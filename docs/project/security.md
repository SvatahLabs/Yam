# Security

## What the project promises

- **No credential in the repository, ever.** The publish script reads a token
  from the environment of one child process, or uses the workflow's OIDC
  identity, and writes nothing to disk. Model credentials are environment
  variables read by the gateway and never logged.
- **Secrets never reach an artifact.** An input declared `secret` is read from
  `YAM_INPUT_<NAME>`, redacted in results, audit, summary and the model's
  prompt, and never written to a run directory or a binding.
- **Replay makes no network call beyond the target application.** The runtime
  cannot import the model gateway; `pnpm privacy:check` runs a command with
  every outbound connection refused and fails if one was attempted.
- **The local service binds to `127.0.0.1`** behind a bearer token printed
  once on stdout. It writes only under the project directory it was opened on.
- **Agents are audited.** A tool call records the agent as the invoker, and a
  story that is not idempotent is not listed to an agent in production.

## Reporting a vulnerability

Email <info@svatah.com> rather than opening a public issue. Include the
version, the command or endpoint, and what you observed. You will get an
acknowledgement within three working days, and a fix or a mitigation before
any public disclosure.
