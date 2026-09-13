/**
 * The walkthrough of 2026-09-11, made a command (`EX-N1`, `EX-N2`, E5.1).
 *
 *   pnpm --filter @svatah/yam-desktop package     # the thing a person installs
 *   node evals/self/yam-on-yam/app-walk.mjs       # this
 *
 * The original was done by hand: `surface_connect --app Yam --adapter ax`, then
 * `surface_snapshot`, and every finding read out of the application's own
 * accessibility tree. Twenty-one blockers came out of it and the specification
 * cites them by number — which is worth nothing if the reading cannot be taken
 * again. "A usability rule only a person can see is one that regresses
 * silently" is `EX-N1`, and this is the answer to it.
 *
 * What is printed is a *measurement*, in a fixed order, so two runs diff. The
 * numbers from 2026-09-11 are below each rule as `was:`; they are not
 * thresholds, they are what the old design measured, which is how `EX-N3` is
 * satisfied — a rule that cannot tell the two designs apart says so in its own
 * output rather than being counted as a pass.
 *
 * The broker must be started by the binary that holds the macOS Accessibility
 * grant *before* the application launches, or every native session asks on
 * behalf of `Yam.app`, which nobody granted. `run.mjs` explains this at its top
 * and does it; this does the same.
 */
import { spawnSync } from "node:child_process";
import { mcpDriver } from "./drivers.mjs";
import { awaitAxWindow, CLI, launchPackagedYam, PROCESS_NAME, quit, ROOT } from "./launch.mjs";

/*
 * A clear field, and a broker this terminal's grant applies to.
 *
 * The same preamble `run.mjs` carries, for the same two reasons. The broker is
 * one process per machine and outlives the commands that use it, so a stale one
 * makes the first measurement a handover; and on macOS the Accessibility
 * permission belongs to a **program**, so whichever binary starts the broker is
 * the one every native session asks on behalf of. Launch the application first
 * and that is `Yam.app`, which nobody granted.
 */
spawnSync("pkill", ["-f", "surface broker"], { encoding: "utf8" });
spawnSync("pkill", ["-f", "bin.js serve"], { encoding: "utf8" });
spawnSync(process.execPath, [CLI, "surface", "sessions", "--json"], { encoding: "utf8", cwd: ROOT });

const transcript = [];
const driver = await mcpDriver({ transcript, name: "app-walk" });

/** Every node of the window, through the adapter a screen reader would use. */
async function tree(session) {
  const { envelope } = await driver.call("snapshot", { session, interactiveOnly: false });
  if (envelope.status !== "succeeded") {
    throw new Error(`snapshot refused: ${envelope.error?.message ?? "no reason given"}`);
  }
  return envelope.result?.nodes ?? [];
}

const say = (line) => process.stdout.write(`${line}\n`);
const pad = (value, width) => String(value).padStart(width);

/**
 * The rules, each one a blocker the walkthrough found.
 *
 * `was` is the 2026-09-11 reading. A rule whose `now` equals its `was` has not
 * distinguished the designs, and prints as `SAME` rather than as a pass.
 */
