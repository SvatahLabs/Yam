# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Email
<info@svatah.com> instead, with as much of this as you have:

- the Yam version, or the commit you built from,
- the command, tool or endpoint involved,
- what you observed, and how to reproduce it.

Yam is maintained on a best-effort basis. Reports are read and acted on as
time allows; there is no guaranteed response time or fix schedule.

## Supported versions

Only the latest release, 0.1.0, and the latest `main` are looked at. A fix lands
on `main` and ships in the next release; there are no backports.

## Security design

How Yam keeps credentials out of the repository, redacts secrets, replays
without calling a model, and binds its local service to `127.0.0.1` is
described in [docs/project/security.md](docs/project/security.md). That page
describes the design rather than guaranteeing it: Yam is provided as is, under
the [Apache License 2.0](LICENSE).
