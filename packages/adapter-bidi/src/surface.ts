/**
 * The BiDi adapter: `AgentSurface` over WebDriver BiDi (T4.1, LLD §7.3, REQ-ADP-4).
 *
 * The independence proof. Nothing here shares a line with the Playwright
 * adapter: a WebSocket, a command table, an injected script, and the same
 * `AgentSurface` on top. If the surface is a real boundary then a plan recorded
 * through Playwright replays through this with identical statuses, and if it is
 * not, this is where that shows.
 *
 * Two things BiDi does not give you and Playwright does, both of which LLD §7.3
 * puts in the adapter deliberately:
 *
 * * **Actionability.** There is no "wait until this button is ready" in the
 *   protocol. `session.ts` implements the wait the spec names — visible, enabled,
 *   and a box unchanged over two frames — so no caller above the surface has to.
 * * **Accessible names and roles.** BiDi exposes the DOM, not an accessibility
 *   tree with references. `page-script.ts` computes both, which is why
 *   `snapshot()` here has the same shape as `snapshot()` there (REQ-SURF-4).
 *
 * What BiDi genuinely cannot do is declared in `BIDI_CAPABILITIES` rather than
 * emulated, which is the rule this adapter was specified under: a capability
 * flag is an honest answer, and a half-working emulation is not.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type {
  ActArgs,
  ActResult,
  Candidate,
  Capabilities,
  CheckResult,
  CheckSubject,
  Config,
  ElementDescription,
  Predicate,
  ReadKind,
  Ref,
  SessionInit,
  SessionState,
  Snapshot,
  SurfaceAction,
  SurfaceKind,
} from "@svatah/schema";
import { DEFAULT_IGNORE_ATTRIBUTES } from "@svatah/schema";
import type { AgentSurface } from "@svatah/surface";
import {
  ActionabilityError,
  buildSnapshot,
  LocateError,
  NavigationError,
  ScriptError,
  SessionError,
  structuralHash,
  type SnapshotNode,
} from "@svatah/surface";
import { BidiClient } from "./client.js";
import { openEndpoint, type BidiEndpoint, type LaunchOptions } from "./launch.js";
import { BidiSession, fromRemoteValue, sleep, toLocalValue } from "./session.js";
import type { RawCandidate } from "./page-script.js";
import { evaluateBidiPredicate } from "./predicates.js";
import { keyActions, pointerClick, pointerDrag, typeText } from "./input.js";

/** How many neighbouring texts `describe()` collects on each side (LLD §3.3). */
const NEIGHBOUR_COUNT = 3;
const DEFAULT_MAX_NODES = 1_500;

/**
 * What this adapter can do (LLD §2.4, §7.3).
 *
 * > capability flags declare what BiDi cannot do rather than emulating it.
 *
 * `trace` is the one false flag, and it is false because BiDi has no tracing:
 * Playwright's trace viewer is a Playwright artefact, not a protocol feature,
 * and a "trace" this adapter wrote would be a different file with the same name.
 * `webmcp` is false everywhere until REQ-ADP-9 (P2).
 */
export const BIDI_CAPABILITIES: Capabilities = {
  dialogs: true,
  frames: true,
  windows: true,
  upload: true,
  drag: true,
  trace: false,
  webmcp: false,
  screenshot: true,
  restore: true,
};

export interface BidiAdapterOptions extends LaunchOptions {
  /** Per-action timeout; `Config.run.stepTimeoutMs`. */
  timeoutMs?: number;
  testIdAttributes?: readonly string[];
  /** `config.bindings.ignoreAttributes` (LLD §3.5): never reported by the surface. */
  ignoreAttributes?: readonly string[];
  maxNodes?: number;
}

export class BidiSurface implements AgentSurface {
  readonly kind: SurfaceKind = "web";

  private endpoint: BidiEndpoint | undefined;
  private client: BidiClient | undefined;
  private session: BidiSession | undefined;
  private baseUrl: string | undefined;
  private storageStatePath: string | undefined;
  /** How the endpoint was obtained: a launched binary, or an attached URL. */
  private servedBy = "(not open)";

  constructor(private readonly options: BidiAdapterOptions = {}) {}

  /* ── lifecycle ──────────────────────────────────────────────────────────── */

  capabilities(): Capabilities {
    return { ...BIDI_CAPABILITIES };
  }

