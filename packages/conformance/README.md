# @svatah/yam-conformance

The published conformance suites (REQ-STD-2). An adapter is **conformant** only
when the surface suite passes against it (REQ-SURF-3).

## Surface suite

A script of surface calls per page of `apps/sample-web`, with the invariants
LLD §14 names: roles, names and states present in the snapshot; the effect an
`act` must have had; and the error type a call must throw.

The suite is handed an `AgentSurface` and knows nothing else — no Playwright, no
browser, no Yam internals. That is what lets a third party run it against
their own adapter, and it is why `packages/conformance/test` can exercise the
whole suite against a mock adapter with no browser at all.

```bash
# Against a running sample application:
yam surface conform --adapter playwright --base-url http://127.0.0.1:4173

# Or, from a checkout, with the sample application started for you:
pnpm conform:playwright
```

Options: `--only <ids>` to run a subset, `--headed`, `--json`, and
`--report <path.md>` to write the Markdown report the release notes attach
(REQ-PKG-4). Exit code 0 when conformant, 1 when not.

A case declares the capabilities it needs (`requires: ["dialogs"]`). An adapter
that lacks one has that case **skipped**, not failed — an adapter is allowed not
to have optional features, and the report says which were skipped and why.

## Reading a failure

Every check carries what it expected and what it saw, so a failing adapter is
told what to fix without its author reading the suite's source:

```
  /login
    FAIL  login.snapshot-states  (7 checks, 126 ms)
          The login snapshot reports the form controls with their names and their
          required, unchecked and hidden states.
          × the username field reports the required state
              expected: "required" in states
              actual:   []
```

`renderMarkdown` produces the same content for a release note.

## Runtime suite

Plans plus bindings plus expected `results.jsonl`, for foreign runtimes
(REQ-STD-3). It arrives with the executor in Phase 2.

## Licence

Apache-2.0.
