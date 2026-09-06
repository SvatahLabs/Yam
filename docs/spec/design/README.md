# Builder surfaces — design source (Draft 2.11)

The approved mockups for the ADE redesign, the `svatah ui` terminal cockpit, and the design system beneath both. Reviewed and approved by the owner on 2026-09-05 on the design canvas: https://claude.ai/code/artifact/62b56432-b5c4-4226-9c37-444f6fa134f8

- `base.css` — the tokens, type ramp, and component styles every artboard shares. This is the seed of `@svatah/ui-tokens`.
- `artboards/*.html` — one file per screen: Main (Flows), RecordReview, Run, Results, HealReview, Bindings, Agents, Palette, TUI, Tokens, Secondary. `@@TOPBAR`, `@@SIDEBAR`, `@@STATUS` are expanded by `build.mjs`.
- `canvas.json` — the layout and the notes that were on the canvas.

Every value in the mockups is real project data (the fixtures project, the `comp` run, the fake-gateway decision, the WebMCP binding, the healed schedule link). The implementer builds to LLD §13.7 and §13.8, using these files as the visual reference; where a mockup and the LLD disagree, the LLD wins and the disagreement is recorded as a deviation.

## Reading them as designs

`pnpm artboards` renders every artboard with `base.css` and `build.mjs`'s macros
expanded, and asks the browser the four questions the Phase 10 verification's F4
was: a toolbar is one row with nothing past its end, its title keeps twelve
characters where it is cut at all, an inspector's contents are inside the
inspector, and nothing is past the edge of the 1440 px frame. Those are the same
rules `apps/ade/test/shell.spec.ts` measures on the built application, so a
design that fails them is a design the build cannot be held to.

`pnpm artboards --shoot <dir>` writes a PNG of each one beside the answers.