  /**
   * Which browser is actually answering, as it names itself.
   *
   * `firefox 153.0 (launched)`, not the path to a binary in somebody's home
   * directory: a conformance report is committed, and one that recorded a path
   * would record whose machine ran it (LLD §16).
   */
  browser(): string {
    if (this.session === undefined) return this.servedBy;
    return `${this.session.describedBrowser} (${this.servedBy})`;
  }

  async open(session: SessionInit): Promise<void> {
    if (session.appPath !== undefined || session.processName !== undefined) {
      throw new SessionError(
        "The BiDi adapter drives browsers, not applications; `appPath` and `processName` " +
          "belong to the desktop adapters (LLD §7.5).",
        { adapter: "bidi" },
      );
    }
    this.baseUrl = session.baseUrl;

    const endpoint = await openEndpoint(this.options);
    this.endpoint = endpoint;
    this.servedBy = endpoint.launched
      ? "launched"
      : endpoint.hosted
        ? "attached to a driver-hosted session"
        : "attached";

    const trace = process.env["SVATAH_BIDI_TRACE"] === "1";
    this.client = await BidiClient.connect(endpoint.url, {
      commandTimeoutMs: Math.max(30_000, (this.options.timeoutMs ?? 10_000) * 3),
      ...(trace
        ? {
            // `SVATAH_BIDI_TRACE=1` exists to be read on a terminal, so it
            // writes to stderr rather than through a logger nothing here has.
            onTraffic: (direction, message) =>
              console.error(`bidi ${direction} ${JSON.stringify(message).slice(0, 400)}`),
          }
        : {}),
    });

    this.session = await BidiSession.open(this.client, {
      testIdAttributes: this.options.testIdAttributes ?? ["data-testid"],
      ignoreAttributes: this.options.ignoreAttributes ?? DEFAULT_IGNORE_ATTRIBUTES,
      timeoutMs: this.options.timeoutMs ?? 10_000,
      hosted: endpoint.hosted,
    });

    if (session.storageState !== undefined) {
      this.storageStatePath = session.storageState;
      await this.applyStorageState(session.storageState);
    }
  }

  async close(): Promise<void> {
    /*
     * Order matters: end the BiDi session so the browser shuts its contexts
     * cleanly, then drop the socket, then kill whatever we launched. Killing
     * first leaves a profile directory locked on Windows.
     *
     * `session.end` gets a short leash of its own. It is a courtesy — the kill
     * below is what actually ends the browser — and a browser that has already
     * wandered off must not make closing a session take the full command
     * timeout, thirty seconds at a time, once per flow.
     */
    /*
     * A session we did not create is not ours to end (Draft 2.6, LLD §7.3).
     *
     * When the URL is `…/session/<id>`, the classic session belongs to whoever
     * created it through the driver, and they will `DELETE /session/<id>` when
     * they are done. Ending it here would take the browser away from a caller
     * that meant to keep driving it, and would make a second `open()` against
     * the same URL fail on an endpoint that no longer has a session.
     */
    if (this.endpoint?.hosted !== true) {
      await this.client?.send("session.end", {}, { timeoutMs: 2_000 }).catch(() => undefined);
    }
    await this.client?.close();
    await this.endpoint?.close();
    this.session = undefined;
    this.client = undefined;
    this.endpoint = undefined;
  }

  private live(): BidiSession {
    if (this.session === undefined) {
      throw new SessionError("The BiDi session is not open.", { adapter: "bidi" });
    }
    return this.session;
  }

  /* ── snapshot, locate, describe ─────────────────────────────────────────── */

  async snapshot(opts: { root?: Ref; maxNodes?: number; interactiveOnly?: boolean } = {}): Promise<Snapshot> {
    const session = this.live();
    const nodes = (await session.walk({
      maxNodes: opts.maxNodes ?? this.options.maxNodes ?? DEFAULT_MAX_NODES,
      interactiveOnly: opts.interactiveOnly === true,
      ...(opts.root === undefined ? {} : { root: opts.root }),
    })) as SnapshotNode[];
    const root = opts.root ?? nodes[0]?.ref ?? "r0";
    return buildSnapshot(root, nodes, structuralHash(nodes));
  }

  async locate(candidate: Candidate): Promise<Ref[]> {
    assertWebCandidate(candidate);
    const flat: RawCandidate = {
      by: candidate.by,
      ...(candidate.role === undefined ? {} : { role: candidate.role }),
      ...(candidate.name === undefined ? {} : { name: candidate.name }),
      ...(candidate.exact === undefined ? {} : { exact: candidate.exact }),
      ...(candidate.value === undefined ? {} : { value: candidate.value }),
      ...(candidate.attribute === undefined ? {} : { attribute: candidate.attribute }),
      ...(candidate.nth === undefined ? {} : { nth: candidate.nth }),
    };
    return await this.live().locate(flat);
  }

