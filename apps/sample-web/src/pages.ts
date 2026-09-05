/**
 * The sample application's pages (LLD §16, T0.5).
 *
 * These reproduce what the four sample flows drive — a home page with a sign-in
 * call to action, a login form, an application shell with a sidebar, a Schedule
 * Build page, and a booking and checkout pair — plus the widgets the surface and
 * conformance suites need: a native dialog, single and multiple selects, an
 * iframe, a link that opens a new tab, a file input, a drag pair, and a control
 * that exists only on a canvas.
 *
 * Every page is a plain HTML string at variant 0. `variants.ts` transforms that
 * string for `?variant=1..20`, so the baseline stays readable and every
 * deliberate change is in one place.
 */

export interface Page {
  /** Route path, without the query string. */
  readonly path: string;
  /** Human name, used in VARIANTS.md and the smoke test names. */
  readonly title: string;
  readonly html: string;
}

const NAV = `
    <nav class="navbar" aria-label="Main">
      <div class="navbar-brand">
        <a class="navbar-item" href="/" data-testid="brand">Svatah Sample</a>
      </div>
      <button class="navbar-toggle" data-testid="nav-toggle" aria-label="Toggle navigation" aria-expanded="false">Menu</button>
      <div class="navbar-menu">
        <a class="navbar-item" href="/dashboard" data-testid="dashboard-link">Dashboard</a>
        <a class="navbar-item" href="/booking" data-testid="booking-link">Book a slot</a>
        <a class="navbar-item" href="/widgets" data-testid="widgets-link">Widgets</a>
        <a class="navbar-item" href="/docs" target="_blank" rel="noopener" data-testid="docs-link">Docs</a>
      </div>
    </nav>`;

const SIDEBAR = `
      <aside class="sidebar" aria-label="Sections">
        <button class="sidebar-toggle" data-testid="sidebar-toggle" aria-label="Toggle sidebar" aria-expanded="true">☰</button>
        <ul class="sidebar-list">
          <li><a href="/dashboard" data-testid="nav-overview">Overview</a></li>
          <li><a href="/schedule-build" data-testid="nav-schedule-build">Schedule Build</a></li>
          <li><a href="/booking" data-testid="nav-bookings">Bookings</a></li>
          <li><a href="/checkout" data-testid="nav-checkout">Checkout</a></li>
          <li><a href="/logout" data-testid="nav-logout">Logout</a></li>
        </ul>
      </aside>`;

