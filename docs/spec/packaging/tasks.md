# Tasks — what a person installs

`[ ]` not started · `[x]` done · `[~]` partly, with the reason in the text.

## Wave P0 — the contract

- [ ] **P0.1** `@svatah/yam-contract`: the operation catalogue and
  `catalogueFingerprint()`, with `surface-control` and everything else depending
  on it rather than each other. `PK-07`
- [ ] **P0.2** The broker's `mismatched` state names the parties — which
  component started the broker, its version, its contract, and what to update.
  `PK-08`

## Wave P1 — the split

- [ ] **P1.1** `playwright` and `webdriverio` become optional peers of
  `@svatah/yam`; `undici` stays a dependency. `PK-02`, `PK-06`
- [ ] **P1.2** Adapter registration stops importing a driver at module load: the
  adapter registers its name always and resolves its driver on first use.
  `PK-03`, `PK-04`
- [ ] **P1.3** `yam surface doctor` gains **not installed**, distinct from "not
  this host" and "not configured", with the one command that fixes it — and
  `--fix` to run it. `PK-03`, `PK-10`
- [ ] **P1.4** A check that no `adapter-*` package imports a driver statically,
  and that `@svatah/yam`'s dependencies contain no driver. `PK-04`, `PK-12`

## Wave P2 — the MCP server moves out

- [ ] **P2.1** `@svatah/yam-mcp`: the server, depending on `@svatah/yam` and the
  SDK. The surface tools always; the operation tools only where a project is
  present. `PK-05`
- [ ] **P2.2** Remove `yam mcp` and `yam mcp --http` from the CLI, its help, its
  completions and its diagnostics. Removed, not deprecated. `PK-05`
- [ ] **P2.3** Update all 43 documents that name `yam mcp`, including
  `docs/mcp.md`, the getting-started guide, the generated CLI reference, the
  app's own configuration block and the `TUI-Mcp` artboard. `PK-11`
- [ ] **P2.4** The app's "Connect an agent" block emits the new command, and
  offers to write it into an agent's configuration. `PK-11`

## Wave P3 — proof

- [ ] **P3.1** Install the published tarball into an empty directory with no
  further registry access; run `yam surface doctor` and one native connect.
  `PK-N1`
- [ ] **P3.2** Measure the installed tree and fail over 12 MB. `PK-01`, `PK-N2`
- [ ] **P3.3** Install the base plus `playwright` and prove a browser connect;
  install the base alone and prove the refusal names the command. `PK-02`,
  `PK-03`
- [ ] **P3.4** Three installables on one machine at one contract: the app, the
  CLI and `@svatah/yam-mcp` share a broker and a session. At two contracts: the
  mismatch names the parties. `PK-07`, `PK-08`
