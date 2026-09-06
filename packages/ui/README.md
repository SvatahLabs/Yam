# `@svatah/ui`

The Svatah design system: React components on Radix primitives (REQ-ADE-12,
LLD §13.7).

Button, field, chooser, pill, chip, table, tabs, rail item, inspector sections,
alert, command palette, kbd. Two rules hold the package together, and both are
in the code rather than in a review:

1. **Every interactive control has a visible label that is its accessible name,
   and an id in the `automationId` form.** `requireNamed` throws in development
   when either is missing; `test/named.test.tsx` renders every component without
   one to show it. This is the rule the Phase 8 verification found three
   violations of on the ADE's Project screen.
2. **A status colour never appears without a word.** `Pill` refuses an empty
   label. There is no way through this package to draw a bare coloured dot.

The package knows nothing about Svatah — `eslint.config.js` forbids it importing
anything but `@svatah/ui-tokens` — so a screen's *meaning* lives in
`@svatah/screens` and its *appearance* lives here.

## The component sheet

```console
$ pnpm sheet          # renders packages/ui/sheet/index.html
$ pnpm sheet:audit    # the accessibility audit: 0 violations
$ pnpm sheet:shoot    # reports/sheet-dark.png and reports/sheet-light.png
```

Every component, both themes, one static page with no bundler and no script —
so a DOM parser can audit it, a browser can open it from the filesystem, and the
desktop accessibility adapters can read it.

The audit is `scripts/audit-sheet.mjs`, and it is ours rather than axe-core's:
axe-core is MPL-2.0 and REQ-PKG-3 admits MIT, Apache-2.0 and BSD.
`pnpm sheet:audit --axe <axe.min.js>` runs axe-core beside it for a verifier who
has a copy. `tools/repo-checks/test/sheet-audit.test.ts` shows every rule
failing on a page written to break it.
