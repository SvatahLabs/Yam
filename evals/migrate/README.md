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
