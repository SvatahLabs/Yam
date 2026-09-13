import { readFileSync, writeFileSync } from "node:fs";
/**
 * The new experience, drawn in the brand the product's own site already has.
 *
 *   node docs/spec/design/build-ux.mjs   # writes /tmp/ux2
 *   (cd /tmp/ux2 && python3 -m http.server 8771 &)
 *   node evals/self/yam-on-yam/ux-review.mjs
 */
const css = readFileSync("docs/spec/design/ux.css", "utf8");

/** The rail. `need` marks the destinations a project is required for (AX-04). */
const rail = (here, noProject) => {
  const item = (id, label, why) =>
    `<a class="nav" href="#" ${here === id ? 'aria-current="page" ' : ""}${why ? 'aria-disabled="true" ' : ""}aria-label="${label}${why ? `, ${why}` : ""}"><span>${label}</span>${why ? `<span class="why">${why}</span>` : ""}</a>`;
  return `<nav class="rail" aria-label="Sections">
  <div class="brand"><span class="mark"></span>Yam</div>
  <span class="eyebrow">Work</span>
  ${item("session", "Session")}
  ${item("agents", "Agents")}
  <span class="eyebrow" style="margin-top:16px">Automations</span>
  ${item("flows", "Flows", noProject ? "needs a project" : undefined)}
  ${item("bindings", "Bindings", noProject ? "needs a project" : undefined)}
  ${item("data", "Data", noProject ? "needs a project" : undefined)}
  ${item("api", "API", noProject ? "needs a project" : undefined)}
  <span class="eyebrow" style="margin-top:16px">Activity</span>
  ${item("runs", "Runs", noProject ? "needs a project" : undefined)}
  ${item("reports", "Reports", noProject ? "needs a project" : undefined)}
  <span class="eyebrow" style="margin-top:16px">Yam</span>
  ${item("import", "Import")}
  ${item("settings", "Settings")}
  <div class="theme" style="margin:16px 0 0;display:block">
    <span class="eyebrow" style="margin-bottom:6px">Appearance</span>
    <div style="display:flex;gap:4px">
      <button class="btn" style="padding:3px 8px;font-size:.72rem" aria-label="Light">Light</button>
      <button class="btn" style="padding:3px 8px;font-size:.72rem" aria-label="Dark">Dark</button>
      <button class="btn primary" style="padding:3px 8px;font-size:.72rem" aria-label="Match the system">System</button>
    </div>
  </div>
</nav>`;
};

/*
 * There is no journey rail.
 *
 * One was drawn here — Connect, Watch, Keep, Run, with connectors — and it is
 * gone on the owner's call: a stepper is a *diagram* of the flow, printed
 * because the screens were not producing it. It also lies on every screen that
 * is a place rather than a step, which was already two of twelve and would have
 * been more.
 *
 * What it was doing, the screens do now. Each says its state in the heading,
 * names the next step on its primary control, and shows the result of the step
 * before — which is what makes the next one obvious without a picture of it.
 */
const theme = "";

const page = (title, body) =>
`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head>
<body><div class="app">${body}</div></body></html>`;

