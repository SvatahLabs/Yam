/**
 * T2.6 — JSON-path capture (REQ-ADP-2, `Step.capture.jsonPath`).
 *
 * The subset is small on purpose. A capture reads one value out of one response;
 * the moment a flow needs a predicate over a list, what it needs is a custom step
 * (Tier 0), where the logic is TypeScript a reviewer can read. So the tests are
 * as much about what is *refused* as about what works.
 */
import { describe, expect, it } from "vitest";
import { JsonPathError, parseJsonPath, readJsonPath } from "../src/index.js";

const body = {
  activeCount: 3,
  items: [
    { id: "BK-1", total: 10 },
    { id: "BK-2", total: 20 },
  ],
  "odd key": { value: "here" },
  nested: { deep: { deeper: true } },
  nothing: null,
};

describe("reading a path", () => {
  it.each([
    ["$.activeCount", 3],
    ["$.items[0].id", "BK-1"],
    ["$.items[1].total", 20],
    ["$.items[-1].id", "BK-2"],
    ['$["odd key"].value', "here"],
    ["$['odd key'].value", "here"],
    ["$.items.length", 2],
    ["$.nested.deep.deeper", true],
    ["$.nothing", null],
  ])("%s → %s", (path, expected) => {
    expect(readJsonPath(body, path)).toEqual(expected);
  });

  it("reads the whole body for `$`", () => {
    expect(readJsonPath(body, "$")).toBe(body);
  });

  it("returns undefined for a path that is not there, rather than throwing", () => {
    // A capture of something absent is a data problem the executor reports with
    // the step's context; throwing here would lose that context.
    expect(readJsonPath(body, "$.nope")).toBeUndefined();
    expect(readJsonPath(body, "$.items[9].id")).toBeUndefined();
    expect(readJsonPath(body, "$.nothing.deeper")).toBeUndefined();
  });
});

describe("refusing what the subset does not cover", () => {
  it.each([
    ["a wildcard", "$.items[*].id"],
    ["a filter", "$.items[?(@.total>10)]"],
    ["a slice", "$.items[0:1]"],
    ["a path that does not start at the root", "items[0].id"],
    ["an empty field name", "$."],
    ["an unclosed bracket", "$.items[0"],
  ])("refuses %s", (_what, path) => {
    expect(() => parseJsonPath(path)).toThrow(JsonPathError);
  });

  it("says why, and where to go instead", () => {
    expect(() => parseJsonPath("$.items[*]")).toThrow(/custom step/);
  });
});
