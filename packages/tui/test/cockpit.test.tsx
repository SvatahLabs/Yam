/**
 * `yam ui`'s panes, keys and palette (T9.4, REQ-TUI-1, LLD §13.7).
 *
 * Ink rendered into a string by `ink-testing-library`, against the same
 * recorded service responses `@svatah/yam-screens` tests against — so what is
 * checked here is the *terminal* half and nothing else: that the four panes are
 * drawn, that `1–4`, `Tab`, `j`/`k` and `^K` do what the artboard says, and
 * that the palette lists the registry's actions with their CLI commands.
 *
 * What needs a real terminal — that the cockpit draws in a pseudo-terminal and
 * that `--json` equals the model's state — is
 * `tools/repo-checks/test/tui-pty.test.ts`, which spawns one. The phase's
 * environment note allows `ink-testing-library` where a pseudo-terminal is not
 * available; both are run here, and both are reported.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { render } from "ink";
import {
  ACTIONS,
  SCREEN_IDS,
  actionsForScreen,
  fakeService,
  screenById,
  type FakeResponses,
} from "@svatah/yam-screens";
import { App } from "../src/app.js";
import type { UiState } from "../src/model.js";
import { INSPECTOR_MIN_COLUMNS, layoutFor } from "../src/layout.js";
import { paneModel } from "../src/rows.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(
  readFileSync(
    join(HERE, "..", "..", "screens", "test", "fixtures", "fixtures-project.json"),
    "utf8",
  ),
) as FakeResponses;

const CONNECTION = { url: "http://127.0.0.1:55702", project: "yam-fixtures" };

/**
 * A terminal wide enough for four panes (T10.4, P9-F4).
 *
 * 160×40 is the width the `TUI` artboard is drawn at and the wide capture
 * `pnpm ui:capture` takes.
 */
const WIDE = { columns: 160, rows: 40 };
/** And one that is not: below `INSPECTOR_MIN_COLUMNS`, so three panes. */
const NARROW = { columns: 100, rows: 30 };

/**
 * A fake terminal of a given size (T10.4, P9-F4).
 *
 * `ink-testing-library` hard-codes `columns` at 100 and has no `rows`, so a test
 * of "the panes are sized to the terminal" could not state a terminal to be
 * sized to. This is the same handful of lines with the size as an argument, fed
 * to Ink's own `render` — which means the cockpit reads its width through
 * `useStdout()`, exactly as it does in a real one, with no test-only prop on
 * `App`.
 */
class FakeStdout extends EventEmitter {
  readonly frames: string[] = [];
  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    super();
  }
  write = (frame: string): void => {
    this.frames.push(frame);
  };
  lastFrame = (): string => this.frames[this.frames.length - 1] ?? "";
}

/**
 * A terminal's input side. `read()` hands back exactly one write, which is what
 * Ink's `useInput` pulls when it hears `readable`.
 */
class FakeStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read = (): string | null => {
    const { data } = this;
    this.data = null;
    return data;
  };
  write = (data: string): void => {
    this.data = data;
    this.emit("readable");
    this.emit("data", data);
  };
}

/** Mount `<App>` in a terminal of `size`, with `lastFrame()` and `stdin`. */
function renderApp(
  element: React.JSX.Element,
  size: { columns: number; rows: number } = WIDE,
): { lastFrame: () => string; stdin: FakeStdin; unmount: () => void } {
  const stdout = new FakeStdout(size.columns, size.rows);
  const stdin = new FakeStdin();
  const instance = render(element, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    // `debug` writes every frame rather than only the last on exit, which is
    // what `lastFrame()` reads; the other two are what a test wants of a
    // cockpit that owns the terminal in production.
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { lastFrame: stdout.lastFrame, stdin, unmount: instance.unmount };
}

/** Render the cockpit into a terminal of `size` and wait for its first load. */
async function cockpit(
  screen: "flows" | "run",
  params: Record<string, string> = {},
  size: { columns: number; rows: number } = WIDE,
) {
  const instance = renderApp(
    <App service={fakeService(FIXTURES)} connection={CONNECTION} screen={screen} params={params} />,
    size,
  );
  await settle();
  return instance;
}

/** One turn of the event loop, long enough for `load()` to resolve. */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 50));

