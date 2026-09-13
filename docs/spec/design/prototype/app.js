/**
 * The prototype: one app, real state, real transitions.
 *
 * Everything a person can press does something. The state below is the only
 * state there is — no project, a surface, a capture, a flow, a run — and every
 * screen is a function of it. That is the point: a prototype where half the
 * controls are decoration cannot be walked, and walking it is the whole reason
 * it exists.
 *
 * The navigation is `SECTIONS` from `@svatah/yam-screens`, unchanged: Session,
 * then Automations (flows, bindings, agents, api, data, import), then Activity
 * (runs), then Settings. A prototype that invented a different rail would be a
 * prototype of a different product.
 */
const S = {
  screen: "session",
  project: null,          // {name, flows}
  surface: null,          // {url, adapter, holder}
  mode: null,             // null | "watch" | "say" | "do"
  captured: [],           // steps seen while watching
  pending: null,          // a decision waiting
  said: [],
  flows: [],
  run: null,              // {flow, passed, healed}
  repairs: [],
  toast: null,
};

const SECTIONS = [
  { id: "session", label: "Session", rail: [["session", "Session"]] },
  { id: "automations", label: "Automations", rail: [
    ["flows", "Flows"], ["bindings", "Bindings"], ["agents", "Agents"],
    ["api", "API"], ["data", "Data"], ["import", "Import"]] },
  { id: "activity", label: "Activity", rail: [["runs", "Runs"]] },
  { id: "settings", label: "Settings", rail: [["settings", "Settings"]] },
];
/** Which destinations are a project's, and are therefore shut without one. */
const NEEDS_PROJECT = new Set(["flows", "bindings", "api", "data", "runs"]);

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const el = (h) => { const d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstElementChild; };
const say = (text) => { S.toast = text; render(); setTimeout(() => { S.toast = null; render(); }, 2600); };
const go = (screen, mode) => { S.screen = screen; if (mode !== undefined) S.mode = mode; render(); };

/* ── the rail ───────────────────────────────────────────────────────────── */
function rail() {
  const item = ([id, label]) => {
    const shut = NEEDS_PROJECT.has(id) && S.project === null;
    return `<button class="nav" data-go="${id}"${S.screen === id ? ' aria-current="page"' : ""}${shut ? ' aria-disabled="true" disabled' : ""}
      aria-label="${label}${shut ? ", needs a project" : ""}">${label}${shut ? '<span class="why">needs a project</span>' : ""}</button>`;
  };
  return `<nav class="rail" aria-label="Sections">
    <div class="brand"><span class="mark"></span>Yam</div>
    ${SECTIONS.map((s) => `<span class="eyebrow">${s.label}</span>${s.rail.map(item).join("")}`).join("")}
    <div class="grow"></div>
  </nav>`;
}

