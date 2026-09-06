# Desktop conformance — `ax`

Run at 2026-09-06T19:27:48.464Z on darwin arm64, Node v25.6.1.

**Conformant.** 10 cases passed across ADE variants 0, 1 and 2 (REQ-SURF-3, REQ-ADE-6).

Bridge (LLD §7.5): the largest window read was **1017 nodes in 1461 ms — 1.44 ms per node**, 16277 accessibility calls, 1 process invocation per snapshot, at **load average 3.88 over 8 CPUs**.

No variant's window read exceeded the bridge's deadline, so nothing was retried.

## Healing (LLD §16)

| Case | Variant | Outcome |
|---|---|---|
| `ade.heal.renamed-control` | 1 | relocalized |
| `ade.heal.moved-panel` | 2 | relocalized |

## ADE variant 0


Run at 2026-09-06T19:26:38.655Z · 36859 ms


Bridge: the largest window read was 1017 nodes in 1461 ms (1.44 ms per node, 16277 accessibility calls, 1 process invocation, load average 3.88 over 8 CPUs).

**Conformant.** 8 cases passed, 2 skipped, 42 checks.

| Case | Page | Status | Checks |
|---|---|---|---|
| `ade.snapshot` | `Svatah ADE` | passed | 10/10 |
| `ade.project` | `Svatah ADE` | passed | 4/4 |
| `ade.flow` | `Svatah ADE` | passed | 4/4 |
| `ade.run` | `Svatah ADE` | passed | 6/6 |
| `ade.result` | `Svatah ADE` | passed | 6/6 |
| `ade.api-client` | `Svatah ADE` | passed | 4/4 |
| `ade.inspector` | `Svatah ADE` | passed | 3/3 |
| `ade.no-navigation` | `Svatah ADE` | passed | 2/2 |
| `ade.heal.renamed-control` | `Svatah ADE` | skipped | 1/1 |
| `ade.heal.moved-panel` | `Svatah ADE` | skipped | 2/2 |

## ADE variant 1


Run at 2026-09-06T19:27:17.758Z · 13790 ms


Bridge: the largest window read was 340 nodes in 585 ms (1.72 ms per node, 5445 accessibility calls, 1 process invocation, load average 3.67 over 8 CPUs).

**Conformant.** 1 cases passed, 9 skipped, 4 checks.

| Case | Page | Status | Checks |
|---|---|---|---|
| `ade.snapshot` | `Svatah ADE` | skipped | 0/0 |
| `ade.project` | `Svatah ADE` | skipped | 0/0 |
| `ade.flow` | `Svatah ADE` | skipped | 0/0 |
| `ade.run` | `Svatah ADE` | skipped | 0/0 |
| `ade.result` | `Svatah ADE` | skipped | 0/0 |
| `ade.api-client` | `Svatah ADE` | skipped | 0/0 |
| `ade.inspector` | `Svatah ADE` | skipped | 0/0 |
| `ade.no-navigation` | `Svatah ADE` | skipped | 0/0 |
| `ade.heal.renamed-control` | `Svatah ADE` | passed | 4/4 |
| `ade.heal.moved-panel` | `Svatah ADE` | skipped | 0/0 |

## ADE variant 2


Run at 2026-09-06T19:27:33.773Z · 14165 ms


Bridge: the largest window read was 340 nodes in 585 ms (1.72 ms per node, 5445 accessibility calls, 1 process invocation, load average 3.8 over 8 CPUs).

**Conformant.** 1 cases passed, 9 skipped, 5 checks.

| Case | Page | Status | Checks |
|---|---|---|---|
| `ade.snapshot` | `Svatah ADE` | skipped | 0/0 |
| `ade.project` | `Svatah ADE` | skipped | 0/0 |
| `ade.flow` | `Svatah ADE` | skipped | 0/0 |
| `ade.run` | `Svatah ADE` | skipped | 0/0 |
| `ade.result` | `Svatah ADE` | skipped | 0/0 |
| `ade.api-client` | `Svatah ADE` | skipped | 0/0 |
| `ade.inspector` | `Svatah ADE` | skipped | 0/0 |
| `ade.no-navigation` | `Svatah ADE` | skipped | 0/0 |
| `ade.heal.renamed-control` | `Svatah ADE` | skipped | 0/0 |
| `ade.heal.moved-panel` | `Svatah ADE` | passed | 5/5 |

