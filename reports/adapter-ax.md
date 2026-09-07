# Desktop conformance — `ax`

Run at 2026-09-09T06:05:05.274Z on darwin arm64, Node v25.6.1.

**Not conformant.** 2 case(s) failed (REQ-SURF-3).

Bridge (LLD §7.5): the largest window read was **1019 nodes in 1393 ms — 1.37 ms per node**, 16309 accessibility calls, 1 process invocation per snapshot, at **load average 5.5 over 8 CPUs**.

No variant's window read exceeded the bridge's deadline, so nothing was retried.

## Healing (LLD §16)

| Case | Variant | Outcome |
|---|---|---|
| `app.heal.renamed-control` | 1 | failed |
| `app.heal.moved-panel` | 2 | relocalized |

## APP_DIR variant 0


Run at 2026-09-09T06:03:24.250Z · 38687 ms


Bridge: the largest window read was 1019 nodes in 1393 ms (1.37 ms per node, 16309 accessibility calls, 1 process invocation, load average 5.5 over 8 CPUs).

**Not conformant.** 1 of 10 cases failed (1 checks).

| Case | Page | Status | Checks |
|---|---|---|---|
| `app.snapshot` | `Yam` | passed | 10/10 |
| `app.project` | `Yam` | failed | 3/4 |
| `app.flow` | `Yam` | passed | 4/4 |
| `app.run` | `Yam` | passed | 6/6 |
| `app.result` | `Yam` | passed | 10/10 |
| `app.api-client` | `Yam` | passed | 4/4 |
| `app.inspector` | `Yam` | passed | 3/3 |
| `app.no-navigation` | `Yam` | passed | 2/2 |
| `app.heal.renamed-control` | `Yam` | skipped | 1/1 |
| `app.heal.moved-panel` | `Yam` | skipped | 2/2 |

## Failures

### `app.project`

Flow 1: a project is open, and every rail item of LLD §13.7 is addressable by its id.

- **the open project is named in the window**
  - expected: `the project's name or directory in the crumb`

## APP_DIR variant 1


Run at 2026-09-09T06:04:15.462Z · 12798 ms


Bridge: the largest window read was 376 nodes in 605 ms (1.61 ms per node, 6021 accessibility calls, 1 process invocation, load average 5.85 over 8 CPUs).

**Not conformant.** 1 of 10 cases failed (1 checks).

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
| `app.heal.renamed-control` | `Yam` | failed | 2/3 |
| `app.heal.moved-panel` | `Yam` | skipped | 0/0 |

## Failures

### `app.heal.renamed-control`

LLD §16 variant 1: a rail item is renamed, and a binding recorded at variant 0 relocalizes onto it.

- **"rail-flows" relocalizes at variant 1**
  - expected: `relocalized`
  - actual: `ambiguous`

## APP_DIR variant 2


Run at 2026-09-09T06:04:40.701Z · 13807 ms


Bridge: the largest window read was 376 nodes in 743 ms (1.98 ms per node, 6021 accessibility calls, 1 process invocation, load average 4.59 over 8 CPUs).

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

