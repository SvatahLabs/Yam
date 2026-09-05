/**
 * T2.1 — the rules that only exist across files (REQ-LANG-1, 8, 9, 10).
 *
 * A single file cannot know whether a story name is unique in the project, or
 * whether a `compose:` block names something that exists somewhere else. Those
 * checks live in `readProject`, and this is where they are tested.
 */
import { describe, expect, it } from "vitest";
import { readProject } from "../src/index.js";

const flow = (file: string, text: string) => ({ file, text });

const read = (...flows: Array<{ file: string; text: string }>) =>
  readProject({ flows, env: {} });

describe("story names are unique per project (REQ-LANG-1)", () => {
  it("reports E_DUP_STORY across two files", () => {
    const { diagnostics } = read(
      flow("flows/a.flow", "story: Validate login\n  Click a\n"),
      flow("flows/b.flow", "story: Validate login\n  Click b\n"),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["E_DUP_STORY"]);
    expect(diagnostics[0]!.message).toContain("flows/a.flow:1");
    expect(diagnostics[0]!.file).toBe("flows/b.flow");
  });

  it("reports E_DUP_STORY inside one file", () => {
    const { diagnostics } = read(
      flow("flows/a.flow", "story: One\n  Click a\n\nscenario: One\n  Click b\n"),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["E_DUP_STORY"]);
  });

  it("keeps the first definition, so one duplicate does not lose both stories", () => {
    const { project } = read(
      flow("flows/a.flow", "story: One\n  Click a\n"),
      flow("flows/b.flow", "story: One\n  Click b\n"),
    );
    expect(project.stories.get("One")?.file).toBe("flows/a.flow");
  });

  it("reports two compositions with one name", () => {
    const { diagnostics } = read(
      flow("flows/a.flow", "story: X\n  Click a\n\ncompose: Both\n  X\n"),
      flow("flows/b.flow", "compose: Both\n  X\n"),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["E_DUP_STORY"]);
  });
});

