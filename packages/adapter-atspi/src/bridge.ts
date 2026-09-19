/**
 * The one part of this adapter that touches Linux (T23, SF-23, REQ-ADP-7).
 *
 * AT-SPI2 is a D-Bus service. An application publishes its accessibility tree on
 * a bus of its own — the *accessibility bus*, whose address the session bus's
 * `org.a11y.Bus` hands out — and a client walks it with
 * `org.a11y.atspi.Accessible` calls. There is no native module here and none is
 * wanted: `gdbus` ships with GLib, which is on every GNOME or GTK system, and
 * calling it is the same shape the macOS adapter uses with `osascript`.
 *
 * ## What is validated and what is not
 *
 * **Everything above this file is a pure function of an `AtspiNode[]`** — the
 * role map, the tree shape, candidate matching, the predicates — and every one
 * of those is driven by `tree.test.ts` against recorded answers, on this
 * machine, with no Linux anywhere. That is the same arrangement `adapter-ax`
 * uses and the reason its tree code could be tested on a host with no
 * Accessibility permission.
 *
 * **This file has not been run against a live AT-SPI registry.** No Linux
 * runner is provisioned for this repository, and the honest label for that is
 * *implemented, unvalidated here* — which is what the support matrix says, with
 * what would have to be true beside it. Nothing in the coverage report counts
 * an AT-SPI row as passing, and `probeAdapter("atspi")` on any host without the
 * bus answers with what it looked for and did not find.
 *
 * ## Why `gdbus` and not a D-Bus library
 *
 * REQ-PKG-3 admits MIT, Apache-2.0 and BSD only, and the maintained Node D-Bus
 * bindings are either native (a compile on every install) or carry a licence
 * outside that set. `gdbus` is a program the desktop already has, exactly as
 * `expect(1)` is for the terminal surface and `osascript` is for macOS.
 */
import { spawn } from "node:child_process";

/** One element of an AT-SPI tree, flattened with parent indices. */
export interface AtspiNode {
  /** Index of this node's parent in the same array; `-1` for the root. */
  readonly parent: number;
  /** The AT-SPI role name, e.g. `push button`. Mapped to ARIA by `tree.ts`. */
  readonly role: string;
  /** `Accessible.Name`. */
  readonly name?: string;
  /** `Accessible.Description`. */
  readonly description?: string;
  /** `Text.GetText`, when the element has the Text interface. */
  readonly text?: string;
  /** `Value.CurrentValue`, or the text of an editable element. */
  readonly value?: string;
  /**
   * The application's own id for the element.
   *
   * AT-SPI publishes it in the object's attributes, as GTK's `accessible-id`
   * or as `id` — the same fact `AXIdentifier` carries on macOS and
   * `AutomationId` on Windows, which is what makes one binding work on three
   * platforms (LLD §3.3).
   */
  readonly automationId?: string;
  /** The state set, lower-cased AT-SPI state names: `enabled`, `focused`, … */
  readonly states?: readonly string[];
  /** `Component.GetExtents`: `[x, y, width, height]`. */
  readonly box?: readonly [number, number, number, number];
  /** The names of the actions the element declares, from `Action.GetActions`. */
  readonly actions?: readonly string[];
  /**
   * What the bus said when the element's Action interface was asked and did
   * not answer (SF-11).
   *
   * Absent both when the element has no Action interface and when it answered.
   * The walker used to drop this error with every other one, so a D-Bus call
   * that timed out once read exactly like an element that offers no actions,
   * and the gesture was refused as unsupported: "never", about something a
   * second read would have answered.
   */
  readonly actionsError?: string;
  /**
   * The object itself on the bus: the application's bus name and the object's
   * path (SF-10).
   *
   * This is the one identity AT-SPI gives an element that does not depend on
   * where it sits or what it is called. The walker publishes it when the
   * binding exposes it; when it does not, a check falls back to the element's
   * id or name and refuses to guess between elements those cannot tell apart.
   */
  readonly address?: { readonly bus: string; readonly path: string };
}

export interface AtspiWindow {
  readonly nodes: readonly AtspiNode[];
  readonly title?: string;
  readonly truncated: boolean;
}