const boards = {
"UX-1-Start": page("Start", rail("session", true) + `<main class="work">
  <div class="topline"><h1>Connect something to drive</h1>${theme}</div>
  <p class="lead">A browser at a URL, an application by name, a browser you already have open, an API, or a command in a terminal. Nothing here needs a project.</p>
  <div class="card focus">
    <span class="eyebrow">Start here</span>
    <label for="t" style="display:block;font-size:.8rem;color:var(--muted);margin-bottom:6px">URL, application name, or endpoint</label>
    <div class="field"><input type="text" id="t" placeholder="https://example.com" aria-label="URL, application name, or endpoint"><button class="btn primary" aria-label="Connect">Connect</button></div>
    <p class="hint"><span class="live-dot"></span>Ready here: Chromium, macOS apps, HTTP, and a terminal. <a href="#" style="color:var(--accent)">Three more ways</a><br>Connecting opens it and brings you back here to choose what to do with it.</p>
  </div>
  <div class="card">
    <span class="eyebrow">Or pick up where you left off</span>
    <div class="row"><span>booking-tests</span><span class="meta">9 flows · yesterday</span></div>
    <div class="row"><span>Open a project…</span><span class="meta">a folder of flows, bindings and runs</span></div>
    <p class="hint">Yam keeps its own scratch workspaces for sessions started without a project. <a href="#" style="color:var(--accent)">Show them</a></p>
  </div>
</main>`),

"UX-2-Watch": page("Watch or drive", rail("session") + `<main class="work">
  <div class="topline"><h1>example.com</h1><span class="pill">connected</span>${theme}</div>
  <p class="lead">Chromium, and you are holding it. Choose how the flow gets written.</p>
  <div class="card focus">
    <span class="eyebrow">Three ways, one session</span>
    <div class="row"><span><b>Watch me</b> — you drive, Yam writes it down</span><span class="meta">the observer, on this adapter</span><button class="btn primary" aria-label="Start watching">Start watching</button></div>
    <div class="row"><span><b>Say what to do</b> — one sentence at a time</span><span class="meta">grounded, run, appended</span><button class="btn" aria-label="Say what to do">Say</button></div>
    <div class="row"><span><b>Do it here</b> — pick a control and an action</span><span class="meta">from the adapter's catalogue</span><button class="btn" aria-label="Do it here">Do</button></div>
    <p class="hint">All three write the same thing: a flow and its bindings, kept in this project. Switching never reconnects, and an agent over MCP can hold the same session — you will see who has it.</p>
  </div>
  <div class="card">
    <span class="eyebrow">On the page</span>
    <div class="row"><span class="mono">textbox “Username”</span><span class="meta">r6 · required</span></div>
    <div class="row"><span class="mono">textbox “Password”</span><span class="meta">r7 · required</span></div>
    <div class="row"><span class="mono">button “Sign In”</span><span class="meta">r9</span></div>
  </div>
</main>`),

"UX-3-Observe": page("Watch me", rail("session") + `<main class="work">
  <div class="topline"><h1>Watching you</h1><span class="pill"><span class="live-dot"></span>4 steps</span>${theme}</div>
  <p class="lead">Drive the browser that opened. Every click and every value becomes a step below. When you are done, <b>Keep it</b> writes a flow into this project and you can run it from Flows.</p>
  <div class="card">
    <span class="eyebrow">What Yam has seen</span>
    <div class="row"><span>Click <b>the Book a slot link</b></span><span class="meta">bound</span></div>
    <div class="row"><span>Type “ada” into <b>the username field</b></span><span class="meta">bound</span></div>
    <div class="row"><span>Click <b>the Sign In button</b></span><span class="meta">bound</span></div>
    <div class="row"><span>Click <b>the third card</b></span><span class="meta" style="color:var(--warn)">needs a decision</span></div>
  </div>
  <div class="card focus">
    <span class="eyebrow">Which control did you mean?</span>
    <div class="row"><span>the offer card</span><span class="meta">0.81 · testid offer-card-3</span><button class="btn primary" aria-label="Accept the offer card">Accept</button></div>
    <div class="row"><span>the third list item</span><span class="meta">0.64 · role and position</span><button class="btn" aria-label="Accept the third list item">Accept</button></div>
    <p class="hint">Or <a href="#" style="color:var(--accent)">point at it in the browser</a> — the control you click becomes the binding.</p>
  </div>
  <div class="card"><span class="eyebrow">Will be written</span>
    <div class="row"><span class="mono">flows/book-a-slot.flow</span><span class="meta">4 steps, one undecided · joins Flows</span><button class="btn primary" aria-label="Keep it">Keep it</button></div>
  </div>
</main>`),

"UX-4-Run": page("Run it again", rail("activity") + `<main class="work">
  <div class="topline"><h1>book a slot</h1><span class="pill">passed in 3.1 s</span>${theme}</div>
  <p class="lead">The flow you kept, run against the same application. Two bindings moved and Yam repaired them.</p>
  <div class="card">
    <span class="eyebrow">Steps</span>
    <div class="row"><span>Click the Book a slot link</span><span class="meta">41 ms</span></div>
    <div class="row"><span>Type “Indiranagar” into the location field</span><span class="meta" style="color:var(--warn)">healed · the field was renamed</span></div>
    <div class="row"><span>Click the Book now button</span><span class="meta">58 ms</span></div>
    <div class="row"><span>The receipt should say paid</span><span class="meta">verified</span></div>
  </div>
  <div class="card focus">
    <span class="eyebrow">Two repairs, not yet accepted</span>
    <p style="margin:0 0 12px">Yam found the moved controls and proposed new bindings. Nothing is written to the store until you accept them.</p>
    <button class="btn primary" aria-label="Review the repairs">Review the repairs</button>
    <button class="btn" aria-label="Run without healing">Run without healing</button>
  </div>
</main>`),

"UX-5-Agents": page("Agents", rail("agents") + `<main class="work">
  <div class="topline"><h1>Agents</h1>${theme}</div>
  <p class="lead">An agent reaches the same sessions you do, through the same broker. You can see what it does and take the target back at any moment.</p>
  <div class="card focus">
    <span class="eyebrow">Who is holding what</span>
    <div class="row"><span><span class="live-dot"></span>example.com</span><span class="meta">claude-desktop has it · 2 min</span><button class="btn primary" aria-label="Take control">Take control</button></div>
    <div class="row"><span>127.0.0.1:4173</span><span class="meta">you have it</span><button class="btn" aria-label="Give it up">Give it up</button></div>
  </div>
  <div class="card">
    <span class="eyebrow">Recently called</span>
    <div class="row"><span class="mono">surface_snapshot</span><span class="meta">claude-desktop · 10 controls · 120 ms</span></div>
    <div class="row"><span class="mono">surface_act</span><span class="meta">claude-desktop · click r9 · not verified</span></div>
    <p class="hint">Every call an agent makes is on this list, with what it touched and whether a postcondition passed.</p>
  </div>
  <div class="card"><span class="eyebrow">Connect an agent</span>
    <div class="row"><span class="mono">npx -y @svatah/yam mcp</span><span class="meta">stdio</span><button class="btn" aria-label="Copy configuration">Copy</button></div>
  </div>
</main>`),

"UX-6-Flows": page("Flows", rail("flows") + `<main class="work">
  <div class="topline"><h1>Flows</h1><span class="pill">9 in booking-tests</span></div>
  <p class="lead">What Yam can run. Each one is a file you can read, written in sentences, with its bindings beside it.</p>
  <div class="card">
    <span class="eyebrow">In this project</span>
    <div class="row"><span><b>book a slot</b> — 6 steps</span><span class="meta">passed 2 min ago · all bound</span><button class="btn" aria-label="Run book a slot">Run</button></div>
    <div class="row"><span><b>sign in and out</b> — 4 steps</span><span class="meta">passed yesterday · all bound</span><button class="btn" aria-label="Run sign in and out">Run</button></div>
    <div class="row"><span><b>checkout with a card</b> — 11 steps</span><span class="meta" style="color:var(--warn)">2 unbound · never run</span><button class="btn" aria-label="Bind targets for checkout with a card">Bind targets</button></div>
    <div class="row"><span><b>guards and compensation</b> — 9 steps</span><span class="meta" style="color:var(--fail)">failed at step 5</span><button class="btn" aria-label="Heal guards and compensation">Heal</button></div>
  </div>
  <div class="card">
    <span class="eyebrow">book a slot</span>
    <div class="row"><span class="mono">Click the Book a slot link</span><span class="meta">tier 1 · human</span></div>
    <div class="row"><span class="mono">Type “Indiranagar” into the location field</span><span class="meta">tier 1 · human</span></div>
    <div class="row"><span class="mono">The receipt should say paid</span><span class="meta">a postcondition</span></div>
    <p class="hint">Lint says nothing to report. <a href="#" style="color:var(--accent)">Open it in your editor</a>, or run it — a run leaves a report, and anything that moved comes back here as a repair to review.</p>
  </div>
</main>`),

"UX-7-Bindings": page("Bindings", rail("bindings") + `<main class="work">
  <div class="topline"><h1>Bindings</h1><span class="pill">30 · 1 unverified</span></div>
  <p class="lead">How a sentence finds a control. Press <b>Verify</b> on anything marked unverified to resolve it against the live page before a run depends on it.</p>
  <div class="card focus">
    <span class="eyebrow">Worth your attention</span>
    <div class="row"><span class="mono">booking.pay-button</span><span class="meta" style="color:var(--warn)">unverified · proposed by healing</span><button class="btn primary" aria-label="Verify booking.pay-button">Verify</button></div>
    <p class="hint">Verifying resolves it against the live page and records what it found. Nothing is written until it does.</p>
  </div>
  <div class="card">
    <span class="eyebrow">booking.location-field</span>
    <div class="row"><span>1 · <span class="mono">testid=location</span></span><span class="meta">resolved 2 min ago</span></div>
    <div class="row"><span>2 · <span class="mono">role=textbox name=“Location”</span></span><span class="meta">fallback</span></div>
    <div class="row"><span>3 · <span class="mono">css=.search &gt; input</span></span><span class="meta">last resort</span></div>
    <p class="hint">Tried in order, and Yam records which one answered — open a run\u2019s report to see whether a brittle first choice is being relied on.</p>
  </div>
</main>`),

"UX-8-Reports": page("Reports", rail("reports") + `<main class="work">
  <div class="topline"><h1>Reports</h1></div>
  <p class="lead">What happened, kept. A run's report is the evidence a person or a build system reads afterwards — steps, timings, screenshots, and every call an agent made.</p>
  <div class="card">
    <span class="eyebrow">Runs</span>
    <div class="row"><span><b>book a slot</b></span><span class="meta">passed · 3.1 s · 2 healed · 2 min ago</span><button class="btn" aria-label="Open the report for book a slot">Open</button></div>
    <div class="row"><span><b>guards and compensation</b></span><span class="meta" style="color:var(--fail)">failed at step 5 · 8.4 s · yesterday</span><button class="btn" aria-label="Open the report for guards and compensation">Open</button></div>
  </div>
  <div class="card">
    <span class="eyebrow">book a slot · passed</span>
    <div class="row"><span>6 steps, 2 healed, 1 postcondition</span><span class="meta">3.1 s</span></div>
    <div class="row"><span>Evidence</span><span class="meta">4 screenshots · a trace · the audit</span></div>
    <div class="row"><span>Written to</span><span class="mono meta">runs/2026-09-12T09-14-02/</span></div>
    <div style="margin-top:12px;display:flex;gap:8px">
      <button class="btn primary" aria-label="Open the folder">Open the folder</button>
      <button class="btn" aria-label="Export as JUnit XML">Export as JUnit</button>
      <button class="btn" aria-label="Copy the command that reproduces it">Copy the command</button>
    </div>
  </div>
  <div class="card">
    <span class="eyebrow">Health over time</span>
    <div class="row"><span>Healing</span><span class="meta">94% relocalized without a model · last 30 runs</span></div>
    <div class="row"><span>Grounding</span><span class="meta">tier 1 on 78% of steps</span></div>
    <p class="hint">These come from <span class="mono">yam eval healing</span> and <span class="mono">yam eval grounding</span>, which write the same numbers to a file for a release.</p>
  </div>
</main>`),

"UX-9-Settings": page("Settings", rail("settings") + `<main class="work">
  <div class="topline"><h1>Settings</h1></div>
  <p class="lead">What this copy of Yam does, and what it is allowed to reach. Nothing here is a secret — secrets live in the project and are never shown.</p>
  <div class="card">
    <span class="eyebrow">Appearance</span>
    <div class="row"><span>Theme</span><span class="meta">follows the system unless you choose</span>
      <button class="btn" aria-label="Light theme">Light</button><button class="btn" aria-label="Dark theme">Dark</button><button class="btn primary" aria-label="Match the system theme">System</button></div>
    <div class="row"><span>Reduce motion</span><span class="meta">follows the system</span></div>
  </div>
  <div class="card">
    <span class="eyebrow">Project</span>
    <div class="row"><span class="mono">~/work/booking-tests</span><span class="meta">9 flows · 30 bindings · 12 runs</span><button class="btn" aria-label="Open a different project">Change</button></div>
  </div>
  <div class="card">
    <span class="eyebrow">Ways to connect</span>
    <div class="row"><span><span class="live-dot"></span>Chromium</span><span class="meta">Playwright 1.62.1 · ready</span></div>
    <div class="row"><span><span class="live-dot"></span>macOS apps</span><span class="meta">Accessibility granted</span></div>
    <div class="row"><span>Windows apps</span><span class="meta">not this machine</span></div>
    <div class="row"><span>Phones</span><span class="meta">needs an Appium server · <span class="mono">appium</span></span></div>
  </div>
  <div class="card">
    <span class="eyebrow">Grounding</span>
    <div class="row"><span>Model gateway</span><span class="meta">none configured — Yam grounds without one and says when it cannot</span><button class="btn" aria-label="Configure a gateway">Configure</button></div>
  </div>
</main>`),

"UX-10-Data": page("Data and requests", rail("data") + `<main class="work">
  <div class="topline"><h1>Data</h1></div>
  <p class="lead">The values a flow uses. Set the two unset secrets in your environment before you run, or the run stops and names them. A secret is read from the environment and never written to a file or shown here.</p>
  <div class="card">
    <span class="eyebrow">data.yaml</span>
    <div class="row"><span class="mono">user.name</span><span class="meta">ada</span></div>
    <div class="row"><span class="mono">user.password</span><span class="meta">from <span class="mono">YAM_SAMPLE_PASSWORD</span> · not set</span></div>
    <div class="row"><span class="mono">card.number</span><span class="meta">from <span class="mono">YAM_SAMPLE_CARD_NUMBER</span> · not set</span></div>
    <p class="hint">Two are unset. Compiling does not need them; running will — Yam says which, and stops rather than sending a blank.</p>
  </div>
  <div class="card">
    <span class="eyebrow">Saved requests</span>
    <div class="row"><span class="mono">POST /bookings</span><span class="meta">api/create-booking.yaml</span><button class="btn" aria-label="Send POST bookings">Send</button></div>
    <div class="row"><span class="mono">GET /bookings/{id}</span><span class="meta">api/read-booking.yaml</span><button class="btn" aria-label="Send GET booking">Send</button></div>
    <p class="hint">A request is a surface like any other: a flow can send one and check what comes back.</p>
  </div>
</main>`),

"UX-11-Heal": page("Heal review", rail("runs") + `<main class="work">
  <div class="topline"><h1>Two controls moved</h1><span class="pill">proposed, not written</span></div>
  <p class="lead">The interface changed and the flow still ran, because Yam found the controls again. Here is what it would write to the store, and what it saw before and after.</p>
  <div class="card focus">
    <span class="eyebrow">booking.location-field</span>
    <div class="row"><span>Was</span><span class="mono meta">testid=location</span></div>
    <div class="row"><span>Now</span><span class="mono meta">testid=search-location</span></div>
    <div class="row"><span>Why it is the same control</span><span class="meta">same role, same label, same place in the form · 0.93</span></div>
    <div style="margin-top:12px;display:flex;gap:8px">
      <button class="btn primary" aria-label="Accept this repair">Accept</button>
      <button class="btn" aria-label="Point at the control instead">Point at it instead</button>
      <button class="btn" aria-label="Reject this repair">Reject</button>
    </div>
  </div>
  <div class="card">
    <span class="eyebrow">booking.pay-button</span>
    <div class="row"><span>Was</span><span class="mono meta">role=button name=“Pay”</span></div>
    <div class="row"><span>Now</span><span class="mono meta">role=button name=“Pay now”</span></div>
    <div class="row"><span>Why it is the same control</span><span class="meta">same position, label changed · 0.71</span></div>
    <p class="hint">Below the threshold Yam accepts on its own, so it is asking. Accepting marks the binding unverified until it resolves once.</p>
  </div>
  <div class="card">
    <span class="eyebrow">If you accept both</span>
    <div class="row"><span>bindings/booking.yaml</span><span class="meta">2 changed, 0 added</span><button class="btn" aria-label="Accept both repairs">Accept both</button></div>
  </div>
</main>`),

"UX-12-Import": page("Import", rail("import") + `<main class="work">
  <div class="topline"><h1>Import a prototype</h1></div>
  <p class="lead">Bring a prototype's screens and elements in as a starting point. Yam reads them, shows you what it would create, and writes nothing until you say so.</p>
  <div class="card focus">
    <span class="eyebrow">Start here</span>
    <label for="imp" style="display:block;font-size:.8rem;color:var(--muted);margin-bottom:6px">A prototype database file</label>
    <div class="field"><input type="text" id="imp" placeholder="~/Downloads/prototype.db" aria-label="A prototype database file"><button class="btn primary" aria-label="Read it">Read it</button></div>
    <p class="hint">Nothing is written while Yam reads. You will see the preview first.</p>
  </div>
  <div class="card">
    <span class="eyebrow">What is in it</span>
    <div class="row"><span>14 screens</span><span class="meta">would become 14 stories</span></div>
    <div class="row"><span>212 elements</span><span class="meta">would become 212 unverified bindings</span></div>
    <div class="row"><span>3 flows already named</span><span class="meta">would be proposals under <span class="mono">proposals/</span></span></div>
    <p class="hint">Everything lands as a proposal for you to read. Nothing joins the project until you accept it.</p>
  </div>
</main>`),
};

for (const [name, html] of Object.entries(boards)) {
  writeFileSync(`/tmp/ux2/${name}.html`, html);
  console.log("wrote", name);
}
writeFileSync("/tmp/ux2/index.html", page("The new experience", `<main class="work" style="max-width:720px">
  <h1>Yam, in the brand the site already has</h1>
  <p class="lead">Five boards, light and dark, with the journey drawn across the top of each.</p>
  <div class="card">${Object.keys(boards).map((b) => `<div class="row"><a href="${b}.html" style="color:var(--accent)">${b.replace(/^UX-\\d-/, "")}</a><span class="meta">${b}</span></div>`).join("")}</div>
</main>`));