/**
 * Wait until `read` answers something, rather than sleeping a fixed time.
 *
 * `load()` is a promise and the whole suite runs in parallel, so fifty
 * milliseconds is enough on an idle machine and not on a busy one — which is a
 * test that fails for a reason that has nothing to do with the cockpit.
 */
async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`${what} did not happen within 10 s`);
    await settle();
  }
}

const instances: Array<{ unmount: () => void }> = [];
afterEach(() => {
  while (instances.length > 0) instances.pop()!.unmount();
});

const track = <T extends { unmount: () => void }>(one: T): T => {
  instances.push(one);
  return one;
};

describe("the cockpit is live (TV-09, TV-T14)", () => {
  it("says the stream is arriving, without anyone pressing a key", async () => {
    const { lastFrame } = track(await cockpit("run", { runId: "comp" }));
    expect(lastFrame() ?? "").toContain("live");
  });

  it("folds an event with the model's own reducer, and does not reload", async () => {
    /*
     * The cockpit re-read only when a key was pressed, in a product whose
     * subject is runs — so a run finished and the screen did not know. What
     * arrives is folded by `applyEvent`, so a run arriving here and the same run
     * arriving in the app reach the same state.
     */
    const service = fakeService(FIXTURES);
    const instance = track(
      renderApp(
        <App service={service} connection={CONNECTION} screen="run" params={{ runId: "comp" }} />,
      ),
    );
    await settle();
    const before = instance.lastFrame() ?? "";
    expect(before).toContain("Run comp");

    const calls = service.calls.length;
    service.emit({ kind: "step.result", runId: "comp", story: "I want to book and then fail" });
    await settle();
    /* Folded, not re-fetched: the screen did not go back to the service. */
    expect(service.calls.length, "an event caused a reload").toBe(calls);
  });
});

