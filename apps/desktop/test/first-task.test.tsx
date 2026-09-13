// @vitest-environment jsdom
/**
 * The first task is first, and the bar shows what can be done (`AX-01`,
 * `AX-05`, E1.1).
 *
 * The walkthrough of 2026-09-11 read the packaged window's own accessibility
 * tree and found the only task a new person can perform sitting *underneath*
 * four toolbar buttons, three of which were disabled — Disconnect, Check the
 * surface, Refresh and select again. Reading order followed the component tree,
 * and the component tree put the furniture before the door (`B8`, `B9`).
 *
 * This is that reading, made mechanical. The state is loaded through the screen
 * model against fixtures with no open session, which is the state every launch
 * begins in, and the assertion is about *order in the document* — which is what
 * a screen reader walks and what `surface_snapshot` returns.
 *
 * The navigation is excepted, and a `tablist` is navigation: the mode strip
 * changes which view you are in, it does not perform the task. `EX-N1` wants
 * this driven through the packaged application as well, and `evals/self` is
 * where that lives; this is the half that runs on every commit.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  actionsForScreen,
  fakeService,
  screenById,
  type FakeResponses,
  type SessionState,
} from "@svatah/yam-screens";
import { SessionScreen } from "../src/renderer/shell/Session.js";
import { Toolbar } from "../src/renderer/shell/parts.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(
  readFileSync(
    join(HERE, "..", "..", "..", "packages", "screens", "test", "fixtures", "fixtures-project.json"),
    "utf8",
  ),
) as FakeResponses;

afterEach(cleanup);

/** The Session screen as it loads with nothing connected, which is every launch. */
async function nothingConnected(): Promise<SessionState> {
  const screen = screenById("session");
  return (await screen.load(fakeService(FIXTURES), { mode: "do" })) as SessionState;
}

/** Every interactive control, in document order, with the navigation taken out. */
function controls(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, input, select, textarea, [role='combobox']")]
    .filter((one) => one.closest("[role='tablist']") === null)
    .filter((one) => one.closest("nav") === null)
    .filter((one) => one.offsetParent !== null || one.hidden === false);
}

describe("the first task is first (AX-01)", () => {
  it("puts the connect controls before every other control on the screen", async () => {
    const state = await nothingConnected();
    const { container } = render(
      <SessionScreen
        state={state}
        params={{ mode: "do" }}
        actions={actionsForScreen("session")}
        onAction={() => undefined}
        onParams={() => undefined}
      />,
    );

    const order = controls(container).map((one) => one.id);
    expect(order.length, "the screen drew no controls at all").toBeGreaterThan(0);

    /*
     * The four controls that do the only available thing. The first of them is
     * the first control on the screen; the rest follow it without anything
     * else in between, because a task split by unrelated controls is a task
     * somebody loses their place in.
     */
    const task = ["surfaces-url", "surfaces-adapter", "surfaces-headed", "action-surface-connect"];
    const at = order.indexOf(task[0]!);
    expect(at, `${task[0]!} is not on the screen — order was ${order.join(", ")}`).toBeGreaterThan(
      -1,
    );
    expect(at, `controls come before the first task: ${order.slice(0, at).join(", ")}`).toBe(0);
    expect(order.slice(0, task.length)).toEqual(task);
  });

  it("draws no toolbar buttons when not one of them can be pressed (AX-05)", async () => {
    const state = await nothingConnected();
    const { container } = render(
      <SessionScreen
        state={state}
        params={{ mode: "do" }}
        actions={actionsForScreen("session")}
        onAction={() => undefined}
        onParams={() => undefined}
      />,
    );
    const bar = container.querySelectorAll("[data-toolbar-action]");
    for (const one of bar) {
      expect(
        one.getAttribute("disabled") === null && one.getAttribute("aria-disabled") !== "true",
        `the bar drew ${one.id}, which cannot be pressed, on a screen with nothing connected`,
      ).toBe(true);
    }
  });
});

describe("an unavailable control is never drawn ahead of an available one (AX-05)", () => {
  /**
   * A bar with one of each, so the rule is exercised rather than satisfied by a
   * screen that happens to have no mixture.
   */
  const barWith = (states: readonly boolean[]) => {
    const actions = states.map((can, at) => ({
      id: `demo.${String(at)}`,
      label: `Action ${String(at)}`,
      group: "Actions",
      screen: "session" as const,
      cli: "",
      availableWhen: () => can,
      run: async () => ({ ok: true, message: "" }),
    }));
    const state = { screen: "session", title: "Session", subtitle: "", status: "", sources: [] };
    return render(
      <Toolbar
        state={state as never}
        actions={actions as never}
        onAction={() => undefined}
      />,
    );
  };

  it("puts what works first, whatever order the registry had them in", () => {
    const { container } = barWith([false, true, false, true]);
    const drawn = [...container.querySelectorAll<HTMLElement>("[data-toolbar-action]")];
    const dead = drawn.map((one) => one.hasAttribute("disabled"));
    expect(dead, "a disabled button came before an enabled one").toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("draws nothing at all when nothing works", () => {
    const { container } = barWith([false, false, false]);
    expect(container.querySelectorAll("[data-toolbar-action]")).toHaveLength(0);
  });

  it("would have passed on the old bar, and does not: shown to bite (EX-N3)", () => {
    /*
     * The old bar rendered `props.actions` in registry order. Given the same
     * four actions it would have drawn `[true, false, true, false]` above and
     * three dead buttons below — so the two assertions above are the difference
     * between the designs, not a restatement of either.
     */
    const { container } = barWith([false, true]);
    const first = container.querySelector<HTMLElement>("[data-toolbar-action]");
    expect(first?.hasAttribute("disabled")).toBe(false);
  });
});