export type AtspiCommand =
  | { readonly kind: "action"; readonly path: readonly number[]; readonly action: string }
  | { readonly kind: "setValue"; readonly path: readonly number[]; readonly value: string }
  | { readonly kind: "focus"; readonly path: readonly number[] }
  | { readonly kind: "keystroke"; readonly text: string }
  | { readonly kind: "key"; readonly key: string };

export interface AtspiAvailability {
  readonly available: boolean;
  /** What the host said, when it could not be reached. */
  readonly reason?: string;
  /** The accessibility bus address, when there is one. */
  readonly busAddress?: string;
}

/** What the adapter needs from Linux. Everything else is a pure function. */
export interface AtspiBridge {
  /** Is there an accessibility bus, and can it be reached? */
  availability(): Promise<AtspiAvailability>;
  /** The accessibility tree of an application's active window. */
  window(request: {
    application: string;
    maxNodes: number;
    deadlineMs?: number;
  }): Promise<AtspiWindow>;
  /** Perform one command; throws `AtspiBridgeError` when the bus refuses. */
  perform(command: AtspiCommand): Promise<void>;
}

export class AtspiBridgeError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AtspiBridgeError";
  }
}

/** Run a program and answer with what it said. Injected, so tests need no bus. */
export type Run = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>;

export const runProcess: Run = (command, args, timeoutMs) =>
  new Promise((done) => {
    const child = spawn(command, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      done({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr, timedOut });
    });
  });

/**
 * The tree walker, as one Python program.
 *
 * The same shape as the macOS bridge's one `osascript` invocation and for the
 * same reason: a walk that spawned `gdbus` once per element would cost a
 * process per node, and a window is hundreds of nodes. `pyatspi` is the
 * binding every Linux desktop already has for its own accessibility tools, and
 * where it is missing the fallback is `gdbus` — one call per node, slow and
 * correct — so a host without `pyatspi` is not a host without a surface.
 *
 * It writes one JSON document on stdout: the flattened tree. Nothing about the
 * shape below is Python-specific; `parseTree` is what reads it and is what the
 * tests drive.
 */
