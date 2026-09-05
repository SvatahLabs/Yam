# `svatah-runtime-java`

The Java conformance runtime (REQ-STD-3, [LLD §14](../../docs/spec/lld.md)).

> A foreign runtime (first: Java on Playwright for Java) executes `plan.json`
> and bindings without the TypeScript compiler and passes the runtime
> conformance suite.

It is a **conformance target, not a second product** (HLD §13, Phase 6). What it
proves is that the published artifacts — plan, bindings, data, config — are
enough to execute a flow, and that the schemas say enough for someone who never
read the TypeScript to get *identical* results.

## Running it

```bash
cd runtimes/java
./gradlew fatJar

# from the repository root
node scripts/runtime-conformance.mjs --runtime java --report reports/runtime-java.md
```

The harness compiles the fixture project's plan, checks its hash against
`evals/conformance/runtime/plan.sha256`, runs the jar against the sample
application, **validates the `results.jsonl` and `summary.json` this runtime
wrote against `stepResultSchema` and `summarySchema`**, and only then compares
every step with the committed `evals/conformance/runtime/results.jsonl`.

The validation is not a formality (Draft 2.8 §14, T7.4). The committed fixture
is a *projection* — status and matched candidate, with the run-specific fields
stripped — and Phase 6's runtime copied the projection rather than the schema:
it wrote no `startedAt`, `endedAt` or `durationMs` on any line, and was reported
conformant anyway. Since T7.4 it writes full `StepResult` and `Summary` records
and the suite refuses to call a runtime conformant whose artifacts do not
validate, whatever the comparison says. `--strip <field>` deletes a required
field from the first produced line and shows the gate failing with the file, the
line and the schema path.

Directly:

```bash
java -jar build/libs/svatah-runtime-java-0.1.0-all.jar <project> \
  --run-id my-run --base-url http://127.0.0.1:4173 \
  --flow flows/simple.flow --input email=a@b.c --input password=…
```

It needs a compiled plan at `<project>/.svatah/plan.json`
(`svatah compile <project> --stable`). It does not compile flows: that is
module (b)'s, and a foreign runtime consuming the plan is the point.

## What is compared

Per step, in plan order: the **status** and the **matched candidate** — its
index and its `by`. Nothing else. Timestamps, durations, run ids and the
reference a runtime minted for an element belong to the run rather than to the
plan.

The matched candidate is what makes the suite worth running. Two runtimes can
produce identical statuses by finding the same elements *different ways* — one
by test id, one by XPath — and that is a difference that bites the first time a
page changes.

## What it implements, and what it refuses

The conformance fixture is four migrated flows: 40 steps, ten actions
(`click`, `type`, `clear`, `selectOption`, `hoverAndClick`, `back`, `forward`,
`waitFor`, `sleep`, `api`), two predicates, one capture and one named HTTP
request.

Everything outside that **fails the step by name**:

```
the Java runtime has no "dragTo" action. A conformance runtime that skipped
what it cannot do would report a green suite and prove nothing.
```

That is the design. A conformance runtime that quietly passed over an action it
did not implement would make the comparison meaningless, and the comparison is
the only reason this exists.

Not implemented, deliberately: guards, checkpoints, resume, abort policies,
custom steps, `invoke`, the audit log, screenshots, healing, and every adapter
but Playwright. Each is either a behaviour the fixture does not exercise or a
module (b) concern.

## What was hard to get right

Three things, and each was a real failure before it was a rule:

1. **The context pattern.** `contextPattern` drops the origin and generalises
   identifier-looking path segments. One character of disagreement picks a
   different binding entry and resolves a *different element*: the run still
   passes and only the matched candidate differs, which is exactly what the
   suite compares. `ResolverTest` pins it.
2. **Story inputs.** `simple.flow`'s login story declares a signature. A runtime
   that ignored `--input` typed the empty string into the login form and then
   reported every step after it as a locator failure — which read as a runtime
   that could not find the sidebar rather than one that never logged in.
3. **The matched candidate on a failure.** A step that resolves its element and
   then fails to act on it — clicking a `<datalist>` option, which a browser
   refuses — has a `matched`. Dropping it on failure made every such step differ
   from the fixture while the status agreed.

## Why PowerShell-free, node-free, and outside the workspace

It builds with `./gradlew` from this directory and depends on nothing in the
pnpm workspace. That is the claim: a runtime written against the published
schemas, by someone with a JDK and Maven Central, produces the same results.
Its only inputs are files this repository publishes.

Dependencies are Apache-2.0 (Playwright for Java, Jackson) and the JDK's own
`java.net.http`, which keeps REQ-PKG-3 true for this tree as well.
