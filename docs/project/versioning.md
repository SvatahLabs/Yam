# Versioning

Yam is a monorepo of packages that release together. Every package carries the
same version, `CHANGELOG.md` is the whole workspace's changelog, and the
release set is computed by `scripts/lib/release-packages.mjs` rather than
listed by hand.

- **Semantic versioning** for the packages. Until `1.0.0`, a minor version may
  change an interface; the changelog says which.
- **`schemaVersion`** is the contract's own version, carried in every artifact
  and in every schema's `$id` under `https://yam.svatah.com/schema/<version>/`.
  It changes only when an artifact's shape changes in a way a foreign runtime
  must know about, and the conformance fixture changes with it.
- **The tag** `v<version>` is created at the published commit and nowhere else.
  A tag is a claim that a version exists on a registry.
- **What a release contains**: the tarballs, the ADE installers for three
  operating systems, and every report under `reports/`, generated on the
  release's commit.

The publish itself is one guarded script, `scripts/publish.mjs`: a dry run
unless `--publish`, a manual dispatch of the release workflow, and a publish
identity (the workflow's trusted-publishing token, or `NPM_TOKEN` as a fallback)
all hold. `pnpm quick-start:registry` verifies a publish afterwards by
installing the module (a) packages by name into an empty project.
