/**
 * Valid instances of every artifact in LLD §3, used by the round-trip tests.
 *
 * Each fixture is the smallest value that satisfies its schema and exercises the
 * automation fields Draft 2 added — guards, custom, invoke, signatures, onFailure,
 * audit, checkpoints, desktop candidate kinds, `aborted` and the `guard` failure
 * class — so a field disappearing from a schema breaks a test here.
 */
import type {
  AuditLine,
  BindingEntry,
  BindingFile,
  Checkpoint,
  Config,
  Plan,
  Proposal,
  Provenance,
  Step,
  StepResult,
  Story,
  Summary,
} from "../src/index.js";
import { DEFAULT_CONFIG, SCHEMA_VERSION } from "../src/index.js";

const AT = "2026-09-02T10:00:00.000Z";

export const humanProvenance: Provenance = {
  model: "human",
  promptVersion: "picker-1",
  at: AT,
  tokensIn: 0,
  tokensOut: 0,
};

export const modelProvenance: Provenance = {
  model: "claude-opus-5",
  promptVersion: "g-1",
  at: AT,
  tokensIn: 1_200,
  tokensOut: 48,
  cacheRead: 900,
  costUsd: 0.0031,
};

/** A Tier 1 step: grammar output, so no provenance. */
export const tier1Step: Step = {
  id: "Validate login/3",
  storyName: "Validate login",
  line: 7,
  text: 'Type {input.email} into the username field',
  action: "type",
  target: {
    ref: "login.username-field",
    phrase: "the username field",
    status: "bound",
    scope: "page",
  },
  args: { value: { kind: "input", name: "email" } },
  timeoutMs: 10_000,
  origin: { tier: 1, rule: "type-into", confidence: 1 },
};

/** A guarded step that also carries an expectation and a capture. */
export const guardedStep: Step = {
  id: "Validate login/4",
  storyName: "Validate login",
  line: 8,
  text: 'Only if the error banner is hidden, click the sign in button',
  action: "click",
  target: { ref: "login.sign-in-button", phrase: "the sign in button", status: "bound" },
  guard: {
    subject: "target",
    predicate: { kind: "hidden" },
    mode: "onlyIf",
  },
  expect: {
    subject: "page",
    predicate: { kind: "urlContains", value: { kind: "literal", value: "/dashboard" } },
  },
  capture: { name: "landingUrl", from: "title" },
  timeoutMs: 10_000,
  origin: { tier: 1, rule: "click", confidence: 1 },
};

/** A Tier 0 custom step (LLD §5). */
export const customStep: Step = {
  id: "Transfer funds/1",
  storyName: "Transfer funds",
  line: 3,
  text: 'Transfer 250 from the current account to the savings account',
  action: "custom",
  custom: {
    id: "steps/transfer.ts#default",
    params: {
      amount: { kind: "literal", value: "250" },
      from: { kind: "literal", value: "accounts.current" },
      to: { kind: "literal", value: "accounts.savings" },
    },
  },
  sideEffect: true,
  timeoutMs: 30_000,
  origin: { tier: 0, rule: "steps/transfer.ts#default", confidence: 1 },
};

/** A step invoking another story as a function. */
export const invokeStep: Step = {
  id: "Book and cancel/2",
  storyName: "Book and cancel",
  line: 5,
  text: 'Run the "Book a slot" story with date={data.date} and remember bookingId as booking',
  action: "invoke",
  invoke: { story: "Book a slot", inputs: { date: { kind: "data", path: "date" } } },
  capture: { name: "booking", from: "output" },
  timeoutMs: 60_000,
  origin: { tier: 1, rule: "invoke-story", confidence: 1 },
};

/** A Tier 2 step: local-model output, so provenance is mandatory (REQ-STD-4). */
export const tier2Step: Step = {
  id: "Validate login/9",
  storyName: "Validate login",
  line: 13,
  text: "Dismiss the cookie banner if it appears",
  action: "click",
  target: { ref: "common.cookie-accept", phrase: "the cookie banner accept button", status: "unbound" },
  timeoutMs: 10_000,
  origin: { tier: 2, confidence: 0.82, provenance: { ...modelProvenance, digest: "sha256:abc" } },
};

export const story: Story = {
  name: "Validate login",
  kind: "story",
  file: "flows/simple.flow",
  meta: {
    enabled: true,
    onFailure: { compensate: "Reset session" },
    idempotent: false,
    tags: ["smoke"],
  },
  signature: {
    inputs: { email: { type: "string" }, password: { type: "secret" } },
    outputs: { landingUrl: { type: "string", description: "Where the login landed" } },
  },
  steps: [tier1Step, guardedStep],
};

export const plan: Plan = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: AT,
  project: "sample",
  stories: [story],
  compositions: { "Login and check": ["Validate login", "Validate dashboard"] },
  runs: { "flows/simple.flow": ["Login and check"] },
  targets: { "login.username-field": { phrases: ["the username field", "the email field"] } },
  apis: ["active count"],
  customSteps: ["steps/transfer.ts#default"],
  hash: "0".repeat(64),
};