  async describe(ref: Ref): Promise<ElementDescription> {
    const raw = await this.live().describe(ref, NEIGHBOUR_COUNT);
    return { ref, ...raw } as ElementDescription;
  }

  /* ── act ────────────────────────────────────────────────────────────────── */

  async act(action: SurfaceAction, ref?: Ref, args: ActArgs = {}, ref2?: Ref): Promise<ActResult> {
    const session = this.live();
    const timeout = this.options.timeoutMs ?? 10_000;

    const need = (which: Ref | undefined): Ref => {
      if (which === undefined) {
        throw new LocateError(`The "${action}" action needs a reference.`, { adapter: "bidi" });
      }
      return which;
    };
    const str = (name: string, fallback?: string): string => {
      const value = args[name];
      if (value === undefined) {
        if (fallback !== undefined) return fallback;
        throw new ScriptError(`The "${action}" action needs an argument "${name}".`, {
          adapter: "bidi",
        });
      }
      return Array.isArray(value) ? value.join(",") : String(value);
    };
    /** Scroll into view, wait for actionability, and hand back the box. */
    const ready = async (which: Ref): Promise<[number, number, number, number]> => {
      await session.scrollIntoView(which);
      const state = await session.waitActionable(which, timeout);
      return state.box;
    };

    switch (action) {
      /* ── navigation ───────────────────────────────────────────────────── */
      case "navigate": {
        const url = str("url");
        const absolute =
          /^[a-z][a-z0-9+.-]*:/i.test(url) || this.baseUrl === undefined
            ? url
            : new URL(url, this.baseUrl).toString();
        await session.client.call("browsingContext.navigate", {
          context: session.window(),
          url: absolute,
          wait: "complete",
        });
        session.activeFrame = undefined;
        return { ok: true, navigated: true };
      }
      case "back":
      case "forward": {
        const before = session.navigationCount();
        await session.client.call("browsingContext.traverseHistory", {
          context: session.window(),
          delta: action === "back" ? -1 : 1,
        });
        /*
         * `traverseHistory` answers as soon as the traversal is *scheduled*, and
         * there is no `wait` parameter for it the way there is for `navigate`.
         * Waiting on the navigation the traversal starts is the difference
         * between the next step resolving against the page it went back to and
         * resolving against `about:blank` halfway through the transition — which
         * is what the fixtures' `Go back` did before this.
         */
        await session.settleIfNavigated(before, timeout);
        session.activeFrame = undefined;
        return { ok: true, navigated: true };
      }
      case "refresh": {
        const before = session.navigationCount();
        await session.client.call("browsingContext.reload", {
          context: session.window(),
          wait: "complete",
        });
        await session.settleIfNavigated(before, timeout, 0);
        session.activeFrame = undefined;
        return { ok: true, navigated: true };
      }

      /* ── pointer ──────────────────────────────────────────────────────── */
      case "click":
      case "doubleClick":
      case "rightClick":
      case "hover":
      case "hoverAndClick":
      case "pressAndHold":
      case "release": {
        const target = need(ref);
        await ready(target);
        const shared = await session.sharedId(target);
        const before = session.navigationCount();
        await pointerClick(session, shared, action);
        // A click on a link comes back before the new document exists; this is
        // where the surface's caller stops having to know that (LLD §7.3).
        const navigated = await session.settleIfNavigated(before, timeout);
        return { ok: true, ref: target, ...(navigated ? { navigated: true } : {}) };
      }
      case "dragTo": {
        const from = need(ref);
        const to = need(ref2);
        await ready(from);
        await ready(to);
        await pointerDrag(session, await session.sharedId(from), await session.sharedId(to));
        return { ok: true, ref: from };
      }

      /* ── keyboard and forms ───────────────────────────────────────────── */
      case "type": {
        const target = need(ref);
        await ready(target);
        await this.focus(target);
        await typeText(session, str("value"));
        return { ok: true, ref: target };
      }
      case "clear": {
        const target = need(ref);
        await ready(target);
        await this.setValue(target, "");
        return { ok: true, ref: target };
      }
      case "press":
      case "keyDown":
      case "keyUp": {
        if (ref !== undefined) {
          await ready(ref);
          await this.focus(ref);
        }
        const before = session.navigationCount();
        await keyActions(session, str("key"), action);
        // `Press "Enter"` in a form is a submission as much as a click is.
        const navigated = await session.settleIfNavigated(before, timeout);
        return { ok: true, ...(ref === undefined ? {} : { ref }), ...(navigated ? { navigated: true } : {}) };
      }
      case "submit": {
        const target = need(ref);
        const before = session.navigationCount();
        await this.withElement(target, (el) => {
          const form = el.tagName.toLowerCase() === "form" ? (el as HTMLFormElement) : el.closest("form");
          if (form === null) return false;
          if (typeof form.requestSubmit === "function") form.requestSubmit();
          else form.submit();
          return true;
        });
        await session.settleIfNavigated(before, timeout);
        return { ok: true, ref: target, navigated: true };
      }
      case "upload": {
        const target = need(ref);
        const files = args["files"] ?? args["value"];
        const list = Array.isArray(files) ? files : [String(files ?? "")];
        await session.client.call("input.setFiles", {
          context: session.context(),
          element: { sharedId: await session.sharedId(target) },
          files: list,
        });
        return { ok: true, ref: target };
      }

      /* ── selects and checkboxes ───────────────────────────────────────── */
      case "selectOption":
      case "deselectOption":
      case "deselectAll": {
        const target = need(ref);
        const raw = args["values"] ?? args["value"] ?? args["label"] ?? [];
        const wanted = Array.isArray(raw) ? raw.map(String) : [String(raw)];
        const mode =
          action === "selectOption" ? "select" : action === "deselectOption" ? "deselect" : "none";
        const ok = await this.withElement(
          target,
          (el, input: { wanted: string[]; mode: string }) => {
            if (el.tagName.toLowerCase() !== "select") return false;
            const select = el as HTMLSelectElement;
            for (const option of Array.from(select.options)) {
              const named =
                input.wanted.includes(option.value) ||
                input.wanted.includes(option.label) ||
                input.wanted.includes((option.textContent ?? "").trim());
              if (input.mode === "none") option.selected = false;
              else if (named) option.selected = input.mode === "select";
              else if (input.mode === "select" && !select.multiple) option.selected = false;
            }
            select.dispatchEvent(new Event("input", { bubbles: true }));
            select.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          },
          { wanted, mode },
        );
        if (!ok) {
          throw new ScriptError(`"${action}" needs a <select>.`, { adapter: "bidi" });
        }
        return { ok: true, ref: target };
      }
      case "setChecked": {
        const target = need(ref);
        await ready(target);
        const wanted = args["checked"] !== false && args["checked"] !== "false";
        const state = await this.withElement(target, (el) => (el as HTMLInputElement).checked === true);
        if (state !== wanted) {
          await pointerClick(session, await session.sharedId(target), "click");
        }
        return { ok: true, ref: target };
      }

      /* ── scrolling ────────────────────────────────────────────────────── */
      case "scrollIntoView":
        await session.scrollIntoView(need(ref));
        return { ok: true, ref };
      case "scrollToTop":
      case "scrollToBottom":
        await session.evaluate(
          action === "scrollToTop"
            ? "window.scrollTo(0, 0)"
            : "window.scrollTo(0, document.body.scrollHeight)",
        );
        return { ok: true };

      /* ── waiting ──────────────────────────────────────────────────────── */
      case "sleep": {
        const ms = Number(args["ms"] ?? args["seconds"] ?? 0) * (args["seconds"] === undefined ? 1 : 1000);
        await sleep(Math.max(0, ms));
        return { ok: true };
      }
      case "waitFor": {
        const target = need(ref);
        const state = String(args["state"] ?? "visible");
        await session.waitFor(
          async () => {
            const now = await session.actionability(target).catch(() => undefined);
            if (now === undefined) return state === "hidden" || state === "detached";
            if (state === "hidden") return !now.visible;
            if (state === "detached") return !now.attached;
            if (state === "enabled") return now.enabled;
            return now.visible;
          },
          timeout,
          `${target} to be ${state}`,
        );
        return { ok: true, ref: target };
      }

      /* ── windows and frames ───────────────────────────────────────────── */
      case "switchWindow": {
        await this.refreshWindows();
        const index = Number(args["index"] ?? NaN);
        if (Number.isInteger(index)) {
          if (index < 0 || index >= session.windows.length) {
            throw new NavigationError(
              `There is no window ${index}; the session has ${session.windows.length}.`,
              { adapter: "bidi" },
            );
          }
          session.activeWindow = index;
        } else {
          const wanted = String(args["title"] ?? args["url"] ?? "");
          const found = await this.findWindow(wanted);
          if (found < 0) {
            throw new NavigationError(`No open window matches "${wanted}".`, { adapter: "bidi" });
          }
          session.activeWindow = found;
        }
        session.activeFrame = undefined;
        /*
         * Bringing the window to the front is a courtesy to a watching human,
         * not something driving it depends on — every command already names its
         * context. Headless Gecko never answers `activate` at all, so it is
         * asked for only in a headed session, and even then on a short leash: a
         * `switchWindow` that took thirty seconds to do nothing would be worse
         * than one that skipped the courtesy.
         */
        if (this.options.headless === false) {
          await session.client
            .call("browsingContext.activate", { context: session.window() }, { timeoutMs: 1_500 })
            .catch(() => undefined);
        }
        return { ok: true };
      }
      case "closeOtherWindows": {
        await this.refreshWindows();
        const keep = session.window();
        for (const context of [...session.windows]) {
          if (context === keep) continue;
          await session.client
            .call("browsingContext.close", { context }, { timeoutMs: 5_000 })
            .catch(() => undefined);
        }
        session.windows = [keep];
        session.activeWindow = 0;
        session.activeFrame = undefined;
        return { ok: true };
      }
      case "switchFrame": {
        const tree = (await session.client.call("browsingContext.getTree", {
          root: session.window(),
        })) as { contexts?: Array<{ children?: Array<{ context: string; url: string }> }> };
        const children = tree.contexts?.[0]?.children ?? [];

        const name = args["name"] === undefined ? undefined : String(args["name"]);
        // `main` is the flow language's word for "back to the document".
        if (name === "main" || args["index"] === "main") {
          session.activeFrame = undefined;
          return { ok: true };
        }
        const wantedUrl = args["url"] === undefined ? undefined : String(args["url"]);
        const index = Number(args["index"] ?? NaN);

        let chosen: string | undefined;
        if (Number.isInteger(index)) chosen = children[index]?.context;
        else if (wantedUrl !== undefined) chosen = children.find((c) => c.url.includes(wantedUrl))?.context;
        else if (name !== undefined) {
          // A frame's `name` attribute lives in the parent document, not in the
          // BiDi tree, so it is read from the DOM and matched by position.
          const at = await session.callFunction<number>(
            ((wanted: string) =>
              Array.from(document.querySelectorAll("iframe,frame")).findIndex(
                (f) =>
                  f.getAttribute("name") === wanted ||
                  f.getAttribute("id") === wanted ||
                  f.getAttribute("title") === wanted,
              )) as never,
            [name],
            { context: session.window() },
          );
          chosen = at >= 0 ? children[at]?.context : undefined;
        }
        if (chosen === undefined) {
          throw new NavigationError(
            `No frame matches ${JSON.stringify(args)}; the document has ${children.length}.`,
            { adapter: "bidi" },
          );
        }
        session.activeFrame = chosen;
        return { ok: true };
      }

      /* ── dialogs ──────────────────────────────────────────────────────── */
      /* ── dialogs ────────────────────────────────────────────────────── */
      case "dialog": {
        /*
         * `args.action`, and nothing else (Draft 2.8 LLD §3.2).
         *
         * The grammar has always emitted `{ action: "accept" | "dismiss" }`
         * and this adapter read `args.accept`, which no step ever carried —
         * so `args.accept === undefined` and the default `true` accepted
         * every dialog, including the ones a flow said to dismiss. `Dismiss
         * the dialog` left the sample page saying `confirmed` end to end
         * (K7, confirmed by the Phase 6 verification as F4).
         *
         * §3.2 now fixes the key on both sides and adds the sentence that
         * makes this a defect rather than a preference: "an adapter that
         * defaults a missing `action` to accept is a defect". A missing
         * `action` is a caller error and is refused, because the two ways of
         * being wrong are not symmetric — a dialog wrongly dismissed shows up
         * as a failing assertion, and one wrongly accepted silently confirms
         * whatever it was asking about.
         */
        const answer = args["action"];
        if (answer !== "accept" && answer !== "dismiss") {
          throw new ActionabilityError(
            'The "dialog" action needs args.action of "accept" or "dismiss" ' +
              `(LLD §3.2), and was given ${answer === undefined ? "nothing" : JSON.stringify(answer)}. ` +
              "A missing action is never treated as accept: a dialog wrongly accepted confirms " +
              "whatever it asked about and says nothing about it.",
            { adapter: "bidi" },
          );
        }
        const text = args["text"];
        session.dialogPolicy = {
          accept: answer === "accept",
          /*
           * `text`, which is what the grammar emits; `promptText` is still read
           * because the raw schema accepts it as a synonym a model may have
           * learned, and dropping it would silently type nothing into a prompt.
           */
          ...(text === undefined
            ? args["promptText"] === undefined
              ? {}
              : { promptText: String(args["promptText"]) }
            : { promptText: String(text) }),
        };
        return { ok: true };
      }

      /* ── reading and scripting ────────────────────────────────────────── */
      case "read": {
        const kind = String(args["kind"] ?? "text") as ReadKind;
        return { ok: true, value: await this.read(kind, ref, args["name"] === undefined ? undefined : String(args["name"])) };
      }
      case "evaluate": {
        const expression = str("script", str("expression", ""));
        if (expression === "") {
          throw new ScriptError('The "evaluate" action needs a "script" argument.', {
            adapter: "bidi",
          });
        }
        return { ok: true, value: await session.evaluate(`(() => { ${expression} })()`) };
      }
      case "screenshot": {
        await this.screenshot(str("path"));
        return { ok: true };
      }

      case "invoke":
        throw new ScriptError(
          '"invoke" calls another story and is the executor\'s, not an adapter\'s (LLD §8.2).',
          { adapter: "bidi" },
        );
      default: {
        const never: never = action;
        throw new ScriptError(`The BiDi adapter has no row for "${String(never)}".`, {
          adapter: "bidi",
        });
      }
    }
  }

