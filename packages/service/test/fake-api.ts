/**
 * A `ServiceApi` that answers from memory (T2.11).
 *
 * The service's own contract is HTTP: the token, the paths, the status codes,
 * the stream. None of that is about a browser or a compiler, and driving one to
 * test it would make the interesting cases slow to arrange and the failures
 * ambiguous.
 *
 * That the service *can* be tested this way is the injection working: it has no
 * way to reach the compiler or the executor, so four functions are the whole of
 * what has to be stood in for. The CLI's `test/service.test.ts` runs the same
 * service against the real ones.
 */
import type { ServiceApi, ProjectHandle } from "../src/index.js";

export const FAKE_ROOT = "/fake/project";

export function fakeProject(root = FAKE_ROOT): ProjectHandle {
  return {
    root,
    config: {
      project: "fake",
      flows: { dir: "flows" },
      bindings: { dir: "bindings" },
      run: { outputDir: "runs" },
    },
    project: {
      flows: [{ file: "flows/a.flow" }],
      stories: new Map([
        [
          "Sign in",
          {
            story: {
              kind: "story",
              steps: [{}, {}],
              signature: { inputs: { email: { type: "string" } }, outputs: {} },
            },
            file: "flows/a.flow",
          },
        ],
      ]),
      compositions: new Map([["Everything", { names: ["Sign in"] }]]),
      runs: new Map([["flows/a.flow", ["Sign in"]]]),
      apis: { requests: new Map([["active count", { name: "active count", method: "GET", url: "/x" }]]) },
      data: {
        values: { user: { email: "a@b.c", password: "hunter2" }, baseUrl: "http://app.test" },
        secrets: new Set(["user.password"]),
      },
    },
    steps: { ids: () => ["steps/seed.ts#default"] },
    diagnostics: [],
  };
}

export function fakeApi(overrides: Partial<ServiceApi> = {}): ServiceApi {
  let counter = 0;
  return {
    loadProject: async (root) => fakeProject(root),
    compileProject: () => ({ plan: { hash: "a".repeat(64), stories: [{}] }, diagnostics: [] }),
    runProject: async () => ({
      runId: "fake-run",
      summary: {} as never,
      results: [],
    }),
    newRunId: () => `fake${(counter += 1)}`,
    ...overrides,
  };
}