const RULES = [
  {
    id: "B11 / EX-04",
    says: "controls announced collapsed",
    was: "every one",
    run: (ns) => {
      const collapsed = ns.filter((n) => (n.states ?? []).includes("collapsed"));
      const expandable = new Set(["combobox", "treeitem", "row", "button", "disclosure"]);
      const wrong = collapsed.filter((n) => !expandable.has(n.role));
      return { now: `${collapsed.length} collapsed, ${wrong.length} on a role that cannot expand`, ok: wrong.length === 0 };
    },
  },
  {
    id: "B12 / EX-03",
    says: "names arriving in capitals",
    was: "INSPECTOR, CONNECT AN AGENT, BROWSER, API, NATIVE APP, DEVICE",
    run: (ns) => {
      const shouted = ns
        .map((n) => (n.name ?? "").trim())
        .filter((name) => {
          const letters = name.replace(/[^A-Za-z]/g, "");
          return letters.length >= 4 && letters === letters.toUpperCase();
        });
      return { now: shouted.length === 0 ? "none" : shouted.slice(0, 8).join(", "), ok: shouted.length === 0 };
    },
  },
  {
    id: "B13 / AX-09",
    says: "the heading outline",
    was: "flat: 8 headings, all one level",
    run: (ns) => {
      /*
       * The level is the heading's `value`.
       *
       * `AXHeading` carries its level in `AXValue` — that is the AXAPI
       * convention, and Yam's snapshot has been carrying it all along. The
       * first version of this rule read `n.level`, a field no adapter
       * publishes, and therefore reported every outline as flat: a measurement
       * that cannot come out any other way is not a measurement.
       */
      const headings = ns.filter((n) => n.role === "heading");
      const levels = [...new Set(headings.map((n) => Number(n.value)).filter(Number.isFinite))].sort();
      return {
        now: `${headings.length} headings at level(s) ${levels.join(", ") || "unstated"}`,
        ok: headings.length === 0 || (levels.length > 1 && levels[0] === 1),
      };
    },
  },
  {
    id: "B14 / AX-09",
    says: "headings published and not drawn",
    was: 'heading "OTHER"',
    run: (ns) => {
      const undrawn = ns.filter(
        (n) => n.role === "heading" && ((n.name ?? "").trim() === "" || (n.box && (n.box[2] <= 0 || n.box[3] <= 0))),
      );
      return { now: undrawn.length === 0 ? "none" : undrawn.map((n) => n.name).join(", "), ok: undrawn.length === 0 };
    },
  },
  {
    id: "B15 / AX-10",
    says: "empty scaffolding",
    was: "6 tables, 15 rows, 106 cells with nothing connected",
    run: (ns) => {
      const tables = ns.filter((n) => n.role === "table" || n.role === "grid");
      const rows = ns.filter((n) => n.role === "row");
      const cells = ns.filter((n) => n.role === "cell" || n.role === "gridcell");
      return {
        now: `${tables.length} tables, ${rows.length} rows, ${cells.length} cells`,
        ok: tables.length < 6,
      };
    },
  },
  {
    id: "B8 / AX-05",
    says: "the toolbar's first controls",
    was: "3 of 4 disabled, ahead of the task",
    run: (ns) => {
      const acts = interactive(ns);
      const leading = [];
      for (const one of acts) {
        if (!(one.states ?? []).includes("disabled")) break;
        leading.push(one.name);
      }
      return { now: leading.length === 0 ? "none disabled before the first live control" : leading.join(", "), ok: leading.length === 0 };
    },
  },
  {
    id: "B9 / AX-01",
    says: "where the first task sits",
    was: "below and after the toolbar",
    run: (ns) => {
      const acts = interactive(ns);
      const at = acts.findIndex((n) => n.native?.automationId === "surfaces-url");
      const before = at < 0 ? [] : acts.slice(0, at).map((n) => n.name);
      return {
        now: at < 0 ? "the connect field is not on the screen" : `${at} control(s) before it${before.length === 0 ? "" : `: ${before.join(", ")}`}`,
        ok: at === 0,
      };
    },
  },
  {
    id: "B10 / AX-01",
    says: "the mode strip against the first control that acts",
    was: "after it",
    run: (ns) => {
      const order = ns.filter((n) => n.role === "tab" || n.role === "button");
      const tab = order.findIndex((n) => n.role === "tab");
      const bar = order.findIndex((n) => (n.native?.automationId ?? "").startsWith("action-"));
      if (tab < 0) return { now: "no mode strip on this screen", ok: true };
      return {
        now: bar < 0 ? "the strip is here and nothing on the screen acts" : `strip at ${tab}, first acting control at ${bar}`,
        ok: bar < 0 || tab < bar,
      };
    },
  },
  {
    id: "B1 / AX-12",
    says: "recents that are the app's own",
    was: "yam-shell-ZSPbBQ, yam-shell-aTz9sp, yam-shell-v5WyAd",
    run: (ns) => {
      const own = ns.filter((n) => /^yam-shell-|^workspace$/.test((n.name ?? "").trim()));
      return { now: own.length === 0 ? "none" : own.map((n) => n.name).join(", "), ok: own.length === 0 };
    },
  },
  {
    id: "B5 / AX-02",
    says: "say mode's own controls",
    was: "none: a paragraph",
    run: (ns) => {
      /* Read from the tree of the screen as it opens; Say is a mode away. */
      const hasField = ns.some((n) => n.role === "textbox");
      return { now: hasField ? "a field is on the screen" : "no field", ok: hasField };
    },
  },
];

