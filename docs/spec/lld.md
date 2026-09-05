# Svatah — Low-Level Design

Status: Draft 2.1 · Date: 2026-09-02
Companion documents: [requirements.md](requirements.md) · [hld.md](hld.md) · [tasks.md](tasks.md)

Section numbers are referenced from tasks as `LLD §n`. Types are TypeScript with Zod in mind; JSON Schemas in `packages/schema` are generated from them. Draft 2 restructures Draft 1 around the three layers; §17 lists the changes.

---

## 1. Workspace and build

- pnpm workspace, TypeScript 5.x, ESM, Node 22 LTS, strict mode, `tsup` builds, `vitest` unit tests, Playwright Test for adapter and host tests.
- Import boundaries enforced by eslint `import/no-restricted-paths`:
  - `runtime`, `bindings`, `healer` (relocalize path), `adapter-*`, `surface`, `playwright-test`, `workflow`, `tool` must not import `gateway`, `recorder`, `compiler`, or `trajectory`.
  - `bindings`, `healer`, `playwright-test` must not import `spec`, `steps`, `compiler` (module (a) independence, REQ-PKG-1).
  - Nothing above `surface` may import an `adapter-*` package directly except `cli` (registration) and `playwright-test` (Playwright adapter only).
  - The lint must resolve TypeScript sources for relative imports (an `eslint-import-resolver-typescript` or equivalent) and must also cover dynamic `import()` expressions; and a repository test must assert that no package's `package.json` declares a forbidden package under `dependencies`, `devDependencies`, `peerDependencies`, or `optionalDependencies`. With pnpm's strict isolation, the dependency-graph test is the guard that holds at run time; the lint is the guard that names the rule.
- Every package exports from `src/index.ts`. One version for all packages; `schemaVersion` is separate and bumped on any contract change.

Dependency graph (arrows = depends on):

```
schema ◄── surface ◄── adapter-playwright | adapter-http | adapter-bidi | adapter-appium | adapter-uia | adapter-ax
bindings ─► surface, schema
healer ─► bindings, runtime(replay), [gateway via optional plugin interface, see §10]
runtime ─► bindings, surface, schema
playwright-test ─► runtime, bindings, adapter-playwright, healer
spec ─► schema ; steps ─► schema, surface ; compiler ─► spec, steps, schema, [gateway]
gateway ─► schema ; recorder ─► gateway, bindings, runtime, surface, schema
workflow ─► runtime ; tool ─► workflow, schema ; trajectory ─► compiler, recorder
cli ─► everything ; conformance ─► surface, runtime, schema ; migrate ─► spec, bindings
```

---

## 2. Agent surface (package `surface`)

### 2.1 Interface

```ts
interface AgentSurface {
  readonly kind: "web" | "mobile" | "desktop" | "http";
  capabilities(): Capabilities;                       // which optional features exist
  open(session: SessionInit): Promise<void>;          // storageState | appPath | processName | baseUrl
  close(): Promise<void>;

  snapshot(opts?: { root?: Ref; maxNodes?: number; interactiveOnly?: boolean }): Promise<Snapshot>;
  act(action: SurfaceAction, ref?: Ref, args?: ActArgs, ref2?: Ref): Promise<ActResult>;
  read(kind: "text" | "value" | "attribute" | "title" | "url" | "result", ref?: Ref, name?: string): Promise<unknown>;
  check(predicate: Predicate, subject: "ref" | "page" | "dialog", ref?: Ref): Promise<CheckResult>;

  locate(c: Candidate): Promise<Ref[]>;               // candidate → refs (0, 1, or many); used by resolver
  describe(ref: Ref): Promise<ElementDescription>;    // for synthesis and fingerprint
  screenshot(path: string, mask?: Ref[]): Promise<void>;
  state(): Promise<SessionState>;                     // url/window/frame/dialog; restorable subset for checkpoints
  restore(state: SessionState): Promise<void>;
  trace?(start: boolean, path?: string): Promise<void>;
  request?(req: ApiRequest, opts: { withSessionCookies: boolean }): Promise<ApiResponse>;  // http-capable adapters
}
```

### 2.2 Snapshot shape (normalised across adapters)

```ts
interface Snapshot { ref: Ref; nodes: SnapshotNode[]; text: string; tokensEstimate: number; hash: string; }
interface SnapshotNode {
  ref: Ref;                     // stable within the snapshot; adapters map to native handles
  role: string;                 // ARIA role vocabulary; adapters map UIA ControlType / AX role / Appium class onto it
  name?: string; value?: string; description?: string;
  states: Array<"disabled" | "checked" | "unchecked" | "selected" | "expanded" | "collapsed" | "focused" | "required" | "hidden" | "readonly">;
  box?: [number, number, number, number];
  depth: number; parent?: Ref;
  native?: Record<string, string>;   // adapter-specific extras (automationId, resource-id, testid), never used above surface except by synthesis
}
type Ref = string;               // "r12" style; opaque above the surface
```

