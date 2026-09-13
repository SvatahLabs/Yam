/**
 * The mocks, judged against AX-01…AX-15 by driving them through the MCP tools.
 *
 *   node --input-type=module -e '…render the boards to /tmp/ux…'
 *   (cd /tmp/ux && python3 -m http.server 8770 &)
 *   node evals/self/yam-on-yam/ux-review.mjs
 *
 * Run over the *old* boards as well as the new ones, because a check that
 * passes on both measures nothing — which is what the first version of this
 * file did, on every rule, and it reported READY.
 */
import { mcpDriver } from "./drivers.mjs";

const BASE = "http://127.0.0.1:8770";
const OLD = ["App-Session", "Explorer", "RecordReview"];
const NEW = ["UX-1-Start", "UX-2-Connected", "UX-3-Say", "UX-4-Record"];
const driver = await mcpDriver({ transcript: [], name: "ux-review" });

const CHROME = new Set(["Command palette", "Session", "Automations", "Activity", "Settings"]);
const isChrome = (n) => CHROME.has((n.name ?? "").split(",")[0].trim());

/** The rules a DOM snapshot can genuinely answer. */
const RULES = [
  {
    id: "AX-01",
    says: "on a board with one task, that task is first",
    run: (ns) => {
      /*
       * The specification says "the controls that perform the *only* available
       * task". A board with a connected surface has several, so the rule does
       * not apply there — and forcing it to would have made a text field the
       * answer to every screen, including Record, whose work is done in the
       * browser.
       */
      const acts = ns.filter((n) => ["button", "link", "textbox", "combobox", "tab"].includes(n.role) && !isChrome(n));
      const field = acts.findIndex((n) => n.role === "textbox");
      if (field < 0) return { ok: true, why: "more than one task here; rule does not apply" };
      const button = acts.findIndex((n) => n.role === "button");
      return { ok: button < 0 || field < button, why: `field at ${field}, first button at ${button}` };
    },
  },
  {
    id: "AX-01b",
    says: "the mode strip comes before the toolbar it gives meaning to",
    run: (ns) => {
      const acts = ns.filter((n) => ["button", "tab"].includes(n.role) && !isChrome(n));
      const tab = acts.findIndex((n) => n.role === "tab");
      if (tab < 0) return { ok: true, why: "no modes on this board" };
      const button = acts.findIndex((n) => n.role === "button");
      return { ok: button < 0 || tab < button, why: `first tab at ${tab}, first button at ${button}` };
    },
  },
  {
    id: "AX-02",
    says: "the board offers something to do",
    run: (ns) => {
      const inputs = ns.filter((n) => ["textbox", "combobox", "checkbox"].includes(n.role)).length;
      const live = ns.filter((n) => n.role === "button" && !isChrome(n) && !(n.states ?? []).includes("disabled")).length;
      return { ok: inputs > 0 || live > 0, why: `${inputs} input(s), ${live} action(s)` };
    },
  },
  {
    id: "AX-04",
    says: "with no project open, a destination that needs one says so",
    run: (ns) => {
      /*
       * Only where there is no project. With one open, Automations and Activity
       * work and marking them would be a lie — the first version of this rule
       * failed every board that had a project, which is all of them but one.
       */
      const noProject = ns.some((n) => /no project open/i.test(`${n.name ?? ""} ${n.value ?? ""}`));
      if (!noProject) return { ok: true, why: "a project is open; rule does not apply" };
      const rail = ns.filter((n) => n.role === "link");
      if (rail.length === 0) return { ok: true, why: "no rail on this board" };
      const said = rail.filter((n) => /needs a project/i.test(n.name ?? "") || (n.states ?? []).includes("disabled"));
      return { ok: said.length > 0, why: `${said.length} of ${rail.length} rail items declare their state` };
    },
  },
  {
    id: "AX-05",
    says: "no dead control is drawn among the live ones",
    run: (ns) => {
      const bar = ns.filter((n) => n.role === "button" && !isChrome(n));
      const dead = bar.filter((n) => (n.states ?? []).includes("disabled"));
      return { ok: dead.length === 0, why: `${dead.length} disabled of ${bar.length}` };
    },
  },
  {
    id: "AX-07",
    says: "the prose names an action",
    run: (ns) => {
      const prose = ns.map((n) => String(n.value ?? "")).filter((t) => t.trim().length > 40);
      if (prose.length === 0) return { ok: true, why: "no prose to judge" };
      const verbs = /\b(press|enter|choose|click|type|open|switch|point|say|run|stop|drive)\b/i;
      const idle = prose.filter((t) => !verbs.test(t));
      return { ok: idle.length === 0, why: `${idle.length} of ${prose.length} sentence(s) name no action` };
    },
  },
  {
    id: "AX-13",
    says: "no sentence twice, and no over-promising copy",
    run: (ns) => {
      const text = ns.map((n) => String(n.value ?? n.name ?? "").trim()).filter((t) => t.length > 25);
      const dupes = text.filter((t, i) => text.indexOf(t) !== i);
      const promise = text.filter((t) => /browser, app, device or API/i.test(t));
      return { ok: dupes.length === 0 && promise.length === 0, why: `${dupes.length} repeat(s), ${promise.length} over-promise(s)` };
    },
  },
  {
    id: "AX-14",
    says: "no screen the model no longer has is named",
    run: (ns) => {
      const stale = ns.filter((n) => /\bSurfaces\b|Record review/i.test(`${n.name ?? ""} ${n.value ?? ""}`));
      return { ok: stale.length === 0, why: stale.length ? stale.map((n) => n.name || n.value).join(" | ").slice(0, 70) : "none" };
    },
  },
];

async function judge(board) {
  const opened = await driver.call("connect", { url: `${BASE}/${board}.html`, adapter: "playwright", headed: false });
  const session = opened.envelope?.result?.sessionId;
  if (!session) return { board, rows: [], note: "could not open" };
  const nodes = (await driver.call("snapshot", { session, maxNodes: 400 })).envelope?.result?.nodes ?? [];
  await driver.call("close", { session });
  return { board, rows: RULES.map((r) => ({ id: r.id, ...r.run(nodes) })) };
}

const results = [];
for (const b of [...OLD, ...NEW]) results.push(await judge(b));

const width = 16;
console.log("\n" + "rule".padEnd(8) + results.map((r) => r.board.slice(0, width - 1).padEnd(width)).join(""));
for (const rule of RULES) {
  let line = rule.id.padEnd(8);
  for (const r of results) {
    const row = r.rows.find((x) => x.id === rule.id);
    line += (row ? (row.ok ? "pass" : "FAIL") : "—").padEnd(width);
  }
  console.log(line + "  " + rule.says);
}
console.log("\n--- why, per board ---");
for (const r of results) {
  const bad = r.rows.filter((x) => !x.ok);
  console.log(`${r.board}: ${bad.length === 0 ? "all pass" : bad.map((x) => `${x.id} (${x.why})`).join("; ")}`);
}
const newBad = results.filter((r) => NEW.includes(r.board)).flatMap((r) => r.rows.filter((x) => !x.ok));
const oldBad = results.filter((r) => OLD.includes(r.board)).flatMap((r) => r.rows.filter((x) => !x.ok));
console.log(`\nold boards: ${oldBad.length} failure(s)   new boards: ${newBad.length} failure(s)`);
console.log(oldBad.length === 0 ? "\nTHE CHECKS DO NOT DISCRIMINATE — they pass on the boards this work replaces." : newBad.length === 0 ? "\nREADY FOR REVIEW" : "\nNOT READY");
process.exit(0);
