# `evals/self/api` — where the HTTP side's requests live

The self project declares `api: { dir: api }` in `svatah.config.yaml`. The
requests the HTTP side of the suite calls are in `evals/self/http/api`, beside
the configuration that names the local service's base URL; this directory
belongs to the *desktop* half, which calls no API of its own.

It is tracked because git carries no empty directory, and `svatah.config.yaml`
names it: `scripts/self-parity-bite.mjs` and `scripts/self-record.mjs` copy the
project before they touch it and crashed here from a clean checkout (P11-F1).
The copy tolerates a missing optional directory now too.

Only `*.yaml` and `*.yml` are read as requests (LLD §4.1), so this file is a
note and not a malformed request.
