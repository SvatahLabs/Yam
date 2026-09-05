# Svatah eval report — healing

Generated: 2026-09-02T19:25:05.625Z

**Relocalize-only recovery: 92.3%**, against REQ-HEAL-5's 60.0% threshold. Met.

No model was involved at any point: relocalization only, with the no-op `Regrounder` (LLD §10). The model half of REQ-HEAL-5 arrives in Phase 3.

## Method

Bindings are recorded for every interactive element on every sample page at variant 0, with test-id attributes disabled: an application that carries a data-testid on every control barely needs healing, and measuring on it would flatter the result. Each variant is then loaded on the pages it changes. A candidate has broken when it no longer identifies exactly one element. A binding is degraded when at least one of its candidates has broken, and those are the cases this number is about. Recovered means relocalization proposed an element AND a candidate re-synthesised from that element resolves back to it — the score alone is never taken as proof. No model is involved.

Population: `no-test-ids`.

## What was measured

| | Count |
|---|---|
| Bindings recorded at variant 0 | 106 |
| Locator cases examined (candidate × variant) | 2825 |
| Locators broken | 66 |
| Bindings that stopped resolving entirely | 0 |
| **Bindings degraded — the cases below** | **52** |
| Recovered by relocalization | 48 |
| Not found | 4 |
| Refused as ambiguous | 0 |
| Proposed but unverifiable | 0 |

> No binding stopped resolving on any variant. A synthesised bundle carries five to eight independent candidates and a single-property change rarely takes them all, so the recovery rate above is measured over bindings that *degraded* — lost a candidate and with it their redundancy — rather than over bindings that failed outright. That distinction is the honest one; see the method.

## By variant

| # | Change | Locators broken | Degraded | Recovered | Rate |
|---|---|---|---|---|---|
| 1 | Sign-in call to action renamed | 2/28 | 1 | 1 | 100.0% |
| 2 | Test id dropped from the username field | 0/43 | 0 | 0 | — |
| 3 | Login fields wrapped in an extra layout div | 0/43 | 0 | 0 | — |
| 4 | Submit button value changed | 1/43 | 1 | 1 | 100.0% |
| 5 | Password field id renamed | 3/43 | 1 | 1 | 100.0% |
| 6 | Sidebar items reordered | 0/257 | 0 | 0 | — |
| 7 | Logout became an icon-only button | 4/257 | 4 | 0 | 0.0% |
| 8 | Dashboard heading rewritten | 0/48 | 0 | 0 | — |
| 9 | A second Book button appears | 2/85 | 1 | 1 | 100.0% |
| 10 | CSS classes hashed by the build | 9/413 | 9 | 9 | 100.0% |
| 11 | Search field became a search input | 0/85 | 0 | 0 | — |
| 12 | Schedule Build heading demoted to h2 | 0/54 | 0 | 0 | — |
| 13 | Nav toggle text moved into a child span | 0/413 | 0 | 0 | — |
| 14 | Placeholders removed from the login form | 2/43 | 2 | 2 | 100.0% |
| 15 | Labels detached from their inputs | 12/113 | 6 | 6 | 100.0% |
| 16 | CVV field keeps only its name | 5/70 | 1 | 1 | 100.0% |
| 17 | A banner was added above the main content | 25/389 | 25 | 25 | 100.0% |
| 18 | An extra first option in every select | 0/270 | 0 | 0 | — |
| 19 | Next button moved into a toolbar | 1/85 | 1 | 1 | 100.0% |
| 20 | Login moved into a modal dialog | 0/43 | 0 | 0 | — |

A rate of `—` means the variant degraded no binding: every candidate it could have
invalidated still identified its element.

## Which candidate kinds broke

| Kind | Times broken |
|---|---|
| `xpath` | 28 |
| `css` | 11 |
| `role` | 10 |
| `label` | 7 |
| `text` | 6 |
| `id` | 2 |
| `placeholder` | 2 |

This is the ranking in T1.4 being justified or not: a kind near the top of the
bundle that breaks often is ranked too high.

## What relocalization does not survive

- **Variant 7 — Logout became an icon-only button**: 0 of 4 recovered, 4 not found.
