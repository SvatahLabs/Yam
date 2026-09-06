/**
 * The pieces every artboard shares, so more than one thing can expand them.
 *
 * `build.mjs` writes the canvas files and `scripts/audit-artboards.mjs` renders
 * the artboards to *measure* them (P10-F4), and both need the same sidebar, top
 * bar, status bar and stylesheet. Two copies of that would be two designs.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** `base.css`, the stylesheet every artboard is drawn with. */
export const baseCss = readFileSync(join(HERE, "base.css"), "utf8");

const I = {
  flows: '<svg viewBox="0 0 16 16"><path d="M3 2.5h7l3 3v8H3z"/><path d="M10 2.5v3h3"/><path d="M5.5 8h5M5.5 10.5h5"/></svg>',
  runs: '<svg viewBox="0 0 16 16"><path d="M5 3l8 5-8 5z"/></svg>',
  bindings: '<svg viewBox="0 0 16 16"><path d="M6.5 9.5l3-3"/><path d="M7 4.5l1.2-1.2a2.5 2.5 0 013.5 3.5L10.5 8"/><path d="M9 11.5l-1.2 1.2a2.5 2.5 0 01-3.5-3.5L5.5 8"/></svg>',
  agents: '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5"/><path d="M6.5 1.5v2.5M9.5 1.5v2.5M6.5 12v2.5M9.5 12v2.5M1.5 6.5H4M1.5 9.5H4M12 6.5h2.5M12 9.5h2.5"/></svg>',
  api: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg>',
  data: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 7h12M2 10h12M6 3v10"/></svg>',
  settings: '<svg viewBox="0 0 16 16"><path d="M2 4.5h12M2 8h12M2 11.5h12"/><circle cx="5" cy="4.5" r="1.3" fill="#151a20"/><circle cx="11" cy="8" r="1.3" fill="#151a20"/><circle cx="7" cy="11.5" r="1.3" fill="#151a20"/></svg>',
  import: '<svg viewBox="0 0 16 16"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 11v2.5h10V11"/></svg>',
  search: '<svg viewBox="0 0 16 16" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:1.6"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>',
};
const nav = (id, label, count, active) => `<div class="nav${active === id ? " active" : ""}" role="link" aria-label="${label}">${I[id]}<span>${label}</span>${count ? `<span class="count">${count}</span>` : ""}</div>`;
const sidebar = (active) => `<nav class="sidebar" aria-label="Sections">
<div class="section">Project</div>
${nav("flows", "Flows", "7", active)}
${nav("runs", "Runs", "12", active)}
${nav("bindings", "Bindings", "41", active)}
${nav("agents", "Agents and tools", "", active)}
<div class="section">Resources</div>
${nav("api", "API", "3", active)}
${nav("data", "Data", "", active)}
<div class="grow"></div>
${nav("import", "Import prototype database", "", active)}
${nav("settings", "Settings", "", active)}
</nav>`;
const topbar = (crumb) => `<header class="topbar"><div class="brand"><span class="mark"></span>Svatah</div><div class="crumb"><span class="sep">/</span><b>svatah-fixtures</b><span class="sep">/</span><span>${crumb}</span></div><div class="spacer"></div><div class="palette-hint" role="button" aria-label="Command palette">${I.search}<span>Search or run a command</span><kbd>⌘K</kbd></div><span class="env"><span class="dot"></span>service 127.0.0.1:55702</span><span class="env">test · playwright</span></header>`;
const statusbar = (text) => `<footer class="statusbar">${text}<span class="spacer"></span><span><kbd>⌘K</kbd>commands</span><span><kbd>?</kbd>keys</span></footer>`;

/** One artboard fragment with `@@TOPBAR`, `@@SIDEBAR` and `@@STATUS` expanded. */
export function expand(body) {
  return body
    .replace(/@@SIDEBAR\((\w+)\)/g, (_, a) => sidebar(a))
    .replace(/@@TOPBAR\(([^)]*)\)/g, (_, c) => topbar(c))
    .replace(/@@STATUS\(([^)]*)\)/g, (_, t) => statusbar(t));
}
