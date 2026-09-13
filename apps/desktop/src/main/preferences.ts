/**
 * The only thing the app stores (T3.6, REQ-ADE-2, LLD §13.6).
 *
 * "No storage of its own beyond UI preferences. The project directory is the only
 * source of truth; anything the app shows is a file the CLI also reads or writes."
 *
 * So this holds a theme, a window size and a list of recent projects — three
 * things whose loss costs a person one gesture — and nothing that could ever be
 * the answer to a question about a project. A cached flow, a remembered run, a
 * copy of the bindings: each would be a second source of truth, and the first
 * time it disagreed with the files the app would be lying about the project.
 *
 * The schema is narrow and unknown keys are dropped on read, so a file edited by
 * hand or left by an older version cannot smuggle anything in.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export interface Preferences {
  readonly theme: "system" | "light" | "dark";
  readonly window: { readonly width: number; readonly height: number };
  /** Most recent first, at most ten. */
  readonly recentProjects: readonly string[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  window: { width: 1280, height: 860 },
  recentProjects: [],
};

const MAX_RECENT = 10;

export function preferencesPath(userDataDir: string): string {
  return join(userDataDir, "preferences.json");
}

/**
 * Read, keeping only what the schema names.
 *
 * A missing file, an unreadable one and one full of nonsense are the same
 * answer: the defaults. Preferences are a convenience, and refusing to start
 * because of one would be the tail wagging the dog.
 */
export function readPreferences(path: string): Preferences {
  if (!existsSync(path)) return DEFAULT_PREFERENCES;
  try {
    return normalise(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function writePreferences(path: string, preferences: Preferences): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(normalise(preferences), null, 2)}\n`, "utf8");
}

/** Add a project to the front of the recent list, without duplicating it. */
export function withRecentProject(preferences: Preferences, project: string): Preferences {
  return {
    ...preferences,
    recentProjects: [project, ...preferences.recentProjects.filter((one) => one !== project)].slice(
      0,
      MAX_RECENT,
    ),
  };
}

/**
 * The projects a person made, out of everything that has been opened
 * (`AX-12`, `B1`).
 *
 * The top bar offered `yam-shell-ZSPbBQ`, `yam-shell-aTz9sp` and
 * `yam-shell-v5WyAd` in the position where somebody expects their own work.
 * Three of the five things in the bar were noise they did not make. Two
 * separate causes, and both are filtered here:
 *
 *   * a directory **under the user-data directory** is the app's own — the
 *     private surfaces workspace lives there, and `openProject(…, false)`
 *     already declines to record it, but a list written before that rule
 *     existed still carries one;
 *   * a directory that is **no longer there** is not somewhere a person can go
 *     back to. The three above were the desktop suite's temporary projects,
 *     recorded when it drove the packaged app and deleted when it finished.
 *
 * `exists` is a parameter so this is a function of its inputs: the main process
 * passes `existsSync` and a test passes a set.
 */
export function personsProjects(
  preferences: Preferences,
  userData: string,
  exists: (path: string) => boolean,
): Preferences {
  const own = resolve(userData);
  return {
    ...preferences,
    recentProjects: preferences.recentProjects.filter(
      (one) => !resolve(one).startsWith(`${own}${sep}`) && resolve(one) !== own && exists(one),
    ),
  };
}

export function normalise(value: unknown): Preferences {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const window = (typeof raw["window"] === "object" && raw["window"] !== null
    ? raw["window"]
    : {}) as Record<string, unknown>;

  return {
    theme:
      raw["theme"] === "light" || raw["theme"] === "dark" || raw["theme"] === "system"
        ? raw["theme"]
        : DEFAULT_PREFERENCES.theme,
    window: {
      width: positive(window["width"], DEFAULT_PREFERENCES.window.width),
      height: positive(window["height"], DEFAULT_PREFERENCES.window.height),
    },
    recentProjects: Array.isArray(raw["recentProjects"])
      ? raw["recentProjects"].filter((one): one is string => typeof one === "string").slice(0, MAX_RECENT)
      : [],
  };
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}
