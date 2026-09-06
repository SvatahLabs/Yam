/**
 * Reading a binding file (LLD §6.1, §13.5).
 *
 * `GET /bindings/:id` answers the YAML on disk — the file `yam bindings show`
 * prints and a reviewer reads in a pull request. So a screen that shows a
 * candidate table is reading the same bytes the CLI reads, which is the screen
 * rule (§13.6) at its most literal: there is no "binding as the ADE sees it".
 *
 * Parsing it here rather than asking the service for JSON is deliberate. A
 * `GET /bindings/:id.json` would be a second representation of the store, and
 * the moment one exists someone has to keep the two in step.
 */
import { parse as parseYaml } from "yaml";
import type { BindingFileResponse } from "./shapes.js";

/**
 * One binding file's YAML → the shape a screen reads, or `undefined`.
 *
 * `undefined` rather than a throw: a store file that will not parse is a broken
 * project, and the screen that shows it draws an empty inspector with the error
 * the load already recorded rather than taking the window down.
 */
export function parseBinding(text: string): BindingFileResponse | undefined {
  if (text.trim() === "") return undefined;
  try {
    const value = parseYaml(text) as unknown;
    if (typeof value !== "object" || value === null) return undefined;
    return value as BindingFileResponse;
  } catch {
    return undefined;
  }
}
