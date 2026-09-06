# Write a foreign runtime

The determinism layer is the standard. Its artifacts are published as JSON
Schemas, and a runtime in any language that executes `plan.json` and the
bindings and writes conformant results is a Yam runtime. The reference is
`runtimes/java`, on Playwright for Java, which passes the suite without the
TypeScript compiler anywhere in the loop.

## What you consume

`@svatah/yam-schema` ships the schemas under `json/` and the conformance fixture
under `conformance/`. A runtime is held to three of them:

| Schema | What it is |
|---|---|
| `ir.schema.json` | the step intermediate representation you execute |
| `results.schema.json` | one line per step in `results.jsonl` |
| `summary.schema.json` | `summary.json` at the end of a run |

The rest, plan, bindings, config, data, audit, checkpoints and the surface
messages, are in [the schema reference](../reference/generated/schemas/README.md).
Each schema's `$id` is under `https://yam.svatah.com/schema/1.0.0/`.

## What you implement

1. Read `plan.json`, `yam.config.yaml`, `data.yaml` and `bindings/`.
2. For each story in the run block's expansion, for each step: resolve the
   target through the bindings (candidates in order, exactly one match),
   perform the action or evaluate the predicate on your platform driver, and
   write a full `StepResult` line: status, the candidate that matched,
   `startedAt`, `endedAt`, `durationMs`, and the failure class when it failed.
3. Apply the policies: `stop`, `continue`, `compensate:<story>`, and mark the
   run `aborted` when a compensation ran.
4. Write `summary.json`.

Refuse, with a clear diagnostic, a plan that needs something you did not
implement: a custom step, an API request, a capability.

## Prove it

```bash
node scripts/runtime-conformance.mjs --runtime java --report reports/runtime-java.md
```

The harness compiles the fixture project, checks the plan's hash, runs your
runtime against the sample application, validates the artifacts you wrote
against the schemas, and only then compares every step's status and matched
candidate with the committed `evals/conformance/runtime/results.jsonl`. It
refuses to call a runtime conformant whose artifacts do not validate, whatever
the comparison says. `--strip <field>` shows that gate failing on purpose.

Add a `--runtime <name>` branch to the harness for your runtime, or run the
same three steps yourself; the fixture and the expected results are what the
package publishes.
