# What implementing it found

All four waves, `P0`–`P3`. Twelve tasks done, two partly with the reason in the
task text. 36 packages, 4,534 tests.

## What shipped

**`@svatah/yam-contract`** — the operation catalogue and the fingerprint, lifted
out of the broker's package so a client that wants to know what the contract *is*
need not depend on the thing that implements it. Schema and zod, and nothing that
drives anything.

**The broker names its starter.** `/health` carries `startedBy`, `brokerState`
carries it through, and the mismatch message names both parties and both
contracts. `YAM_STARTED_BY` lets the application say `Yam.app 0.1.0` rather than
the name of the CLI it stages — which is the case the whole thing exists for,
since two of the three installables are the same binary run from different places.

**The drivers are optional.** `playwright` (19 MB) and `webdriverio` (4 MB) are
optional peers; registering an adapter resolves nothing and connecting resolves
the driver. `doctor` gained a third verdict — **not installed**, with the one
command — distinct from "not this host", which no command fixes.

**`@svatah/yam-mcp`** — the server, its own installable, because the MCP SDK is
six megabytes against six for everything Yam wrote. `yam mcp` is removed and says
where it went.

## What the checks found that reading would not have

**The back door.** `@svatah/yam` depends on `@svatah/yam-playwright-test`, which
had `playwright` as a *hard* dependency — so the CLI installed a browser driver
transitively however optional the peer was. The CLI uses three functions from
that package, over a map, needing nothing but Yam's own types, and reached them
through a barrel that re-exported the fixture. A `./grounder` entry point is
**556 bytes**.

**The split then broke the grounder twice.** Two entry points bundling one module
give two copies of its state, and a registry *is* state: registering a grounder
appeared to do nothing. A self-reference through the package's own subpath fixed
the bundle and broke the source, where `bind.ts` still imports the file. Code
splitting is the answer — one 563-byte chunk, both entries pointing at it.

**The probe asked the wrong package.** "Not installed" was answered by
`surface-control`, which depends on neither driver, so resolution succeeded or
failed for reasons about the wrong location. Only the adapter is standing in the
right place; it records what it resolved when it registers.

**And resolved the wrong thing.** `webdriverio` does not export its
`package.json`, so asking for it threw `ERR_PACKAGE_PATH_NOT_EXPORTED` and the
answer was read as "missing" on a machine that had it.

**The repository's own checks caught the two new packages three ways** — HLD §12's
list, the release set's count, the generated pages — and a stale relative link in
a document nobody had opened.

## Two things I got wrong before measuring

**The `observe` flake was never a timeout.** I read it as impatience twice and
raised the budget from two seconds to ten and then to thirty; it kept failing in
three and a half, which is the number that says it is not a clock. The loop waited
for `click` and the proof required `click` *and* `navigate`, so it stopped the
moment the first arrived and asserted on the second. It waits for both now, and
the three "fixes" before it were noise in the history.

**I asserted the CLI packs under two megabytes**, having measured nothing. It
packs 6.1, which is exactly what the specification's own "everything Yam wrote,
about six megabytes" says. The threshold is the measurement plus room now.

## What the "contention" turned out to be

`surface-journey` and `trajectory-compile` had each failed once under
`pnpm -r test` and passed alone, recorded here and in two earlier waves as
probable contention. The last failure of this wave had a plainer cause: **a broker
left running by a manual experiment**, from a different working directory. Killing
it made the suite green. That is not proof the earlier ones were the same thing,
and it is a better hypothesis than load — one process per machine means a stray
one is a shared fixture nobody declared.

## Not done

**Installing a published tarball** (`P3.1`). `npm pack --dry-run` measures the
package's contents, which is the half a registry cannot change; the other half
needs something published, and nothing is. That is the owner's call.

**A machine that genuinely lacks a driver** (`P3.3`). All three verdicts are
driven through the registry, but this machine has both drivers installed, so the
"not installed" path is proven by construction rather than by absence.
