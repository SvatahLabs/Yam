# @svatah/yam-adapter-playwright

The default web adapter (REQ-ADP-1): the published
[`AgentSurface`](../surface/README.md) implemented on Playwright.

Playwright is consumed as an adapter, not as the core. Nothing above the surface
imports this package except `@svatah/yam`, which registers it, and
`@svatah/yam-playwright-test`, which hosts it — the import-boundary lint and the
dependency-graph test in `tools/repo-checks` enforce that (LLD §1).

## What it implements

| Surface | Covered by |
|---|---|
| `snapshot()` | Two mechanisms, isolated in [`src/snapshot.ts`](src/snapshot.ts) — see below |
| `act()` | Every `SurfaceAction`; one test per action in [`test/actions.spec.ts`](test/actions.spec.ts) |
| `read()` | `text`, `value`, `attribute`, `title`, `url`, `result` |
| `check()` | Every predicate kind of LLD §3.2; one test per kind in [`test/predicates.spec.ts`](test/predicates.spec.ts) |
| `locate()` | Every web candidate kind plus `coords`; the mobile and desktop kinds are refused by name |
| `describe()` | Tag, attributes, own text, neighbour text, ancestor role path, box, sibling index — what synthesis and fingerprinting read |
| `state()` / `restore()` | URL, window, frame, dialog, storage state |
| `screenshot()` | With masking by reference (REQ-NFR-6) |
| `trace()` | Playwright tracing to a zip |

## The two snapshot mechanisms (LLD §7.1)

HLD §14 lists "Playwright internal snapshot API changes" as a risk, with the
mitigation "isolated in the adapter; public `ariaSnapshot()` fallback with own
refs". Both live in `src/snapshot.ts` and nothing outside it knows which one
produced a reference:

- **`playwright`** — Playwright's ref-producing ARIA snapshot, the mechanism
  Playwright MCP uses. References are Playwright's own `eN` and resolve through
  the public `aria-ref=` selector engine.
- **`own`** — a walker injected into the page assigns `rN` in document order and
  registers the elements, so a reference resolves with no Playwright internal
  involved at all.

`YAM_PW_SNAPSHOT=own|playwright|auto` selects one. `auto` is the default: it
uses Playwright's mechanism while the internal call answers and falls back to
`own` when it does not, which is what will happen by itself if Playwright removes
it. **Every behavioural test in this package runs twice, once per mechanism**, and
`test/snapshot.spec.ts` additionally holds the own-refs walker's roles and names
against Playwright's public `ariaSnapshot()`.

A third reference space, `hN`, is minted by `locate()` for an element found from a
stored `Candidate`; Playwright issues `eN` only from its own snapshot, so a
located element could not otherwise be named.

References are stable within a snapshot and are lost on navigation, exactly as
LLD §2.2 says. Using one afterwards is an error that says to take a new snapshot.

## Running the tests

```bash
pnpm browsers   # or: pnpm exec playwright install chromium
pnpm --filter @svatah/yam-adapter-playwright test
```

Only chromium is required. To run the same suite on all three browsers:

```bash
pnpm --filter @svatah/yam-adapter-playwright exec playwright install firefox webkit
YAM_PW_BROWSERS=all pnpm --filter @svatah/yam-adapter-playwright test
```

## Licence

Apache-2.0.
