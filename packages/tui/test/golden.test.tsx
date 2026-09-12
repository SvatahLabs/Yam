/**
 * Golden frames (TV-T06, TV-11).
 *
 * Every screen, at three terminal sizes, rendered against the recorded fixtures
 * and compared with a committed text file. A change to a view is a diff in a
 * file somebody reviews, rather than a picture nobody looks at — which is the
 * whole reason the phantom row numbered `1` and the thirty rows of black
 * survived two phases.
 *
 * Two properties are asserted of every frame as well as its text, because they
 * are the ones a golden file cannot state for the *next* size somebody adds:
 * the frame is exactly as tall as the terminal, and no line is wider than it.
 *
 * `UPDATE_GOLDEN=1 pnpm --filter @svatah/yam-tui test` rewrites them. Read the
 * diff before committing it: a golden updated without being read is a golden
 * that has stopped checking anything.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { render } from "ink";
import { SCREEN_IDS, fakeService, type FakeResponses, type ScreenId } from "@svatah/yam-screens";
import { App } from "../src/app.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "golden");
const FIXTURES = JSON.parse(
  readFileSync(join(HERE, "..", "..", "screens", "test", "fixtures", "fixtures-project.json"), "utf8"),
) as FakeResponses;

const CONNECTION = { url: "http://127.0.0.1:55702", project: "yam-fixtures" };
const SIZES = [
  [80, 24],
  [120, 40],
  [200, 50],
] as const;

/** The parameters that make a screen show something rather than its empty state. */
const PARAMS: Partial<Record<ScreenId, Record<string, string>>> = {
  run: { runId: "comp" },
  flows: { file: "flows/guards-and-compensation.flow" },
};

class FakeStdout extends EventEmitter {
  frames: string[] = [];
  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    super();
  }
  write = (frame: string): void => {
    this.frames.push(frame);
  };
  last = (): string => this.frames[this.frames.length - 1] ?? "";
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read = (): string | null => null;
}

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 60));

/** Draw one screen at one size, with the colour taken back out. */
async function frameOf(screen: ScreenId, columns: number, rows: number): Promise<string> {
  const stdout = new FakeStdout(columns, rows);
  const instance = render(
    <App
      service={fakeService(FIXTURES)}
      connection={CONNECTION}
      screen={screen}
      params={PARAMS[screen] ?? {}}
    />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: new FakeStdin() as unknown as NodeJS.ReadStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  await settle();
  await settle();
  const frame = stdout.last();
  instance.unmount();
  /* Taking the colour back out is the point: a golden is about the words. */
  return frame.replace(COLOUR, "").replace(/\n$/, "");
}

const COLOUR = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

describe("every screen, at every size, is the frame that was reviewed (TV-11)", () => {
  if (!existsSync(GOLDEN)) mkdirSync(GOLDEN, { recursive: true });

  for (const screen of SCREEN_IDS) {
    for (const [columns, rows] of SIZES) {
      it(`${screen} at ${columns}x${rows}`, async () => {
        const drawn = await frameOf(screen, columns, rows);
        const lines = drawn.split("\n");

        /* The two properties a golden cannot state for a size nobody added yet. */
        expect(lines.length, `${screen} drew ${lines.length} rows in ${rows}`).toBe(rows);
        for (const line of lines) {
          expect(
            line.length,
            `${screen} drew ${line.length} columns in ${columns}`,
          ).toBeLessThanOrEqual(columns);
        }

        const file = join(GOLDEN, `${screen}-${columns}x${rows}.txt`);
        if (process.env["UPDATE_GOLDEN"] === "1" || !existsSync(file)) {
          writeFileSync(file, `${drawn}\n`);
          return;
        }
        expect(drawn, `${screen} at ${columns}x${rows} is not the frame that was reviewed`).toBe(
          readFileSync(file, "utf8").replace(/\n$/, ""),
        );
      });
    }
  }
});
