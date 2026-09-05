/**
 * The surface conformance suite for the web sample application (LLD §14).
 *
 * One group of cases per page of `apps/sample-web`, each a script of surface
 * calls with the invariants LLD §14 names: roles, names and states present in the
 * snapshot; the effect an `act` must have had; and the error type a call must
 * throw. Nothing here is Playwright-specific — the suite is handed an
 * `AgentSurface` and knows nothing else, which is the point (REQ-SURF-3).
 */
import type { ConformanceCase } from "./types.js";

/** A textbox, button, link or the like — what an adapter must always report. */
function nodeWith(
  nodes: readonly { role: string; name?: string; states: readonly string[] }[],
  role: string,
  name?: string,
) {
  return nodes.find((n) => n.role === role && (name === undefined || n.name === name));
}

export const SURFACE_CASES: readonly ConformanceCase[] = [
  /* ── the home page ──────────────────────────────────────────────────────── */
  {
    id: "home.snapshot",
    page: "/",
    description: "The home page snapshot carries the navigation, the heading and the sign-in link.",
    async run({ surface, baseUrl, check, equals }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/` });
      const snapshot = await surface.snapshot();

      check("the snapshot has nodes", snapshot.nodes.length > 0, {
        expected: "> 0",
        actual: snapshot.nodes.length,
      });
      check(
        "every node has a reference, a role and a states array",
        snapshot.nodes.every(
          (n) => typeof n.ref === "string" && n.ref !== "" && typeof n.role === "string" && Array.isArray(n.states),
        ),
        { expected: "ref, role, states on every node", actual: snapshot.nodes[0] },
      );
      check(
        "the navigation landmark is present",
        nodeWith(snapshot.nodes, "navigation") !== undefined,
        { expected: 'a node with role "navigation"' },
      );
      check(
        'the heading "Deterministic automation, once described" is present',
        nodeWith(snapshot.nodes, "heading", "Deterministic automation, once described") !== undefined,
        { expected: 'heading "Deterministic automation, once described"' },
      );
      check('the "Sign in" link is present', nodeWith(snapshot.nodes, "link", "Sign in") !== undefined, {
        expected: 'link "Sign in"',
      });
      equals("the snapshot hash is a sha256", /^[0-9a-f]{64}$/.test(snapshot.hash), true);
      check("the snapshot renders text with references", snapshot.text.includes("[ref="), {
        expected: "[ref=…] annotations in Snapshot.text",
        actual: snapshot.text.slice(0, 120),
      });
    },
  },
  {
    id: "home.click-navigates",
    page: "/",
    description: "Clicking the sign-in link navigates the session.",
    async run({ surface, baseUrl, check, equals }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/` });
      const refs = await surface.locate({ by: "role", role: "link", name: "Sign in", score: 1 });
      equals("exactly one sign-in link is located", refs.length, 1);
      await surface.act("click", refs[0]!);
      const url = String(await surface.read("url"));
      check("the session is on /login", url.endsWith("/login"), { expected: "/login", actual: url });
    },
  },

  /* ── the login page ─────────────────────────────────────────────────────── */
  {
    id: "login.snapshot-states",
    page: "/login",
    description:
      "The login snapshot reports the form controls with their names and their required, unchecked and hidden states.",
    async run({ surface, baseUrl, check }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/login` });
      const snapshot = await surface.snapshot();

      const username = nodeWith(snapshot.nodes, "textbox", "Username");
      const password = nodeWith(snapshot.nodes, "textbox", "Password");
      const remember = nodeWith(snapshot.nodes, "checkbox", "Remember me");
      const submit = nodeWith(snapshot.nodes, "button", "Sign In");

      check('a textbox named "Username"', username !== undefined, { expected: 'textbox "Username"' });
      check('a textbox named "Password"', password !== undefined, { expected: 'textbox "Password"' });
      check('a checkbox named "Remember me"', remember !== undefined, {
        expected: 'checkbox "Remember me"',
      });
      check('a button named "Sign In"', submit !== undefined, { expected: 'button "Sign In"' });

      check("the username field reports the required state", username?.states.includes("required") === true, {
        expected: '"required" in states',
        actual: username?.states,
      });
      check("the unticked checkbox reports unchecked", remember?.states.includes("unchecked") === true, {
        expected: '"unchecked" in states',
        actual: remember?.states,
      });
      check(
        "the hidden error banner is not rendered in the snapshot text",
        !snapshot.text.includes("Invalid credentials"),
        { expected: "hidden nodes omitted from Snapshot.text", actual: snapshot.text.slice(0, 200) },
      );
    },
  },
  {
    id: "login.type-changes-value",
    page: "/login",
    description: "Typing into a field changes the value read back and the value predicate agrees.",
    async run({ surface, baseUrl, equals, check }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/login` });
      const refs = await surface.locate({ by: "label", value: "Username", score: 1 });
      equals("exactly one field is labelled Username", refs.length, 1);
      const ref = refs[0]!;

      equals("the field starts empty", await surface.read("value", ref), "");
      await surface.act("type", ref, { value: "conform@example.com" });
      equals("read() sees the typed value", await surface.read("value", ref), "conform@example.com");

      const predicate = await surface.check(
        { kind: "value", value: { kind: "literal", value: "conform@example.com" } },
        "ref",
        ref,
      );
      check("the value predicate holds", predicate.ok, { expected: true, actual: predicate });

      await surface.act("clear", ref);
      equals("clear empties the field", await surface.read("value", ref), "");
    },
  },
  {
    id: "login.checkbox-state",
    page: "/login",
    description: "setChecked moves the checkbox and the checked and unchecked predicates follow.",
    async run({ surface, baseUrl, check }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/login` });
      const ref = (await surface.locate({ by: "id", value: "remember", score: 1 }))[0]!;

      check("it starts unchecked", (await surface.check({ kind: "unchecked" }, "ref", ref)).ok, {
        expected: true,
      });
      await surface.act("setChecked", ref, { checked: true });
      check("it is checked after setChecked", (await surface.check({ kind: "checked" }, "ref", ref)).ok, {
        expected: true,
      });
      const snapshot = await surface.snapshot();
      check(
        "the snapshot reports the checked state",
        nodeWith(snapshot.nodes, "checkbox", "Remember me")?.states.includes("checked") === true,
        { expected: '"checked" in states', actual: nodeWith(snapshot.nodes, "checkbox", "Remember me")?.states },
      );
    },
  },
  {
    id: "login.describe",
    page: "/login",
    description:
      "describe() returns everything synthesis and fingerprinting read: tag, attributes, text, neighbours, role path, box and sibling index.",
    async run({ surface, baseUrl, check, equals }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/login` });
      const ref = (await surface.locate({ by: "id", value: "password", score: 1 }))[0]!;
      const described = await surface.describe(ref);

      equals("the description names the reference it was asked about", described.ref, ref);
      equals("role", described.role, "textbox");
      equals("name", described.name, "Password");
      check("tag is set", typeof described.tag === "string" && described.tag !== "", {
        expected: "a non-empty tag",
        actual: described.tag,
      });
      check("attributes are reported", Object.keys(described.attrs).length > 0, {
        expected: "> 0 attributes",
        actual: described.attrs,
      });
      check("neighbour text is collected on both sides", Array.isArray(described.neighbours.before) && Array.isArray(described.neighbours.after), {
        expected: "before[] and after[]",
        actual: described.neighbours,
      });
      check("the ancestor role path is reported", Array.isArray(described.rolePath), {
        expected: "an array of roles",
        actual: described.rolePath,
      });
      check("a bounding box of four numbers", described.box.length === 4 && described.box.every((n) => typeof n === "number"), {
        expected: "[x, y, width, height]",
        actual: described.box,
      });
      check("a sibling index", Number.isInteger(described.index), {
        expected: "an integer",
        actual: described.index,
      });
    },
  },
  {
    id: "login.locate-cardinality",
    page: "/login",
    description:
      "locate() reports 0, 1 or many references and never decides for the caller which one is meant.",
    async run({ surface, baseUrl, equals, check }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/login` });

      equals("a candidate matching nothing returns no references", (await surface.locate({ by: "css", value: "#absent", score: 1 })).length, 0);
      equals("a unique candidate returns one", (await surface.locate({ by: "id", value: "username", score: 1 })).length, 1);

      const many = await surface.locate({ by: "role", role: "textbox", score: 1 });
      check("a candidate matching several returns them all", many.length >= 2, {
        expected: ">= 2",
        actual: many.length,
      });
    },
  },

  /* ── the dashboard ──────────────────────────────────────────────────────── */
  {
    id: "dashboard.read-kinds",
    page: "/dashboard",
    description: "read() answers every kind the surface publishes.",
    async run({ surface, baseUrl, equals, check }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/dashboard` });
      const heading = (await surface.locate({ by: "css", value: "h1", score: 1 }))[0]!;
      const link = (await surface.locate({ by: "css", value: "[data-testid=docs-link]", score: 1 }))[0]!;

      equals("text", await surface.read("text", heading), "Welcome back, Enterprise");
      check("title", String(await surface.read("title")).includes("Dashboard"), {
        expected: "a title containing Dashboard",
        actual: await surface.read("title"),
      });
      check("url", String(await surface.read("url")).endsWith("/dashboard"), {
        expected: "/dashboard",
        actual: await surface.read("url"),
      });
      equals("attribute", await surface.read("attribute", link, "target"), "_blank");
    },
  },
  {
    id: "dashboard.state",
    page: "/dashboard",
    description: "state() reports a restorable subset, and restore() puts the session back.",
    requires: ["restore"],
    async run({ surface, baseUrl, equals, check }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/dashboard` });
      const saved = await surface.state();

      equals("the state names the surface kind", saved.kind, "web");
      check("the state names where the session is", typeof saved.url === "string" && saved.url !== "", {
        expected: "a url",
        actual: saved.url,
      });

      await surface.act("navigate", undefined, { url: `${baseUrl}/checkout` });
      await surface.restore(saved);
      check("restore returns to the recorded url", String(await surface.read("url")).endsWith("/dashboard"), {
        expected: "/dashboard",
        actual: await surface.read("url"),
      });
    },
  },

  /* ── the widgets page ───────────────────────────────────────────────────── */
  {
    id: "widgets.select",
    page: "/widgets",
    description: "selectOption changes a select's value; a multiple select reports multiSelect.",
    async run({ surface, baseUrl, equals, check }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/widgets` });
      const single = (await surface.locate({ by: "id", value: "single-select", score: 1 }))[0]!;
      const multi = (await surface.locate({ by: "id", value: "multi-select", score: 1 }))[0]!;

      await surface.act("selectOption", single, { value: "staging" });
      equals("the single select took the value", await surface.read("value", single), "staging");

      check("the single select is not a multiSelect", !(await surface.check({ kind: "multiSelect" }, "ref", single)).ok, {
        expected: false,
      });
      check("the multiple select is", (await surface.check({ kind: "multiSelect" }, "ref", multi)).ok, {
        expected: true,
      });

      await surface.act("selectOption", multi, { values: ["chromium", "webkit"] });
      equals("the multiple select took both values", await surface.read("value", multi), "chromium, webkit");
    },
  },
  {
    id: "widgets.dialog",
    page: "/widgets",
    description: "A native dialog appears, is answered by policy, and is readable afterwards.",
    requires: ["dialogs"],
    async run({ surface, baseUrl, check, equals }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/widgets` });
      check("no dialog has been seen yet", (await surface.check({ kind: "absent" }, "dialog")).ok, {
        expected: true,
      });

      await surface.act("dialog", undefined, { action: "accept" });
      const alert = (await surface.locate({ by: "css", value: "[data-testid=show-alert]", score: 1 }))[0]!;
      await surface.act("click", alert);

      check("a dialog was seen", (await surface.check({ kind: "present" }, "dialog")).ok, { expected: true });
      const text = await surface.check({ kind: "text", value: { kind: "literal", value: "Saved." } }, "dialog");
      check("its message is readable", text.ok, { expected: "Saved.", actual: text.actual });

      const confirmRef = (await surface.locate({ by: "css", value: "[data-testid=show-confirm]", score: 1 }))[0]!;
      const result = (await surface.locate({ by: "css", value: "[data-testid=dialog-result]", score: 1 }))[0]!;

      /*
       * Both directions, because a suite that only dismissed would pass against
       * an adapter that dismissed everything — and the mirror of that is exactly
       * the defect Draft 2.8 §3.2 was written for: an adapter that read a key no
       * step carried, defaulted to accept, and confirmed every dialog a flow
       * asked it to dismiss (Phase 6 verification, F4).
       */
      await surface.act("dialog", undefined, { action: "dismiss" });
      await surface.act("click", confirmRef);
      equals("a dismissed confirm reports dismissed", await surface.read("text", result), "dismissed");

      await surface.act("dialog", undefined, { action: "accept" });
      await surface.act("click", confirmRef);
      equals("an accepted confirm reports confirmed", await surface.read("text", result), "confirmed");
    },
  },
  {
    id: "widgets.frame",
    page: "/widgets",
    description: "switchFrame scopes the surface to an iframe and back to the main document.",
    requires: ["frames"],
    async run({ surface, baseUrl, equals }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/widgets` });

      await surface.act("switchFrame", undefined, { url: "/widgets/frame" });
      const inside = await surface.locate({ by: "id", value: "frame-input", score: 1 });
      equals("the frame's field is reachable inside the frame", inside.length, 1);
      await surface.act("type", inside[0]!, { value: "conformance" });
      equals("typing in the frame works", await surface.read("value", inside[0]!), "conformance");

      await surface.act("switchFrame", undefined, { name: "main" });
      equals(
        "the main document's heading is reachable again",
        (await surface.locate({ by: "css", value: "[data-testid=widgets-heading]", score: 1 })).length,
        1,
      );
      equals(
        "the frame's field is not reachable from the main document",
        (await surface.locate({ by: "id", value: "frame-input", score: 1 })).length,
        0,
      );
    },
  },
  {
    id: "widgets.windows",
    page: "/widgets",
    description: "A link that opens a new tab is reachable through switchWindow.",
    requires: ["windows"],
    async run({ surface, baseUrl, check }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/widgets` });
      const link = (await surface.locate({ by: "css", value: "[data-testid=open-new-tab]", score: 1 }))[0]!;
      await surface.act("click", link);
      await surface.act("sleep", undefined, { ms: 500 });

      await surface.act("switchWindow", undefined, { index: 1 });
      check("the second window is the docs page", String(await surface.read("url")).includes("/docs"), {
        expected: "/docs",
        actual: await surface.read("url"),
      });

      await surface.act("switchWindow", undefined, { index: 0 });
      await surface.act("closeOtherWindows");
      check("the session is back on the widgets page", String(await surface.read("url")).includes("/widgets"), {
        expected: "/widgets",
        actual: await surface.read("url"),
      });
    },
  },
  {
    id: "widgets.canvas-coords",
    page: "/widgets",
    description:
      "An element with no accessibility node is reachable only by coordinates, and the coords candidate resolves there.",
    async run({ surface, baseUrl, equals, check }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/widgets` });
      const canvas = (await surface.locate({ by: "id", value: "canvas-control", score: 1 }))[0]!;
      await surface.act("scrollIntoView", canvas);
      const box = (await surface.describe(canvas)).box;

      const refs = await surface.locate({
        by: "coords",
        value: `${box[0] + 160},${box[1] + 57}`,
        score: 1,
      });
      equals("the coords candidate resolves to one element", refs.length, 1);
      check("and it is the canvas", (await surface.describe(refs[0]!)).tag === "canvas", {
        expected: "canvas",
        actual: (await surface.describe(refs[0]!)).tag,
      });
    },
  },

  /* ── errors ─────────────────────────────────────────────────────────────── */
  {
    id: "errors.typed",
    page: "/login",
    description:
      "The adapter throws the surface's typed errors, which is how the executor classifies a failure without knowing which adapter ran.",
    async run({ surface, baseUrl, throws }) {
      await surface.act("navigate", undefined, { url: `${baseUrl}/login` });

      await throws(
        "a reference the session never issued is a LocateError or says so",
        () => surface.describe("this-is-not-a-reference"),
        "Error",
      );
      await throws(
        "a candidate with no value is a LocateError",
        () => surface.locate({ by: "css", score: 1 }),
        "LocateError",
      );
      await throws(
        "an action needing a reference and given none is a LocateError",
        () => surface.act("click"),
        "LocateError",
      );
    },
  },
  {
    id: "capabilities.descriptor",
    page: "/",
    description: "The adapter publishes a capability descriptor covering every published flag.",
    async run({ surface, check }) {
      const capabilities = surface.capabilities();
      const flags = [
        "dialogs",
        "frames",
        "windows",
        "upload",
        "drag",
        "trace",
        "webmcp",
        "screenshot",
        "restore",
      ];
      for (const flag of flags) {
        check(`the descriptor answers for "${flag}"`, typeof (capabilities as Record<string, unknown>)[flag] === "boolean", {
          expected: "a boolean",
          actual: (capabilities as Record<string, unknown>)[flag],
        });
      }
      check("the adapter names its kind", ["web", "mobile", "desktop", "http"].includes(surface.kind), {
        expected: "web | mobile | desktop | http",
        actual: surface.kind,
      });
    },
  },
];
