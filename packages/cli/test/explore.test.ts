/**
 * T14.9 — `yam explore`, and the proposal on the front door (REQ-AGT-5, REQ-CLI-10).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startSampleApp, type SampleServer } from "sample-web";
import { EXIT } from "@svatah/yam-bindings-cli";
import { main } from "../src/index.js";
import { explore } from "../src/commands/explore.js";
import { nextVerb, projectState } from "../src/front-door.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
let app: SampleServer;
const projects: string[] = [];

beforeAll(async () => {
  app = await startSampleApp(0);
}, 120_000);
afterAll(async () => {
  await app.close();
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-explore-"));
  projects.push(dir);
  for (const entry of ["bindings", "flows", "api"]) cpSync(join(FIXTURES, entry), join(dir, entry), { recursive: true });
  cpSync(join(FIXTURES, "data.yaml"), join(dir, "data.yaml"));
  writeFileSync(join(dir, "yam.config.yaml"), readFileSync(join(FIXTURES, "yam.config.yaml"), "utf8").replace(/baseUrl: ".*"/, `baseUrl: "${app.origin}"`), "utf8");
  return dir;
}

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(argv, { out: (t) => (out += `${t}\n`), err: (t) => (err += `${t}\n`) });
  return { code, out, err };
}

const silent = { out: () => undefined, err: () => undefined };
const answer = (result: unknown): { text: string } =>
  JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text) as { text: string };

describe("yam explore (REQ-AGT-5)", () => {
  it("an exploration over the MCP surface becomes a proposal the front door names", async () => {
    const dir = scaffold();
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "explorer", version: "1.0.0" });
    const served = explore({ root: dir, io: silent, transport: serverSide, sessionId: "test", name: "Explored sign in" });
    await client.connect(clientSide);
    const opened = answer(await client.callTool({ name: "surface_connect", arguments: { url: app.origin } })) as { result: { sessionId: string } };
    const session = opened.result.sessionId;
    const home = (answer(await client.callTool({ name: "surface_snapshot", arguments: { session, intent: "see what is on the home page", interactiveOnly: true } })) as { result: { text: string } }).result;
    const signIn = /link "Sign in"(?: \[[^\]]*\])* \[ref=(\w+)\]/.exec(home.text)?.[1];
    expect(signIn, home.text.slice(0, 300)).toBeDefined();
    await client.callTool({ name: "surface_act", arguments: { session, intent: "go to the sign-in page", action: "click", ref: signIn } });
    await client.close();
    const proposal = await served;

    expect(proposal).toBeDefined();
    expect(proposal!.dir.startsWith("proposals/")).toBe(true);
    const files = readdirSync(join(dir, proposal!.dir));
    const flow = files.find((one) => one.endsWith(".flow"));
    expect(flow).toBeDefined();
    const text = readFileSync(join(dir, proposal!.dir, flow!), "utf8");
    expect(text).toContain("Explored sign in");
    expect(existsSync(join(dir, ".yam", "explore", "test", "trajectory.jsonl"))).toBe(true);
    // Nothing reached the flows directory or the store.
    expect(readdirSync(join(dir, "flows")).some((one) => one.includes("Explored"))).toBe(false);

    const state = await projectState(dir);
    expect(state.proposals.length).toBe(1);
    expect(nextVerb(state).verb).toBe(`review ${proposal!.dir}`);
    const status = await cli("status", dir);
    expect(status.out).toContain("proposals 1 waiting");
    expect(status.out).toContain("next      review proposals/");
  }, 120_000);

  it("an empty exploration writes nothing and says so", async () => {
    const dir = scaffold();
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "explorer", version: "1.0.0" });
    const lines: string[] = [];
    const served = explore({ root: dir, io: { out: () => undefined, err: (t) => lines.push(t) }, transport: serverSide, sessionId: "empty" });
    await client.connect(clientSide);
    await client.close();
    expect(await served).toBeUndefined();
    expect(lines.join("\n")).toContain("The exploration was empty");
    expect(existsSync(join(dir, "proposals"))).toBe(false);
  }, 60_000);

  it("--trajectory compiles a trajectory yam mcp wrote", async () => {
    const dir = scaffold();
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "explorer", version: "1.0.0" });
    const served = explore({ root: dir, io: silent, transport: serverSide, sessionId: "first", out: join(dir, "elsewhere") });
    await client.connect(clientSide);
    const first = answer(await client.callTool({ name: "surface_connect", arguments: { url: app.origin } })) as { result: { sessionId: string } };
    await client.callTool({ name: "surface_snapshot", arguments: { session: first.result.sessionId, intent: "look at the home page", interactiveOnly: true } });
    await client.close();
    await served;
    const trajectory = join(dir, ".yam", "explore", "first", "trajectory.jsonl");
    const { code, out } = await cli("explore", dir, "--trajectory", trajectory, "--json");
    expect(code).toBe(EXIT.ok);
    const parsed = JSON.parse(out) as { dir: string };
    expect(parsed.dir.startsWith("proposals/")).toBe(true);
    expect(existsSync(join(dir, parsed.dir))).toBe(true);
  }, 120_000);

  it("refuses a trajectory that is not there", async () => {
    const dir = scaffold();
    const { code, err } = await cli("explore", dir, "--trajectory", join(dir, "nope.jsonl"));
    expect(code).toBe(EXIT.usage);
    expect(err).toContain("No trajectory at");
  });
});