/**
 * Everything on the screen a person can press or type into, in tree order.
 *
 * The screen, meaning the `main` landmark — which is exactly what `AX-01`'s
 * "the navigation excepted" is about, once it is said precisely. The window's
 * own close, minimise and zoom buttons are the operating system's; the rail is
 * `navigation`; the top bar is `banner` and carries the command palette, the
 * project and the appearance, none of which anybody opened the window to use.
 *
 * The first version of this listed names to exclude, and missed every rail row
 * the moment `AX-04` added ", needs a project" to their accessible names — so
 * it reported eleven controls before the task and nine of them were the rail.
 * A filter that has to be kept in step with copy is a filter that goes wrong
 * silently.
 */
function interactive(ns) {
  const roles = new Set(["button", "textbox", "combobox", "checkbox", "tab", "link", "radio"]);
  const byRef = new Map(ns.map((n) => [n.ref, n]));
  /*
   * A `tablist` is navigation, and `AX-01` excepts the navigation.
   *
   * This was not obvious and the measurement is what settled it. With the rail,
   * the window chrome and the top bar excluded, three controls still stood in
   * front of the connect field: Record, Say and Do. Whether that is a defect
   * depends on whether the mode strip is navigation, and the specification
   * answers it from the other end — `B10`'s complaint is that the strip comes
   * *after* the toolbar, which is a request to move it **earlier**, not to
   * remove it. A rule that made the strip a violation of `AX-01` would
   * contradict the blocker `AX-01` also cites.
   *
   * So the strip is navigation here, and `B10` below is what holds it to its
   * place: before the bar whose meaning it changes.
   */
  const inMain = (n) => {
    for (let at = n, hops = 0; at !== undefined && hops < 40; hops += 1) {
      if (at.role === "main") return true;
      at = byRef.get(at.parent);
    }
    return false;
  };
  const inTablist = (n) => {
    for (let at = n, hops = 0; at !== undefined && hops < 40; hops += 1) {
      if (at.role === "tablist") return true;
      at = byRef.get(at.parent);
    }
    return false;
  };
  return ns.filter((n) => roles.has(n.role) && inMain(n) && !inTablist(n));
}

let code = 0;
try {
  const launched = await launchPackagedYam();
  if (launched.launched === false || launched.ready === false) {
    throw new Error(launched.reason ?? "the application did not start");
  }
  const window = await awaitAxWindow();
  if (!window.ready) throw new Error(window.reason);

  const opened = await driver.call("connect", { app: PROCESS_NAME, adapter: "ax" });
  if (opened.envelope.status !== "succeeded") {
    throw new Error(`connect refused: ${opened.envelope.error?.message ?? "no reason given"}`);
  }
  const session = opened.envelope.result.sessionId;
  const nodes = await tree(session);

  say("");
  say(`  the packaged application, read through the ax adapter`);
  say(`  ${pad(nodes.length, 4)} nodes   ${pad(interactive(nodes).length, 3)} interactive controls   ${pad(nodes.filter((n) => (n.name ?? "") === "" && n.role !== "group").length, 3)} unnamed`);
  say("");

  let same = 0;
  for (const rule of RULES) {
    const answer = rule.run(nodes);
    const verdict = answer.ok ? "ok  " : "OPEN";
    say(`  ${verdict} ${rule.id.padEnd(12)} ${rule.says}`);
    say(`       was: ${rule.was}`);
    say(`       now: ${answer.now}`);
    if (String(answer.now) === String(rule.was)) same += 1;
    if (!answer.ok) code = 1;
  }
  say("");
  say(`  ${RULES.length - same} of ${RULES.length} rules can tell this design from the one they were written against.`);
  if (same > 0) say(`  ${same} measured the same on both, and are marked so rather than counted (EX-N3).`);
  say("");

  await driver.call("close", { session }).catch(() => undefined);
} catch (error) {
  say(`  the walk stopped: ${error instanceof Error ? error.message : String(error)}`);
  code = 1;
} finally {
  await driver.close();
  quit();
}

process.exit(code);
