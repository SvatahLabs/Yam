# `evals/migrate`

The committed output of `svatah migrate legacy/src/test/resources <dest>`.

## Why this exists rather than a comparison with `evals/fixtures/flows`

T2.9 asks for migration output "compared byte-for-byte", and the natural target
is `evals/fixtures/flows` — the four flows Phase 0 hand-migrated. That comparison
cannot hold, and the reason is worth stating rather than working around:

The hand migration made decisions no converter can make. It turned two literals
into a typed `inputs:` signature; it named an element "the schedule heading"
where the original said `~xpath://h1~`; it added `(tags=smoke)`. Those are good
decisions, and they are *design*, not conversion. A migrator that reproduced them
would be a migrator that had memorised these four files.

So migration is held to the three properties that are actually about migration —
**story names, step order and step counts equal to the originals, and output that
compiles clean** — and to byte equality against *its own* committed output, which
is what this directory is. That pins the converter: any change to it shows up as
a diff a reviewer reads, which is what byte-for-byte comparison is for.

Regenerate with:

```bash
node scripts/migrate-legacy.mjs
```

`tools/repo-checks/test/migrate.test.ts` fails when the two disagree.

## `ade-db/` — the prototype database fixture (T6.6, REQ-ADE-9)

The Svatah ADE prototype kept a project's flows, locators and data in an
electron-db directory rather than on disk, and `svatah migrate <dest> --from-ade
<src>` reads one. REQ-ADE-9's Validate needs a database to read.

**This one is synthesised, and no prototype database was available on the
machine T6.6 was implemented on.** What makes it worth trusting is that neither
its shape nor its content was invented:

* The **tables and columns** are the prototype's own, read from
  `src/js/dbclient.js` in `github.com/a-t-u-l/svatahADE`. That is the only place
  that tells you a locator row's keys are `"locator identifier"` and
  `"locator details"` — with spaces — and that they hold a JSON string inside a
  column.
* The **flows and locators** are the real legacy files from
  `legacy/src/test/resources`, HTML-escaped the way the prototype's
  contenteditable editor stored them.

So what is synthetic is the packaging, and the packaging is exactly what the
importer reads. It carries two projects (so `--project` has something to choose
between), a browser with no Playwright equivalent, a request with a field v3
does not have, and the `results`, `images` and `settings` tables REQ-ADE-9
excludes — so every branch of the importer has an input.

Regenerate with:

```bash
node scripts/build-ade-fixture.mjs
```