describe("names resolve across files (REQ-LANG-10)", () => {
  it("lets a run block in one file name a story in another", () => {
    const { diagnostics, project } = read(
      flow("flows/stories.flow", "story: Validate login\n  Click a\n"),
      flow("flows/run.flow", "test: everything\n  Validate login\n"),
    );
    expect(diagnostics).toEqual([]);
    expect(project.runs.get("flows/run.flow")).toEqual(["Validate login"]);
  });

  it("does not report a forward reference as unknown", () => {
    // The check runs after every file is read, so the order files happen to be
    // walked in cannot decide whether a project compiles.
    const { diagnostics } = read(
      flow("flows/a-run.flow", "test: everything\n  Validate login\n"),
      flow("flows/b-stories.flow", "story: Validate login\n  Click a\n"),
    );
    expect(diagnostics).toEqual([]);
  });

  it("reports a name that is neither a story nor a composition", () => {
    const { diagnostics } = read(
      flow("flows/a.flow", "story: One\n  Click a\n\ntest: everything\n  Two\n"),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["E_UNKNOWN_STORY"]);
    expect(diagnostics[0]!.line).toBe(5);
  });

  it("concatenates two run blocks in one file, in the order they appear", () => {
    const { project } = read(
      flow(
        "flows/a.flow",
        "story: One\n  Click a\n\nstory: Two\n  Click b\n\ntest: first\n  One\n\nrun: second\n  Two\n",
      ),
    );
    expect(project.runs.get("flows/a.flow")).toEqual(["One", "Two"]);
  });

  it("resolves a bare run block's own name", () => {
    const { diagnostics, project } = read(
      flow("flows/a.flow", "story: One\n  Click a\n\ntest: One\n"),
    );
    expect(diagnostics).toEqual([]);
    expect(project.runs.get("flows/a.flow")).toEqual(["One"]);
  });

  it("reports E_TEST_EMPTY when a bare run block's name is nothing at all", () => {
    // Not E_UNKNOWN_STORY: the author did not mistype a name, they wrote a
    // label and never said what to run. The message has to say that.
    const { diagnostics } = read(
      flow("flows/a.flow", "story: One\n  Click a\n\ntest: Run everything\n"),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["E_TEST_EMPTY"]);
    expect(diagnostics[0]!.message).toContain("runs nothing");
  });

  /*
   * The legacy distinction between the two header words, which `execution.flow`
   * depends on: seven `scenario:` blocks and no `test:` block at all. A `story:`
   * is a library unit that a composition or a run block names; a `scenario:`
   * runs where it is written. Recorded as a deviation — REQ-LANG-10 says the run
   * block defines the order, and does not say what happens without one.
   */
  it("runs a flow's scenarios in file order when it has no run block", () => {
    const { diagnostics, project } = read(
      flow("flows/a.flow", "scenario: First\n  Click a\n\nscenario: Second\n  Click b\n"),
    );
    expect(diagnostics).toEqual([]);
    expect(project.runs.get("flows/a.flow")).toEqual(["First", "Second"]);
  });

  it("does not run a story that nothing names", () => {
    const { project } = read(
      flow("flows/a.flow", "story: Library\n  Click a\n\nscenario: Runs\n  Click b\n"),
    );
    expect(project.runs.get("flows/a.flow")).toEqual(["Runs"]);
  });

  it("lets a run block override the scenario order it would otherwise have", () => {
    const { project } = read(
      flow(
        "flows/a.flow",
        "scenario: First\n  Click a\n\nscenario: Second\n  Click b\n\ntest: only the second\n  Second\n",
      ),
    );
    expect(project.runs.get("flows/a.flow")).toEqual(["Second"]);
  });

  it("reports a composition that expands into itself", () => {
    // Expanding it would not terminate, and "the run hung" is a much worse
    // report than "this composition contains itself".
    const { diagnostics } = read(
      flow("flows/a.flow", "story: X\n  Click a\n\ncompose: A\n  X\n  B\n\ncompose: B\n  A\n"),
    );
    expect(diagnostics.some((d) => d.code === "E_UNKNOWN_STORY" && d.message.includes("into itself"))).toBe(
      true,
    );
  });
});

describe("data (REQ-LANG-9)", () => {
  const data = (text: string, env: NodeJS.ProcessEnv = {}) =>
    readProject({ flows: [], data: { file: "data.yaml", text }, env });

  it("reads the tree and the secret paths", () => {
    const { project, diagnostics } = data(
      `user:\n  email: "a@b.c"\n  password: "\${PW}"\nsecrets:\n  - user.password\n`,
      { PW: "hunter2" },
    );
    expect(diagnostics).toEqual([]);
    expect(project.data.values).toEqual({ user: { email: "a@b.c", password: "hunter2" } });
    expect([...project.data.secrets]).toEqual(["user.password"]);
  });

  it("keeps `secrets:` out of the data itself", () => {
    const { project } = data(`a: 1\nsecrets:\n  - a\n`);
    expect(Object.keys(project.data.values)).toEqual(["a"]);
  });

  it("warns rather than fails when a secret's variable is unset", () => {
    // Compiling a plan does not need the value; running does. Failing the
    // compile would make a plan un-buildable on a machine that will never run it.
    const { project, diagnostics } = data(`p: "\${MISSING}"\nsecrets:\n  - p\n`);
    expect(diagnostics.map((d) => d.code)).toEqual(["W_SECRET_UNSET"]);
    expect(diagnostics[0]!.severity).toBe("warning");
    expect(project.data.values["p"]).toBe("${MISSING}");
    expect(project.data.secrets.has("p")).toBe(true);
  });

  it("resolves only a whole-value indirection", () => {
    // `"${A}/${B}"` is partly a secret, and a value that is partly a secret
    // cannot be redacted. Leaving it alone is the honest outcome.
    const { project } = data(`u: "\${HOST}/x"\n`, { HOST: "https://h" });
    expect(project.data.values["u"]).toBe("${HOST}/x");
  });

  it("reports a secret path that is not in the data", () => {
    const { diagnostics } = data(`a: 1\nsecrets:\n  - b\n`);
    expect(diagnostics.map((d) => d.code)).toEqual(["E_DATA"]);
  });

  it("applies SVATAH_DATA_* overrides", () => {
    const { project } = data(`user:\n  email: "a@b.c"\n`, { SVATAH_DATA_USER__EMAIL: "x@y.z" });
    expect(project.data.values).toEqual({ user: { email: "x@y.z" } });
  });

  it("accepts a dotted override name too", () => {
    const { project } = data(`user:\n  email: "a@b.c"\n`, { "SVATAH_DATA_user.email": "x@y.z" });
    expect(project.data.values).toEqual({ user: { email: "x@y.z" } });
  });

  it("reports a data file that is not a mapping", () => {
    expect(data("- one\n- two\n").diagnostics.map((d) => d.code)).toEqual(["E_DATA"]);
  });

  it("reports YAML that does not parse", () => {
    expect(data("a: [1,\n").diagnostics.map((d) => d.code)).toEqual(["E_DATA"]);
  });
});