  /* ── read and check ─────────────────────────────────────────────────────── */

  async read(kind: ReadKind, ref?: Ref, name?: string): Promise<unknown> {
    const session = this.live();
    if (kind === "url") {
      /*
       * `location.href`, not `browsingContext.getTree`'s `url`.
       *
       * Gecko updates the tree's URL lazily: a click that navigates leaves the
       * tree reporting the *previous* document for a while after the new one has
       * loaded, so a caller that acted and then read the URL would see where it
       * used to be. The document itself is never wrong about where it is.
       */
      return String(await session.evaluate("location.href", { context: session.window() }));
    }
    if (kind === "title") return await session.evaluate("document.title");

    if (ref === undefined) {
      throw new LocateError(`Reading "${kind}" needs a reference.`, { adapter: "bidi" });
    }
    switch (kind) {
      case "text":
      case "result":
        return await this.withElement(ref, (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim());
      case "value":
        return await this.withElement(ref, (el) => {
          const tag = el.tagName.toLowerCase();
          if (tag === "select") {
            return Array.from((el as HTMLSelectElement).selectedOptions)
              .map((o) => o.value)
              .join(", ");
          }
          if (tag === "input" || tag === "textarea") return (el as HTMLInputElement).value;
          return (el.textContent ?? "").replace(/\s+/g, " ").trim();
        });
      case "attribute": {
        if (name === undefined) {
          throw new LocateError('Reading "attribute" needs the attribute name.', {
            adapter: "bidi",
          });
        }
        return await this.withElement(ref, (el, which: string) => el.getAttribute(which), name);
      }
      default:
        throw new LocateError(`Unknown read kind "${String(kind)}".`, { adapter: "bidi" });
    }
  }

  async check(predicate: Predicate, subject: CheckSubject, ref?: Ref): Promise<CheckResult> {
    return await evaluateBidiPredicate(this.live(), predicate, subject, ref, (r, fn, extra) =>
      this.withElement(r, fn as never, extra),
    );
  }

  /* ── screenshots, state, storage ────────────────────────────────────────── */

  /**
   * A screenshot, with the boxes of the masked references painted over
   * (REQ-NFR-6: screenshots of secret-injecting steps are masked).
   *
   * BiDi has no mask parameter, so the masking is done in the page: a solid
   * overlay per masked element, added before the capture and removed after. The
   * overlay is never in the DOM when `describe()` runs, so nothing above the
   * surface can see it.
   */
  async screenshot(path: string, mask?: Ref[]): Promise<void> {
    const session = this.live();
    const boxes: Array<[number, number, number, number]> = [];
    for (const ref of mask ?? []) {
      const state = await session.actionability(ref).catch(() => undefined);
      if (state !== undefined) boxes.push(state.box);
    }
    if (boxes.length > 0) await this.paintMasks(boxes);
    try {
      const shot = (await session.client.call("browsingContext.captureScreenshot", {
        context: session.window(),
      })) as { data?: string };
      writeFileSync(path, Buffer.from(shot.data ?? "", "base64"));
    } finally {
      if (boxes.length > 0) await this.clearMasks();
    }
  }

  async state(): Promise<SessionState> {
    const session = this.live();
    const state: SessionState = {
      kind: "web",
      url: String(await this.read("url")),
      windowIndex: session.activeWindow,
    };
    const title = await session.evaluate("document.title").catch(() => undefined);
    if (typeof title === "string") state.windowTitle = title;
    if (session.activeFrame !== undefined) state.frame = session.activeFrame;
    const dialog = session.dialogs[session.dialogs.length - 1];
    state.dialog = dialog === undefined ? null : { type: dialog.type, message: dialog.message };
    if (this.storageStatePath !== undefined) state.storageState = this.storageStatePath;
    return state;
  }

  async restore(state: SessionState): Promise<void> {
    if (state.kind !== "web") {
      throw new SessionError(`Cannot restore a "${state.kind}" session into a web adapter.`, {
        adapter: "bidi",
      });
    }
    const session = this.live();
    if (state.storageState !== undefined) await this.applyStorageState(state.storageState);
    if (state.windowIndex !== undefined && state.windowIndex < session.windows.length) {
      session.activeWindow = state.windowIndex;
    }
    session.activeFrame = undefined;
    if (state.url !== undefined && state.url !== "about:blank") {
      await session.client.call("browsingContext.navigate", {
        context: session.window(),
        url: state.url,
        wait: "complete",
      });
    }
  }

  /* ── helpers ────────────────────────────────────────────────────────────── */

  /**
   * Run a function against one element, by BiDi node reference.
   *
   * The element crosses as a `sharedId` rather than as an index the page looks
   * up, so the function is the same self-contained function it reads as.
   */
  private async withElement<T>(
    ref: Ref,
    fn: (el: Element, extra: never) => T,
    extra?: unknown,
  ): Promise<T> {
    const session = this.live();
    const shared = await session.sharedId(ref);
    const result = (await session.client.call("script.callFunction", {
      functionDeclaration: fn.toString(),
      arguments: [{ sharedId: shared }, toLocalValue(extra)],
      target: { context: session.context() },
      awaitPromise: true,
      serializationOptions: { maxObjectDepth: 20, maxDomDepth: 0 },
    })) as { type?: string; result?: unknown; exceptionDetails?: { text?: string } };
    if (result.type === "exception") {
      throw new ScriptError(
        `A script in the page threw: ${result.exceptionDetails?.text ?? "unknown error"}`,
        { adapter: "bidi" },
      );
    }
    return fromRemoteValue(result.result) as T;
  }

  private async focus(ref: Ref): Promise<void> {
    await this.withElement(ref, (el) => {
      (el as HTMLElement).focus();
      return true;
    });
  }

  /** Set a control's value and fire the events a framework listens for. */
  private async setValue(ref: Ref, value: string): Promise<void> {
    await this.withElement(
      ref,
      (el, next: string) => {
        const input = el as HTMLInputElement;
        input.focus();
        input.value = next;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      },
      value,
    );
  }

  /** Wait for the document to be ready again, after a navigation-like action. */
  private async settle(): Promise<void> {
    const session = this.live();
    await session
      .waitFor(
        async () => (await session.evaluate("document.readyState")) === "complete",
        Math.min(this.options.timeoutMs ?? 10_000, 10_000),
        "the document to finish loading",
      )
      .catch(() => undefined);
  }

  /** Re-read the top-level contexts, in case one opened without an event. */
  private async refreshWindows(): Promise<void> {
    const session = this.live();
    const tree = (await session.client.call("browsingContext.getTree", {})) as {
      contexts?: Array<{ context: string }>;
    };
    const live = (tree.contexts ?? []).map((c) => c.context);
    // Keep the order the session already knew — `switchWindow --index 1` means
    // "the one that opened second", not "whatever the browser lists second".
    const known = session.windows.filter((c) => live.includes(c));
    session.windows = [...known, ...live.filter((c) => !known.includes(c))];
    if (session.activeWindow >= session.windows.length) session.activeWindow = 0;
  }

  private async findWindow(wanted: string): Promise<number> {
    const session = this.live();
    for (let index = 0; index < session.windows.length; index += 1) {
      const context = session.windows[index]!;
      const title = await session.evaluate("document.title", { context }).catch(() => undefined);
      const url = await session.evaluate("location.href", { context }).catch(() => "");
      if (String(title ?? "").includes(wanted) || String(url ?? "").includes(wanted)) return index;
    }
    return -1;
  }

  private async paintMasks(boxes: Array<[number, number, number, number]>): Promise<void> {
    await this.live().callFunction(
      ((rects: Array<[number, number, number, number]>) => {
        const layer = document.createElement("div");
        layer.id = "__svatah_mask__";
        layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
        for (const [x, y, w, h] of rects) {
          const box = document.createElement("div");
          box.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:#ff00ff`;
          layer.appendChild(box);
        }
        document.body.appendChild(layer);
        return true;
      }) as never,
      [boxes],
    );
  }

  private async clearMasks(): Promise<void> {
    await this.live()
      .evaluate("document.getElementById('__svatah_mask__')?.remove()")
      .catch(() => undefined);
  }

  /**
   * Apply a Playwright-shaped storage-state file (LLD §7.1).
   *
   * The same file both adapters read, because a project's `config.app.
   * storageState` must not mean two things. Cookies go through
   * `storage.setCookie`; `localStorage` origins are set by navigating to the
   * origin and writing them, which is the only way any protocol can do it.
   */
  private async applyStorageState(path: string): Promise<void> {
    const session = this.live();
    let parsed: {
      cookies?: Array<{
        name: string;
        value: string;
        domain: string;
        path?: string;
        expires?: number;
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: string;
      }>;
      origins?: Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>;
    };
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as typeof parsed;
    } catch (cause) {
      throw new SessionError(`Could not read the storage state at ${path}.`, {
        adapter: "bidi",
        cause,
      });
    }

    for (const cookie of parsed.cookies ?? []) {
      await session.client
        .call("storage.setCookie", {
          cookie: {
            name: cookie.name,
            value: { type: "string", value: cookie.value },
            domain: cookie.domain,
            path: cookie.path ?? "/",
            ...(cookie.expires !== undefined && cookie.expires > 0
              ? { expiry: Math.floor(cookie.expires) }
              : {}),
            httpOnly: cookie.httpOnly ?? false,
            secure: cookie.secure ?? false,
            ...(cookie.sameSite === undefined ? {} : { sameSite: cookie.sameSite.toLowerCase() }),
          },
        })
        .catch(() => undefined);
    }

    for (const origin of parsed.origins ?? []) {
      if ((origin.localStorage ?? []).length === 0) continue;
      await session.client.call("browsingContext.navigate", {
        context: session.window(),
        url: origin.origin,
        wait: "complete",
      });
      await session.callFunction(
        ((entries: Array<{ name: string; value: string }>) => {
          for (const entry of entries) window.localStorage.setItem(entry.name, entry.value);
          return true;
        }) as never,
        [origin.localStorage],
      );
    }
  }
}

