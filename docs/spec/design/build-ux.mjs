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
  ${item("automations", "Automations", noProject ? "needs a project" : undefined)}
  ${item("activity", "Activity", noProject ? "needs a project" : undefined)}
  ${item("agents", "Agents")}
  <span class="eyebrow" style="margin-top:18px">Yam</span>
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

/** The journey, drawn as the site draws one (the user's "visual flow"). */
const flow = (at) => {
  const nodes = [
    ["connect", "Connect", "a browser, app, API or terminal"],
    ["watch", "Watch or drive", "observe, say, or do it yourself"],
    ["keep", "Keep it", "a flow and its bindings"],
    ["run", "Run it again", "and heal what moved"],
  ];
  const done = nodes.findIndex((n) => n[0] === at);
  return `<div class="flow-rail" role="list" aria-label="What you can do, in order">` +
    nodes.map((n, i) => {
      const state = i === done ? ' aria-current="step"' : i > done ? ' aria-disabled="true"' : "";
      const why = i > done ? ", not yet" : i < done ? ", done" : "";
      return `<a class="flow-node" role="listitem" href="#"${state} aria-label="${n[1]}${why}"><strong>${n[1]}</strong><span>${n[2]}</span></a>`;
    }).join('<span class="flow-connector" aria-hidden="true"></span>') + `</div>`;
};

const theme = "";

const page = (title, body) =>
`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head>
<body><div class="app">${body}</div></body></html>`;

const boards = {
"UX-1-Start": page("Start", rail("session", true) + `<main class="work">
  <div class="topline"><h1>Connect something to drive</h1>${theme}</div>
  <p class="lead">A browser at a URL, an application by name, a browser you already have open, an API, or a command in a terminal. Nothing here needs a project.</p>
  ${flow("connect")}
  <div class="card focus">
    <span class="eyebrow">Step one</span>
    <label for="t" style="display:block;font-size:.8rem;color:var(--muted);margin-bottom:6px">URL, application name, or endpoint</label>
    <div class="field"><input type="text" id="t" placeholder="https://example.com" aria-label="URL, application name, or endpoint"><button class="btn primary" aria-label="Connect">Connect</button></div>
    <p class="hint"><span class="live-dot"></span>Ready here: Chromium, macOS apps, HTTP, and a terminal. <a href="#" style="color:var(--accent)">Three more ways</a></p>
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
  ${flow("watch")}
  <div class="card focus">
    <span class="eyebrow">Three ways, one session</span>
    <div class="row"><span><b>Watch me</b> — you drive, Yam writes it down</span><span class="meta">the observer, on this adapter</span><button class="btn primary" aria-label="Start watching">Start watching</button></div>
    <div class="row"><span><b>Say what to do</b> — one sentence at a time</span><span class="meta">grounded, run, appended</span><button class="btn" aria-label="Say what to do">Say</button></div>
    <div class="row"><span><b>Do it here</b> — pick a control and an action</span><span class="meta">from the adapter's catalogue</span><button class="btn" aria-label="Do it here">Do</button></div>
    <p class="hint">Switching never reconnects. An agent over MCP can hold the same session — you will see who has it.</p>
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
  <p class="lead">Drive the browser that opened. Every click and every value becomes a step. Press Keep it when you are done.</p>
  ${flow("watch")}
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
    <div class="row"><span class="mono">sessions/2026-09-11.flow</span><span class="meta">4 steps, one undecided</span><button class="btn primary" aria-label="Keep it">Keep it</button></div>
  </div>
</main>`),

"UX-4-Run": page("Run it again", rail("activity") + `<main class="work">
  <div class="topline"><h1>book a slot</h1><span class="pill">passed in 3.1 s</span>${theme}</div>
  <p class="lead">The flow you kept, run against the same application. Two bindings moved and Yam repaired them.</p>
  ${flow("run")}
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
  ${flow("watch")}
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
