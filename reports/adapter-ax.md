# Desktop conformance — `ax`

Run at 2026-09-05T04:22:54.254Z on darwin arm64, Node v25.6.1.

**Conformant.** 9 cases passed across ADE variants 0, 1 and 2 (REQ-SURF-3, REQ-ADE-6).

Bridge (LLD §7.5): the largest window read was **588 nodes in 999 ms — 1.7 ms per node**, 9413 accessibility calls, 1 process invocation per snapshot.

## Healing (LLD §16)

| Case | Variant | Outcome |
|---|---|---|
| `ade.heal.renamed-control` | 1 | relocalized |
| `ade.heal.moved-panel` | 2 | relocalized |

## ADE variant 0


Run at 2026-09-05T04:21:56.225Z · 24895 ms


Bridge: the largest window read was 588 nodes in 999 ms (1.7 ms per node, 9413 accessibility calls, 1 process invocation).

**Conformant.** 7 cases passed, 2 skipped, 30 checks.

| Case | Page | Status | Checks |
|---|---|---|---|
| `ade.snapshot` | `Svatah ADE` | passed | 7/7 |
| `ade.project` | `Svatah ADE` | passed | 4/4 |
| `ade.flow` | `Svatah ADE` | passed | 4/4 |
| `ade.run` | `Svatah ADE` | passed | 3/3 |
| `ade.result` | `Svatah ADE` | passed | 3/3 |
| `ade.api-client` | `Svatah ADE` | passed | 4/4 |
| `ade.no-navigation` | `Svatah ADE` | passed | 2/2 |
| `ade.heal.renamed-control` | `Svatah ADE` | skipped | 2/2 |
| `ade.heal.moved-panel` | `Svatah ADE` | skipped | 1/1 |

## ADE variant 1


Run at 2026-09-05T04:22:23.000Z · 15652 ms


Bridge: the largest window read was 588 nodes in 889 ms (1.51 ms per node, 9413 accessibility calls, 1 process invocation).

**Conformant.** 1 cases passed, 8 skipped, 8 checks.

| Case | Page | Status | Checks |
|---|---|---|---|
| `ade.snapshot` | `Svatah ADE` | skipped | 0/0 |
| `ade.project` | `Svatah ADE` | skipped | 0/0 |
| `ade.flow` | `Svatah ADE` | skipped | 0/0 |
| `ade.run` | `Svatah ADE` | skipped | 0/0 |
| `ade.result` | `Svatah ADE` | skipped | 0/0 |
| `ade.api-client` | `Svatah ADE` | skipped | 0/0 |
| `ade.no-navigation` | `Svatah ADE` | skipped | 0/0 |
| `ade.heal.renamed-control` | `Svatah ADE` | passed | 8/8 |
| `ade.heal.moved-panel` | `Svatah ADE` | skipped | 0/0 |

## ADE variant 2


Run at 2026-09-05T04:22:40.598Z · 13633 ms


Bridge: the largest window read was 588 nodes in 883 ms (1.5 ms per node, 9413 accessibility calls, 1 process invocation).

**Conformant.** 1 cases passed, 8 skipped, 4 checks.

| Case | Page | Status | Checks |
|---|---|---|---|
| `ade.snapshot` | `Svatah ADE` | skipped | 0/0 |
| `ade.project` | `Svatah ADE` | skipped | 0/0 |
| `ade.flow` | `Svatah ADE` | skipped | 0/0 |
| `ade.run` | `Svatah ADE` | skipped | 0/0 |
| `ade.result` | `Svatah ADE` | skipped | 0/0 |
| `ade.api-client` | `Svatah ADE` | skipped | 0/0 |
| `ade.no-navigation` | `Svatah ADE` | skipped | 0/0 |
| `ade.heal.renamed-control` | `Svatah ADE` | skipped | 0/0 |
| `ade.heal.moved-panel` | `Svatah ADE` | passed | 4/4 |

