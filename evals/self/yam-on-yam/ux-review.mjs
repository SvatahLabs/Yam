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

const BASE = process.env.UX_BASE ?? "http://127.0.0.1:8771";
const OLD = [];
const NEW = ["UX-1-Start","UX-2-Watch","UX-3-Observe","UX-4-Run","UX-5-Agents","UX-6-Flows","UX-7-Bindings","UX-8-Reports","UX-9-Settings","UX-10-Data","UX-11-Heal","UX-12-Import"];
const driver = await mcpDriver({ transcript: [], name: "ux-review" });

/*
 * The app's own furniture: navigation and appearance, which are on every screen
 * and are nobody's task. Naming them here is a claim — that a person did not
 * open the window to change the theme — and the rule below is only as honest as
 * that claim is. Everything *else* competes with the task, including the
 * controls a designer thinks of as trim.
 */
const CHROME = new Set([
  "Command palette", "Session", "Automations", "Activity", "Agents", "Settings",
  "Light", "Dark", "Match the system",
]);
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
    says: "the screen tells you what to do, somewhere on it",
    /*
     * Third formulation, and the first two were both wrong.
     *
     * It read the snapshot's node values and found nothing, because the
     * semantic snapshot is the *interactive* tree and a paragraph is not in it
     * — so "no prose to judge" was the answer on every board and the rule
     * passed without looking at a sentence.
     *
     * Reading the page's text instead, it then demanded an imperative in
     * *every* sentence, and failed seven boards on copy that is correct:
     * "an unverified binding is never used without saying so" is a guarantee,
     * and rewriting it as an instruction would make it worse. It also counted
     * the rail's own words as a sentence.
     *
     * What the walkthrough actually found was screens that describe themselves
     * and never say what to do — Say mode's paragraph with no field. One
     * sentence naming an action is the difference, and that is what this asks.
     */
    needsText: true,
    run: (ns, text) => {
      const rail = new Set(ns.filter((n) => n.role === "button" || n.role === "link").map((n) => (n.name ?? "").trim()));
      const sentences = String(text ?? "")
        .split(/(?<=[.!?])\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 40 && !rail.has(t) && /\s[a-z]/.test(t));
      if (sentences.length === 0) return { ok: false, why: "no prose on the page at all" };
      const verbs = /\b(press|enter|choose|click|type|open|switch|point|say|run|stop|drive|connect|keep|accept|verify|review)\b/i;
      const told = sentences.filter((t) => verbs.test(t));
      return { ok: told.length > 0, why: `${told.length} of ${sentences.length} sentence(s) name an action` };
    },
  },
  {
    id: "AX-16",
    says: "the board says where its work goes next",
    run: (ns) => {
      /*
       * There was a stepper across the top of every board, and it is gone: a
       * diagram of the flow is what you print when the screens are not
       * producing one. What it was carrying — where you are, what comes next —
       * has to be in the screen now, so this is the rule that holds it there.
       *
       * A board passes by naming a place the product actually has, or by
       * naming the artifact its work produces. A board that only describes
       * what it is looking at is a cul-de-sac with no sign.
       */
      const text = ns.map((n) => `${n.name ?? ""} ${n.value ?? ""}`).join(" ");
      const forward = /\b(Flows|Bindings|Reports|Runs|Settings|Agents|project|flow|report|repair|proposal|binding)s?\b/i;
      const primary = ns.filter((n) => n.role === "button" && !isChrome(n)).length;
      if (primary === 0) return { ok: false, why: "no action at all on this board" };
      return { ok: forward.test(text), why: forward.test(text) ? "names a destination" : "describes itself and nothing beyond" };
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
  /* The page's text, for the rules that are about sentences rather than controls. */
  const asked = await driver.call("check", { session, predicate: { kind: "textContains", value: "" }, subject: "page" });
  const text = String(asked.envelope?.result?.actual ?? "");
  await driver.call("close", { session });
  return { board, rows: RULES.map((r) => ({ id: r.id, ...r.run(nodes, text) })) };
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