/** Candidate kinds this adapter cannot honour, and which adapter owns each. */
const FOREIGN_KINDS: Record<string, string> = {
  accessibilityId: "the Appium adapter",
  resourceId: "the Appium adapter",
  automationId: "the UIA and AX adapters",
  controlPath: "the UIA and AX adapters",
};

function assertWebCandidate(candidate: Candidate): void {
  const foreign = FOREIGN_KINDS[candidate.by];
  if (foreign !== undefined) {
    throw new LocateError(
      `A "${candidate.by}" candidate belongs to ${foreign}; the BiDi adapter cannot honour it.`,
      { adapter: "bidi" },
    );
  }
  if (candidate.by === "webmcp") {
    // Declared `false` in the capability descriptor, so the resolver falls
    // through to the locator candidates behind it (LLD §6.3).
    throw new LocateError("The BiDi adapter has no WebMCP support (REQ-ADP-9 is P2).", {
      adapter: "bidi",
    });
  }
  const needsValue = [
    "label",
    "placeholder",
    "testid",
    "text",
    "altText",
    "title",
    "css",
    "xpath",
    "id",
    "name",
    "coords",
  ];
  if (needsValue.includes(candidate.by) && (candidate.value === undefined || candidate.value === "")) {
    throw new LocateError(`A "${candidate.by}" candidate must carry a value.`, { adapter: "bidi" });
  }
  if (candidate.by === "role" && candidate.role === undefined) {
    throw new LocateError('A "role" candidate must carry a role.', { adapter: "bidi" });
  }
}

/** Build a surface from a project config (LLD §2.4). */
export function createBidiSurface(
  config: Config,
  overrides: BidiAdapterOptions = {},
): BidiSurface {
  return new BidiSurface({
    headless: config.run.headless,
    timeoutMs: config.run.stepTimeoutMs,
    testIdAttributes: config.bindings.testIdAttributes,
    ignoreAttributes: config.bindings.ignoreAttributes ?? DEFAULT_IGNORE_ATTRIBUTES,
    ...overrides,
  });
}
