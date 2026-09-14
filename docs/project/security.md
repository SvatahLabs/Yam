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
- **Agents are audited.** A tool call records the agent as the invoker, and a
  story that is not idempotent is not listed to an agent in production.

## Reporting a vulnerability

See [SECURITY.md](../../SECURITY.md). Reports are handled on a best-effort
basis.
