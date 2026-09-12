/**
 * Every declared key runs its action, in the running program (TV-02, TV-07).
 *
 * The check this replaces compared two tables — the screens' keys against the
 * cockpit's — and passed while three actions were unreachable:
 *
 *   * `capture.start` on `R` (Flows) and `run.resume` on `R` (Run), eaten by a
 *     reconnect handler written as an inline `if` above the key table;
 *   * `api.send` on `Enter` (API), eaten by the row opener.
 *
 * None of those keys was in `COMMAND_KEYS`, so no comparison of declarations
 * could have seen them. A key is spent by the code that consumes it, not by the
 * table that describes it — so this presses the key into the real handler and
 * asserts the action ran. That is the only formulation that closes the class.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "ink";
import {
  ACTIONS,
  SCREEN_IDS,
  SESSION_MODES,
  fakeService,
  type FakeResponses,
  type ScreenId,
  type SessionMode,
} from "@svatah/yam-screens";
import { App } from "../src/app.js";
import { COCKPIT_ONLY, COMMAND_KEYS, keysFor } from "../src/keys.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(
  readFileSync(join(HERE, "..", "..", "screens", "test", "fixtures", "fixtures-project.json"), "utf8"),
) as FakeResponses;

const PARAMS: Partial<Record<ScreenId, Record<string, string>>> = {
  run: { runId: "comp" },
  flows: { file: "flows/guards-and-compensation.flow" },
};

class FakeStdout extends EventEmitter {
  columns = 120;
  rows = 40;
  write = (): void => {};
}

/** `read()` hands back exactly one write, which is what Ink pulls on `readable`. */
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

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 40));

/** The bytes a terminal sends for a key as the table spells it. */
function bytesFor(key: string): string {
  if (key.startsWith("^") && key.length === 2) {
    /* `^s` is byte 0x13: the letter's position in the alphabet. */
    return String.fromCharCode(key.toLowerCase().charCodeAt(1) - 96);
  }
  return key;
}

/**
 * Press one key on one screen and answer whether its action ran.
 *
 * The action's `run` is spied rather than its effect observed, because what is
 * being checked is reachability — whether the keystroke arrives — and not what
 * the action then does, which its own tests cover.
 */
async function pressed(
  screen: ScreenId,
  key: string,
  actionId: string,
  mode?: SessionMode,
): Promise<boolean> {
  const action = ACTIONS.find((one) => one.id === actionId);
  if (action === undefined) throw new Error(`${screen} binds ${key} to ${actionId}, which is not an action`);
  const spy = vi.spyOn(action, "run").mockResolvedValue({ ok: true, message: "" });
  /*
   * Availability is forced, because it is a different question.
   *
   * `surface.take-control` is unavailable against a fixture with no session
   * selected, and the cockpit says so — correctly. What is under test here is
   * whether the keystroke *arrives*, which must hold whatever the state is; an
   * unreachable key and an unavailable action produce the same silence
   * otherwise, and telling those two apart is the whole point.
   */
  vi.spyOn(action, "availableWhen").mockReturnValue(true);
  const stdin = new FakeStdin();
  const instance = render(
    <App
      service={fakeService(FIXTURES)}
      connection={{ url: "http://127.0.0.1:1", project: "fixtures" }}
      screen={screen}
      params={{ ...(PARAMS[screen] ?? {}), ...(mode === undefined ? {} : { mode }) }}
    />,
    {
      stdout: new FakeStdout() as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  await settle();
  stdin.write(bytesFor(key));
  await settle();
  instance.unmount();
  const ran = spy.mock.calls.length > 0;
  spy.mockRestore();
  return ran;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a bound key reaches its action", () => {
  for (const screen of SCREEN_IDS) {
    for (const binding of keysFor(screen)) {
      /*
       * `flows.save` opens `$EDITOR` instead of running, on purpose (K6): in a
       * terminal "edit the open flow" means the editor, and the action's `run`
       * is what the app's Save button calls. Reachability is checked, the
       * detour is not re-litigated here.
       */
      if (binding.action === "flows.save") continue;
      const mode = binding.modes?.[0];
      const where = mode === undefined ? screen : `${screen} (${mode})`;
      it(`${where}: ${binding.key} runs ${binding.action}`, async () => {
        expect(await pressed(screen, binding.key, binding.action, mode)).toBe(true);
      }, 15_000);
    }
  }
});

describe("no screen binds a key the cockpit spends unconditionally", () => {
  it("holds for every screen and every mode", () => {
    const clashes: string[] = [];
    for (const screen of SCREEN_IDS) {
      const modes: ReadonlyArray<SessionMode | undefined> =
        screen === "session" ? SESSION_MODES : [undefined];
      for (const mode of modes) {
        for (const binding of keysFor(screen, mode)) {
          if (COCKPIT_ONLY.includes(binding.key)) {
            clashes.push(`${screen}${mode === undefined ? "" : `/${mode}`}: ${binding.key}`);
          }
        }
      }
    }
    expect(clashes, clashes.join(" · ")).toEqual([]);
  });

  /*
   * `COCKPIT_ONLY` is a second list, so it can drift from `COMMAND_KEYS`. It may
   * hold fewer keys — `Enter`, `i` and `m` are deliberately absent, being scoped
   * — but it may not hold a key the cockpit has stopped spending.
   */
  it("names no key the cockpit does not advertise", () => {
    const advertised = COMMAND_KEYS.flatMap((one) =>
      one.key === "1-4"
        ? ["1", "2", "3", "4"]
        : one.key === "j k"
          ? ["j", "k"]
          : one.key === "[ ]"
            ? ["[", "]"]
            : one.key === "Tab"
              ? ["\t"]
              : [one.key.toLowerCase()],
    );
    for (const key of COCKPIT_ONLY) expect(advertised, key).toContain(key);
  });
});
