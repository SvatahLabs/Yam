# Yam: surface-first mission specification

Yam should make **connect → inspect → act → verify** its primary experience for humans and agents. Flows and runs should build on that surface-control experience as optional automation and evidence features.

- [Gap analysis and Yam-on-Yam validation](gap-analysis.md): observed failures, source findings, screenshots, raw MCP evidence and explicit coverage limitations.
- [Requirements](requirements.md): mission, 23 prioritized requirements, acceptance scenarios and existing-spec changes.
- [Design](design.md): shared control architecture, session lifecycle, CLI/MCP/service contract, desktop experience and migration.
- [Tasks](tasks.md): 23 implementation tasks, dependencies, completion criteria and release gates.
- [Wave 1 implementation prompt](wave-1-implementation.md): the slice to build first — T01–T05, a narrow CLI and MCP journey, and the six verified defects — with the prompt to start it and the contract to verify it.

Status: proposed product changes; documentation and audit evidence only. The current UI/runtime has not been changed. Start with the gap analysis; the most consequential failures are missing direct CLI commands, incomplete session control, ignored adapter selection and an Explorer action button without an action form.
