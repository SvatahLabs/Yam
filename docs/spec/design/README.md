# Builder surfaces — design source (Draft 2.11)

The approved mockups for the ADE redesign, the `svatah ui` terminal cockpit, and the design system beneath both. Reviewed and approved by the owner on 2026-09-05 on the design canvas: https://claude.ai/code/artifact/62b56432-b5c4-4226-9c37-444f6fa134f8

- `base.css` — the tokens, type ramp, and component styles every artboard shares. This is the seed of `@svatah/ui-tokens`.
- `artboards/*.html` — one file per screen: Main (Flows), RecordReview, Run, Results, HealReview, Bindings, Agents, Palette, TUI, Tokens, Secondary. `@@TOPBAR`, `@@SIDEBAR`, `@@STATUS` are expanded by `build.mjs`.
- `canvas.json` — the layout and the notes that were on the canvas.

Every value in the mockups is real project data (the fixtures project, the `comp` run, the fake-gateway decision, the WebMCP binding, the healed schedule link). The implementer builds to LLD §13.7 and §13.8, using these files as the visual reference; where a mockup and the LLD disagree, the LLD wins and the disagreement is recorded as a deviation.
