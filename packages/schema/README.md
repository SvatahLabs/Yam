# @svatah/yam-schema

The Yam artifact contract (REQ-STD-1): Zod definitions for everything in
LLD §3 and the agent-surface wire shapes of LLD §2, plus the JSON Schemas
generated from them.

Every artifact that crosses a process or a repository boundary is defined here
and nowhere else, so the TypeScript types, the runtime validation and the
published contract a foreign runtime reads all come from one source.

## What is in it

| Group | Shapes |
|---|---|
| Step IR | `Action`, `TargetRef`, `Predicate`, `Guard`, `Capture`, `Step`, `Signature`, `Story`, `Plan` |
| Bindings | `Candidate`, `Fingerprint`, `BindingContext`, `BindingEntry`, `BindingFile` |
| Results | `StepResult`, `Summary`, `AuditLine`, `Checkpoint`, `Invoker`, `FailureClass` |
| Surface | `Snapshot`, `SnapshotNode`, `Capabilities`, `SessionInit`, `SessionState`, `ElementDescription`, `ApiRequest`, `ApiResponse`, and the request/response envelopes |
| Config and provenance | `Config`, `Provenance`, `Proposal` |

Canonical serialisation lives here too — `canonicalJson`, `canonicalYaml`,
`canonicalHash`, `planHash`, `bindingsHash` — because `plan.json` must be
byte-stable for identical inputs (REQ-COMP-7) and the bindings store must produce
a reviewable diff rather than noise (REQ-REC-9).

## The published JSON Schemas

`pnpm --filter @svatah/yam-schema build` regenerates `json/` from the Zod
definitions, and a drift test asserts the committed files match. Consume them
directly:

```ts
import irSchema from "@svatah/yam-schema/json/ir.schema.json" with { type: "json" };
```

Each carries `$id` and `x-yam-schema-version`. `schemaVersion` is `1.0.0` and
is independent of the npm version: it is bumped on any change to the shapes in
LLD §3.

## Provenance is not optional

REQ-STD-4 rejects an artifact without it, and the schemas enforce that rather
than documenting it: a Tier 2 or Tier 3 step and a recorded binding are both
refused without a `Provenance` block. A binding a person picked interactively
records `model: "human"` — that is a real answer to "where did this come from",
and omitting the block would not be.

## Licence

Apache-2.0.
