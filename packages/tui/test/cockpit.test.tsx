/**
 * `svatah ui`'s panes, keys and palette (T9.4, REQ-TUI-1, LLD §13.7).
 *
 * Ink rendered into a string by `ink-testing-library`, against the same
 * recorded service responses `@svatah/screens` tests against — so what is
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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "ink-testing-library";
import { ACTIONS, fakeService, type FakeResponses } from "@svatah/screens";
import { App } from "../src/app.js";
import type { UiState } from "../src/model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(
  readFileSync(
    join(HERE, "..", "..", "screens", "test", "fixtures", "fixtures-project.json"),
    "utf8",
  ),
) as FakeResponses;

const CONNECTION = { url: "http://127.0.0.1:55702", project: "svatah-fixtures" };

/** Render the cockpit and wait for its first load to land. */
async function cockpit(screen: "flows" | "run", params: Record<string, string> = {}) {
  const instance = render(
    <App service={fakeService(FIXTURES)} connection={CONNECTION} screen={screen} params={params} />,
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

describe("the four panes (the `TUI` artboard)", () => {
  it("draws all four, numbered", async () => {
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
    expect(frame).toContain("candidates tried");
    expect(frame).toContain("testid");
    expect(frame).toContain("xpath");
  });

  it("puts the audit in pane 4, stamped from the run's start", async () => {
    const { lastFrame } = track(await cockpit("run", { runId: "comp" }));
    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/\d\d\.\d\d\d/);
    expect(frame).toContain("svatah ui --json streams these same lines");
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
      render(
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
      render(
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
      render(
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

describe("the palette (^K) is the ADE's list (T9.4, REQ-ADE-10)", () => {
  it("opens on ^K and lists actions with their CLI commands", async () => {
    const { stdin, lastFrame } = track(await cockpit("run", { runId: "comp" }));
    stdin.write("\u000b"); // ^K
    await settle();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("same list as the ADE");
    // The rows are the registry's, by label and by command.
    expect(frame).toContain("Compile");
    expect(frame).toContain("svatah compile");
  });

  it("filters as it is typed, over labels and CLI commands", async () => {
    const { stdin, lastFrame } = track(await cockpit("run", { runId: "comp" }));
    stdin.write("\u000b");
    await settle();
    stdin.write("heal");
    await settle();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Heal");
    expect(frame).toContain("svatah heal");
    // And nothing that does not match.
    expect(frame).not.toContain("Save data");
  });

  it("closes on Escape", async () => {
    const { stdin, lastFrame } = track(await cockpit("run", { runId: "comp" }));
    stdin.write("\u000b");
    await settle();
    expect(lastFrame()).toContain("same list as the ADE");
    stdin.write("\u001b");
    await settle();
    expect(lastFrame()).not.toContain("same list as the ADE");
  });

  it("offers every action the registry has, so neither palette is a subset", async () => {
    const { stdin, lastFrame } = track(await cockpit("flows", {}));
    stdin.write("\u000b");
    await settle();
    /*
     * The pane shows eight rows at a time, so this checks the *source* rather
     * than the frame: `ACTIONS` is what both palettes are built from, and
     * `tools/repo-checks/test/action-parity.test.ts` is what holds the ADE's
     * palette, this one, the SDK and the CLI to it.
     */
    expect(ACTIONS.length).toBeGreaterThan(20);
    expect(lastFrame()).toContain("same list as the ADE");
  });
});

describe("the cockpit renders the model and adds nothing (LLD §13.7)", () => {
  it("shows the project and service in its header", async () => {
    const { lastFrame } = track(await cockpit("run", { runId: "comp" }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("svatah-fixtures");
    expect(frame).toContain("127.0.0.1:55702");
  });

  it("draws a screen whose load failed as the model's error, not a crash", async () => {
    const instance = track(
      render(<App service={fakeService({})} connection={CONNECTION} screen="flows" />),
    );
    await settle();
    // The title and subtitle are still the model's; the error is a value.
    expect(instance.lastFrame()).toContain("Flows");
  });
});
