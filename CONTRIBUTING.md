# Contributing to Yam

Thank you for wanting to help. This page tells you how to get set up, what we
expect from a change, and how to get it reviewed.

## Before you start

Yam is built from a written specification. The specification comes first, the
code second. If you change what the product does, you change
[`docs/spec/`](docs/spec/) first and say why.

This sounds heavy. It exists because the alternative is worse: a product where
nobody can say what it is supposed to do, so nobody can say whether it works.

Small fixes do not need this. A typo, a broken link, a clearer error message, a
missing test: send those straight in.

## Get set up

You need Node 22 or newer and [pnpm](https://pnpm.io/installation).

```bash
git clone https://github.com/SvatahLabs/yam
cd yam
pnpm install
pnpm -r build
```

Some tests drive a real browser. Install it once:

```bash
pnpm browsers
```

`pnpm browsers` is a short name for `pnpm exec playwright install chromium`. It
is the step people skip, and the tests that need a browser are the ones that
fail when they do.

## Run the checks

These six are the whole contract. A clean checkout that passes all six has run
everything.

```bash
pnpm install --frozen-lockfile
pnpm browsers
pnpm -r build
pnpm -r typecheck
pnpm -r test
pnpm lint
```

The full suite takes about ten minutes. If you are working on one package, run
just that one while you work:

```bash
pnpm --filter @svatah/yam-compiler test
```

Then run all six before you send the change.

Three more checks run in CI and you can run them too:

```bash
pnpm check:licenses   # every dependency is permissively licensed
pnpm docs --check     # the generated reference matches the code
pnpm quick-start      # the ten minute quick start, timed
```

## What makes a good change

**Every change has a test.** Not because of a rule, but because a change nobody
can check is a change nobody can keep.

**The test must be able to fail.** Write it, watch it fail against the old
behaviour, then make it pass. A test that passes before and after your change
tests nothing. We call this "shown to bite", and several checks in this
repository carry a case that proves they bite.

**Say why in the code.** A comment that repeats the code is noise. A comment
that says why the code is shaped that way, and what went wrong when it was
shaped differently, is what the next person needs. Look at any file here for the
house style.

**One change, one reason.** If you are fixing two things, send two changes.

## Commit messages

Write a subject line that says what changed and, when it helps, why. Then a
body that a reviewer can read instead of the diff.

Good:

```
The heal review wrote proposals before anybody accepted them

`applyProposal` was called from the load path, so opening the screen
wrote to bindings/. Nothing said so, and a reviewer who opened the
screen to look had already changed the store.
```

Not useful:

```
fix bug
```

If your change closes a specification task or a verification finding, name it:
`T13.3: ...` or `P12-F2: ...`.

## Code style

The linter and the formatter decide layout. Do not argue with them, and do not
reformat code you are not changing.

Naming and prose follow the house style:

- Plain sentences over jargon.
- Name a file or a function only when the reader has to go and look at it.
- Every number comes with the report it came from.

## Package boundaries

Packages may import each other only as the design allows, and ESLint enforces
it. The runtime cannot reach the model gateway. Module (a), the Playwright
bindings, cannot reach module (b), the flow language and compiler. A screen
cannot reach the runtime.

If your change needs a new import across a boundary, that is a design change.
Say so, and expect a conversation about it.

`tools/repo-checks` holds tests about the repository itself: the layout matches
the design, the generated clients have not drifted, the docs make no claim the
product does not keep.

## Adding an adapter

An adapter teaches Yam to drive a new kind of target. There is a conformance
suite it must pass, and a guide:
[Add an adapter](docs/guides/add-an-adapter.md).

An adapter that exists is not an adapter that works. The
[support matrix](docs/reference/generated/support-matrix.md) is generated from
real runs. A new adapter appears there as unvalidated until something drives it.

## Documentation

Docs live in [`docs/`](docs/README.md). Two rules:

1. Do not edit anything under `docs/reference/generated/`. Run `pnpm docs`.
2. Do not claim what the product does not do. A check reads every doc a user
   might read and fails on a claim the support matrix does not back.

## Reporting a problem

Open an issue with:

- what you ran,
- what happened,
- what you expected,
- the output of `yam surface doctor` if it involves driving something.

A failing test is the best bug report there is.

## Security

Do not open a public issue for a security problem. See
[docs/project/security.md](docs/project/security.md).

## Licence

Yam is Apache-2.0. By sending a change you agree it is licensed the same way.
