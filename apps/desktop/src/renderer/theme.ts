/**
 * The appearance, on the document root (TV-18, TV-A06, `EX-02`).
 *
 * It lived on `Shell`'s own `<div>`, which meant every screen rendered *outside*
 * Shell had no theme on it — and those are the first two a person ever sees.
 * `Starting` and `Welcome` therefore drew in Chromium's default serif with a
 * blank square where the mark goes, because `shell.css` scopes both
 * `font-family` and `--brand-mark` to `.sv-root`.
 *
 * On `<html>`, so there is nowhere left to render that is outside it. The check
 * in `test/theme-root.test.tsx` fails if a component puts it back on a `<div>`.
 *
 * ## Three values, not two (`EX-02`)
 *
 * The hook returned `"light" | "dark"` and began at `"dark"`, unconditionally.
 * Two things followed from that literal. A person on a light machine got a dark
 * window for as long as the bridge took to answer, and in any host without a
 * bridge — the browser harness Yam drives itself through — they got a dark
 * window for ever, whatever the machine said.
 *
 * So the state is the *choice*, which has three values, and the appearance is
 * derived from it:
 *
 *   * `system` — no `data-theme` on the root at all, and `tokens.css`'s
 *     `prefers-color-scheme` media query decides. Absence is the mechanism: an
 *     attribute saying `system` would have to be understood by the stylesheet,
 *     and a stylesheet cannot ask the machine on an attribute's behalf.
 *   * `light`, `dark` — written to the root, where the sheet's `[data-theme]`
 *     blocks override the media query because they come after it.
 *
 * `resolved` is what is actually on screen, for the few places that need to
 * know — it is never what is *stored*, because storing a resolved value is how
 * a preference stops following the machine.
 */
import { useCallback, useEffect, useState } from "react";
import { bridge } from "./bridge.js";

export type ThemeChoice = "system" | "light" | "dark";
export type Appearance = "light" | "dark";

/** What the machine says, right now. */
function machineAppearance(): Appearance {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export interface ThemeControl {
  /** What the person chose, which is what is stored. */
  readonly choice: ThemeChoice;
  /** What is on screen, which is what `system` resolves to. */
  readonly resolved: Appearance;
  readonly choose: (next: ThemeChoice) => void;
}

export function useThemeRoot(): ThemeControl {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [machine, setMachine] = useState<Appearance>(machineAppearance);

  /* The stored choice, once the bridge can be asked for it. */
  useEffect(() => {
    let alive = true;
    try {
      void bridge()
        .preferences()
        .then((preferences) => {
          /*
           * Only one of the three. A host that stubs the bridge without a theme
           * — which the harness does — leaves `system`, rather than setting the
           * choice to `undefined` and writing that to the root.
           */
          const stored = preferences.theme as ThemeChoice | undefined;
          if (alive && (stored === "system" || stored === "light" || stored === "dark")) {
            setChoice(stored);
          }
        })
        .catch(() => undefined);
    } catch {
      /* No bridge: the machine's preference is the whole answer. */
    }
    return () => {
      alive = false;
    };
  }, []);

  /*
   * Follow the machine while it is open, from both directions.
   *
   * `matchMedia` is the browser's account and works in every host; `onTheme` is
   * the main process's, which is the one that fires when `nativeTheme` is told
   * to follow a themeSource. Listening to both means neither host has a state
   * the other would have caught.
   */
  useEffect(() => {
    const stop: Array<() => void> = [];
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const query = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = (): void => setMachine(query.matches ? "dark" : "light");
      query.addEventListener("change", onChange);
      stop.push(() => query.removeEventListener("change", onChange));
      onChange();
    }
    try {
      const off = bridge().onTheme((next: Appearance) => setMachine(next));
      if (off !== undefined) stop.push(off);
    } catch {
      /* No bridge. */
    }
    return () => {
      for (const one of stop) one();
    };
  }, []);

  const resolved: Appearance = choice === "system" ? machine : choice;

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (choice === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
    root.classList.add("sv-root");
  }, [choice]);

  const choose = useCallback((next: ThemeChoice) => {
    setChoice(next);
    try {
      void bridge()
        .preferences({ theme: next })
        .catch(() => undefined);
    } catch {
      /* No bridge: the choice lives for this window and is not stored. */
    }
  }, []);

  return { choice, resolved, choose };
}
