# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Email <info@svatah.com>
instead, and include:

- the Yam version, or the commit you built from,
- the command, tool or endpoint involved,
- what you observed, and how to reproduce it.

You will get an acknowledgement within three working days, and a fix or a
mitigation before any public disclosure.

## Supported versions

0.1.0 is the first release and has not been tagged yet. Until a later release
exists, security fixes land on `main`, and only the latest `main` is supported.

## What Yam promises

No credentials in the repository, secrets redacted from every artifact, replay
without network calls beyond the target application, and a local service bound
to `127.0.0.1` are described in
[docs/project/security.md](docs/project/security.md).
