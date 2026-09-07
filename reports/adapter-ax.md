# Desktop conformance — `ax`

Run at 2026-09-09T02:35:41.585Z on darwin arm64, Node v25.6.1.

**Not conformant.** 8 case(s) failed (REQ-SURF-3).

Bridge (LLD §7.5): the largest window read was **343 nodes in 635 ms — 1.85 ms per node**, 5493 accessibility calls, 1 process invocation per snapshot, at **load average 3.18 over 8 CPUs**.

No variant's window read exceeded the bridge's deadline, so nothing was retried.

## Healing (LLD §16)

| Case | Variant | Outcome |
|---|---|---|
| `app.heal.moved-panel` | 0 | failed |
| `app.heal.renamed-control` | 1 | failed |
| `app.heal.moved-panel` | 2 | failed |

## APP_DIR variant 0


Run at 2026-09-09T02:33:59.431Z · 27965 ms


Bridge: the largest window read was 343 nodes in 635 ms (1.85 ms per node, 5493 accessibility calls, 1 process invocation, load average 3.18 over 8 CPUs).

**Not conformant.** 6 of 10 cases failed (8 checks).

| Case | Page | Status | Checks |
|---|---|---|---|
| `app.snapshot` | `Yam` | failed | 8/10 |
| `app.project` | `Yam` | failed | 3/4 |
| `app.flow` | `Yam` | passed | 4/4 |
| `app.run` | `Yam` | passed | 6/6 |
| `app.result` | `Yam` | failed | 2/2 |
| `app.api-client` | `Yam` | failed | 1/4 |
| `app.inspector` | `Yam` | failed | 2/3 |
| `app.no-navigation` | `Yam` | passed | 2/2 |
| `app.heal.renamed-control` | `Yam` | skipped | 1/1 |
| `app.heal.moved-panel` | `Yam` | failed | 2/3 |

## Failures

### `app.snapshot`

The window's snapshot is the normalised shape of LLD §2.2, in the ARIA role vocabulary.

- **every interactive control has an accessible name**
  - expected: `0 unnamed buttons, links, tabs, fields or menu items`
  - actual: `["option r83"]`

- **every interactive control has an automationId**
  - expected: `0 controls with a name and no id, window chrome aside`
  - actual: `["option \"\""]`

### `app.project`

Flow 1: a project is open, and every rail item of LLD §13.7 is addressable by its id.

- **the open project is named in the window**
  - expected: `the project's name or directory in the crumb`

### `app.result`

Flow 4: the gate makes a run through the Run screen, then the Runs screen lists it.

The case threw: `AxBridgeError: osascript refused the accessibility call.`

### `app.api-client`

Flow 5: the API screen's request list and its headers are addressable.

- **the named requests are addressable**
  - expected: `a control whose automationId is "api-requests"`

- **the request's headers are on the screen**
  - expected: `a control whose automationId is "api-headers"`
  - actual: `["root","sv-portal-host","rail","workspace","inspector","topbar-crumb","open-project","project-recent-0","project-recent-1","project-recent-2","open-command-pa…`

- **Send is offered, with the accelerator the model gives it**
  - expected: `a control whose automationId is "action-api-send"`

### `app.inspector`

T10.3: the right inspector is a list of landmarks, which is what makes controlPath short.

- **a binding's resolver order is addressable**
  - expected: `a control whose automationId is "inspector-candidate-table"`
  - actual: `["root","sv-portal-host","rail","workspace","inspector","topbar-crumb","open-project","project-recent-0","project-recent-1","project-recent-2","open-command-pa…`

### `app.heal.moved-panel`

LLD §16 variant 2: the Record screen's gateway control moves into another panel, and a binding recorded at variant 0 relocalizes onto it.

- **"record-gateway" is on the palette:record screen at variant 0**
  - expected: `a combobox whose automationId is "record-gateway"`
  - actual: `[]`

## APP_DIR variant 1


Run at 2026-09-09T02:34:53.678Z · 12319 ms


Bridge: the largest window read was 343 nodes in 586 ms (1.71 ms per node, 5493 accessibility calls, 1 process invocation, load average 3.77 over 8 CPUs).

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


Run at 2026-09-09T02:35:18.276Z · 12600 ms


Bridge: the largest window read was 321 nodes in 594 ms (1.85 ms per node, 5141 accessibility calls, 1 process invocation, load average 3.28 over 8 CPUs).

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
| `app.heal.renamed-control` | `Yam` | skipped | 0/0 |
| `app.heal.moved-panel` | `Yam` | failed | 2/3 |

## Failures

### `app.heal.moved-panel`

LLD §16 variant 2: the Record screen's gateway control moves into another panel, and a binding recorded at variant 0 relocalizes onto it.

- **a binding for "record-gateway" was recorded at variant 0**
  - expected: `a fingerprint carried over from the variant-0 pass`
  - actual: `nothing was recorded — run the variant-0 pass first`

