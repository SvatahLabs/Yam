/**
 * The primitives Session needs (TV-A03, TV-16, SF-18).
 *
 * What is asserted is the part a screenshot cannot show: the roles, the one tab
 * stop, the live region that stops being live, and the handle a keyboard can
 * move. The sheet's axe pass covers the rest.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

/* Each case renders its own tree; without this they accumulate and every
   `getAllByRole` sees the last case's DOM as well as its own. */
afterEach(cleanup);
import { Log, ModeStrip, PickerOverlay, Split, Toast, Tree } from "../src/components/session.js";

describe("a tree is a tree, with one tab stop (SF-18)", () => {
  const nodes = [
    { id: "e1", label: "Booking", kind: "document", depth: 0 },
    { id: "e12", label: "Location", kind: "textbox", depth: 2, states: ["focusable"] },
  ];

  it("is one tab stop, not three hundred", () => {
    /*
     * A person tabs *to* a tree and moves within it with the arrows. Tabbing
     * through every node to reach what is after it is keyboard punishment, and
     * it is what a list of buttons would have been.
     */
    render(<Tree id="t" label="Snapshot" nodes={nodes} />);
    const tree = screen.getByRole("tree", { name: "Snapshot" });
    expect(tree.getAttribute("tabindex")).toBe("0");
    expect(screen.getAllByRole("treeitem")).toHaveLength(2);
  });

  it("says how deep a node is, so the shape survives without indentation", () => {
    render(<Tree id="t" label="Snapshot" nodes={nodes} />);
    expect(screen.getAllByRole("treeitem")[1]!.getAttribute("aria-level")).toBe("3");
  });

  it("says which is selected, and answers a click", () => {
    const chosen: string[] = [];
    render(<Tree id="t" label="Snapshot" nodes={nodes} selected="e12" onSelect={(id) => chosen.push(id)} />);
    expect(screen.getAllByRole("treeitem")[1]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getAllByRole("treeitem")[0]!);
    expect(chosen).toEqual(["e1"]);
  });

  it("says what is not there rather than drawing an empty box (SF-17)", () => {
    render(<Tree id="t" label="Snapshot" nodes={[]} empty="connect a surface first" />);
    expect(screen.getByText("connect a surface first")).toBeTruthy();
  });
});

describe("a log follows, and stops shouting when it is being read", () => {
  const lines = [{ id: "1", at: "41.140", kind: "act", text: "fill e12" }];

  it("is polite while it follows, because lines arrive unasked", () => {
    const { container } = render(<Log id="l" label="This session" lines={lines} />);
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  it("goes quiet once a person has scrolled up, and offers the way back", () => {
    /*
     * A screen reader reading a log somebody is *reading* is a screen reader
     * shouting over them.
     */
    const { container } = render(<Log id="l" label="This session" lines={lines} following={false} />);
    expect(container.querySelector('[aria-live="off"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Jump to the end" })).toBeTruthy();
  });
});

describe("the mode strip is a tablist, because that is what it is", () => {
  it("says which mode is showing, and switching is not navigation", () => {
    const chosen: string[] = [];
    render(
      <ModeStrip
        id="m"
        label="Session mode"
        modes={[
          { id: "record", label: "Record" },
          { id: "say", label: "Say" },
        ]}
        mode="say"
        onMode={(next) => chosen.push(next)}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.find((one) => one.getAttribute("aria-selected") === "true")!.textContent).toBe("Say");
    fireEvent.click(tabs[0]!);
    expect(chosen).toEqual(["record"]);
  });
});

describe("picking is offered, never forced (REQ-REC-12)", () => {
  it("says what is being asked, and how to stop being asked", () => {
    const stopped: number[] = [];
    render(<PickerOverlay id="p" phrase="the pay button" onCancel={() => stopped.push(1)} />);
    expect(screen.getByRole("dialog").textContent).toContain("the pay button");
    fireEvent.click(screen.getByRole("button", { name: "Stop picking" }));
    expect(stopped).toHaveLength(1);
  });
});

describe("a result is not an interruption", () => {
  it("is a status rather than an alert", () => {
    /* A component that shouted every time a step passed would teach a person to
       stop listening. */
    render(
      <Toast id="t" tone="pass" label="verified">
        value = &ldquo;Indiranagar&rdquo;
      </Toast>,
    );
    expect(screen.getByRole("status").textContent).toContain("verified");
  });
});

describe("a split can be moved without a mouse (SF-18)", () => {
  it("is a separator with a value, and the arrows move it", () => {
    const at: number[] = [];
    render(
      <Split id="s" label="Resize" at={50} onAt={(next) => at.push(next)} first={<p>one</p>} second={<p>two</p>} />,
    );
    const handle = screen.getByRole("separator", { name: "Resize" });
    expect(handle.getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(at).toEqual([48, 52]);
  });

  it("does not let a pane be dragged out of existence", () => {
    const at: number[] = [];
    render(<Split id="s" label="Resize" at={10} onAt={(next) => at.push(next)} first={<p>one</p>} second={<p>two</p>} />);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    expect(at).toEqual([10]);
  });
});
