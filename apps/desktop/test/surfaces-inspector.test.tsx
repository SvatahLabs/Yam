// @vitest-environment jsdom
/**
 * The three things the release review named as unbuilt on Surfaces, drawn
 * (T15, T16, SF-07, SF-10, SF-15):
 *
 * - **Copy command** and **Copy MCP call**, beside Act, copying what the form
 *   holds now — and never a password field's value;
 * - the **preview**, whose click selects the control under the pointer exactly
 *   as its row in the tree would, and clicks nothing in the application;
 * - the **connection test** that says what the MCP handshake verified.
 *
 * The state is loaded through the screen model against the fake service, so
 * what is drawn is what the model produced; this checks where it goes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  actionsForScreen,
  fakeService,
  screenById,
  SECRET_PLACEHOLDER,
  type FakeResponses,
  type ScreenParams,
  type SessionState,
} from "@svatah/yam-screens";
import { SessionInspector, SessionScreen } from "../src/renderer/shell/Session.js";

afterEach(cleanup);

const ok = (result: unknown): unknown => ({ schemaVersion: "1.0", requestId: "req_test", status: "succeeded", result });

/** The smallest bytes the model reads as a 1280×720 PNG. */
function png(width: number, height: number): Uint8Array {
  const u32 = (value: number): number[] => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  const text = (word: string): number[] => [...word].map((one) => one.charCodeAt(0));
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...u32(13), ...text("IHDR"), ...u32(width), ...u32(height), 8, 6, 0, 0, 0, 0, 0, 0, 0,
    ...u32(0), ...text("IEND"), 0, 0, 0, 0,
  ]);
}

const SURFACE: NonNullable<FakeResponses["surface"]> = {
  targets: ok({ adapters: [{ adapter: "playwright", registered: true, available: true, platform: [], prerequisites: [] }], targets: [] }),
  sessions: ok({ sessions: [{ sessionId: "s_1", adapter: "playwright", kind: "web", status: "ready" }] }),
  capabilities: ok({ adapter: "playwright", kind: "web", capabilities: {} }),
  snapshot: ok({
    snapshotId: "snap_1",
    nodes: [
      { ref: "r1", role: "textbox", name: "Password", depth: 0, states: [], box: [20, 40, 200, 30] },
      { ref: "r2", role: "button", name: "Sign in", depth: 0, states: [], box: [20, 100, 80, 30] },
    ],
  }),
  describe: ok({ ref: "r1", role: "textbox", name: "Password", tag: "input", attrs: { type: "password" }, states: [] }),
  image: png(1280, 720),
};

async function loaded(params: ScreenParams, surface = SURFACE): Promise<SessionState> {
  return (await screenById("session").load(fakeService({ surface }), { mode: "do", ...params })) as SessionState;
}

describe("Copy command and Copy MCP call (T15, SF-15)", () => {
  const writeText = vi.fn(async (_text: string) => undefined);
  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("sit beside Act and copy what the form holds, without a password field's value", async () => {
    const params = { selected: "s_1", ref: "r1", snapshot: "snap_1" };
    const state = await loaded(params);
    const { container } = render(
      <SessionInspector
        state={state}
        params={{ mode: "do", ...params }}
        actions={actionsForScreen("session")}
        onAction={() => undefined}
        onParams={() => undefined}
      />,
    );

    const buttons = [...container.querySelectorAll<HTMLElement>("#inspector-action .sv-inspector-actions button")].map(
      (one) => one.id,
    );
    expect(buttons).toEqual(["action-surface-act", "action-surface-read", "surfaces-copy-command", "surfaces-copy-mcp"]);

    const field = container.querySelector<HTMLInputElement>("#surfaces-field-value")!;
    fireEvent.change(field, { target: { value: "hunter2" } });

    fireEvent.click(container.querySelector("#surfaces-copy-command")!);
    const cli = writeText.mock.calls.at(-1)![0];
    expect(cli).toContain("yam surface act --session s_1 --action type --ref r1 --snapshot snap_1 --input -");
    expect(cli).toContain('--secret "$YAM_SECRET"');
    expect(cli).not.toContain("hunter2");
    expect(container.querySelector("#surfaces-copy-command")?.textContent).toContain("Copied");

    fireEvent.click(container.querySelector("#surfaces-copy-mcp")!);
    const call = JSON.parse(writeText.mock.calls.at(-1)![0]) as { params: { arguments: Record<string, unknown> } };
    expect(call.params.arguments).toMatchObject({ session: "s_1", action: "type", ref: "r1", secrets: [SECRET_PLACEHOLDER] });
    expect(JSON.stringify(call)).not.toContain("hunter2");

    // What is copied can be read first, with what it assumes.
    expect(container.querySelector("#surfaces-copy-notes")?.textContent).toContain("expires when the page changes");
    expect(container.querySelector("#surfaces-copy-cli")?.textContent).toBe(cli);
  });

  it("stop saying Copied once the form changes under them", async () => {
    const params = { selected: "s_1", ref: "r1", snapshot: "snap_1" };
    const state = await loaded(params);
    const { container } = render(
      <SessionInspector
        state={state}
        params={{ mode: "do", ...params }}
        actions={actionsForScreen("session")}
        onAction={() => undefined}
        onParams={() => undefined}
      />,
    );
    fireEvent.click(container.querySelector("#surfaces-copy-command")!);
    expect(container.querySelector("#surfaces-copy-command")?.textContent).toContain("Copied");
    fireEvent.change(container.querySelector("#surfaces-field-value")!, { target: { value: "x" } });
    expect(container.querySelector("#surfaces-copy-command")?.textContent).toContain("Copy command");
  });
});