describe("the target dictionary comes with the project (REQ-COMP-5)", () => {
  it("is seeded from targets.yaml and from the bindings the caller passed", () => {
    const { project, diagnostics } = readProject({
      flows: [],
      targets: { file: "targets.yaml", text: 'sign-in-button:\n  - "the sign in button"\n' },
      bindings: [{ id: "login.username-field", phrases: ["the username field"] }],
      env: {},
    });
    expect(diagnostics).toEqual([]);
    expect(project.targets.resolve("the sign in button").id).toBe("sign-in-button");
    expect(project.targets.resolve("the username field").id).toBe("login.username-field");
  });

  it("is empty but present when the project has neither", () => {
    const { project } = readProject({ flows: [], env: {} });
    expect(project.targets.list()).toEqual([]);
  });

  it("reports targets.yaml that does not parse", () => {
    const { diagnostics } = readProject({
      flows: [],
      targets: { file: "targets.yaml", text: "a: [1,\n" },
      env: {},
    });
    expect(diagnostics.map((d) => d.code)).toEqual(["E_SYNTAX"]);
  });
});

describe("named API requests (REQ-LANG-8, REQ-ADP-2)", () => {
  const apis = (...files: Array<{ file: string; text: string }>) =>
    readProject({ flows: [], apis: files, env: {} });

  it("reads a request and keys it by its declared name, not its filename", () => {
    const { project, diagnostics } = apis(
      flow("api/count.yaml", 'name: "active count"\nmethod: GET\nurl: "/api/active-count"\n'),
    );
    expect(diagnostics).toEqual([]);
    expect(project.apis.requests.get("active count")?.method).toBe("GET");
  });

  it("falls back to the filename when the file declares no name", () => {
    const { project } = apis(flow("api/count.yaml", 'method: GET\nurl: "/x"\n'));
    expect(project.apis.requests.has("count")).toBe(true);
  });

  it("rejects a request the published schema does not accept", () => {
    const { diagnostics } = apis(flow("api/bad.yaml", 'method: FETCH\nurl: "/x"\n'));
    expect(diagnostics.map((d) => d.code)).toEqual(["E_SYNTAX"]);
  });

  it("reports two requests under one name, and says which files", () => {
    const { diagnostics } = apis(
      flow("api/a.yaml", 'name: "count"\nmethod: GET\nurl: "/a"\n'),
      flow("api/b.yaml", 'name: "count"\nmethod: GET\nurl: "/b"\n'),
    );
    expect(diagnostics.map((d) => d.code)).toEqual(["E_DUP_API"]);
    expect(diagnostics[0]!.message).toContain("api/a.yaml");
    expect(diagnostics[0]!.message).toContain("api/b.yaml");
  });
});