/* ── the screens ────────────────────────────────────────────────────────── */
const screens = {
  session: () => {
    if (S.surface === null) return `
      <div class="head"><h1>Connect something to drive</h1></div>
      <p class="lead">A browser at a URL, an application by name, a browser you already have open, an API, or a command in a terminal. Nothing here needs a project.</p>
      <div class="card now">
        <span class="eyebrow" style="padding:0 0 8px">Start here</span>
        <label for="target" style="display:block;font-size:.8rem;color:var(--muted);margin-bottom:6px">URL, application name, or endpoint</label>
        <div class="field">
          <input type="text" id="target" value="https://example.com" aria-label="URL, application name, or endpoint">
          <button class="btn primary" data-act="connect">Connect</button>
        </div>
        <p class="hint"><span class="dot"></span>Ready here: Chromium, macOS apps, HTTP, a terminal. Connecting opens it and brings you back here to choose what to do with it.</p>
      </div>
      ${S.project === null ? `<div class="card">
        <span class="eyebrow" style="padding:0 0 8px">Or open a project</span>
        <div class="row"><span>booking-tests</span><span class="meta">9 flows · yesterday</span><button class="btn" data-act="open-project">Open</button></div>
        <p class="hint">A project is a folder of flows, bindings and runs. Yam keeps its own scratch workspace for sessions started without one.</p>
      </div>` : ""}`;

    if (S.mode === null) return `
      <div class="head live"><h1>${esc(S.surface.url)}</h1><span class="pill"><span class="dot"></span>connected</span></div>
      <p class="lead">Chromium, and ${S.surface.holder === "you" ? "you are holding it" : `${esc(S.surface.holder)} is holding it`}. Choose how the flow gets written.</p>
      <div class="card now">
        <span class="eyebrow" style="padding:0 0 8px">Three ways, one session</span>
        <div class="row"><span><b>Watch me</b> — you drive, Yam writes it down</span><span class="meta">the observer</span><button class="btn primary" data-act="watch">Start watching</button></div>
        <div class="row"><span><b>Say what to do</b> — one sentence at a time</span><span class="meta">grounded, run, appended</span><button class="btn" data-act="mode-say">Say</button></div>
        <div class="row"><span><b>Do it here</b> — pick a control and an action</span><span class="meta">from the catalogue</span><button class="btn" data-act="mode-do">Do</button></div>
        <p class="hint">All three write the same thing: a flow and its bindings, kept in this project. Switching never reconnects.</p>
      </div>
      <div class="card">
        <span class="eyebrow" style="padding:0 0 8px">On the page</span>
        <div class="row"><span class="mono">textbox “Username”</span><span class="meta">r6 · required</span></div>
        <div class="row"><span class="mono">textbox “Password”</span><span class="meta">r7 · required</span></div>
        <div class="row"><span class="mono">button “Sign In”</span><span class="meta">r9</span></div>
        <div class="row"><span></span><span class="meta"></span><button class="btn" data-act="disconnect">Disconnect</button></div>
      </div>`;

    if (S.mode === "watch") return `
      <div class="head live"><h1>Watching you</h1><span class="pill"><span class="dot"></span>${S.captured.length} step${S.captured.length === 1 ? "" : "s"}</span></div>
      <p class="lead">Drive the browser that opened. Every click and every value becomes a step below. When you are done, <b>Keep it</b> writes a flow into this project.</p>
      <div class="card">
        <span class="eyebrow" style="padding:0 0 8px">What Yam has seen</span>
        ${S.captured.length === 0 ? `<p class="hint" style="margin:0">Nothing yet. <button class="btn small" data-act="simulate">Pretend I clicked something</button></p>`
          : S.captured.map((c) => `<div class="row"><span>${esc(c.text)}</span><span class="meta${c.bound ? "" : " warn"}">${c.bound ? "bound" : "needs a decision"}</span></div>`).join("")}
        ${S.captured.length > 0 && S.pending === null ? `<div class="row"><span></span><button class="btn small" data-act="simulate">Do another</button></div>` : ""}
      </div>
      ${S.pending ? `<div class="card now">
        <span class="eyebrow" style="padding:0 0 8px">Which control did you mean?</span>
        <div class="row"><span>the offer card</span><span class="meta">0.81 · testid offer-card-3</span><button class="btn primary" data-act="accept">Accept</button></div>
        <div class="row"><span>the third list item</span><span class="meta">0.64 · role and position</span><button class="btn" data-act="accept2">Accept</button></div>
        <p class="hint">Or point at it in the browser — the control you click becomes the binding.</p>
      </div>` : ""}
      <div class="card">
        <span class="eyebrow" style="padding:0 0 8px">Will be written</span>
        <div class="row"><span class="mono">flows/book-a-slot.flow</span><span class="meta">${S.captured.length} step${S.captured.length === 1 ? "" : "s"}${S.pending ? ", one undecided" : ""} · joins Flows</span>
          <button class="btn primary" data-act="keep"${S.captured.length === 0 || S.pending ? " disabled" : ""}>Keep it</button></div>
        <div class="row"><span></span><button class="btn" data-act="stop-watching">Stop without keeping</button></div>
      </div>`;

    if (S.mode === "say") return `
      <div class="head live"><h1>${esc(S.surface.url)}</h1><span class="pill">${S.said.length} said</span></div>
      <p class="lead">One sentence at a time. Each runs on the page that is open and is appended to the flow.</p>
      <div class="card now">
        <label for="sentence" style="display:block;font-size:.8rem;color:var(--muted);margin-bottom:6px">Say what to do next</label>
        <div class="field">
          <input type="text" id="sentence" value="Click the Book a slot link" aria-label="Say what to do next">
          <button class="btn primary" data-act="run-sentence">Run it</button>
        </div>
      </div>
      ${S.said.length ? `<div class="card"><span class="eyebrow" style="padding:0 0 8px">Said so far</span>
        ${S.said.map((t) => `<div class="row"><span>${esc(t)}</span><span class="meta">ran · appended</span></div>`).join("")}
        <div class="row"><span></span><button class="btn primary" data-act="keep">Keep it</button><button class="btn" data-act="back-to-modes">Choose another way</button></div>
      </div>` : `<div class="card"><p class="hint" style="margin:0">Nothing said yet. Press <b>Run it</b> above.</p></div>`}`;

    return `
      <div class="head live"><h1>${esc(S.surface.url)}</h1><span class="pill">do</span></div>
      <p class="lead">Pick a control, then an action the adapter publishes for it. Yam dispatches it and says whether a postcondition passed.</p>
      <div class="card now">
        <span class="eyebrow" style="padding:0 0 8px">Username</span>
        <label for="fill" style="display:block;font-size:.8rem;color:var(--muted);margin-bottom:6px">Type into it</label>
        <div class="field"><input type="text" id="fill" value="ada" aria-label="Type into it"><button class="btn primary" data-act="fill">Fill field</button></div>
        <p class="hint">Nothing is written to a flow in this mode. Switch to <b>Watch me</b> if you want it kept.</p>
      </div>
      <div class="card"><div class="row"><span></span><button class="btn" data-act="back-to-modes">Choose another way</button></div></div>`;
  },

  flows: () => `
    <div class="head"><h1>Flows</h1><span class="pill">${S.flows.length} in ${esc(S.project?.name ?? "")}</span></div>
    <p class="lead">What Yam can run. Each is a file of sentences with its bindings beside it.</p>
    <div class="card">
      ${S.flows.map((f) => `<div class="row"><button class="nav" style="width:auto;padding:2px 6px" data-act="open-flow" data-flow="${esc(f.name)}" aria-label="${esc(f.name)}, ${f.steps} steps"><b>${esc(f.name)}</b> — ${f.steps} steps</button>
        <span class="meta${f.state === "unbound" ? " warn" : f.state === "failed" ? " bad" : ""}">${esc(f.note)}</span>
        <button class="btn ${f.state === "ok" ? "primary" : ""}" data-act="run" data-flow="${esc(f.name)}">${f.state === "unbound" ? "Bind targets" : "Run"}</button></div>`).join("")}
      <p class="hint">Running one leaves a report, and anything that moved comes back as a repair to review.</p>
    </div>`,

  bindings: () => `
    <div class="head"><h1>Bindings</h1><span class="pill${S.repairs.length ? " warn" : ""}">${30 + S.repairs.length} · ${S.repairs.length} unverified</span></div>
    <p class="lead">How a sentence finds a control. Tried in order, and Yam records which one answered.</p>
    ${S.repairs.length ? `<div class="card now"><span class="eyebrow" style="padding:0 0 8px">Worth your attention</span>
      ${S.repairs.map((r) => `<div class="row"><span class="mono">${esc(r)}</span><span class="meta warn">unverified · proposed by healing</span><button class="btn primary" data-act="verify" data-b="${esc(r)}">Verify</button></div>`).join("")}
      <p class="hint">Verifying resolves it against the live page and records what it found.</p></div>` : ""}
    <div class="card"><span class="eyebrow" style="padding:0 0 8px">booking.location-field</span>
      <div class="row"><span>1 · <span class="mono">testid=location</span></span><span class="meta">resolved 2 min ago</span></div>
      <div class="row"><span>2 · <span class="mono">role=textbox name=“Location”</span></span><span class="meta">fallback</span></div>
      <div class="row"><span>3 · <span class="mono">css=.search &gt; input</span></span><span class="meta">last resort</span></div>
    </div>`,

  agents: () => `
    <div class="head"><h1>Agents</h1></div>
    <p class="lead">An agent reaches the same sessions you do, through the same broker. You can see what it does and take the target back.</p>
    ${S.surface ? `<div class="card now"><span class="eyebrow" style="padding:0 0 8px">Who is holding what</span>
      <div class="row"><span><span class="dot"></span>${esc(S.surface.url)}</span>
        <span class="meta">${S.surface.holder === "you" ? "you have it" : `${esc(S.surface.holder)} has it · 2 min`}</span>
        <button class="btn primary" data-act="toggle-hold">${S.surface.holder === "you" ? "Give it up" : "Take control"}</button></div>
    </div>` : `<div class="card"><p class="hint" style="margin:0">No session is open, so nothing is held. Connect one in <b>Session</b>.</p></div>`}
    <div class="card"><span class="eyebrow" style="padding:0 0 8px">Connect an agent</span>
      <div class="row"><span class="mono">npx -y @svatah/yam-mcp</span><span class="meta">stdio</span><button class="btn" data-act="copy">Copy</button></div>
      <p class="hint">Every call an agent makes is listed here with what it touched and whether a postcondition passed.</p></div>`,

  api: () => `
    <div class="head"><h1>API</h1></div>
    <p class="lead">Saved requests. A request is a surface like any other: a flow can send one and check what comes back.</p>
    <div class="card">
      <div class="row"><span class="mono">POST /bookings</span><span class="meta">api/create-booking.yaml</span><button class="btn" data-act="send">Send</button></div>
      <div class="row"><span class="mono">GET /bookings/{id}</span><span class="meta">api/read-booking.yaml</span><button class="btn" data-act="send">Send</button></div>
    </div>`,

  data: () => `
    <div class="head"><h1>Data</h1></div>
    <p class="lead">The values a flow uses. A secret is named here and read from the environment when it runs — its value is never written to a file or shown.</p>
    <div class="card">
      <div class="row"><span class="mono">user.name</span><span class="meta">ada</span></div>
      <div class="row"><span class="mono">user.password</span><span class="meta warn">from YAM_SAMPLE_PASSWORD · not set</span></div>
      <div class="row"><span class="mono">card.number</span><span class="meta warn">from YAM_SAMPLE_CARD_NUMBER · not set</span></div>
      <p class="hint">Two are unset. Compiling does not need them; running will — Yam says which and stops rather than sending a blank.</p>
    </div>`,

  import: () => `
    <div class="head"><h1>Import a prototype</h1></div>
    <p class="lead">Bring a prototype's screens and elements in as a starting point. Yam reads them, shows what it would create, and writes nothing until you say so.</p>
    <div class="card now">
      <label for="imp" style="display:block;font-size:.8rem;color:var(--muted);margin-bottom:6px">A prototype database file</label>
      <div class="field"><input type="text" id="imp" value="~/Downloads/prototype.db" aria-label="A prototype database file"><button class="btn primary" data-act="read-import">Read it</button></div>
      <p class="hint">Nothing is written while Yam reads. You will see the preview first.</p>
    </div>`,

  runs: () => `
    <div class="head"><h1>Runs</h1></div>
    <p class="lead">What happened, kept. A run's report is the evidence a person or a build system reads afterwards.</p>
    ${S.run ? `<div class="card now"><span class="eyebrow" style="padding:0 0 8px">${esc(S.run.flow)} · ${S.run.passed ? "passed" : "failed"}</span>
      <div class="row"><span>6 steps${S.run.healed ? ", 2 healed" : ""}, 1 postcondition</span><span class="meta">3.1 s</span></div>
      <div class="row"><span>Evidence</span><span class="meta">4 screenshots · a trace · the audit</span></div>
      <div class="row"><span>Written to</span><span class="meta mono">runs/2026-09-12T09-14-02/</span></div>
      <div class="row"><span></span>
        <button class="btn" data-act="export">Export as JUnit</button>
        <button class="btn" data-act="copy">Copy the command</button>
        ${S.repairs.length ? `<button class="btn primary" data-go="heal">Review 2 repairs</button>` : ""}</div>
    </div>` : `<div class="card"><p class="hint" style="margin:0">Nothing has run yet. Run a flow from <b>Flows</b> and its report lands here.</p></div>`}`,

  heal: () => `
    <div class="head"><h1>Two controls moved</h1><span class="pill warn">proposed, not written</span></div>
    <p class="lead">The interface changed and the flow still ran, because Yam found the controls again. Here is what it would write, and what it saw.</p>
    <div class="card now"><span class="eyebrow" style="padding:0 0 8px">booking.location-field</span>
      <div class="row"><span>Was</span><span class="meta mono">testid=location</span></div>
      <div class="row"><span>Now</span><span class="meta mono">testid=search-location</span></div>
      <div class="row"><span>Why it is the same control</span><span class="meta">same role, label and place · 0.93</span></div>
    </div>
    <div class="card"><span class="eyebrow" style="padding:0 0 8px">booking.pay-button</span>
      <div class="row"><span>Was</span><span class="meta mono">role=button name=“Pay”</span></div>
      <div class="row"><span>Now</span><span class="meta mono">role=button name=“Pay now”</span></div>
      <div class="row"><span>Why it is the same control</span><span class="meta warn">position matches, label changed · 0.71</span></div>
      <p class="hint">Below the threshold Yam accepts on its own, so it is asking.</p>
    </div>
    <div class="card"><div class="row"><span>bindings/booking.yaml</span><span class="meta">2 changed</span>
      <button class="btn primary" data-act="accept-repairs">Accept both</button>
      <button class="btn" data-act="reject-repairs">Reject both</button></div></div>`,

  settings: () => `
    <div class="head"><h1>Settings</h1></div>
    <p class="lead">What this copy of Yam does, and what it can reach. Secrets live in the project and are never shown here.</p>
    <div class="card"><span class="eyebrow" style="padding:0 0 8px">Appearance</span>
      <div class="row"><span>Theme</span><span class="meta">follows the system unless you choose</span>
        ${["light", "dark", "system"].map((t) => `<button class="btn small${(localStorage.getItem("theme") ?? "system") === t ? " primary" : ""}" data-theme="${t}" aria-label="${t === "system" ? "Match the system" : t[0].toUpperCase() + t.slice(1)}">${t === "system" ? "System" : t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>
    </div>
    <div class="card"><span class="eyebrow" style="padding:0 0 8px">Project</span>
      <div class="row"><span class="mono">${S.project ? "~/work/" + esc(S.project.name) : "none open"}</span>
        <span class="meta">${S.project ? `${S.flows.length} flows` : "flows, bindings and runs live in one"}</span>
        <button class="btn" data-act="open-project">${S.project ? "Change" : "Open a project"}</button></div>
    </div>
    <div class="card"><span class="eyebrow" style="padding:0 0 8px">Ways to connect</span>
      <div class="row"><span><span class="dot"></span>Chromium</span><span class="meta">Playwright 1.62.1 · ready</span></div>
      <div class="row"><span><span class="dot"></span>macOS apps</span><span class="meta">Accessibility granted</span></div>
      <div class="row"><span>Windows apps</span><span class="meta">not this machine</span></div>
      <div class="row"><span>Phones</span><span class="meta">needs an Appium server · <span class="mono">appium</span></span></div>
    </div>`,
};

/* ── what the controls do ───────────────────────────────────────────────── */
const acts = {
  connect() {
    const url = document.getElementById("target")?.value.trim() || "https://example.com";
    S.surface = { url, adapter: "playwright", holder: "you" };
    S.mode = null;
    if (S.project === null) S.project = { name: "yam-scratch" }, S.flows = [];
    say(`Connected with the playwright adapter, and the window is visible.`);
  },
  disconnect() { S.surface = null; S.mode = null; S.captured = []; S.pending = null; S.said = []; say("Disconnected."); },
  "open-project"() {
    S.project = { name: "booking-tests" };
    S.flows = [
      { name: "sign in and out", steps: 4, state: "ok", note: "passed yesterday" },
      { name: "checkout with a card", steps: 11, state: "unbound", note: "2 unbound · never run" },
    ];
    say("Opened booking-tests. 2 flows.");
  },
  watch() { S.mode = "watch"; S.captured = []; S.pending = null; },
  "mode-say"() { S.mode = "say"; },
  "mode-do"() { S.mode = "do"; },
  "back-to-modes"() { S.mode = null; },
  "stop-watching"() { S.mode = null; S.captured = []; S.pending = null; say("Stopped. Nothing was written."); },
  simulate() {
    const next = [
      { text: "Click the Book a slot link", bound: true },
      { text: "Type “ada” into the username field", bound: true },
      { text: "Click the Sign In button", bound: true },
      { text: "Click the third card", bound: false },
    ][S.captured.length];
    if (!next) return say("That is the whole of this example.");
    S.captured.push(next);
    if (!next.bound) S.pending = next;
  },
  accept() { if (S.pending) { S.pending.bound = true; S.pending = null; say("Accepted. The binding is unverified until it resolves once."); } },
  accept2() { acts.accept(); },
  keep() {
    const steps = S.mode === "say" ? S.said.length : S.captured.length;
    S.flows.unshift({ name: "book a slot", steps, state: "ok", note: "never run" });
    S.mode = null; S.captured = []; S.said = [];
    S.screen = "flows";
    say("Wrote flows/book-a-slot.flow. It is in Flows.");
  },
  "run-sentence"() {
    const t = document.getElementById("sentence")?.value.trim();
    if (t) S.said.push(t);
  },
  fill() { say("Dispatched. Not verified — no postcondition was given."); },
  run(button) {
    const name = button.dataset["flow"];
    const flow = S.flows.find((f) => f.name === name);
    if (flow?.state === "unbound") { S.mode = "watch"; S.surface ??= { url: "https://example.com", adapter: "playwright", holder: "you" }; S.screen = "session"; return say("Binding targets: drive the browser."); }
    S.run = { flow: name, passed: true, healed: true };
    S.repairs = ["booking.location-field", "booking.pay-button"];
    if (flow) flow.note = "passed just now";
    S.screen = "runs";
    say("Passed in 3.1 s. Two controls had moved and were healed.");
  },
  "accept-repairs"() { S.repairs = []; S.screen = "bindings"; say("Accepted both. They are unverified until they resolve once."); },
  "reject-repairs"() { S.repairs = []; S.screen = "runs"; say("Rejected. The bindings are unchanged."); },
  verify(button) { S.repairs = S.repairs.filter((r) => r !== button.dataset["b"]); say("Verified against the live page."); },
  "toggle-hold"() { S.surface.holder = S.surface.holder === "you" ? "claude-desktop" : "you"; },
  copy() { say("Copied."); },
  "open-flow"(button) { say(`${button.dataset["flow"]}: sentences, bindings and its last run.`); },
  send() { say("200 OK in 61 ms."); },
  export() { say("Wrote runs/2026-09-12T09-14-02/junit.xml."); },
  "read-import"() { say("14 screens, 212 elements. Nothing written — preview first."); },
};

/* ── theme ──────────────────────────────────────────────────────────────── */
function setTheme(which) {
  localStorage.setItem("theme", which);
  if (which === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", which);
}
setTheme(localStorage.getItem("theme") ?? "system");

/**
 * The context column, drawn only where the window has room (CSS decides).
 *
 * It is the same facts the screen is about, not a second navigation: what is
 * connected, what will be written, what is waiting. A wide window gets more of
 * the answer, never more chrome.
 */
function aside() {
  const bits = [];
  if (S.surface) bits.push(["This session", [
    ["Target", S.surface.url], ["Adapter", "playwright · web"],
    ["Held by", S.surface.holder === "you" ? "you" : S.surface.holder],
  ]]);
  if (S.mode === "watch") bits.push(["Will be written", [
    ["File", "flows/book-a-slot.flow"],
    ["Steps", `${S.captured.length}${S.pending ? ", one undecided" : ""}`],
  ]]);
  if (S.project) bits.push(["Project", [
    ["Folder", `~/work/${S.project.name}`], ["Flows", String(S.flows.length)],
    ["Bindings", String(30 + S.repairs.length)],
  ]]);
  if (S.repairs.length) bits.push(["Waiting for you", [["Repairs", `${S.repairs.length} proposed`]]]);
  if (bits.length === 0) bits.push(["Nothing connected", [["Next", "enter a target and press Connect"]]]);
  return `<aside class="aside" aria-label="Context">${bits.map(([title, rows]) =>
    `<h2>${esc(title)}</h2>${rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span class="meta">${esc(v)}</span></div>`).join("")}`
  ).join("")}</aside>`;
}

/* ── render ─────────────────────────────────────────────────────────────── */
function render() {
  const body = (screens[S.screen] ?? screens.session)();
  document.body.innerHTML = `<div class="app">${rail()}<main class="work">${body}</main>${aside()}</div>` +
    (S.toast ? `<div class="toast" role="status">${esc(S.toast)}</div>` : "");
}
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-go],[data-act],[data-theme]");
  if (!target || target.hasAttribute("disabled")) return;
  if (target.dataset["theme"]) { setTheme(target.dataset["theme"]); render(); return; }
  if (target.dataset["go"]) { go(target.dataset["go"]); return; }
  acts[target.dataset["act"]]?.(target);
  render();
});
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { const b = e.target.closest(".card")?.querySelector(".btn.primary"); b?.click(); } });
render();
