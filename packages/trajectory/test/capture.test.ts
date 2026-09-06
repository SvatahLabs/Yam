/**
 * The trajectory file (T4.6, REQ-BEH-4, LLD §13.4).
 *
 * `packages/cli/test/mcp.test.ts` drives an agent through the surface and reads
 * what comes out. This is the file format on its own: that it is JSON lines,
 * that it is canonical, that it validates, and that the three properties T5.5's
 * compiler will depend on are checkable.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkTrajectory, readTrajectory, TrajectoryWriter } from "../src/index.js";

const dirs: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "yam-trajectory-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const description = {
  ref: "r7",
  role: "textbox",
  name: "Username",
  tag: "input",
  attrs: { id: "username" },
  text: "",
  neighbours: { before: ["Sign in"], after: ["Password"] },
  rolePath: ["main", "form"],
  box: [16, 140, 358, 44] as [number, number, number, number],
  index: 0,
  states: ["required" as const],
};

describe("TrajectoryWriter (LLD §13.4)", () => {
  it("writes one JSON object per line", () => {
    // JSON *lines*: a writer that pretty-printed would produce a file no reader
    // could split, which is exactly what the first version of this did.
    const path = join(temp(), "trajectory.jsonl");
    const writer = new TrajectoryWriter(path);
    writer.write({ intent: "look at the page", call: "snapshot" });
    writer.write({ intent: "click sign in", call: "act", ref: "r3" });

    const lines = readFileSync(path, "utf8").split("\n").filter((one) => one !== "");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it("numbers the calls in the order they were made", () => {
    const path = join(temp(), "trajectory.jsonl");
    const writer = new TrajectoryWriter(path);
    for (const intent of ["one", "two", "three"]) writer.write({ intent, call: "snapshot" });
    expect(readTrajectory(path).map((one) => one.seq)).toEqual([1, 2, 3]);
    expect(writer.count).toBe(3);
  });

  it("creates the directory it was pointed at", () => {
    // A trajectory goes under `runs/<id>/`, which does not exist until something
    // makes it (HLD §7).
    const path = join(temp(), "runs", "abc", "trajectory.jsonl");
    new TrajectoryWriter(path).write({ intent: "x", call: "snapshot" });
    expect(readTrajectory(path)).toHaveLength(1);
  });

  it("sorts keys, so two captures of the same calls are the same bytes", () => {
    const one = join(temp(), "a.jsonl");
    const two = join(temp(), "b.jsonl");
    const at = "2026-09-03T00:00:00.000Z";
    new TrajectoryWriter(one).write({ intent: "x", call: "act", ref: "r1", at, describe: description });
    new TrajectoryWriter(two).write({ describe: description, ref: "r1", call: "act", intent: "x", at });
    expect(readFileSync(two, "utf8")).toBe(readFileSync(one, "utf8"));
  });

  it("keeps the element's description, because a reference does not survive", () => {
    // "candidates and fingerprints are synthesised at capture time (no model)":
    // an element described an hour later is a different element or none at all.
    const path = join(temp(), "trajectory.jsonl");
    new TrajectoryWriter(path).write({ intent: "type", call: "act", ref: "r7", describe: description });
    const [line] = readTrajectory(path);
    expect(line!.describe?.name).toBe("Username");
    expect(line!.describe?.attrs["id"]).toBe("username");
  });

  it("records a call that threw", () => {
    // A trajectory is an account of what happened, and the one from a session
    // that went wrong is the one worth reading.
    const path = join(temp(), "trajectory.jsonl");
    new TrajectoryWriter(path).write({ intent: "click", call: "act", error: "no such element" });
    expect(readTrajectory(path)[0]!.error).toBe("no such element");
  });

  it("refuses a line with no intent", () => {
    // The property the whole idea rests on: the intent *is* the sentence a step
    // compiles from, so a line without one is not compilable.
    const path = join(temp(), "trajectory.jsonl");
    const writer = new TrajectoryWriter(path);
    expect(() => writer.write({ intent: "", call: "snapshot" })).toThrow();
  });
});

describe("readTrajectory", () => {
  it("names the line when one will not parse", () => {
    const path = join(temp(), "trajectory.jsonl");
    writeFileSync(path, '{"seq":1,"intent":"x","call":"snapshot","at":"2026"}\nnot json\n', "utf8");
    expect(() => readTrajectory(path)).toThrow(/:2 is not valid JSON/);
  });

  it("names the line when one is not a trajectory line", () => {
    const path = join(temp(), "trajectory.jsonl");
    writeFileSync(path, '{"seq":1,"call":"snapshot","at":"2026"}\n', "utf8");
    expect(() => readTrajectory(path)).toThrow(/intent/);
  });

  it("ignores blank lines, including a trailing newline", () => {
    const path = join(temp(), "trajectory.jsonl");
    new TrajectoryWriter(path).write({ intent: "x", call: "snapshot" });
    expect(readTrajectory(path)).toHaveLength(1);
  });
});

describe("checkTrajectory", () => {
  const line = (seq: number, at: string) => ({
    seq,
    intent: "x",
    call: "snapshot" as const,
    at,
  });

  it("passes a well-formed trajectory", () => {
    expect(
      checkTrajectory([line(1, "2026-09-03T00:00:00Z"), line(2, "2026-09-03T00:00:01Z")]),
    ).toEqual([]);
  });

  it("catches a gap in the sequence", () => {
    expect(checkTrajectory([line(1, "2026-09-03T00:00:00Z"), line(3, "2026-09-03T00:00:01Z")])).toEqual([
      "line 2 has seq 3",
    ]);
  });

  it("catches a line timestamped before the one before it", () => {
    // Which would mean the file was concatenated from two sessions, and the
    // order a compiler reads it in would not be the order things happened.
    expect(checkTrajectory([line(1, "2026-09-03T00:00:05Z"), line(2, "2026-09-03T00:00:01Z")])).toEqual([
      "line 2 is timestamped before the one before it",
    ]);
  });
});