`text` is the YAML-like rendering used in prompts (same layout as Playwright's ARIA snapshot with `[ref=…]` annotations). `hash` is the structural hash defined in §6.2.

### 2.3 Surface actions and predicates

`SurfaceAction` is the IR `Action` set minus `api`, `custom`, and `expect` (those are executor concerns). `Predicate` is the IR predicate set (§3.2). Adapters throw typed errors: `LocateError`, `ActionabilityError`, `TimeoutError`, `DialogError`, `NavigationError`, `ScriptError`, `SessionError`; the executor maps them to failure classes (§8.4).

### 2.4 Registry and capabilities

`registerAdapter(name, factory)`; `createSurface(config)` picks by `config.adapter` (`playwright|bidi|appium|uia|ax|http`). `Capabilities` lists optional features: `dialogs`, `frames`, `windows`, `upload`, `drag`, `trace`, `webmcp`, `screenshot`, `restore`. The executor refuses a plan whose actions need a missing capability at start, not mid-run.

### 2.5 Surface message schemas

`surface.snapshot.schema.json`, `surface.act.schema.json`, `surface.check.schema.json` are generated so foreign adapters and the MCP raw-surface tools share one wire shape (REQ-SURF-1).

---

## 3. Schemas (package `schema`)

### 3.1 Value references

```ts
type ValueRef =
  | { kind: "literal"; value: string }
  | { kind: "var"; story?: string; name: string }
  | { kind: "data"; path: string; secret?: boolean }
  | { kind: "input"; name: string }
  | { kind: "template"; parts: ValueRef[] };
```

### 3.2 Step IR

```ts
type Action =
  | "navigate" | "back" | "forward" | "refresh"
  | "click" | "doubleClick" | "rightClick" | "hover" | "hoverAndClick" | "pressAndHold" | "release" | "dragTo"
  | "type" | "clear" | "press" | "keyDown" | "keyUp" | "submit" | "upload"
  | "selectOption" | "deselectOption" | "deselectAll" | "setChecked"
  | "scrollIntoView" | "scrollToTop" | "scrollToBottom"
  | "sleep" | "waitFor"
  | "switchWindow" | "closeOtherWindows" | "switchFrame"
  | "dialog"
  | "read" | "expect" | "evaluate" | "screenshot"
  | "api" | "custom" | "invoke";            // invoke = call another story as a function (workflow behavior)

interface TargetRef { ref: string; phrase: string; status: "bound" | "unbound" | "ambiguous"; scope?: "page" | "dialog" | "frame" | "desktop" | "window"; }

type Predicate =
  | { kind: "visible" | "hidden" | "enabled" | "disabled" | "checked" | "unchecked" | "selected" | "present" | "absent" | "multiSelect"; negate?: boolean }
  | { kind: "text" | "textContains" | "value" | "title" | "titleContains" | "url" | "urlContains" | "tag"; value: ValueRef; negate?: boolean }
  | { kind: "attribute" | "css"; name: string; value: ValueRef; negate?: boolean }
  | { kind: "location" | "size" | "box"; numbers: number[] }
  | { kind: "expr"; left: ValueRef; op: "eq" | "ne" | "gt" | "lt" | "matches"; right: ValueRef };   // for guards over scope values

interface Step {
  id: string; storyName: string; line: number; text: string;
  action: Action;
  target?: TargetRef; target2?: TargetRef;
  args?: Record<string, ValueRef | number | string | boolean>;
  guard?: { subject: "target" | "page" | "dialog" | "scope"; predicate: Predicate; mode: "onlyIf" | "unless" };
  expect?: { subject: "target" | "page" | "dialog" | "scope"; predicate: Predicate };
  capture?: { name: string; from: "text" | "value" | "attribute" | "title" | "result" | "response" | "output"; attribute?: string; jsonPath?: string };
  custom?: { id: string; params: Record<string, ValueRef>; targets?: Record<string, TargetRef> };   // action === "custom"; `target` placeholders land in `targets`, never in `params`
  invoke?: { story: string; inputs: Record<string, ValueRef> };      // action === "invoke"
  sideEffect?: boolean;                                              // set by lint heuristics or declared in custom step
  timeoutMs: number;
  origin: { tier: 0 | 1 | 2 | 3; rule?: string; confidence: number; provenance?: Provenance };
}

interface Signature { inputs: Record<string, { type: "string" | "number" | "boolean" | "json" | "secret"; default?: unknown; description?: string }>;
                      outputs: Record<string, { type: "string" | "number" | "boolean" | "json"; description?: string }>; }

interface Story { name: string; kind: "story" | "scenario"; file: string; meta: StoryMeta; signature?: Signature; steps: Step[]; }
interface StoryMeta { enabled: boolean; dataProvider?: string; filePath?: string; onFailure: "stop" | "continue" | { compensate: string }; idempotent?: boolean; tags: string[]; }
interface Plan { schemaVersion: string; generatedAt: string; project: string; stories: Story[]; compositions: Record<string,string[]>;
                 runs: Record<string, string[]>; targets: Record<string, { phrases: string[] }>; apis: string[]; customSteps: string[]; hash: string; }
```

### 3.3 Bindings

```ts
interface Candidate {
  by: "role" | "label" | "placeholder" | "testid" | "text" | "altText" | "title" | "css" | "xpath" | "id" | "name"
    | "accessibilityId" | "resourceId"                         // mobile
    | "automationId" | "controlPath"                            // desktop (UIA/AX): controlPath = "Window[name]/Pane[2]/Button[name]"
    | "webmcp"                                                  // { tool: string; paramMap: Record<string,string> }
    | "coords";
  role?: string; name?: string; exact?: boolean; value?: string; attribute?: string; nth?: number;
  tool?: string; paramMap?: Record<string, string>;
  score: number;
}
interface Fingerprint { tag: string; attrs: Record<string,string>; text: string; neighbours: { before: string[]; after: string[] };
                        rolePath: string[]; box: [number,number,number,number]; index: number; }
interface BindingEntry { context: { pattern: string; hash: string; viewport?: [number,number]; platform: "web" | "mobile" | "desktop" };
                         candidates: Candidate[]; fingerprint: Fingerprint; recordedAt: string; provenance: Provenance; verified: boolean;
                         previous?: { fingerprint: Fingerprint; provenance: Provenance }[]; }
interface BindingFile { schemaVersion: string; id: string; phrases: string[]; entries: BindingEntry[]; }
```

### 3.4 Results, audit, checkpoints

```ts
type FailureClass = "locator" | "timeout" | "assertion" | "guard" | "data" | "navigation" | "dialog" | "script" | "infrastructure" | "unknown";
interface StepResult { runId: string; behavior: "test" | "workflow" | "tool"; flow: string; story: string; stepId: string; line: number; text: string;
                       status: "passed" | "failed" | "skipped" | "healed" | "aborted"; startedAt: string; endedAt: string; durationMs: number;
                       matched?: { ref: string; candidateIndex: number; by: Candidate["by"] }; captured?: Record<string, unknown>;
                       failure?: { class: FailureClass; message: string; candidatesTried?: Candidate[]; screenshot?: string; stack?: string; policyApplied?: StoryMeta["onFailure"] }; }
interface Summary { runId: string; behavior: string; planHash: string; bindingsHash: string; configHash: string; invoker: Invoker; startedAt: string; endedAt: string;
                    flows: Record<string, { status: "passed" | "failed" | "healed" | "aborted"; passed: number; failed: number; skipped: number; trace?: string }>;
                    outputs?: Record<string, unknown>; totals: { passed: number; failed: number; skipped: number; healed: number; aborted: number }; exitCode: number; }
interface Invoker { kind: "user" | "ci" | "agent"; id: string; via: "cli" | "mcp" | "host" }
interface AuditLine { runId: string; at: string; seq: number; kind: "run" | "story" | "surface" | "input" | "output" | "policy";
                      story?: string; stepId?: string; call?: { method: string; action?: string; ref?: string; args?: unknown /*redacted*/ };
                      outcome?: "ok" | "error"; error?: string; durationMs?: number; detail?: unknown /*redacted*/; }
interface Checkpoint { runId: string; flow: string; story: string; stepId: string; at: string; planHash: string; bindingsHash: string;
                       scope: { data: never /*not stored*/; inputs: Record<string, unknown>; captures: Record<string, Record<string, unknown>> };
                       session: SessionState; }
```

### 3.5 Provenance and config

```ts
interface Provenance { model: string; digest?: string; promptVersion: string; at: string; tokensIn: number; tokensOut: number; cacheRead?: number; costUsd?: number; }
interface Config {
  schemaVersion: string; project: string;
  environment: "test" | "staging" | "production"; allowSideEffects?: boolean;
  adapter: "playwright" | "bidi" | "appium" | "uia" | "ax" | "http";
  app: { baseUrl?: string; storageState?: string; appPath?: string; processName?: string };
  flows: { dir: string; include?: string[]; exclude?: string[] }; steps: { dir: string };
  bindings: { dir: string; testIdAttributes: string[] }; data: { file: string }; api: { dir: string };
  run: { workers: number; browser?: "chromium" | "firefox" | "webkit"; headless: boolean; viewport?: [number,number]; stepTimeoutMs: number; candidateTimeoutMs: number;
         screenshots: "onFailure" | "always" | "never"; trace: boolean; outputDir: string; checkpoints: boolean; audit: boolean };
  compile: { tier2?: { provider: "ollama" | "llamacpp"; endpoint: string; model: string; digest?: string }; tier3?: { provider: "anthropic"; model: string; promptVersion: string }; confidenceThreshold: number };
  record: { model: string; maxSnapshotTokens: number; visionFallback: boolean };
  heal: { onFail: boolean; relocalizeThreshold: number; margin: number; useModel: boolean };
  tool?: { expose: string[]; requireIdempotent: boolean };
  mobile?: { appium: string; capabilities: Record<string, unknown> };
  prices?: Record<string, { in: number; out: number; cacheRead?: number }>; macros?: Record<string, string>;
}
```

---

## 4. Flow language (package `spec`)

### 4.1 File grammar

```
File     := (Blank | Comment | Block)*
Block    := Header NEWLINE SigLine* (StepLine | GuardLine | Comment)* (Blank | EOF)
Header   := Kind Meta? ':' Name          Kind := 'story' | 'scenario' | 'compose' | 'test' | 'run'
Meta     := '(' KV (',' KV)* ')'         keys: enabled, dataProvider, filePath, continueOnFailure, onFailure, idempotent, tags
SigLine  := ('inputs:' | 'outputs:') (Param (',' Param)*)      Param := Name ':' Type ('=' Default)?
GuardLine:= ('Only if' | 'Unless') Predicate                    applies to the next StepLine
StepLine := ('Only if' Predicate ',' | 'Unless' Predicate ',')? Sentence
Comment  := ('//' | '#') any
```

`onFailure` values: `stop`, `continue`, `compensate:<story name>`. `continueOnFailure=true` is an alias of `onFailure=continue`.

### 4.2 Sentence patterns (Tier 1)

Patterns 1–26 are unchanged from Draft 1 and listed in `docs/flow-language.md`. Additions:

| # | Pattern | IR |
|---|---|---|
| 27 | `Run the "Story name" story [with a={x}, b="y"] [and remember <output> as name]` | `invoke` |
| 28 | `Only if <predicate>, <sentence>` / `Unless <predicate>, <sentence>` / standalone guard line | `guard` on the step |
| 29 | Scope predicates for guards: `{name} is "x"`, `{name} is not empty`, `{name} is greater than 3`, `{name} matches "regex"` | `expr` predicate |
| 30 | `Use the "tool name" site tool [with a={x}]` | `act` with a `webmcp` candidate preference (P2) |

### 4.3 Target dictionary and synonym vocabulary

Unchanged from Draft 1 (§2.3, §2.4 there): normalisation rules, element id generation, ambiguity as `W_AMBIGUOUS_TARGET`, `actions.yaml` ported from `ActionSynonyms.java`.

---

## 5. Custom typed steps (package `steps`, Tier 0)

```ts
import { defineStep, t } from "@svatah/flow";
export default defineStep(
  "Transfer {amount:number} from {from:target} to {to:target}",
  { sideEffect: true, description: "Moves funds between two accounts" },
  async ({ surface, resolve, args, scope, expect }) => {
     const from = await resolve(args.from); const to = await resolve(args.to);
     await surface.act("click", from); await surface.act("type", to, { value: String(args.amount) });
     await expect(to, { kind: "value", value: { kind: "literal", value: String(args.amount) } });
  });
```

- Template placeholders: `{name:string|number|boolean|target|value}`; `target` placeholders become `TargetRef`s that the recorder grounds like any other; `value` accepts quoted literals and variable references.
- Matching: templates compile to regexes with typed captures; matched before Tier 1; a sentence matching both a template and a grammar pattern is `E_STEP_AMBIGUOUS` (REQ-LANG-16).
- IR: `action: "custom"`, `custom.id` = file path plus export name, `custom.params` holds the `string|number|boolean|value` placeholders as ValueRefs, `custom.targets` holds the `target` placeholders as TargetRefs (so the recorder grounds them and the resolver resolves them exactly like `step.target`), `sideEffect` from the definition. A `target` placeholder must never be encoded as a literal in `params`.
- Execution: the executor loads `steps/` at start (module (b) only) and calls the handler with a `StepContext` that exposes only the surface, resolver, scope, expectation helper, and audit; direct adapter access is not exposed.
- Provenance: none (human-authored); lint records `W_CUSTOM` for visibility.

---

## 6. Bindings store, resolver, relocalization (package `bindings`)

### 6.1 Layout and IO

Unchanged from Draft 1: `bindings/<app>/<page>/<element>.yaml`, canonical YAML, dictionary, hash.

### 6.2 Context hash

Computed from the surface snapshot rather than the DOM so it is adapter-neutral: take the nearest ancestor with a landmark, `form`, `dialog`, or `window` role (fallback `main`, then root); render its subtree with names replaced by length buckets (`0, 1-8, 9-32, 33+`); sha256.

### 6.3 Resolver

```
resolve(target, surface, entries, opts):
  entry = entries matching (platform, pattern) first, else first
  if surface.capabilities().webmcp and entry has a webmcp candidate and the tool is currently declared → return { webmcp }
  for c in entry.candidates: refs = surface.locate(c) within candidateTimeoutMs
     if refs.length == 1 → return { ref, candidateIndex, by }
     if refs.length > 1 and c.nth != null → return refs[c.nth]
  throw LocatorError({ id, tried: candidates, state: await surface.state(), contextDrift: hash(snapshot) != entry.context.hash })
```

### 6.4 Relocalization (no model)

Unchanged scoring from Draft 1 (`0.30·attrJaccard + 0.25·textSim + 0.20·neighbourSim + 0.15·rolePathSim + 0.10·boxProximity`, threshold `heal.relocalizeThreshold` default 0.72, margin `heal.margin` default 0.10), operating on `surface.describe()` output so it works on any adapter.

### 6.5 Public API for plain host tests (module (a))

```ts
// in a Playwright test
import { test } from "@svatah/bindings/playwright";
test("login", async ({ page, bind }) => {
  await page.goto("/login");
  await (await bind("login.username-field", "the username field")).fill("user");   // phrase optional after first record
  await (await bind("login.sign-in-button")).click();
});
```

- `bind(id, phrase?)` returns a Playwright `Locator`. Run mode (`SVATAH_MODE=run`, default): resolver over the store; no model; failure raises `LocatorError` with candidates tried and writes a healer-consumable result line.
- Record mode (`SVATAH_MODE=record`): if the id is unbound in the current context, calls the recorder's `ground()` (module (b) plugin, §9.2) if installed; otherwise opens an interactive picker in headed mode (click the element) and synthesises the binding with `provenance.model: "human"`. Module (a) alone therefore records without any model.
- Heal mode (`SVATAH_MODE=heal`): on `LocatorError`, runs relocalization inline, re-tries once, marks the test annotation `healed`, and stages a diff.

---

## 7. Adapters

### 7.1 Playwright adapter (`adapter-playwright`)

- One `BrowserContext` per session; `storageState` from config; page tracking for `switchWindow`; dialog queue; active frame; tracing to `traces/<flow>.zip`.
- `snapshot()`: Playwright's ref-producing ARIA snapshot (the mechanism Playwright MCP uses) isolated in `snapshot.ts`; fallback to `locator("body").ariaSnapshot()` plus own refs assigned in document order over interactive elements. `native` carries `data-testid`-style attributes for synthesis.
- `locate(c)`: candidate → locator table (Draft 1 §7.3) plus `webmcp` (returns a synthetic ref when the tool is declared via `navigator.modelContext`).
- Action mapping: Draft 1 §7.5 unchanged. `restore(state)`: `goto(url)`, re-apply storage state.

### 7.2 HTTP adapter (`adapter-http`)

Unchanged from Draft 1 §7.6: `ApiRequest` YAML mirrors the Java builder; templating; response object; JSON-path capture; `withSessionCookies` pulls cookies from a paired web session through the executor.

### 7.3 BiDi adapter (`adapter-bidi`)

- Thin WebDriver BiDi client (WebSocket, `session.new`, `browsingContext.*`, `script.*`, `input.*`, `network.*` as needed) against stock Chrome, Edge, Firefox.
- Actionability: implemented in the adapter: wait for `visible && enabled && stable(box unchanged over two frames)` before `act`, with the configured timeout.
- `snapshot()`: injected script computing roles and names from the DOM (a port of the accessible-name algorithm used by the Playwright fallback) and assigning refs; same shape as §2.2.
- Purpose: independence proof; passes the conformance suite (§14). Not the default.

### 7.4 Appium adapter (`adapter-appium`)

WebdriverIO client; webview contexts use web candidate kinds; native contexts use `accessibilityId`, `resourceId`, `xpath`; `snapshot()` converts page source (`class` → role map, `content-desc`/`text` → name, `bounds` → box).

### 7.5 Desktop adapters (`adapter-uia`, `adapter-ax`)

- UIA: Node binding over the UI Automation COM API (or a wrapped driver with the same surface); `ControlType` → role map; `AutomationId` → `automationId` candidate; `controlPath` built from ancestor chain with names and sibling indices; `act` via UIA patterns (Invoke, Value, Toggle, Selection, Scroll) with a mouse/keyboard fallback at the element's box centre.
- AX: `AXUIElement` via a small native module; `AXRole` → role map; `AXIdentifier` → `automationId`; actions via `AXPress`, `AXSetValue`, keyboard events; documents the accessibility permission prompt and provides a `svatah surface doctor` check.
- Both: `state()` returns the focused window and title; `restore` activates the window; screenshots via OS APIs; masks by box.
- Electron targets (including the ADE): Chromium exposes the renderer's accessibility tree through UIA and AX only when accessibility support is enabled; the ADE calls `app.setAccessibilitySupportEnabled(true)` when launched with `SVATAH_A11Y=1` (or always in development builds). Web content nodes then appear with ARIA roles, which map one to one onto the surface role vocabulary. `automationId` is populated from `id` attributes on Windows and from `aria-label` or `AXIdentifier` on macOS; `controlPath` starts at the top-level window title.

---

## 8. Runtime executor (package `runtime`)

### 8.1 Orchestration

```
run(config, plan, bindings, data, opts: { behavior, flows?, stories?, inputs?, invoker, resume? }):
  runId = ulid(); write summary skeleton; audit(kind:"run", invoker, inputs redacted)
  order = expandCompositions(plan)               // identical to ExecutionController.executeFlow
  pool(config.run.workers).map(flows, runFlow)
  summary; exit code (non-zero on failed | healed | aborted)
runFlow(flow):
  surface = createSurface(config); await surface.open(session)
  scope = new Scope(data)
  if resume: load checkpoint; verify hashes; scope.restore; surface.restore(session); start from stepId
  for story in order[flow]: runStory(story)
  surface.close()
runStory(story, inputs?):
  validate inputs against story.signature; scope.enterStory(story, inputs)
  for step in story.steps:
     if flowState.stopped → record skipped; continue
     r = runStep(step)
     if r.failed → applyPolicy(story.meta.onFailure)
  outputs = scope.collectOutputs(story.signature); audit(kind:"output")
```

### 8.2 Step execution

```
runStep(step):
  args = scope.resolve(step.args)
  if step.guard: g = evalPredicate(step.guard); if (mode=onlyIf && !g) || (mode=unless && g) → status "skipped" with reason "guard"; return   // never acts
  target = step.target ? resolver.resolve(step.target, surface, bindings.entries(step.target.ref)) : undefined
  switch step.action:
     "read"    → v = surface.read(...); scope.capture(name, v)
     "expect"  → r = surface.check(...); fail(assertion) if !r.ok
     "api"     → resp = http.request(...); capture jsonPath
     "custom"  → steps.invoke(step.custom, ctx)
     "invoke"  → sub = runStory(plan.story(step.invoke.story), resolvedInputs); capture outputs
     default   → surface.act(step.action, target.ref, args, target2?.ref)
  checkpoint(step) if config.run.checkpoints
  audit(kind:"surface", …) for every surface call (wrapped proxy)
```

### 8.3 Policies

`applyPolicy(onFailure)`: `stop` → flow stopped, remaining `skipped`; `continue` → story stopped, next story runs; `{compensate}` → run the named story with the current scope, record its steps with `behavior` unchanged, then stop the flow. Every applied policy writes an audit line `kind:"policy"` and sets `failure.policyApplied` on the failing step. Status of steps skipped due to a guard is `skipped` with `failure.class: "guard"` only when the guard itself errored (for example an unresolved reference); a clean guard skip has no failure.

### 8.4 Failure classification

`LocateError`→`locator`, `TimeoutError`→`timeout`, `CheckError`→`assertion`, guard evaluation error→`guard`, `DataError`/type validation→`data`, `NavigationError`→`navigation`, `DialogError`→`dialog`, `ScriptError`→`script`, `SessionError`/process crash→`infrastructure`, else `unknown`.

### 8.5 Scope

`Scope { data (readonly), inputs (per story), captures (per story) }`; `{name}` → current story captures, then inputs; `{Story.name}` → that story's captures; `{data.path}`; `{input.name}`. Captures never overwrite (`E_VAR_REDEFINED` at compile; `DataError` at run if a custom step attempts it).

### 8.6 Results, audit, checkpoints

`results.jsonl` per flow merged in order; `audit.jsonl` with monotonically increasing `seq`; `checkpoints/<stepId>.json` written atomically; `summary.json` at the end with `outputs` for workflow and tool behaviors.

---

## 9. Playwright Test host (package `playwright-test`)

### 9.1 Generated specs

`svatah host generate` (also run implicitly by `svatah run --host playwright`) writes `.svatah/specs/<flow>.spec.ts`:

```ts
import { test } from "@svatah/playwright-test";
test.describe("simple.flow", () => {
  test("Validate login", async ({ svatah }) => { await svatah.runStory("Validate login"); });
  test("Validate logout", async ({ svatah }) => { await svatah.runStory("Validate logout"); });
});
```

- The `svatah` fixture (worker-scoped) creates the Playwright adapter over the test's `context`, loads plan and bindings, and owns the scope for the flow so captures cross stories inside the same worker. `test.describe.configure({ mode: "serial" })` keeps story order; flows map to Playwright projects or files for sharding.
- Failures surface as Playwright assertions with the Svatah failure class in the message and `test.info().annotations`; results are additionally written in the Svatah schema by a reporter (`@svatah/playwright-test/reporter`).
- Retries: disabled by default; enabled only if the flow's policy is `continue` or the story is `idempotent`.

### 9.2 `bind()` fixture

Provided by the same package for plain tests (§6.5). The two fixtures share the adapter and store.

---

## 10. Model gateway (package `gateway`) and healer plugin interface

Gateway unchanged from Draft 1 §5 (Anthropic and local backends, schema-constrained output, caching, redaction, provenance, cost).

Because `healer` is part of module (a) and must not depend on `gateway`, the model re-grounding step is a plugin: `healer` defines `interface Regrounder { ground(step, surface): Promise<BindingEntry | null> }`; module (b) registers the recorder's implementation at CLI start; module (a) alone runs relocalization only and reports the rest as unrepaired.

---

## 11. Recorder (package `recorder`)

Session loop and report unchanged from Draft 1 §9. Grounding (§9.2 there) now takes `surface.snapshot()` text with refs, so it is adapter-neutral; `describe(ref)` feeds synthesis. Additional responsibilities:

- Implements `Regrounder` for the healer and the `bind()` record mode.
- Refuses to run when `config.environment === "production"` unless `--force-production` (REQ-AUTO-7).
- For `custom` steps with `target` placeholders, grounds those targets exactly like grammar steps.

---

## 12. Healer (package `healer`)

Algorithm unchanged from Draft 1 §10 with two changes: the model step goes through the `Regrounder` plugin (§10), and input comes either from a Svatah run directory or from the `bind()` failure lines written by host tests (`.svatah/bind-failures.jsonl`), so module (a) users heal without flows.

---

## 13. Behaviors

### 13.1 Test

Plan run with expectations; web through the Playwright Test host (§9), other adapters through the standalone runtime. Exit code semantics as §8.1.

### 13.2 Workflow (package `workflow`)

`runWorkflow(storyName, inputs, opts)`: builds a one-story run with `behavior: "workflow"`, validates inputs, enables checkpoints and audit, applies policies, returns `{ outputs, summary, runId }`. CLI: `svatah workflow run "Book a slot" --input date=2026-09-03 --input user={data.user}` prints outputs as JSON. `--resume <runId> --from <stepId>` supported.

### 13.3 Tool (package `tool`)

`svatah tool serve --expose "Book a slot,Cancel booking"`: an MCP server whose tools are derived from story signatures (`inputSchema` from `inputs`, description from meta or the first comment line). Each call runs `runWorkflow` with `invoker: { kind: "agent", id: <mcp client id>, via: "mcp" }`, returns `outputs` plus `runId`, and never touches a model. Refuses to expose non-idempotent stories when `tool.requireIdempotent` (default true in `production`).

### 13.4 Trajectory compile (package `trajectory`, P2)

- Capture: the MCP raw-surface tools (`surface.snapshot|act|read|check`) require an `intent` string per call; the CLI writes `trajectory.jsonl` lines `{ seq, intent, call, snapshotHash, ref, describe }`.
- Compile: group calls into steps by intent; map `act` kinds to IR actions; the intent becomes the sentence after normalisation through the synonym vocabulary; targets get element ids from `describe`; candidates and fingerprints are synthesised at capture time (no model); a story draft, plan fragment, and `verified: false` bindings go to `proposals/<date>/`. A Tier 1 compile of the draft must succeed or the step is emitted as a comment with `// review:`.

---

### 13.5 Local service (package `service`)

`svatah serve --project <dir> --port <p> [--token <t>]` starts a Fastify server bound to `127.0.0.1` with a bearer token printed on stdout (the ADE reads it from the child process). Every handler calls the same functions the CLI calls; no logic lives in the service.

| Method and path | Purpose | Body / response |
|---|---|---|
| `GET /project` | Config, flows list, stories, compositions, run blocks, API names | `ProjectSummary` |
| `GET /flows/:file` · `PUT /flows/:file` | Read and write a flow file | text |
| `POST /compile` | Compile and lint | `{ plan: PlanRef, errors, warnings }` |
| `POST /record` | Start a recording session | `{ stories?, rebind?, headed? }` → `{ sessionId }`; events on the stream |
| `POST /run` | Start a run | `{ behavior, flows?, stories?, inputs?, host?, workers? }` → `{ runId }`; events on the stream |
| `POST /runs/:id/stop` | Stop a run or session | |
| `GET /runs` · `GET /runs/:id` · `GET /runs/:id/results` · `GET /runs/:id/audit` | Summaries, results, audit | schema objects |
| `GET /runs/:id/screenshots/:name` · `GET /runs/:id/trace/:flow` | Artifacts | binary |
| `GET /bindings` · `GET /bindings/:id` · `POST /bindings/verify` | Store read and dry-resolve | `BindingFile` |
| `POST /heal` | Start healing for a run | `{ runId, useModel? }` → `{ healId }`; diff and report on completion |
| `POST /api/request` | API client: execute an `ApiRequest` ad hoc | `ApiResponse` |
| `GET /api` · `PUT /api/:name` | Named requests | `ApiRequest` |
| `GET /data` · `PUT /data` | `data.yaml` with secrets redacted on read | |
| `POST /surface/:sessionId/snapshot|act|read|check` | Raw surface for the ADE's picker and for agents | surface wire schemas |
| `GET /events` (WebSocket) or `GET /events/sse` | Stream: `step.result`, `record.decision`, `record.candidates`, `heal.proposal`, `run.summary`, `log` | JSON lines |

The service publishes an OpenAPI description at `GET /openapi.json`, from which the ADE's typed client is generated; the event stream's message types are the schema package's `ServiceEvent` union.

Prototype database import (`svatah migrate --from-ade <path>`, P2) maps the prototype's electron-db records: `project` → `svatah.config.yaml` (name, browser, threadCount → workers, url → baseUrl, takeStepScreenshot → screenshots), `flows` → `flows/<filename>` then v2→v3 migration, `project.locatorFile` JSON → `.locator` → seed bindings, `config.dataFile` JSON → `data.yaml`, `apirequests` → `api/<name>.yaml`. Results and images are not imported.

### 13.6 ADE client structure (separate repository)

- Electron current LTS, Electron Forge with the Vite plus TypeScript template; `main/` (window, service process lifecycle, project chooser, accessibility flag), `preload/` (typed bridge exposing only `openProject`, `serviceInfo`, `pickFile`, `preferences`), `renderer/` (React; a generated service client; screens listed below). The renderer never has Node access; every capability comes from the service or the bridge.
- Service lifecycle: on project open, locate the bundled CLI (or a configured one), spawn `svatah serve --project <dir> --port 0`, read port and token from stdout, health-check `GET /project`, and stop it on project close or app quit. If a service is already running for the directory (lock file with port and token), connect instead.
- Screens and the endpoints and events they render: Project (`GET /project`, `init`); Flow editor (`GET/PUT /flows/:file`, `POST /compile` for inline lint, custom step list from `GET /project`); Plan (`POST /compile` result per story: step, tier, confidence, target status); Run (`POST /run`, `step.result` and `run.summary` events, screenshots by URL, `GET /runs/:id/audit`); Results (`GET /runs`); API client (`POST /api/request`, `GET/PUT /api/:name`); Data (`GET/PUT /data`); Record review (`POST /record`, `record.decision` and `record.candidates` events, `POST /surface/:session/snapshot` for re-pick); Bindings (`GET /bindings`, `POST /bindings/verify`); Heal review (`POST /heal`, `heal.proposal` event, apply through `PUT` of the diff); Surface explorer (`POST /surface/:session/*` with `intent`); Tool panel (`tool serve` control and audit lines).
- Accessibility for the desktop adapters: `app.setAccessibilitySupportEnabled(true)` when launched with `SVATAH_A11Y=1` or in development builds; every interactive control has a role and an accessible name; screen containers carry landmark roles so `controlPath` candidates are short and stable.
- Storage: preferences (theme, recent projects, window state) in the app's user-data directory; nothing else.

## 14. Conformance suites (package `conformance`)

- Surface suite: for each sample app page, a script of surface calls with expected snapshot invariants (roles present, names, states), expected `act` effects (URL change, value change, dialog appears), and error types. Runs against any adapter via `svatah surface conform --adapter <name>`.
- Runtime suite: plans plus bindings plus expected `results.jsonl` (status and matched `by`) generated by the TS runtime on the sample app; a foreign runtime passes when statuses and matched candidates are identical.

---

## 15. CLI and MCP (package `cli`)

| Command | Options | Exit |
|---|---|---|
| `compile`, `lint` | `--stable`, `--tier2`, `--tier3`, `--allow-model-drift` | 0 / 2 errors / 3 model unavailable |
| `record` | `--story`, `--flow`, `--rebind`, `--headed`, `--force-production` | 0 / 4 grounding failed / 5 expectation failed / 10 refused (environment) |
| `run` | `--behavior test|workflow`, `--host playwright|none`, `--flow`, `--story`, `--workers`, `--headed`, `--dry-resolve`, `--heal-on-fail`, `--resume`, `--from`, `--input k=v` | 0 / 1 failed / 6 healed / 11 aborted / 12 hash mismatch on resume |
| `heal` | `--run <id>`, `--from-bind-failures`, `--apply`, `--no-model` | 0 / 7 some unrepaired |
| `bindings` | `list`, `show <id>`, `verify` (dry-resolve all), `prune` | 0 / 1 |
| `workflow run <story>` | `--input`, `--resume`, `--from` | as `run` |
| `tool serve` | `--expose`, `--stdio|--http` | daemon |
| `surface` | `snapshot`, `act`, `read`, `check`, `conform --adapter` | 0 / 1 |
| `host generate` | `--out` | 0 |
| `migrate <src> <dest>` | `--keep-original` | 0 / 8 unmapped |
| `repl`, `eval`, `init`, `doctor` | | |

MCP server (`svatah mcp`): operation tools (`compile`, `lint`, `record`, `run`, `heal`, `bindings`, `results`, `workflow`) plus raw surface tools (`surface_snapshot`, `surface_act`, `surface_read`, `surface_check`, each with a required `intent` parameter for trajectory capture).

---

## 16. Sample applications, evals, tests

- `apps/sample-web`: as Draft 1 §13 with variants 1..20, plus a WebMCP-declaring page (P2) and a page with a canvas-only control for the vision fallback.
- Desktop conformance target (P2): the Svatah ADE itself, built from its repository in CI on Windows and macOS runners and launched with `SVATAH_A11Y=1`. The desktop conformance flows are: create a project, open a flow, run it, open the result, use the API client. No separate sample desktop app is built.
- Evals: `compiler/golden.jsonl` (≥300), `grounding/cases` (≥150), `healing/variants.json` (≥20), `conformance/` (surface and runtime). `svatah eval <suite> --report <path>` writes a Markdown report that the release workflow attaches to release notes (REQ-PKG-4).
- Unit and integration tests per package as Draft 1 §14, plus: surface conformance for every adapter; `bind()` record, run, and heal modes; host-generated specs run under Playwright Test with sharding; policy matrix (`stop`, `continue`, `compensate`); checkpoint and resume with hash mismatch; audit redaction; tool server end to end over MCP; trajectory compile of a captured session.

---

## 17. Changes from Draft 1

- Draft 2.2 (after Phase 0 verification): `Step.custom.targets` for Tier 0 `target` placeholders (§3.2, §5); import boundaries must resolve TypeScript sources, cover dynamic imports, and be backed by a package.json dependency-graph test (§1).
- `Driver` replaced by the published `AgentSurface` (§2) with normalised snapshots, `locate`, `describe`, `state`/`restore`, capabilities, and wire schemas.
- Packages regrouped by layer and by module (a)/(b)/(c); import boundaries extended for module (a) independence.
- IR gains `guard`, `custom`, `invoke`, `sideEffect`; `Story` gains `signature` and `meta.onFailure`/`idempotent`; `TargetRef.scope` gains `desktop`/`window`; `Candidate.by` gains `accessibilityId`, `resourceId`, `automationId`, `controlPath`, `webmcp`; `StepResult.status` gains `aborted`; `FailureClass` gains `guard`; new `AuditLine`, `Checkpoint`, `Invoker`, `Signature`.
- Tier 0 custom typed steps (§5).
- `bind()` API and record/run/heal modes for plain Playwright tests (§6.5), healer plugin interface (§10), bind-failure input to the healer (§12).
- Playwright Test host (§9).
- Policies, guards, checkpoints, resume, audit in the executor (§8).
- Workflow, tool, and trajectory behaviors (§13); BiDi, Appium, desktop adapters (§7); conformance suites (§14); CLI additions (§15).
- Draft 2.1: local service (§13.5) with OpenAPI description; new ADE client structure (§13.6) built to the vision with the prototype as blueprint; prototype database import at P2; Electron accessibility note (§7.5); the ADE replaces the sample desktop app (§16).
