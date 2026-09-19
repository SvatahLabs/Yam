# Security

## How Yam is designed

This is how the project is built to handle credentials, secrets and the
network. It is a description, not a guarantee: Yam is provided as is, under the
[Apache License 2.0](../../LICENSE).

- **Credentials stay out of the repository.** The publish script reads a token
  from the environment of one child process, or uses the workflow's OIDC
  identity, and writes nothing to disk. Model credentials are environment
  variables read by the gateway, which does not log them.
- **Secrets are redacted from artifacts.** An input declared `secret` is read
  from `YAM_INPUT_<NAME>`, redacted in results, audit, summary and the model's
  prompt, and not written to a run directory or a binding.
- **Replay does not reach the network beyond the target application.** The
  runtime cannot import the model gateway, and `pnpm privacy:check` runs a
  command with every outbound connection refused and fails if one was
  attempted.
- **The local service binds to `127.0.0.1`**, behind a bearer token printed once
  on stdout, and writes under the project directory it was opened on.
- **Agents are audited.** A `yam tool serve` call records the agent as the
  invoker, and a story that is not idempotent is not listed to an agent in
  production. A surface call over `@svatah/yam-mcp` is written to the trajectory
  when it carries an intent.
- **An agent acts as itself.** Over MCP its holder is the name its client gave,
  marked ` (MCP)`; it cannot name another holder, force a handoff, or close a
  session somebody else holds.
- **An agent starts and drives only what a person allowed.** The MCP server
  starts no program unless `--allow-program` names it, drives no running
  application unless `--allow-app` names it, opens `http`, `https` and `about:`
  pages (and `file:` with `--allow-file-urls`), uploads no local file without
  `--allow-upload`, joins browsers on loopback only, and gives a program it
  starts a shell's environment rather than its own. See
  [Yam and MCP](../mcp.md#what-an-agent-may-start).
- **Secrets typed through a session are withheld.** A value typed into a
  password field, or declared in `secrets`, is not written to a trajectory or a
  proposal, and a web page's password field reads back as `[REDACTED]`.
- **A project's code runs only where it is trusted.** Its code is the files
  under its steps directory, a Playwright config at its root, and a program its
  config launches. Steps are loaded, and a run that would start the others
  begins, only once `yam trust` (or `yam init`, or the desktop's prompt) has said
  so, or under `CI=true`/`CI=1` or `YAM_TRUST_PROJECT=1`. The MCP server does not
  count `CI`, because agent hosts set it.
- **The HTTP adapter keeps each host's cookies to that host**, and refuses
  link-local and cloud metadata addresses unless `YAM_HTTP_ALLOW_LINK_LOCAL=1`.

## Reporting a vulnerability

See [SECURITY.md](../../SECURITY.md). Reports are handled on a best-effort
basis.
