# Svatah eval report — healing

Generated: 2026-09-06T22:42:20.023Z

**Relocalize-only recovery: 92.6%**, against REQ-HEAL-5's 60.0% threshold. Met.

**No model was involved at any point**: relocalization only, with the no-op `Regrounder` (LLD §10). REQ-HEAL-5's second number — 85% with one model call — is therefore *not measured here*, and the figure below is the relocalize-only one. Register a `Regrounder` (a credential, and `heal.useModel`) to measure it.

## Method

Bindings are recorded for every interactive element on every sample page at variant 0. The headline number is taken with test-id attributes disabled: an application that carries a data-testid on every control barely needs healing, and measuring on it would flatter the result. The same run with test ids enabled is reported alongside it. Each variant is then loaded on the pages it changes. A candidate has broken when it no longer identifies exactly one element. A binding is degraded when at least one of its candidates has broken, and those are the cases this number is about. Recovered means two things together: the element relocalization proposed carries the same ground-truth key as the element the binding was recorded on, AND a candidate re-synthesised from that element resolves back to exactly one element. The key is a data-svatah-eval attribute the sample application stamps on every interactive element, identical across all variants; the eval reads it with a page script outside the surface, and bindings.ignoreAttributes strips it from describe(), from native, from synthesis and from fingerprints, so it can never help relocalization find anything. A proposal with a different key is wrong-element however high it scored; one whose key matches but which cannot be re-synthesised into a unique candidate is unverified, not recovered. No model is involved.

Headline population: `no-test-ids`.

## Both populations

| Population | Bindings | Degraded | Recovered | Wrong element | Rate |
|---|---|---|---|---|---|
| `no-test-ids` **(headline)** | 107 | 54 | 50 | 0 | 92.6% |
| `with-test-ids` | 107 | 19 | 15 | 0 | 78.9% |

`no-test-ids` is the headline because it is the harder and more representative population: an application with a `data-testid` on every control barely needs healing at all, so a number taken on it measures the application rather than the healer. Both are published so the gap between them is visible rather than a choice made quietly in the eval's own configuration.

## What was measured

| | Count |
|---|---|
| Bindings recorded at variant 0 | 107 |
| Locator cases examined (candidate × variant) | 2861 |
| Locators broken | 68 |
| Bindings that stopped resolving entirely | 0 |
| **Bindings degraded — the cases below** | **54** |
| Recovered by relocalization | 50 |
| Not found | 4 |
| Refused as ambiguous | 0 |
| **Relocalized onto the wrong element** | **0** |
| Proposed but unverifiable | 0 |

Relocalization proposed the wrong element in no case: every proposal it made carried the ground-truth key of the element the binding was recorded on. That is the claim Phase 1's number could not make, because it verified only that a proposal was findable.

> No binding stopped resolving on any variant. A synthesised bundle carries five to eight independent candidates and a single-property change rarely takes them all, so the recovery rate above is measured over bindings that *degraded* — lost a candidate and with it their redundancy — rather than over bindings that failed outright. That distinction is the honest one; see the method.

## By variant

| # | Change | Locators broken | Degraded | Recovered | Rate |
|---|---|---|---|---|---|
| 1 | Sign-in call to action renamed | 2/28 | 1 | 1 | 100.0% |
| 2 | Test id dropped from the username field | 0/43 | 0 | 0 | — |
| 3 | Login fields wrapped in an extra layout div | 0/43 | 0 | 0 | — |
| 4 | Submit button value changed | 1/43 | 1 | 1 | 100.0% |
| 5 | Password field id renamed | 3/43 | 1 | 1 | 100.0% |
| 6 | Sidebar items reordered | 0/261 | 0 | 0 | — |
| 7 | Logout became an icon-only button | 4/261 | 4 | 0 | 0.0% |
| 8 | Dashboard heading rewritten | 0/48 | 0 | 0 | — |
| 9 | A second Book button appears | 2/89 | 1 | 1 | 100.0% |
| 10 | CSS classes hashed by the build | 10/417 | 10 | 10 | 100.0% |
| 11 | Search field became a search input | 0/89 | 0 | 0 | — |
| 12 | Schedule Build heading demoted to h2 | 0/54 | 0 | 0 | — |
| 13 | Nav toggle text moved into a child span | 0/417 | 0 | 0 | — |
| 14 | Placeholders removed from the login form | 2/43 | 2 | 2 | 100.0% |
| 15 | Labels detached from their inputs | 12/113 | 6 | 6 | 100.0% |
| 16 | CVV field keeps only its name | 5/70 | 1 | 1 | 100.0% |
| 17 | A banner was added above the main content | 26/393 | 26 | 26 | 100.0% |
| 18 | An extra first option in every select | 0/274 | 0 | 0 | — |
| 19 | Next button moved into a toolbar | 1/89 | 1 | 1 | 100.0% |
| 20 | Login moved into a modal dialog | 0/43 | 0 | 0 | — |

A rate of `—` means the variant degraded no binding: every candidate it could have
invalidated still identified its element.

## Which candidate kinds broke

| Kind | Times broken |
|---|---|
| `xpath` | 29 |
| `css` | 12 |
| `role` | 10 |
| `label` | 7 |
| `text` | 6 |
| `id` | 2 |
| `placeholder` | 2 |

This is the ranking in T1.4 being justified or not: a kind near the top of the
bundle that breaks often is ranked too high.

## What relocalization does not survive

- **Variant 7 — Logout became an icon-only button**: 0 of 4 recovered, 4 not found.
