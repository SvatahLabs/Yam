/**
 * Pointer and keyboard actions over BiDi's `input.performActions` (LLD §7.3).
 *
 * BiDi has one input primitive: a list of *source* streams — a pointer, a
 * keyboard, a wheel — each with a list of ticks. Every action Yam's vocabulary
 * names is a particular arrangement of those ticks, and this file is that
 * arrangement and nothing else.
 *
 * Pointer actions address an element by BiDi node reference rather than by
 * coordinates. A page that scrolls between the box being read and the click
 * being sent would otherwise land the pointer somewhere else — which is exactly
 * the class of flake the actionability wait exists to remove, and would put back.
 */
import { ScriptError } from "@svatah/yam-surface";
import type { BidiSession } from "./session.js";

/** The pointer source every pointer action shares, so ticks stay in one stream. */
const MOUSE = "yam-mouse";
const KEYBOARD = "yam-keyboard";

interface Tick {
  readonly type: string;
  readonly [key: string]: unknown;
}

function pointerSource(actions: Tick[]): Record<string, unknown> {
  return { type: "pointer", id: MOUSE, parameters: { pointerType: "mouse" }, actions };
}

function keySource(actions: Tick[]): Record<string, unknown> {
  return { type: "key", id: KEYBOARD, actions };
}

/** The centre of an element, as `input.performActions` addresses it. */
function atElement(sharedId: string): Tick {
  return {
    type: "pointerMove",
    x: 0,
    y: 0,
    origin: { type: "element", element: { sharedId } },
  };
}

export type PointerAction =
  | "click"
  | "doubleClick"
  | "rightClick"
  | "hover"
  | "hoverAndClick"
  | "pressAndHold"
  | "release";

/** One pointer action against an element. */
export async function pointerClick(
  session: BidiSession,
  sharedId: string,
  action: PointerAction,
): Promise<void> {
  const move = atElement(sharedId);
  const down = (button: number): Tick => ({ type: "pointerDown", button });
  const up = (button: number): Tick => ({ type: "pointerUp", button });

  const ticks: Tick[] = (() => {
    switch (action) {
      case "hover":
        return [move];
      case "click":
      case "hoverAndClick":
        // `hoverAndClick` is a click that must arrive *after* a hover has been
        // seen; the pause is what makes a menu that opens on hover open first.
        return action === "click"
          ? [move, down(0), up(0)]
          : [move, { type: "pause", duration: 120 }, down(0), up(0)];
      case "doubleClick":
        return [move, down(0), up(0), { type: "pause", duration: 40 }, down(0), up(0)];
      case "rightClick":
        return [move, down(2), up(2)];
      case "pressAndHold":
        return [move, down(0)];
      case "release":
        return [up(0)];
    }
  })();

  await session.client.call("input.performActions", {
    context: session.context(),
    actions: [pointerSource(ticks)],
  });
}

/** Press, hold, move and release: `dragTo` (LLD §7.1's action table). */
export async function pointerDrag(
  session: BidiSession,
  fromSharedId: string,
  toSharedId: string,
): Promise<void> {
  await session.client.call("input.performActions", {
    context: session.context(),
    actions: [
      pointerSource([
        atElement(fromSharedId),
        { type: "pointerDown", button: 0 },
        // An intermediate move: HTML5 drag-and-drop listeners want to see the
        // pointer travel, and a single jump from source to target does not fire
        // `dragover` on anything in between.
        { type: "pointerMove", x: 0, y: 0, origin: { type: "pointer" }, duration: 50 },
        { ...atElement(toSharedId), duration: 100 },
        { type: "pointerUp", button: 0 },
      ]),
    ],
  });
}

/**
 * Named keys, as WebDriver spells them (the Unicode private-use codepoints of
 * the WebDriver specification's key table).
 *
 * The names on the left are the flow language's, so `Press "Enter"` and
 * `Press "ArrowDown"` mean what a reader expects without the vocabulary having
 * to know about codepoints.
 */
const KEYS: Record<string, string> = {
  Enter: "\uE007",
  Return: "\uE006",
  Tab: "\uE004",
  Escape: "\uE00C",
  Esc: "\uE00C",
  Backspace: "\uE003",
  Delete: "\uE017",
  Insert: "\uE016",
  Space: "\uE00D",
  ArrowUp: "\uE013",
  ArrowDown: "\uE015",
  ArrowLeft: "\uE012",
  ArrowRight: "\uE014",
  Up: "\uE013",
  Down: "\uE015",
  Left: "\uE012",
  Right: "\uE014",
  Home: "\uE011",
  End: "\uE010",
  PageUp: "\uE00E",
  PageDown: "\uE00F",
  Shift: "\uE008",
  Control: "\uE009",
  Ctrl: "\uE009",
  Alt: "\uE00A",
  Meta: "\uE03D",
  F1: "\uE031",
  F2: "\uE032",
  F3: "\uE033",
  F4: "\uE034",
  F5: "\uE035",
  F6: "\uE036",
  F7: "\uE037",
  F8: "\uE038",
  F9: "\uE039",
  F10: "\uE03A",
  F11: "\uE03B",
  F12: "\uE03C",
};

/** The codepoint a key name means, or the name itself when it is one character. */
export function keyValue(name: string): string {
  const known = KEYS[name];
  if (known !== undefined) return known;
  if ([...name].length === 1) return name;
  throw new ScriptError(
    `"${name}" is not a key this adapter knows. Use one of: ${Object.keys(KEYS).join(", ")}, ` +
      "or a single character.",
    { adapter: "bidi" },
  );
}

/**
 * `press`, `keyDown` and `keyUp`, including chords like `"Control+a"`.
 *
 * Modifiers are held for the duration of the final key and released in reverse,
 * which is what makes `Control+a` a select-all rather than three keys typed one
 * after another.
 */
export async function keyActions(
  session: BidiSession,
  key: string,
  action: "press" | "keyDown" | "keyUp",
): Promise<void> {
  const parts = key.includes("+") ? key.split("+").map((p) => p.trim()) : [key];
  const values = parts.map(keyValue);
  const last = values[values.length - 1]!;
  const modifiers = values.slice(0, -1);

  const ticks: Tick[] =
    action === "keyDown"
      ? values.map((value) => ({ type: "keyDown", value }))
      : action === "keyUp"
        ? [...values].reverse().map((value) => ({ type: "keyUp", value }))
        : [
            ...modifiers.map((value) => ({ type: "keyDown", value })),
            { type: "keyDown", value: last },
            { type: "keyUp", value: last },
            ...[...modifiers].reverse().map((value) => ({ type: "keyUp", value })),
          ];

  await session.client.call("input.performActions", {
    context: session.context(),
    actions: [keySource(ticks)],
  });
}

/**
 * Type text into whatever has focus, one key at a time.
 *
 * Real key events rather than a `value` assignment, because a control that
 * validates as you type — the sample application's card-number field is one —
 * behaves differently when the value simply appears.
 */
export async function typeText(session: BidiSession, text: string): Promise<void> {
  if (text === "") return;
  const ticks: Tick[] = [];
  for (const character of [...text]) {
    ticks.push({ type: "keyDown", value: character }, { type: "keyUp", value: character });
  }
  await session.client.call("input.performActions", {
    context: session.context(),
    actions: [keySource(ticks)],
  });
}