export const bindingEntry: BindingEntry = {
  context: {
    pattern: "https://sample.test/login",
    hash: "1".repeat(64),
    viewport: [1280, 720],
    platform: "web",
  },
  candidates: [
    { by: "testid", value: "username", score: 0.98 },
    { by: "label", name: "Username", exact: true, score: 0.91 },
    { by: "css", value: "form#login input[name='username']", score: 0.6 },
  ],
  fingerprint: {
    tag: "input",
    attrs: { type: "text", name: "username" },
    text: "",
    neighbours: { before: ["Username"], after: ["Password"] },
    rolePath: ["main", "form", "textbox"],
    box: [40, 120, 240, 32],
    index: 0,
  },
  recordedAt: AT,
  provenance: humanProvenance,
  verified: true,
};

/** A desktop binding, exercising the `automationId` and `controlPath` candidate kinds. */
export const desktopBindingEntry: BindingEntry = {
  context: { pattern: "Svatah ADE*", hash: "2".repeat(64), platform: "desktop" },
  candidates: [
    { by: "automationId", value: "project-open", score: 0.95 },
    { by: "controlPath", value: "Window[Svatah ADE]/Pane[2]/Button[Open project]", score: 0.7 },
    { by: "coords", value: "412,86", score: 0.1 },
  ],
  fingerprint: {
    tag: "Button",
    attrs: { AutomationId: "project-open" },
    text: "Open project",
    neighbours: { before: ["Recent"], after: ["New project"] },
    rolePath: ["window", "pane", "button"],
    box: [400, 76, 120, 28],
    index: 1,
  },
  recordedAt: AT,
  provenance: modelProvenance,
  verified: true,
};

export const bindingFile: BindingFile = {
  schemaVersion: SCHEMA_VERSION,
  id: "login.username-field",
  phrases: ["the username field", "the email field"],
  entries: [bindingEntry],
};

export const stepResult: StepResult = {
  runId: "01JB0000000000000000000000",
  behavior: "test",
  flow: "flows/simple.flow",
  story: "Validate login",
  stepId: "Validate login/3",
  line: 7,
  text: "Type {input.email} into the username field",
  status: "passed",
  startedAt: AT,
  endedAt: "2026-09-02T10:00:00.240Z",
  durationMs: 240,
  matched: { ref: "r12", candidateIndex: 0, by: "testid" },
  captured: { landingUrl: "https://sample.test/dashboard" },
};

/** An aborted step whose guard errored — the two statuses Draft 2 added. */
export const abortedStepResult: StepResult = {
  ...stepResult,
  stepId: "Validate login/4",
  status: "aborted",
  failure: {
    class: "guard",
    message: "Guard referenced an undefined capture `bannerState`",
    policyApplied: { compensate: "Reset session" },
  },
};

export const summary: Summary = {
  schemaVersion: SCHEMA_VERSION,
  runId: "01JB0000000000000000000000",
  behavior: "test",
  planHash: "3".repeat(64),
  bindingsHash: "4".repeat(64),
  configHash: "5".repeat(64),
  invoker: { kind: "ci", id: "github:svatah/ci#1421", via: "cli" },
  startedAt: AT,
  endedAt: "2026-09-02T10:01:00.000Z",
  flows: {
    "flows/simple.flow": { status: "aborted", passed: 3, failed: 1, skipped: 2, trace: "traces/simple.zip" },
  },
  outputs: { landingUrl: "https://sample.test/dashboard" },
  totals: { passed: 3, failed: 1, skipped: 2, healed: 0, aborted: 1 },
  exitCode: 11,
};

export const auditLine: AuditLine = {
  runId: "01JB0000000000000000000000",
  at: AT,
  seq: 42,
  kind: "surface",
  story: "Validate login",
  stepId: "Validate login/3",
  call: { method: "act", action: "type", ref: "r12", args: { value: "«redacted»" } },
  outcome: "ok",
  durationMs: 31,
};

export const checkpoint: Checkpoint = {
  schemaVersion: SCHEMA_VERSION,
  runId: "01JB0000000000000000000000",
  flow: "flows/simple.flow",
  story: "Validate login",
  stepId: "Validate login/3",
  at: AT,
  planHash: "3".repeat(64),
  bindingsHash: "4".repeat(64),
  scope: {
    inputs: { email: "user@sample.test" },
    captures: { "Validate login": { landingUrl: "https://sample.test/dashboard" } },
  },
  session: {
    kind: "web",
    url: "https://sample.test/dashboard",
    windowIndex: 0,
    dialog: null,
    storageState: "runs/01JB.../storage.json",
  },
};

export const config: Config = { ...DEFAULT_CONFIG, project: "sample" };

export const proposal: Proposal = {
  schemaVersion: SCHEMA_VERSION,
  name: "book-a-slot",
  createdAt: AT,
  provenance: modelProvenance,
  flow: 'story: Book a slot\n  Click the book button\n  // review: unmapped call surface.evaluate\n',
  bindings: [
    {
      schemaVersion: SCHEMA_VERSION,
      id: "booking.book-button",
      phrases: ["the book button"],
      entries: [{ ...bindingEntry, verified: false }],
    },
  ],
  sourceTrajectory: "runs/01JB.../trajectory.jsonl",
  notes: ["One call could not be mapped to an IR action."],
};
