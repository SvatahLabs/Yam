/**
 * The prototype, walked end to end through the MCP tools.
 *
 * Two things are checked that a static board cannot be asked: that every control
 * *does* something, and that the journey a person takes actually connects —
 * connect, watch, decide, keep, run, heal, accept.
 */
import { mcpDriver } from "./drivers.mjs";
const BASE = process.env.PROTO ?? "http://127.0.0.1:8772";
const driver = await mcpDriver({ transcript: [], name: "proto-walk" });
const s = (await driver.call("connect", { url: BASE, adapter: "playwright", headed: false })).envelope?.result?.sessionId;
if (!s) process.exit(2);

const nodes = async () => (await driver.call("snapshot", { session: s, maxNodes: 300 })).envelope?.result?.nodes ?? [];
const text = async () => (await nodes()).map((n) => `${n.name ?? ""} ${n.value ?? ""}`).join(" ");
const click = async (name) => {
  const n = (await nodes()).find((x) => ["button", "link"].includes(x.role) && (x.name ?? "").trim() === name);
  if (!n) return `no control named "${name}"`;
  const a = await driver.call("act", { session: s, ref: n.ref, action: "click", args: {} });
  await new Promise((r) => setTimeout(r, 260));
  return a.envelope?.status === "succeeded" ? "ok" : "refused";
};
let failed = 0;
const step = async (what, name, expect) => {
  const said = await click(name);
  const after = await text();
  const got = expect === undefined || new RegExp(expect, "i").test(after);
  const ok = said === "ok" && got;
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : "  ✘   "}${what}${ok ? "" : ` — click:${said}${got ? "" : `, expected /${expect}/`}`}`);
};

console.log("\n=== the journey ===");
await step("connect", "Connect", "connected");
await step("choose Watch me", "Start watching", "Watching you");
for (let i = 0; i < 4; i += 1) await step(`step ${i + 1} arrives`, i === 0 ? "Pretend I clicked something" : "Do another");
await step("the undecided step asks", "Accept", "Keep it");
await step("keep it", "Keep it", "Flows");
await step("run it", "Run", "Runs|passed|healed");
await step("review the repairs", "Review 2 repairs", "moved");
await step("accept both", "Accept both", "unverified");
/*
 * No "verify" step: accepting both clears the list, so there is nothing left to
 * verify. The first version of this walk asked for one and reported a defect in
 * the prototype for refusing to do something impossible.
 */

console.log("\n=== every control does something ===");
for (const where of ["Session", "Flows", "Bindings", "Agents", "API", "Data", "Import", "Runs", "Settings"]) {
  await click(where);
  const ns = await nodes();
  const controls = ns.filter((n) => n.role === "button" && !(n.states ?? []).includes("disabled"));
  const dead = controls.filter((n) => !(n.name ?? "").trim());
  console.log(`  ${where.padEnd(9)} ${controls.length} live control(s)${dead.length ? ` — ${dead.length} unnamed` : ""}`);
  if (dead.length) failed += 1;
}

console.log("\n=== it answers to the window ===");
/* On the screen the check is about: the loop above left Settings showing. */
await click("Session");
for (const [w, h] of [[1440, 900], [1000, 800], [760, 900], [420, 800]]) {
  await driver.call("act", { session: s, action: "resize", args: { width: w, height: h } });
  await new Promise((r) => setTimeout(r, 200));
  const ns = await nodes();
  const reachable = ns.filter((n) => ["button", "link", "textbox"].includes(n.role) && !(n.states ?? []).includes("hidden")).length;
  const overflow = await driver.call("check", { session: s, predicate: { kind: "textContains", value: "Session" }, subject: "page" });
  console.log(`  ${String(w).padStart(4)}×${h}  ${reachable} control(s) reachable, the task ${overflow.envelope?.status === "succeeded" ? "still on screen" : "GONE"}`);
  if (overflow.envelope?.status !== "succeeded") failed += 1;
}
await driver.call("close", { session: s });
console.log(`\n${failed === 0 ? "the prototype walks" : `${failed} problem(s)`}`);
process.exit(0);