describe("the preview selects, and never acts (T15, SF-10)", () => {
  it("draws the picture beside the tree when asked, and a click selects the control under it", async () => {
    const params = { selected: "s_1", preview: true };
    const state = await loaded(params);
    const onParams = vi.fn();
    const onAction = vi.fn();
    const { container } = render(
      <SessionScreen
        state={state}
        params={{ mode: "do", ...params }}
        actions={actionsForScreen("session")}
        onAction={onAction}
        onParams={onParams}
      />,
    );

    const toggle = container.querySelector<HTMLInputElement>("#surfaces-preview-toggle")!;
    expect(toggle.checked).toBe(true);
    const image = container.querySelector<HTMLImageElement>("#surfaces-preview-image")!;
    expect(image.getAttribute("src")?.startsWith("data:image/png;base64,")).toBe(true);
    expect(image.getAttribute("alt")).toContain("tree");
    // The tree is still there, for the keyboard.
    expect(container.querySelector("#surfaces-tree")).not.toBeNull();

    // Drawn at half size: a point on screen is two pixels of the picture.
    const frame = image.parentElement!;
    frame.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 640, height: 360, right: 640, bottom: 360, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    fireEvent.mouseMove(frame, { clientX: 30, clientY: 55 });
    expect(container.querySelector("#surfaces-preview-hover")?.textContent).toContain('button "Sign in" · r2');
    expect(container.querySelector(".sv-preview-hover")).not.toBeNull();

    fireEvent.click(frame, { clientX: 30, clientY: 25 });
    expect(onParams).toHaveBeenCalledWith({ mode: "do", selected: "s_1", preview: true, ref: "r1", snapshot: "snap_1" });
    // Selecting is not an action: nothing was sent to the surface.
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(onAction).toHaveBeenCalledWith("surface.preview", { show: false });
  });

  it("says why there is no picture, and keeps the tree", async () => {
    const refusal = Object.assign(new Error("422"), {
      body: JSON.stringify({ status: "refused", error: { code: "PERMISSION_REQUIRED", message: "Screen Recording is not granted." } }),
    });
    const params = { selected: "s_1", preview: true };
    const state = await loaded(params, { ...SURFACE, image: refusal });
    const { container } = render(
      <SessionScreen
        state={state}
        params={{ mode: "do", ...params }}
        actions={actionsForScreen("session")}
        onAction={() => undefined}
        onParams={() => undefined}
      />,
    );
    expect(container.querySelector("#surfaces-preview-unavailable")?.textContent).toContain(
      "Screen Recording is not granted.",
    );
    expect(container.querySelector("#surfaces-preview-image")).toBeNull();
    expect(container.querySelector("#surfaces-tree")).not.toBeNull();
  });
});

describe("the connection test says what the handshake verified (T16, SF-07)", () => {
  it("shows the server, its tools and the time, beside the broker", async () => {
    const params = { selected: "s_1" };
    const state = await loaded(params);
    const { container } = render(
      <SessionInspector
        state={state}
        params={{ mode: "do", ...params }}
        actions={actionsForScreen("session")}
        onAction={() => undefined}
        onParams={() => undefined}
        lastOutcome={{
          id: "surface.test-agent",
          ok: true,
          value: {
            broker: SURFACE.targets,
            handshake: { ok: true, server: { name: "yam", version: "0.1.0" }, protocolVersion: "2025-11-25", tools: 14, ms: 3200 },
          },
        }}
      />,
    );
    const panel = container.querySelector("#inspector-agent")?.textContent ?? "";
    expect(panel).toContain("handshake completed");
    expect(panel).toContain("MCP handshake: yam 0.1.0, 14 tools in 3.2 s");
    expect(panel).toContain("reaches the same sessions");
  });

  it("says no handshake has been tried before one has", async () => {
    const state = await loaded({ selected: "s_1" });
    const { container } = render(
      <SessionInspector
        state={state}
        params={{ mode: "do", selected: "s_1" }}
        actions={actionsForScreen("session")}
        onAction={() => undefined}
        onParams={() => undefined}
      />,
    );
    const panel = container.querySelector("#inspector-agent")?.textContent ?? "";
    expect(panel).toContain("not tried");
    expect(panel).toContain("No MCP handshake has been tried");
  });
});
