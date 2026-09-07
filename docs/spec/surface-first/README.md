# Yam: surface-first mission specification

Yam should make **connect → inspect → act → verify** its primary experience for humans and agents. Flows and runs should build on that surface-control experience as optional automation and evidence features.

- [Gap analysis and Yam-on-Yam validation](gap-analysis.md): observed failures, source findings, screenshots, raw MCP evidence and explicit coverage limitations.
- [Requirements](requirements.md): mission, 23 prioritized requirements, acceptance scenarios and existing-spec changes.
- [Design](design.md): shared control architecture, session lifecycle, CLI/MCP/service contract, desktop experience and migration.
- [Tasks](tasks.md): 23 implementation tasks, dependencies, completion criteria and release gates.
- [Release review](release-review.md): what was measured, on what, and the open limitations by name. A review, not a release.
- [Wave 4 progress](progress/wave-4.md): T18–T20 as they landed — Yam driving the packaged Yam, the coverage report and the release review.
- [Wave 5 implementation prompt](wave-5-implementation.md): a dependable Yam-on-Yam suite and a conformant parity gate first, then Streamable HTTP MCP, process/PTY and AT-SPI.
- [Wave 4 implementation prompt](wave-4-implementation.md): Yam controls the packaged Yam through its public interfaces, coverage with a denominator, and the docs and release review brought to what shipped.
- [Wave 3 implementation prompt](wave-3-implementation.md): the Surfaces shell, the action inspector, shared control and agent setup, and the automations regrouped.
- [Wave 2 implementation prompt](wave-2-implementation.md): discovery, reference scope, coordination, evidence, transport parity and clean installation.
- [Wave 1 implementation prompt](wave-1-implementation.md): the slice to build first — T01–T05, a narrow CLI and MCP journey, and the six verified defects — with the prompt to start it and the contract to verify it.

Status: proposed product changes; documentation and audit evidence only. The current UI/runtime has not been changed. Start with the gap analysis; the most consequential failures are missing direct CLI commands, incomplete session control, ignored adapter selection and an Explorer action button without an action form.
