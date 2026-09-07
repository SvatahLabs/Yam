# Yam: surface-first mission specification

Yam should make **connect → inspect → act → verify** its primary experience for humans and agents. Flows and runs should build on that surface-control experience as optional automation and evidence features.

- [Gap analysis and Yam-on-Yam validation](gap-analysis.md): observed failures, source findings, screenshots, raw MCP evidence and explicit coverage limitations.
- [Requirements](requirements.md): mission, 23 prioritized requirements, acceptance scenarios and existing-spec changes.
- [Design](design.md): shared control architecture, session lifecycle, CLI/MCP/service contract, desktop experience and migration.
- [Tasks](tasks.md): 24 implementation tasks, dependencies, completion criteria and release gates.
- [Release review](release-review.md): what was measured, on what, and the open limitations by name. A review, not a release.
- [Wave 5 progress](progress/wave-5.md): T00 and T21–T23 as they landed — the suite made dependable and put in CI, Streamable HTTP MCP, the terminal surface, and adapter readiness derived from probes rather than a table.
- [Wave 4 progress](progress/wave-4.md): T18–T20 as they landed — Yam driving the packaged Yam, the coverage report and the release review.
- [Wave 5 implementation prompt](wave-5-implementation.md): a dependable Yam-on-Yam suite and a conformant parity gate first, then Streamable HTTP MCP, process/PTY and AT-SPI.
- [Wave 4 implementation prompt](wave-4-implementation.md): Yam controls the packaged Yam through its public interfaces, coverage with a denominator, and the docs and release review brought to what shipped.
- [Wave 3 implementation prompt](wave-3-implementation.md): the Surfaces shell, the action inspector, shared control and agent setup, and the automations regrouped.
- [Wave 2 implementation prompt](wave-2-implementation.md): discovery, reference scope, coordination, evidence, transport parity and clean installation.
- [Wave 1 implementation prompt](wave-1-implementation.md): the slice to build first — T01–T05, a narrow CLI and MCP journey, and the six verified defects — with the prompt to start it and the contract to verify it.

Status: **M0–M5 delivered and unpublished.** The five waves are recorded above, each with its evidence and its deviations; the [release review](release-review.md) names what is measured and what is still missing, and it is a review rather than a release. The gap analysis below is the audit this began from and is kept as the historical record of what was wrong.

Start with the gap analysis for that history; start with the [wave 5 record](progress/wave-5.md) for where things now stand.