describe("the four panes (the `TUI` artboard)", () => {
  it("draws all four, numbered, on a terminal with room for them", async () => {
    const { lastFrame } = track(await cockpit("run", { runId: "comp" }));
    const frame = lastFrame() ?? "";
    for (const [number, title] of [
      ["1", "Stories"],
      ["2", "Run comp"],
      ["3", "Step"],
      ["4", "Audit"],
    ] as const) {
      expect(frame, `pane ${number} (${title}) is missing`).toContain(title);
    }
  });

  it("says what size it drew itself at (T10.4)", async () => {
    const { lastFrame } = track(await cockpit("run", { runId: "comp" }));
    // "a capture records the size it was taken at" (Draft 2.12 §13.7).
    expect(lastFrame() ?? "").toContain("160×40");
  });

  it("no pane is wider than the terminal, at either size (P9-F4)", async () => {
    for (const size of [WIDE, NARROW]) {
      const { lastFrame } = track(await cockpit("run", { runId: "comp" }, size));
      const lines = (lastFrame() ?? "").split("\n");
      const widest = Math.max(...lines.map((one) => one.length));
      expect(
        widest,
        `a line of ${widest} characters on a ${size.columns}-column terminal:\n${lastFrame()}`,
      ).toBeLessThanOrEqual(size.columns);
    }
  });

  it("puts the run the mockup draws in the main pane, with its steps", async () => {
    const { lastFrame } = track(await cockpit("run", { runId: "comp" }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Click the Book a slot link");
    expect(frame).toContain("Click the pay button");
    // The status word beside its glyph, never a colour alone.
    expect(frame).toContain("aborted");
    expect(frame).toContain("exit 11");
  });

  it("puts the failing step's candidates in the inspector", async () => {
    const { lastFrame } = track(await cockpit("run", { runId: "comp" }));
    const frame = lastFrame() ?? "";
    // The artboards write an inspector's section labels in small capitals
    // (`base.css`: `.inspector h3 { text-transform: uppercase }`), and the
    // cockpit does the same with the letters it has.
    expect(frame).toContain("CANDIDATES TRIED");
    expect(frame).toContain("testid");
    expect(frame).toContain("xpath");
  });

  it("puts the audit in pane 4, stamped from the run's start", async () => {
    const { lastFrame } = track(await cockpit("run", { runId: "comp" }));
    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/\d\d\.\d\d\d/);
    expect(frame).toContain("yam ui --json streams these same lines");
  });

  it("draws the flow list and the editor on the Flows screen", async () => {
    const { lastFrame } = track(
      await cockpit("flows", { file: "flows/guards-and-compensation.flow" }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("guards-and-compensation.flow");
    expect(frame).toContain("simple.flow");
    /*
     * The editor draws a window onto the file starting at the cursor, so the
     * first frame is the file's first lines — its header comment. What the
     * assertion is about is that the *file* is in the pane and that the pane is
     * the editor: a line number beside a line of `guards-and-compensation.flow`.
     */
    expect(frame).toMatch(/1\s+\/\/ Guards and compensation/);
    // And the flow's status, from the run the fixtures carry.
    expect(frame).toContain("aborted");
  });
});

describe("the keys (LLD §13.7's conventional keys)", () => {
  /*
   * The focus and the cursor are observed on the *model* rather than in the
   * frame.
   *
   * Ink draws focus as a border colour and the cursor as an inverse row, and
   * chalk emits neither when stdout is not a terminal — which
   * `ink-testing-library`'s is not. Comparing frames would therefore compare
   * two identical strings and pass whatever the keys did. `onState` is the
   * cockpit's own state, which is what the keys actually change, and the
   * pseudo-terminal test in `tools/repo-checks` is where the *drawing* is
   * checked with the colours on.
   */
  it("`1`–`4` move the focus, and `Tab` cycles it", async () => {
    const seen: UiState[] = [];
    const instance = track(
      renderApp(
        <App
          service={fakeService(FIXTURES)}
          connection={CONNECTION}
          screen="run"
          params={{ runId: "comp" }}
          onState={(one) => seen.push(one)}
        />,
      ),
    );
    const focus = (): string | undefined => seen.at(-1)?.focus;
    expect(await until(focus, "the first load")).toBe("main");

    instance.stdin.write("1");
    expect(await until(() => (focus() === "tree" ? focus() : undefined), "`1`")).toBe("tree");

    instance.stdin.write("3");
    expect(
      await until(() => (focus() === "inspector" ? focus() : undefined), "`3`"),
    ).toBe("inspector");

    instance.stdin.write("\t");
    expect(await until(() => (focus() === "audit" ? focus() : undefined), "Tab")).toBe("audit");

    // And it wraps, which is what "cycles" means.
    instance.stdin.write("\t");
    expect(await until(() => (focus() === "tree" ? focus() : undefined), "Tab again")).toBe("tree");
  });

  it("`j` and `k` move the cursor within the focused pane", async () => {
    const seen: UiState[] = [];
    const instance = track(
      renderApp(
        <App
          service={fakeService(FIXTURES)}
          connection={CONNECTION}
          screen="run"
          params={{ runId: "comp" }}
          onState={(one) => seen.push(one)}
        />,
      ),
    );
    const at = (): number | undefined => seen.at(-1)?.cursor.main;
    expect(await until(() => (at() === 0 ? 0 : undefined), "the first load")).toBe(0);

    instance.stdin.write("j");
    expect(await until(() => (at() === 1 ? 1 : undefined), "`j`")).toBe(1);

    instance.stdin.write("k");
    expect(await until(() => (at() === 0 ? 0 : undefined), "`k`")).toBe(0);

    // And it stops at the top rather than going negative.
    instance.stdin.write("k");
    await settle();
    expect(at()).toBe(0);
  });

  it("moves the cursor only in the pane that has focus", async () => {
    const seen: UiState[] = [];
    const instance = track(
      renderApp(
        <App
          service={fakeService(FIXTURES)}
          connection={CONNECTION}
          screen="run"
          params={{ runId: "comp" }}
          onState={(one) => seen.push(one)}
        />,
      ),
    );
    await until(() => seen.at(-1), "the first load");
    instance.stdin.write("1");
    await until(() => (seen.at(-1)?.focus === "tree" ? true : undefined), "`1`");
    instance.stdin.write("j");
    await until(() => (seen.at(-1)?.cursor.tree === 1 ? true : undefined), "`j`");
    expect(seen.at(-1)!.cursor.tree).toBe(1);
    expect(seen.at(-1)!.cursor.main).toBe(0);
  });

  it("shows the footer the artboard shows", async () => {
    const { lastFrame } = track(await cockpit("run", { runId: "comp" }));
    const frame = lastFrame() ?? "";
    for (const key of ["^K", "1-4", "Tab", "j k", "Enter", "q"]) {
      expect(frame, `the footer does not offer ${key}`).toContain(key);
    }
  });
});

describe("the palette (^K) is the app's list (T9.4, REQ-ADE-10)", () => {
  it("opens on ^K and lists actions with their CLI commands", async () => {
    const { stdin, lastFrame } = track(await cockpit("run", { runId: "comp" }));
    stdin.write("\u000b"); // ^K
    await settle();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("greyed rows say why");
    /*
     * The rows are the registry's, by label and by command. Surface-first (T14,
     * T15): the registry now opens with the Surfaces actions, so those are the
     * first page — which is what the palette should show first when connecting
     * to something is the primary journey.
     */
    expect(frame).toContain("Connect surface");
    expect(frame).toContain("yam surface connect");

    // And a row further down is still there, one filter away.
    stdin.write("compile");
    await settle();
    const filtered = lastFrame() ?? "";
    expect(filtered).toContain("Compile");
    expect(filtered).toContain("yam compile");
  });

  it("filters as it is typed, over labels and CLI commands", async () => {
    const { stdin, lastFrame } = track(await cockpit("run", { runId: "comp" }));
    stdin.write("\u000b");
    await settle();
    stdin.write("heal");
    await settle();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Heal");
    expect(frame).toContain("yam heal");
    // And nothing that does not match.
    expect(frame).not.toContain("Save data");
  });

  it("closes on Escape", async () => {
    const { stdin, lastFrame } = track(await cockpit("run", { runId: "comp" }));
    stdin.write("\u000b");
    await settle();
    expect(lastFrame()).toContain("greyed rows say why");
    stdin.write("\u001b");
    await settle();
    expect(lastFrame()).not.toContain("greyed rows say why");
  });

  it("offers every action the registry has, so neither palette is a subset", async () => {
    const { stdin, lastFrame } = track(await cockpit("flows", {}));
    stdin.write("\u000b");
    await settle();
    /*
     * The pane shows eight rows at a time, so this checks the *source* rather
     * than the frame: `ACTIONS` is what both palettes are built from, and
     * `tools/repo-checks/test/action-parity.test.ts` is what holds the app's
     * palette, this one, the SDK and the CLI to it.
     */
    expect(ACTIONS.length).toBeGreaterThan(20);
    expect(lastFrame()).toContain("greyed rows say why");
  });
});

describe("the cockpit renders the model and adds nothing (LLD §13.7)", () => {
  it("shows the project and service in its header", async () => {
    const { lastFrame } = track(await cockpit("run", { runId: "comp" }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("yam-fixtures");
    expect(frame).toContain("127.0.0.1:55702");
  });

  it("draws a screen whose load failed as the model's error, not a crash", async () => {
    const instance = track(
      renderApp(<App service={fakeService({})} connection={CONNECTION} screen="flows" />),
    );
    await settle();
    // The title and subtitle are still the model's; the error is a value.
    expect(instance.lastFrame()).toContain("Flows");
  });
});

/**
 * The cockpit fits the terminal, and collapses rather than clips (T10.4, P9-F4).
 *
 * Draft 2.12 §13.7: "The cockpit sizes its panes to the terminal and collapses
 * the inspector below 120 columns rather than clipping it; a capture records the
 * size it was taken at."
 *
 * The Phase 9 capture showed the inspector cut in half at the captured width,
 * because the three columns were fixed at 34, "grow", and 40 — 74 columns of
 * furniture before a character of content. These are the two widths that matter:
 * one with room for four panes, one without.
 */
describe("the panes are sized to the terminal (T10.4, P9-F4)", () => {
  it("draws three panes at 100 columns, and says the inspector is collapsed", async () => {
    const { lastFrame } = track(await cockpit("run", { runId: "comp" }, NARROW));
    const frame = lastFrame() ?? "";

    // The three that are drawn.
    expect(frame).toContain("Stories");
    expect(frame).toContain("Run comp");
    expect(frame).toContain("Audit");
    // The one that is not, and the reason, in words.
    expect(frame).not.toContain("CANDIDATES TRIED");
    expect(frame).toContain("inspector collapsed at 100 cols");
    // And the size, so the capture is self-describing.
    expect(frame).toContain("100×30");
  });

  it("opens the collapsed inspector full width when pane 3 is focused", async () => {
    const { lastFrame, stdin } = track(await cockpit("run", { runId: "comp" }, NARROW));
    stdin.write("3");
    await settle();

    // It is there, under the main pane, with the failing step's detail on it.
    expect(lastFrame()).toContain("3 Step 5 · Click the pay button");
    expect(lastFrame()).toContain("locator");

    /*
     * And it scrolls, which is what a collapsed pane needs instead of the extra
     * columns it has given up: `j` walks to the candidate table further down.
     */
    for (let press = 0; press < 8; press += 1) {
      if ((lastFrame() ?? "").includes("CANDIDATES TRIED")) break;
      stdin.write("j");
      await settle();
    }
    expect(lastFrame()).toContain("CANDIDATES TRIED");

    // Still inside the terminal: collapsed means below, not clipped beside.
    const widest = Math.max(...(lastFrame() ?? "").split("\n").map((one) => one.length));
    expect(widest).toBeLessThanOrEqual(NARROW.columns);
  });

  it("the widths follow the terminal rather than being constants", () => {
    const narrow = layoutFor(100, 30);
    const wide = layoutFor(200, 60);
    expect(narrow.inspectorCollapsed).toBe(true);
    expect(narrow.inspector).toBeUndefined();
    expect(narrow.tree + narrow.main).toBe(100);

    expect(wide.inspectorCollapsed).toBe(false);
    expect(wide.tree + wide.main + wide.inspector!).toBe(200);
    expect(wide.tree).toBeGreaterThan(narrow.tree - 1);
    // A taller terminal draws more rows, which is the other half of "sized".
    expect(wide.listRows).toBeGreaterThan(narrow.listRows);
  });

  it("120 columns is the line the spec draws", () => {
    expect(INSPECTOR_MIN_COLUMNS).toBe(120);
    expect(layoutFor(119, 40).inspectorCollapsed).toBe(true);
    expect(layoutFor(120, 40).inspectorCollapsed).toBe(false);
  });

  it("never asks for a negative width, however small the terminal", () => {
    for (const columns of [1, 20, 40, 61, 80, 100, 121, 400]) {
      const layout = layoutFor(columns, 10);
      expect(layout.tree).toBeGreaterThan(0);
      expect(layout.main).toBeGreaterThan(0);
      expect(layout.listRows).toBeGreaterThan(0);
      expect(layout.auditRows).toBeGreaterThan(0);
      expect(layout.tree + layout.main + (layout.inspector ?? 0)).toBe(layout.columns);
    }
  });
});

/**
 * Every screen draws, and every pane says what it has (T10.1, T10.2).
 *
 * T10.1 and T10.2's Validate is "each screen driven end to end through its own
 * controls … in `yam ui` under a pseudo-terminal". The pseudo-terminal half
 * is `tools/repo-checks/test/tui-pty.test.ts`, which needs a real service; this
 * is the half that runs everywhere, against the recorded fixtures, and it is
 * what says the cockpit has all thirteen screens rather than two.
 */
describe("all thirteen screens draw in the cockpit (T10.1, T10.2, T14)", () => {
  const service = () => fakeService(FIXTURES);

  it.each(SCREEN_IDS)("%s draws four numbered panes with titles", async (id) => {
    const state = await screenById(id).load(service(), {});
    const model = paneModel(state, Date.parse("2026-09-05T20:12:00.000Z"));

    for (const pane of ["tree", "main", "inspector", "audit"] as const) {
      const content = model[pane];
      expect(content.title, `${id}'s ${pane} pane has no title`).not.toBe("");
      // A pane with no rows says what would put some there, rather than drawing
      // a blank box (LLD §13.7: a screen is a view over the service, and "there
      // is nothing" is a thing the service said).
      expect(content.empty, `${id}'s ${pane} pane has no empty message`).not.toBe("");
      for (const line of content.lines) {
        expect(line.cells.length, `${id}'s ${pane} has an empty line`).toBeGreaterThan(0);
      }
    }
  });

  it.each(SCREEN_IDS)("%s renders without throwing, at both widths", async (id) => {
    for (const size of [WIDE, NARROW]) {
      const { lastFrame } = track(
        renderApp(
          <App service={service()} connection={CONNECTION} screen={id} params={{}} />,
          size,
        ),
      );
      /*
       * Polled, not slept (P10-F9).
       *
       * `load()` is a promise and the whole suite runs in parallel, so a fixed
       * fifty milliseconds is enough on an idle machine and not on a busy one:
       * this failed once in a full run with the frame still on `loading…`, and
       * passed alone. The loaded state is what the assertions are about, so it
       * is what the test waits for.
       */
      const word = screenById(id).title.split(" ")[0]!;
      const frame = await until(
        () => (lastFrame().includes(word) ? lastFrame() : undefined),
        `${id} to load at ${size.columns} columns`,
      );
      expect(frame, `${id} drew nothing at ${size.columns} columns`).not.toBe("");
      // The screen's own title is on the header, from the model.
      expect(frame).toContain(word);
      const widest = Math.max(...frame.split("\n").map((one) => one.length));
      expect(widest, `${id} drew past the right edge at ${size.columns}`).toBeLessThanOrEqual(
        size.columns,
      );
    }
  });

  it("no status colour is drawn without its word (LLD §13.7)", async () => {
    for (const id of SCREEN_IDS) {
      const state = await screenById(id).load(service(), {});
      const model = paneModel(state);
      for (const pane of ["tree", "main", "inspector", "audit"] as const) {
        for (const line of model[pane].lines) {
          for (const cell of line.cells) {
            if (cell.tone === undefined) continue;
            expect(
              cell.text.trim(),
              `${id}'s ${pane} draws a ${cell.tone} cell with no word in it`,
            ).not.toBe("");
          }
        }
      }
    }
  });


  it("`[` and `]` walk the rail", async () => {
    const seen: UiState[] = [];
    const instance = track(
      renderApp(
        <App
          service={service()}
          connection={CONNECTION}
          screen="flows"
          onState={(one) => seen.push(one)}
        />,
      ),
    );
    await until(() => seen.at(-1), "the first load");

    /*
     * The rail order is surface-first now (T14): `RAIL` is the four sections
     * flattened — surfaces, then flows and the rest of Automations, then runs
     * under Activity, then settings — so the item after `flows` is `bindings`,
     * not `runs`.
     */
    instance.stdin.write("]");
    expect(
      await until(() => (seen.at(-1)?.screen === "bindings" ? "bindings" : undefined), "`]`"),
    ).toBe("bindings");

    instance.stdin.write("[");
    expect(
      await until(() => (seen.at(-1)?.screen === "flows" ? "flows" : undefined), "`[`"),
    ).toBe("flows");
  });

  it("Enter opens what the cursor is on, whatever the screen", async () => {
    const seen: UiState[] = [];
    const instance = track(
      renderApp(
        <App
          service={service()}
          connection={CONNECTION}
          screen="bindings"
          onState={(one) => seen.push(one)}
        />,
      ),
    );
    await until(() => seen.at(-1), "the first load");

    // Pane 1, second row, Enter: the screen re-loads with that binding.
    instance.stdin.write("1");
    await settle();
    instance.stdin.write("j");
    await settle();
    instance.stdin.write("\r");

    const chosen = await until(
      () => (seen.at(-1)?.params.bindingId === "app.checkout-link" ? "yes" : undefined),
      "Enter on the bindings tree",
    );
    expect(chosen).toBe("yes");
  });
});

/**
 * `e` opens the flow in `$EDITOR`, and what comes back is saved (K6, T11.1).
 *
 * The app's answer to "the editor edits" is a text area and a Save button; a
 * terminal's is the editor a person already has. Both run the *same*
 * `flows.save` action against the same `PUT /flows/:file`, which is what makes
 * this one feature with two renderings rather than two features.
 *
 * `$EDITOR` here is a Node one-liner that appends a line, because what is being
 * checked is the round trip — the file's text out, the edited text in, the
 * action called with it — and not anybody's editor.
 */
describe("`e` edits the open flow through $EDITOR (K6)", () => {
  const withEditor = async (
    script: string,
    run: () => Promise<void>,
  ): Promise<void> => {
    const before = process.env["EDITOR"];
    const visual = process.env["VISUAL"];
    const directory = mkdtempSync(join(tmpdir(), "yam-editor-"));
    const editor = join(directory, "editor.sh");
    writeFileSync(
      editor,
      `#!/bin/sh\nexec "${process.execPath}" -e '${script}' "$1"\n`,
      { mode: 0o755 },
    );
    process.env["EDITOR"] = editor;
    delete process.env["VISUAL"];
    try {
      await run();
    } finally {
      if (before === undefined) delete process.env["EDITOR"];
      else process.env["EDITOR"] = before;
      if (visual !== undefined) process.env["VISUAL"] = visual;
      rmSync(directory, { recursive: true, force: true });
    }
  };

  it("hands the file's text to the editor and saves what comes back", async () => {
    const service = fakeService(FIXTURES);
    const wrote: Array<{ file: string; text: string }> = [];
    const recording = {
      ...service,
      putFlowsByFile: async (file: string, body?: unknown) => {
        wrote.push({ file, text: String(body) });
        return { ok: true, file };
      },
    };

    const seen: UiState[] = [];
    const instance = track(
      renderApp(
        <App
          service={recording}
          connection={CONNECTION}
          screen="flows"
          onState={(one) => seen.push(one)}
        />,
      ),
    );
    const first = await until(() => seen.at(-1), "the first load");
    const text = (first.state as { text?: string }).text ?? "";
    expect(text, "the Flows state carries no text for an editor to open").not.toBe("");

    await withEditor(
      'require("fs").appendFileSync(process.argv[1], "\\n  Frobnicate the widget\\n")',
      async () => {
        instance.stdin.write("e");
        await until(() => (wrote.length > 0 ? "yes" : undefined), "the save");
      },
    );

    expect(wrote).toHaveLength(1);
    // The *name*, not the project-relative path: `/flows/:file` is rooted at
    // the flows directory and joins what it is given to it (K6).
    expect(wrote[0]!.file).not.toContain("/");
    expect(wrote[0]!.text.startsWith(text)).toBe(true);
    expect(wrote[0]!.text).toContain("Frobnicate the widget");
  }, 60_000);

  it("saves nothing when the editor changed nothing", async () => {
    const service = fakeService(FIXTURES);
    const wrote: unknown[] = [];
    const recording = { ...service, putFlowsByFile: async (...args: unknown[]) => {
      wrote.push(args);
      return { ok: true };
    } };

    const seen: UiState[] = [];
    const instance = track(
      renderApp(
        <App
          service={recording as typeof service}
          connection={CONNECTION}
          screen="flows"
          onState={(one) => seen.push(one)}
        />,
      ),
    );
    await until(() => seen.at(-1), "the first load");

    await withEditor('void process.argv[1]', async () => {
      instance.stdin.write("e");
      const said = await until(
        () => (seen.at(-1)?.message?.includes("unchanged") === true ? "yes" : undefined),
        "the cockpit to say the file is unchanged",
      );
      expect(said).toBe("yes");
    });
    // An editor opened and closed is not an edit; a `PUT` for it would put a new
    // mtime on a file nobody touched.
    expect(wrote).toEqual([]);
  }, 60_000);
});
