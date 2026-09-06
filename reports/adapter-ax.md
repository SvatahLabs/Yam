# Desktop conformance — `ax`

Run at 2026-09-06T10:21:09.903Z on darwin arm64, Node v25.6.1.

**Conformant.** 10 cases passed across ADE variants 0, 1 and 2 (REQ-SURF-3, REQ-ADE-6).

Bridge (LLD §7.5): the largest window read was **1017 nodes in 1491 ms — 1.47 ms per node**, 16277 accessibility calls, 1 process invocation per snapshot, at **load average 4.19 over 8 CPUs**.

No variant's window read exceeded the bridge's deadline, so nothing was retried.

## Healing (LLD §16)

| Case | Variant | Outcome |
|---|---|---|
| `ade.heal.renamed-control` | 1 | relocalized |
| `ade.heal.moved-panel` | 2 | relocalized |

## ADE variant 0


Run at 2026-09-06T10:19:51.123Z · 38990 ms


Bridge: the largest window read was 1017 nodes in 1491 ms (1.47 ms per node, 16277 accessibility calls, 1 process invocation, load average 4.19 over 8 CPUs).

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


Run at 2026-09-06T10:20:32.648Z · 15651 ms


Bridge: the largest window read was 340 nodes in 1024 ms (3.01 ms per node, 5445 accessibility calls, 1 process invocation, load average 5.24 over 8 CPUs).

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


Run at 2026-09-06T10:20:50.829Z · 18551 ms


Bridge: the largest window read was 340 nodes in 1959 ms (5.76 ms per node, 5445 accessibility calls, 1 process invocation, load average 5.05 over 8 CPUs).

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