function shell(title: string, body: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Svatah Sample</title>
  <link rel="stylesheet" href="/app.css">${extraHead}
</head>
<body>
${NAV}
${body}
</body>
</html>
`;
}

export const PAGES: readonly Page[] = [
  {
    path: "/",
    title: "Home",
    html: shell(
      "Home",
      `    <main class="hero">
      <h1 data-testid="home-heading">Deterministic automation, once described</h1>
      <p class="lead">Describe a behaviour, record the bindings, replay it forever.</p>
      <a class="btn btn-primary" href="/login" data-testid="sign-in">Sign in</a>
      <a class="btn btn-link" href="/docs" target="_blank" rel="noopener">Read the docs</a>
    </main>`,
    ),
  },
  {
    path: "/login",
    title: "Login",
    html: shell(
      "Login",
      `    <main class="page">
      <h1 data-testid="login-heading">Sign in to your account</h1>
      <div class="alert alert-error" role="alert" data-testid="login-error" hidden>Invalid credentials</div>
      <form id="login" class="form" method="post" action="/dashboard">
        <div class="field">
          <label for="username">Username</label>
          <input id="username" name="username" type="text" placeholder="you@example.com" data-testid="username" autocomplete="username" required>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" placeholder="Your password" data-testid="password" autocomplete="current-password" required>
        </div>
        <div class="field field-inline">
          <input id="remember" name="remember" type="checkbox" data-testid="remember">
          <label for="remember">Remember me</label>
        </div>
        <input type="submit" value="Sign In" class="btn btn-primary" data-testid="login-submit">
      </form>
    </main>`,
    ),
  },
  {
    path: "/dashboard",
    title: "Dashboard",
    html: shell(
      "Dashboard",
      `    <div class="app">
${SIDEBAR}
      <main class="page">
        <h1 data-testid="dashboard-heading">Welcome back, Enterprise</h1>
        <p class="lead">You have <output id="active-count" data-testid="active-count">3</output> active builds.</p>
        <button class="btn" data-testid="refresh-count">Refresh count</button>
        <table class="table" data-testid="builds">
          <thead><tr><th>Build</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td>nightly-1042</td><td>passed</td></tr>
            <tr><td>nightly-1043</td><td>running</td></tr>
            <tr><td>nightly-1044</td><td>queued</td></tr>
          </tbody>
        </table>
      </main>
    </div>`,
    ),
  },
  {
    path: "/schedule-build",
    title: "Schedule Build",
    html: shell(
      "Schedule Build",
      `    <div class="app">
${SIDEBAR}
      <main class="page">
        <h1 data-testid="schedule-heading">Enterprise</h1>
        <p class="lead">Schedule a build for your project.</p>
        <form id="schedule" class="form">
          <div class="field">
            <label for="project">Project</label>
            <select id="project" name="project" data-testid="project">
              <option value="core">Core</option>
              <option value="adapters">Adapters</option>
              <option value="ade">ADE</option>
            </select>
          </div>
          <button type="button" class="btn btn-primary" data-testid="run-build" onclick="if(confirm('Schedule this build?')){document.getElementById('schedule-result').hidden=false;}">Run build</button>
        </form>
        <p id="schedule-result" data-testid="schedule-result" hidden>Build scheduled.</p>
      </main>
    </div>`,
    ),
  },
  {
    path: "/booking",
    title: "Booking",
    html: shell(
      "Booking",
      `    <div class="app">
${SIDEBAR}
      <main class="page">
        <h1 data-testid="booking-heading">Book a slot</h1>
        <form id="booking" class="form">
          <div class="field">
            <label for="location">Starting point</label>
            <input id="location" name="location" type="text" placeholder="Where from?" data-testid="location" list="locations">
            <datalist id="locations">
              <option value="Indiranagar"></option>
              <option value="Indraprastha"></option>
              <option value="Koramangala"></option>
            </datalist>
          </div>
          <div class="field">
            <label for="slot-date">Date</label>
            <input id="slot-date" name="date" type="date" value="2026-09-03" data-testid="slot-date">
          </div>
          <div class="field">
            <label for="slot-times">Times</label>
            <select id="slot-times" name="times" data-testid="slot-times" multiple size="3">
              <option value="09:00">09:00</option>
              <option value="12:00">12:00</option>
              <option value="15:00">15:00</option>
              <option value="18:00">18:00</option>
            </select>
          </div>
          <button type="button" class="btn" data-testid="booking-next">Next</button>
          <button type="button" class="btn btn-primary" data-testid="book-now">Book now</button>
        </form>
        <p id="booking-result" data-testid="booking-result" hidden>Slot booked.</p>
      </main>
    </div>`,
    ),
  },
  {
    path: "/checkout",
    title: "Checkout",
    html: shell(
      "Checkout",
      `    <div class="app">
${SIDEBAR}
      <main class="page">
        <h1 data-testid="checkout-heading">Checkout</h1>
        <form id="checkout" class="form">
          <div class="field">
            <label for="card">Card number</label>
            <input id="card" name="card" type="text" inputmode="numeric" placeholder="0000 0000 0000 0000" data-testid="card">
          </div>
          <div class="field field-inline">
            <label for="expiry-month">Expiry</label>
            <select id="expiry-month" name="expiryMonth" data-testid="expiry-month">
              <option value="01">01</option><option value="08">08</option><option value="12">12</option>
            </select>
            <select id="expiry-year" name="expiryYear" data-testid="expiry-year">
              <option value="2026">2026</option><option value="2027">2027</option>
            </select>
          </div>
          <div class="field">
            <label for="cvv">CVV</label>
            <input id="cvv" name="cvv" type="text" maxlength="4" data-testid="cvv">
          </div>
          <button type="button" class="btn btn-primary" data-testid="pay">Pay</button>
        </form>
      </main>
    </div>`,
    ),
  },
  {
    path: "/widgets",
    title: "Widgets",
    html: shell(
      "Widgets",
      `    <main class="page">
      <h1 data-testid="widgets-heading">Widgets</h1>

      <section aria-labelledby="dialogs-heading" data-testid="section-dialogs">
        <h2 id="dialogs-heading">Dialogs</h2>
        <button class="btn" data-testid="show-alert" onclick="alert('Saved.')">Show alert</button>
        <button class="btn" data-testid="show-confirm" onclick="document.getElementById('confirm-result').textContent = confirm('Are you sure?') ? 'confirmed' : 'dismissed'">Show confirm</button>
        <button class="btn" data-testid="show-prompt" onclick="document.getElementById('confirm-result').textContent = prompt('Your name?', '') || 'none'">Show prompt</button>
        <output id="confirm-result" data-testid="dialog-result"></output>
      </section>

      <section aria-labelledby="selects-heading" data-testid="section-selects">
        <h2 id="selects-heading">Selects</h2>
        <label for="single-select">Environment</label>
        <select id="single-select" name="environment" data-testid="single-select">
          <option value="test">Test</option>
          <option value="staging">Staging</option>
          <option value="production">Production</option>
        </select>
        <label for="multi-select">Browsers</label>
        <select id="multi-select" name="browsers" data-testid="multi-select" multiple size="3">
          <option value="chromium">Chromium</option>
          <option value="firefox">Firefox</option>
          <option value="webkit">WebKit</option>
        </select>
      </section>

      <section aria-labelledby="frame-heading" data-testid="section-frame">
        <h2 id="frame-heading">Frame</h2>
        <iframe id="embedded" title="Embedded widget" src="/widgets/frame" width="360" height="120" data-testid="frame"></iframe>
      </section>

      <section aria-labelledby="tabs-heading" data-testid="section-newtab">
        <h2 id="tabs-heading">New tab</h2>
        <a href="/docs" target="_blank" rel="noopener" class="btn" data-testid="open-new-tab">Open the docs in a new tab</a>
      </section>

      <section aria-labelledby="files-heading" data-testid="section-files">
        <h2 id="files-heading">Files</h2>
        <label for="upload">Attach a report</label>
        <input id="upload" name="report" type="file" data-testid="upload">
      </section>

      <section aria-labelledby="drag-heading" data-testid="section-drag">
        <h2 id="drag-heading">Drag</h2>
        <div id="drag-source" draggable="true" data-testid="drag-source">Drag me</div>
        <div id="drag-target" data-testid="drag-target">Drop here</div>
      </section>

      <section aria-labelledby="canvas-heading" data-testid="section-canvas">
        <h2 id="canvas-heading">Canvas-only control</h2>
        <p>The button below is painted on a canvas and has no accessibility node, so it can only be reached by coordinates or through the vision fallback.</p>
        <canvas id="canvas-control" width="320" height="120" data-testid="canvas-control"></canvas>
        <output id="canvas-result" data-testid="canvas-result"></output>
        <script src="/canvas.js" defer></script>
      </section>
    </main>`,
    ),
  },
  {
    path: "/widgets/frame",
    title: "Embedded frame",
    html: shell(
      "Embedded frame",
      `    <main class="page frame-body">
      <h1 data-testid="frame-heading">Inside the frame</h1>
      <label for="frame-input">Frame field</label>
      <input id="frame-input" name="frameField" type="text" data-testid="frame-input">
      <button class="btn" data-testid="frame-button">Frame button</button>
    </main>`,
    ),
  },
  {
    path: "/docs",
    title: "Docs",
    html: shell(
      "Docs",
      `    <main class="page">
      <h1 data-testid="docs-heading">Documentation</h1>
      <p class="lead">This page is the target of the links that open a new tab.</p>
    </main>`,
    ),
  },
  {
    path: "/logout",
    title: "Logged out",
    html: shell(
      "Logged out",
      `    <main class="page">
      <h1 data-testid="logout-heading">You are signed out</h1>
      <a class="btn btn-primary" href="/login" data-testid="sign-in-again">Sign in again</a>
    </main>`,
    ),
  },
];

export const APP_CSS = `:root { color-scheme: light dark; --fg: #14161a; --bg: #ffffff; --muted: #5b6472; --accent: #2f5bd7; --line: #d8dde5; }
@media (prefers-color-scheme: dark) { :root { --fg: #e8ecf2; --bg: #14161a; --muted: #9aa4b2; --accent: #7fa0ff; --line: #2b313b; } }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg); }
.navbar { display: flex; gap: 16px; align-items: center; padding: 12px 20px; border-bottom: 1px solid var(--line); }
.navbar-menu { display: flex; gap: 14px; margin-left: auto; }
.navbar-item { color: var(--fg); text-decoration: none; }
.navbar-toggle, .sidebar-toggle { background: none; border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; color: inherit; cursor: pointer; }
.app { display: flex; gap: 24px; align-items: flex-start; }
.sidebar { width: 200px; padding: 20px; border-right: 1px solid var(--line); min-height: 70vh; }
.sidebar-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }
.sidebar-list a { color: var(--fg); text-decoration: none; }
.page, .hero { padding: 24px 20px; max-width: 760px; }
h1 { font-size: 26px; margin: 0 0 8px; }
h2 { font-size: 18px; margin: 28px 0 8px; }
.lead { color: var(--muted); margin: 0 0 18px; }
.form { display: grid; gap: 14px; max-width: 380px; }
.field { display: grid; gap: 4px; }
.field-inline { display: flex; gap: 8px; align-items: center; }
input, select { padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; }
.btn { display: inline-block; padding: 8px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--fg); text-decoration: none; cursor: pointer; font: inherit; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn-link { border-color: transparent; }
.alert { padding: 8px 12px; border-radius: 6px; border: 1px solid var(--line); margin-bottom: 14px; }
.alert-error { border-color: #c0392b; color: #c0392b; }
.table { border-collapse: collapse; margin-top: 18px; }
.table th, .table td { border: 1px solid var(--line); padding: 6px 12px; text-align: left; }
#drag-source, #drag-target { display: inline-block; padding: 18px 24px; border: 1px dashed var(--line); border-radius: 8px; margin-right: 12px; }
canvas { border: 1px solid var(--line); border-radius: 8px; display: block; }
.frame-body { padding: 12px; }
`;

/**
 * The canvas-only control (LLD §16): a button painted on a canvas with no
 * accessibility node, so grounding must fall back to coordinates or vision.
 */
export const CANVAS_JS = `const canvas = document.getElementById("canvas-control");
if (canvas) {
  const ctx = canvas.getContext("2d");
  const button = { x: 80, y: 35, w: 160, h: 44, label: "Approve" };
  const paint = (hover) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = hover ? "#2f5bd7" : "#4a72e0";
    ctx.fillRect(button.x, button.y, button.w, button.h);
    ctx.fillStyle = "#ffffff";
    ctx.font = "15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(button.label, button.x + button.w / 2, button.y + button.h / 2);
  };
  const inside = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h;
  };
  canvas.addEventListener("mousemove", (e) => paint(inside(e)));
  canvas.addEventListener("click", (e) => {
    if (inside(e)) document.getElementById("canvas-result").textContent = "approved";
  });
  paint(false);
}
`;

/** Look a page up by path. */
export function pageFor(path: string): Page | undefined {
  return PAGES.find((p) => p.path === path);
}