export const WALK_SCRIPT = [
  "import json, sys",
  "try:",
  "    import pyatspi",
  "except Exception as error:",
  "    json.dump({'error': 'pyatspi is not installed: %s' % error}, sys.stdout)",
  "    sys.exit(0)",
  "wanted = sys.argv[1]",
  "limit = int(sys.argv[2])",
  "nodes = []",
  "truncated = [False]",
  "def attribute(element, names):",
  "    try:",
  "        attrs = element.getAttributes()",
  "    except Exception:",
  "        return None",
  "    table = {}",
  "    for one in attrs:",
  "        if ':' in one:",
  "            key, value = one.split(':', 1)",
  "            table[key] = value",
  "    for name in names:",
  "        if name in table:",
  "            return table[name]",
  "    return None",
  /*
   * The object's address, which the walker never published (SF-10).
   *
   * `AtspiNode.address` was declared and read, and nothing wrote it, so the
   * surface's identity check always fell through to names and paths. A pyatspi
   * accessible is a libatspi `AtspiObject`, whose public fields are the
   * application (with its `bus_name`) and the object `path`; PyGObject exposes
   * both as attributes. Both are asked for inside a `try`, because this has not
   * been run against a live registry, and an element whose address cannot be
   * read is published without one rather than with a guess.
   */
  "def address(element):",
  "    try:",
  "        path = element.path",
  "        bus = element.app.bus_name",
  "    except Exception:",
  "        return None",
  "    if isinstance(path, str) and isinstance(bus, str) and path != '' and bus != '':",
  "        return {'bus': bus, 'path': path}",
  "    return None",
  "def failure(error):",
  "    said = str(error).strip()",
  "    return (said or error.__class__.__name__)[:200]",
  "def walk(element, parent):",
  "    if len(nodes) >= limit:",
  "        truncated[0] = True",
  "        return",
  "    node = {'parent': parent, 'role': element.getRoleName()}",
  "    try:",
  "        node['name'] = element.name",
  "    except Exception:",
  "        pass",
  "    try:",
  "        node['description'] = element.description",
  "    except Exception:",
  "        pass",
  "    found = attribute(element, ['accessible-id', 'id', 'automation-id'])",
  "    if found:",
  "        node['automationId'] = found",
  "    try:",
  "        node['states'] = [str(one).split('_', 2)[-1].lower() for one in element.getState().getStates()]",
  "    except Exception:",
  "        pass",
  "    try:",
  "        text = element.queryText()",
  "        node['text'] = text.getText(0, -1)",
  "    except Exception:",
  "        pass",
  "    try:",
  "        value = element.queryValue()",
  "        node['value'] = str(value.currentValue)",
  "    except Exception:",
  "        pass",
  "    try:",
  "        component = element.queryComponent()",
  "        extents = component.getExtents(pyatspi.DESKTOP_COORDS)",
  "        node['box'] = [extents.x, extents.y, extents.width, extents.height]",
  "    except Exception:",
  "        pass",
  /*
   * An element with no Action interface and an Action interface that did not
   * answer are two answers (SF-11). pyatspi raises `NotImplementedError` for
   * the first; anything else — a D-Bus timeout, a `GLib.Error` from an
   * application that is busy — is recorded, so the surface can say "try again"
   * rather than "this element offers nothing".
   */
  "    try:",
  "        action = element.queryAction()",
  "    except NotImplementedError:",
  "        action = None",
  "    except Exception as error:",
  "        action = None",
  "        node['actionsError'] = failure(error)",
  "    if action is not None:",
  "        try:",
  "            node['actions'] = [action.getName(i) for i in range(action.nActions)]",
  "        except Exception as error:",
  "            node['actionsError'] = failure(error)",
  "    where = address(element)",
  "    if where is not None:",
  "        node['address'] = where",
  "    nodes.append(node)",
  "    at = len(nodes) - 1",
  "    try:",
  "        children = list(element)",
  "    except Exception:",
  "        children = []",
  "    for child in children:",
  "        walk(child, at)",
  "desktop = pyatspi.Registry.getDesktop(0)",
  "title = None",
  "for app in desktop:",
  "    try:",
  "        if app.name != wanted:",
  "            continue",
  "    except Exception:",
  "        continue",
  "    for window in app:",
  "        try:",
  "            active = window.getState().contains(pyatspi.STATE_ACTIVE)",
  "        except Exception:",
  "            active = True",
  "        if not active and len(list(app)) > 1:",
  "            continue",
  "        title = window.name",
  "        walk(window, -1)",
  "        break",
  "    break",
  "if title is None:",
  "    json.dump({'error': 'no-window'}, sys.stdout)",
  "else:",
  "    json.dump({'title': title, 'nodes': nodes, 'truncated': truncated[0]}, sys.stdout)",
].join("\n");

/**
 * Read what the walker wrote.
 *
 * Exported and pure, because this is where a malformed answer becomes either a
 * tree or a sentence — and a test can hand it any answer at all without a bus.
 */
export function parseTree(stdout: string): AtspiWindow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new AtspiBridgeError(
      "The accessibility bus answered something that is not a tree.",
      stdout.slice(0, 400),
    );
  }
  const answer = parsed as { error?: string; title?: string; nodes?: unknown; truncated?: boolean };
  if (typeof answer.error === "string") {
    throw new AtspiBridgeError(
      answer.error === "no-window"
        ? "That application publishes no window on the accessibility bus."
        : answer.error,
    );
  }
  if (!Array.isArray(answer.nodes)) {
    throw new AtspiBridgeError("The accessibility bus answered a tree with no nodes.");
  }
  return {
    nodes: answer.nodes as AtspiNode[],
    ...(answer.title === undefined ? {} : { title: answer.title }),
    truncated: answer.truncated === true,
  };
}

export interface AtspiBridgeOptions {
  readonly run?: Run;
  readonly python?: string;
}

