/**
 * The appearance, on the document root (TV-18, TV-A06).
 *
 * It lived on `Shell`'s own `<div>`, which meant every screen rendered *outside*
 * Shell had no theme on it — and those are the first two a person ever sees.
 * `Starting` and `Welcome` therefore drew in Chromium's default serif with a
 * blank square where the mark goes, because `shell.css` scopes both
 * `font-family` and `--brand-mark` to `.sv-root`.
 *
 * On `<html>`, so there is nowhere left to render that is outside it. The check
 * in `test/theme-root.test.tsx` fails if a component puts it back on a `<div>`.
 */
import { useEffect, useState } from "react";
import { bridge } from "./bridge.js";

export function useThemeRoot(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    /* In a browser harness there is no bridge, and dark is the default. */
    try {
      return bridge().onTheme((next: "light" | "dark") => setTheme(next));
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.classList.add("sv-root");
  }, [theme]);

  return theme;
}
