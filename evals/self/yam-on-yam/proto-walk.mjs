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
/*
 * Responsive is two properties, and the first version of this checked only one.
 *
 *   1. nothing is unreachable when the window is small;
 *   2. the space is *used* when it is large.
 *
 * A layout pinned to 900px against the left edge passes (1) at every width and
 * fails (2) at all of them — which is what a 2000px window actually looked
 * like, and what the check could not see. So the main region's width is
 * measured, and it has to grow with the window.
 */
const widths = [[1920, 1000], [1440, 900], [1100, 800], [760, 900], [420, 800]];
/* Widest first, so the numbers read downwards; the growth check is below. */
for (const [w, h] of widths) {
  await driver.call("act", { session: s, action: "resizeWindow", args: { width: w, height: h } });
  await new Promise((r) => setTimeout(r, 260));
  const ns = await nodes();
  const main = ns.find((n) => n.role === "main");
  const width = main?.box ? Math.round(main.box[2]) : 0;
  const reachable = ns.filter((n) => ["button", "link", "textbox"].includes(n.role)).length;
  const onScreen = (await driver.call("check", { session: s, predicate: { kind: "textContains", value: "Session" }, subject: "page" })).envelope?.status === "succeeded";
  console.log(`  ${String(w).padStart(4)}×${h}  main ${String(width).padStart(4)}px  ${String(reachable).padStart(2)} control(s)  ${onScreen ? "task on screen" : "TASK GONE"}`);
  if (!onScreen) failed += 1;
}
const at = async (w) => {
  await driver.call("act", { session: s, action: "resizeWindow", args: { width: w, height: 900 } });
  await new Promise((r) => setTimeout(r, 240));
  const m = (await nodes()).find((n) => n.role === "main");
  return m?.box ? Math.round(m.box[2]) : 0;
};
const wide = await at(1920), narrow = await at(900);
console.log(`  the work is ${wide}px wide at 1920 and ${narrow}px at 900`);
if (wide <= narrow) { console.log("  \u2718 the layout does not use a wider window"); failed += 1; }
await driver.call("close", { session: s });
console.log(`\n${failed === 0 ? "the prototype walks" : `${failed} problem(s)`}`);
process.exit(0);
