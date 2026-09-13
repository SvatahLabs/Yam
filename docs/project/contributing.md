# Contributing

**The contributing guide now lives at [CONTRIBUTING.md](../../CONTRIBUTING.md)**,
where GitHub looks for it and where a new contributor will find it.

This page keeps the parts that are about the repository's own rules rather than
about sending a change.

## The contract

Requires Node 22 LTS and pnpm. A clean checkout that runs these six, with no
model credential, has run everything:

```bash
pnpm install --frozen-lockfile
pnpm browsers
pnpm -r build
pnpm -r typecheck
pnpm -r test
pnpm lint
```

Beside them: `pnpm check:licenses` (every dependency permissively licensed),
`pnpm docs:check` (the generated reference is current), `pnpm quick-start`
(the ten-minute quick start, timed), and the evals in [Reports](reports.md).

## The specification is the source of truth

`docs/spec/` holds the requirements, the high-level and low-level design and
the task breakdown. Work is done in phases; each phase has a record and an
adversarial verification under `docs/spec/progress/`. A change to behaviour
starts as a change to the specification, with a draft number, and the record
says what was built, how it was verified, and what deviated.

## Boundaries

Packages import each other only as LLD §1 allows, and ESLint enforces it: the
runtime cannot reach the gateway, module (a) cannot reach module (b), a screen
cannot reach the runtime. `tools/repo-checks` holds the tests about the
repository itself: the layout matches the design document, the CI workflow has
the properties each phase pinned, the generated clients have not drifted, and
the product name is used only where it should be.

## Style

Plain sentences over jargon; a name only when the reader has to go there;
every number with the report it comes from. Commit messages name the task
(`T13.3: …`) or the finding (`P12-F2: …`) they close.

## Reporting a problem

Open an issue at <https://github.com/SvatahLabs/yam/issues> with the command,
the exit code, and the run directory or report if there is one. For anything
security-related, read [Security](security.md) first.
