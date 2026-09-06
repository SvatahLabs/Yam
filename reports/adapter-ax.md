# Desktop conformance — `ax`

Run at 2026-09-06T22:39:56.481Z on darwin arm64, Node v25.6.1.

**Conformant.** 10 cases passed across app variants 0, 1 and 2 (REQ-SURF-3, REQ-ADE-6).

Bridge (LLD §7.5): the largest window read was **1017 nodes in 1857 ms — 1.83 ms per node**, 16277 accessibility calls, 1 process invocation per snapshot, at **load average 4.12 over 8 CPUs**.

No variant's window read exceeded the bridge's deadline, so nothing was retried.

## Healing (LLD §16)

| Case | Variant | Outcome |
|---|---|---|
| `app.heal.renamed-control` | 1 | relocalized |
| `app.heal.moved-panel` | 2 | relocalized |

## app variant 0


Run at 2026-09-06T22:38:22.634Z · 49493 ms


Bridge: the largest window read was 1017 nodes in 1857 ms (1.83 ms per node, 16277 accessibility calls, 1 process invocation, load average 4.12 over 8 CPUs).

**Conformant.** 8 cases passed, 2 skipped, 46 checks.

| Case | Page | Status | Checks |
|---|---|---|---|
| `app.snapshot` | `Yam` | passed | 10/10 |
| `app.project` | `Yam` | passed | 4/4 |
| `app.flow` | `Yam` | passed | 4/4 |
| `app.run` | `Yam` | passed | 6/6 |
| `app.result` | `Yam` | passed | 10/10 |
| `app.api-client` | `Yam` | passed | 4/4 |
| `app.inspector` | `Yam` | passed | 3/3 |
| `app.no-navigation` | `Yam` | passed | 2/2 |
| `app.heal.renamed-control` | `Yam` | skipped | 1/1 |
| `app.heal.moved-panel` | `Yam` | skipped | 2/2 |

## app variant 1


Run at 2026-09-06T22:39:14.607Z · 19253 ms


Bridge: the largest window read was 340 nodes in 2339 ms (6.88 ms per node, 5445 accessibility calls, 1 process invocation, load average 4.19 over 8 CPUs).

**Conformant.** 1 cases passed, 9 skipped, 4 checks.

| Case | Page | Status | Checks |
|---|---|---|---|
| `app.snapshot` | `Yam` | skipped | 0/0 |
| `app.project` | `Yam` | skipped | 0/0 |
| `app.flow` | `Yam` | skipped | 0/0 |
| `app.run` | `Yam` | skipped | 0/0 |
| `app.result` | `Yam` | skipped | 0/0 |
| `app.api-client` | `Yam` | skipped | 0/0 |
| `app.inspector` | `Yam` | skipped | 0/0 |
| `app.no-navigation` | `Yam` | skipped | 0/0 |
| `app.heal.renamed-control` | `Yam` | passed | 4/4 |
| `app.heal.moved-panel` | `Yam` | skipped | 0/0 |

## app variant 2


Run at 2026-09-06T22:39:38.168Z · 17787 ms


Bridge: the largest window read was 340 nodes in 1513 ms (4.45 ms per node, 5445 accessibility calls, 1 process invocation, load average 6.26 over 8 CPUs).

**Conformant.** 1 cases passed, 9 skipped, 5 checks.

| Case | Page | Status | Checks |
|---|---|---|---|
| `app.snapshot` | `Yam` | skipped | 0/0 |
| `app.project` | `Yam` | skipped | 0/0 |
| `app.flow` | `Yam` | skipped | 0/0 |
| `app.run` | `Yam` | skipped | 0/0 |
| `app.result` | `Yam` | skipped | 0/0 |
| `app.api-client` | `Yam` | skipped | 0/0 |
| `app.inspector` | `Yam` | skipped | 0/0 |
| `app.no-navigation` | `Yam` | skipped | 0/0 |
| `app.heal.renamed-control` | `Yam` | skipped | 0/0 |
| `app.heal.moved-panel` | `Yam` | passed | 5/5 |