/** The bridge as it runs on a Linux desktop. */
export function pythonBridge(options: AtspiBridgeOptions = {}): AtspiBridge {
  const run = options.run ?? runProcess;
  const python = options.python ?? "python3";
  /*
   * The application the last read was of, so a command acts on that one.
   * `PERFORM_SCRIPT` took the first window of the first application on the bus,
   * whatever it was called — right only while the driven application was the
   * only one there, which a desktop with a panel and a file manager never is.
   */
  let application: string | undefined;

  return {
    async availability(): Promise<AtspiAvailability> {
      if (process.platform !== "linux") {
        return {
          available: false,
          reason: `AT-SPI is Linux's accessibility bus; this host is ${process.platform}.`,
        };
      }
      const asked = await run(
        "gdbus",
        [
          "call",
          "--session",
          "--dest",
          "org.a11y.Bus",
          "--object-path",
          "/org/a11y/bus",
          "--method",
          "org.a11y.Bus.GetAddress",
        ],
        10_000,
      );
      if (asked.code !== 0) {
        return {
          available: false,
          reason:
            "`org.a11y.Bus` did not answer on the session bus. Turn toolkit accessibility on " +
            "(GNOME: `gsettings set org.gnome.desktop.interface toolkit-accessibility true`) " +
            "and make sure `at-spi2-registryd` is running. What the bus said: " +
            `${(asked.stderr || asked.stdout).trim().slice(0, 200)}`,
        };
      }
      const address = /'([^']+)'/u.exec(asked.stdout)?.[1];
      return address === undefined
        ? { available: false, reason: "`org.a11y.Bus` answered without an address." }
        : { available: true, busAddress: address };
    },

    async window({ application: wanted, maxNodes, deadlineMs = 30_000 }): Promise<AtspiWindow> {
      application = wanted;
      const asked = await run(python, ["-c", WALK_SCRIPT, wanted, String(maxNodes)], deadlineMs);
      if (asked.timedOut) {
        throw new AtspiBridgeError(
          `Reading "${application}" from the accessibility bus took longer than ${deadlineMs} ms.`,
        );
      }
      if (asked.code !== 0) {
        throw new AtspiBridgeError(
          "The accessibility bus could not be read.",
          (asked.stderr || asked.stdout).trim().slice(0, 400),
        );
      }
      return parseTree(asked.stdout);
    },

    async perform(command: AtspiCommand): Promise<void> {
      const asked = await run(
        python,
        ["-c", PERFORM_SCRIPT, JSON.stringify({ ...command, ...(application === undefined ? {} : { application }) })],
        30_000,
      );
      if (asked.code !== 0 || asked.stdout.includes('"ok": false')) {
        throw new AtspiBridgeError(
          "The accessibility bus refused the command.",
          (asked.stderr || asked.stdout).trim().slice(0, 400),
        );
      }
    },
  };
}

/**
 * Acting, as one program.
 *
 * The path is the index path from the window down, which is what the tree walk
 * produced — so a command addresses the element the snapshot named rather than
 * a D-Bus path that may have been recycled.
 */
export const PERFORM_SCRIPT = [
  "import json, sys",
  "try:",
  "    import pyatspi",
  "except Exception as error:",
  "    json.dump({'ok': False, 'error': 'pyatspi is not installed: %s' % error}, sys.stdout)",
  "    sys.exit(1)",
  "command = json.loads(sys.argv[1])",
  "kind = command['kind']",
  "if kind in ('keystroke', 'key'):",
  "    text = command.get('text') or command.get('key')",
  "    pyatspi.Registry.generateKeyboardEvent(0, text, pyatspi.KEY_STRING)",
  "    json.dump({'ok': True}, sys.stdout)",
  "    sys.exit(0)",
  "path = command['path']",
  "wanted = command.get('application')",
  "element = None",
  "desktop = pyatspi.Registry.getDesktop(0)",
  "for app in desktop:",
  "    try:",
  "        if wanted is not None and app.name != wanted:",
  "            continue",
  "    except Exception:",
  "        continue",
  "    windows = list(app)",
  "    for window in windows:",
  "        try:",
  "            active = window.getState().contains(pyatspi.STATE_ACTIVE)",
  "        except Exception:",
  "            active = True",
  "        if not active and len(windows) > 1:",
  "            continue",
  "        element = window",
  "        break",
  "    if element is not None:",
  "        break",
  "if element is None:",
  "    json.dump({'ok': False, 'error': 'no window of %s is on the accessibility bus' % wanted}, sys.stdout)",
  "    sys.exit(1)",
  "for index in path:",
  "    element = element[index]",
  "if kind == 'action':",
  "    action = element.queryAction()",
  "    names = [action.getName(i) for i in range(action.nActions)]",
  "    action.doAction(names.index(command['action']))",
  "elif kind == 'setValue':",
  "    element.queryEditableText().setTextContents(command['value'])",
  "elif kind == 'focus':",
  "    element.queryComponent().grabFocus()",
  "json.dump({'ok': True}, sys.stdout)",
].join("\n");
