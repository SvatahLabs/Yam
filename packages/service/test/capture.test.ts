/**
 * Draft 2.23 (REQ-REC-13) — `POST /capture`: the app records a flow from what
 * a person does, and the sentences arrive on the stream.
 *
 * The other recording, `POST /record`, drives a flow somebody wrote. These two
 * share one session slot on purpose — both open the project's browser — and
 * that is the first thing checked here, because two hands on one application
 * would write one store from two sessions.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createService, type RunningService } from "../src/index.js";
import { fakeApi } from "./fake-api.js";

const PROJECT = new URL("../../../evals/fixtures", import.meta.url).pathname;
const TOKEN = "test-token";

let service: RunningService | undefined;
afterEach(async () => {
  await service?.close();
  service = undefined;
});

const post = async (path: string, body?: unknown): Promise<Response> =>
  await fetch(`${service!.url}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/**
 * Events, in order, until `until` arrives.
 *
 * Taken off the service's own bus rather than the SSE stream: the stream is
 * tested where it is served, and a capture's sentences are what this file is
 * about.
 */
function collect(service: RunningService, until: string, ms = 5000): Promise<Array<Record<string, unknown>>> {
  const seen: Array<Record<string, unknown>> = [];
  return new Promise((done) => {
    const timer = setTimeout(() => {
      stop();
      done(seen);
    }, ms);
    const stop = service.events.subscribe((event) => {
      seen.push(event as unknown as Record<string, unknown>);
      if (event.kind === until) {
        clearTimeout(timer);
        stop();
        done(seen);
      }
    });
  });
}

describe("POST /capture (REQ-REC-13, Draft 2.23)", () => {
  it("reports each sentence and finishes with what it wrote", async () => {
    /*
     * A capture that reports three sentences and ends when the signal aborts,
     * which is what the real one does: the flow is written on the way out.
     */
    const api = fakeApi({
      capture: async (_loaded, options) => {
        for (const sentence of ['Go to "/login"', "Type {input.password} into the password field", "Click the sign in button"]) {
          options.onStep?.(sentence);
        }
        await new Promise<void>((done) => {
          if (options.signal?.aborted === true) return done();
          options.signal?.addEventListener("abort", () => done(), { once: true });
        });
        return {
          file: "flows/sign-in.flow",
          story: options.name ?? "Recorded",
          steps: ['Go to "/login"', "Type {input.password} into the password field", "Click the sign in button"],
          inputs: { password: "secret" },
          bound: ["login.password-field", "login.sign-in-button"],
          unbound: [],
          written: ["login/password-field.yaml", "login/sign-in-button.yaml"],
        };
      },
    });
    service = await createService({ project: PROJECT, token: TOKEN, port: 0, api });

    const events = collect(service, "capture.finished");
    const started = await post("/capture", { name: "Sign in" });
    expect(started.status).toBe(202);
    const { sessionId } = (await started.json()) as { sessionId: string };
    expect(sessionId).toBeTruthy();

    // Stopping is how a capture finishes; nothing is written before it.
    await new Promise((done) => setTimeout(done, 100));
    expect((await post(`/capture/${sessionId}/stop`)).status).toBe(202);

    const seen = await events;
    const kinds = seen.map((one) => one["kind"]);
    expect(kinds).toContain("capture.started");
    expect(kinds).toContain("capture.finished");
    expect(seen.filter((one) => one["kind"] === "capture.step").map((one) => one["sentence"])).toEqual([
      'Go to "/login"',
      "Type {input.password} into the password field",
      "Click the sign in button",
    ]);
    const finished = seen.find((one) => one["kind"] === "capture.finished") as {
      captured: { file: string; story: string; bound: string[] };
    };
    expect(finished.captured.file).toBe("flows/sign-in.flow");
    expect(finished.captured.story).toBe("Sign in");
    expect(finished.captured.bound).toHaveLength(2);
  }, 30_000);

  it("shares one session with POST /record: neither starts while the other is open", async () => {
    const api = fakeApi({
      capture: async (_loaded, options) =>
        await new Promise((done) => {
          options.signal?.addEventListener("abort", () => done({ file: "flows/x.flow", steps: [] }), { once: true });
        }),
      record: async () => ({ grounded: 0 }),
    });
    service = await createService({ project: PROJECT, token: TOKEN, port: 0, api });

    const first = await post("/capture", {});
    expect(first.status).toBe(202);
    const { sessionId } = (await first.json()) as { sessionId: string };
    await new Promise((done) => setTimeout(done, 50));

    // A second capture, and a record, are both refused while it is open.
    expect((await post("/capture", {})).status).toBe(409);
    const clash = await post("/record", { gateway: "fake" });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: string }).error).toBe("already-recording");

    expect((await post(`/capture/${sessionId}/stop`)).status).toBe(202);
    await new Promise((done) => setTimeout(done, 100));
    // Released: a record session starts once the capture has ended.
    const after = await post("/record", { gateway: "fake" });
    expect(after.status).toBe(202);
  }, 30_000);

  it("says so when a capture fails, and when the build cannot capture at all", async () => {
    const api = fakeApi({
      capture: async () => {
        throw new Error("The playwright adapter cannot watch what a person does.");
      },
    });
    service = await createService({ project: PROJECT, token: TOKEN, port: 0, api });
    const events = collect(service, "capture.failed");
    expect((await post("/capture", {})).status).toBe(202);
    const failed = (await events).find((one) => one["kind"] === "capture.failed") as { message: string };
    expect(failed.message).toMatch(/cannot watch what a person does/);

    await service.close();
    service = await createService({ project: PROJECT, token: TOKEN, port: 0, api: fakeApi() });
    const refused = await post("/capture", {});
    expect(refused.status).toBe(501);
    expect(((await refused.json()) as { error: string }).error).toBe("not-available");
  }, 30_000);

  it("404s a stop for a session nobody started", async () => {
    service = await createService({ project: PROJECT, token: TOKEN, port: 0, api: fakeApi({ capture: async () => ({}) }) });
    expect((await post("/capture/nope/stop")).status).toBe(404);
  });
});
