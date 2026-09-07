# The three layers

```
 ┌──────────────────────────── BEHAVIOR ────────────────────────────┐
 │   test (oracle)        workflow (function)        tool (MCP)      │
 ├──────────────────────── DETERMINISM (the standard) ──────────────┤
 │   flow → plan.json · bindings/ · resolver · relocalization        │
 │   checkpoints · audit · provenance · conformance suites            │
 ├──────────────────────────── SURFACE ─────────────────────────────┤
 │   snapshot(refs) · act(ref) · read · check · session               │
 │   Playwright │ BiDi │ Appium │ UIA │ AX │ HTTP │ WebMCP             │
 └──────────────────────────────────────────────────────────────────┘
   model calls: compile residue · record grounding · heal · never at replay
```

**The surface** is one published interface, and each platform reaches it
through an adapter: take a snapshot with stable references, act by reference,
read, check, hold session state. Adapters exist for Playwright, WebDriver BiDi,
Appium, Windows UI Automation, macOS Accessibility, HTTP, a process/terminal
and Linux AT-SPI. An adapter existing is not evidence that it works: AT-SPI is
implemented and **unvalidated** — nothing here has driven it against a live
accessibility bus. What each adapter has actually been driven through is the
[support matrix](../reference/generated/support-matrix.md) — an adapter's
existence is not evidence that it works. Nothing above the surface knows a
locator, a protocol or a platform.

**The determinism layer** is the standard the project publishes: the step
intermediate representation, the plan, the bindings store with fingerprints,
the resolver, model-free relocalization, provenance, checkpoints, the audit
log, and the conformance suites that hold adapters and foreign runtimes to
those artifacts.

**The behaviour layer** runs one plan three ways: as a test, as a typed
function with guards and checkpoints, and as a deterministic tool an agent
calls.

## The principles behind the shape

1. **Artifacts, not sessions.** Every model decision is a committed, diffable
   file. Replay reads files only.
2. **The surface is the only way down.**
3. **The determinism layer is the standard.** Schemas, suites and provenance are
   published; adapters and runtimes are interchangeable against them.
4. **Testing is a behaviour, not the identity.** Guards, checkpoints, abort
   policy, typed signatures and audit are in the contract from the first schema
   version.
5. **Adopt the runner, do not replace it.** Web tests run inside Playwright
   Test; the core stays runner-agnostic for everything else.
6. **Pieces adoptable alone.** Bindings and healing work in a plain Playwright
   project with no flow language.
7. **Fail at authoring, not at replay.** Ambiguity, unbound targets and type
   errors are rejected by `compile` or `record`.
8. **No platform, no fork, no transport.** Orchestration is external; browsers
   and protocols are used, not replaced.

The design documents are the source of truth: [HLD](../spec/hld.md) for the
components and decisions, [LLD](../spec/lld.md) for the interfaces.
