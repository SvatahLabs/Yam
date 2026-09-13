# Yam documentation

Yam is a deterministic automation runtime with a standard agent surface, from
[Svatah Labs](https://github.com/SvatahLabs). Describe a behaviour once in plain
language, bind it to the real elements by driving the real platform, then replay
that plan deterministically, with no model in the loop. The
[support matrix](reference/generated/support-matrix.md) says which platforms
that covers and how far each has been driven; it is generated from measured
runs rather than written.

The documentation is organised by what you are trying to do.

| If you want to | Read |
|---|---|
| install it and run something | [Setup](setup.md) |
| see everything Yam does | [Features](features.md) |
| learn from working examples | [Examples](examples.md) |
| look up a command, tool or endpoint | [API reference](api.md) |
| get bindings into an existing Playwright suite | [Playwright quick start](getting-started/playwright-quick-start.md) |
| do one specific task | [Guides](#guides) |
| understand how and why it works | [Concepts](#concepts) |
| work on Yam itself | [Developer guide](developer-guide.md) |
| send a change | [Contributing](../CONTRIBUTING.md) |

## Start here

1. [Setup](setup.md), from `npm install` to a working machine, including the
   permissions macOS wants and which program it grants them to.
2. [Features](features.md), what Yam does, one feature at a time, with pictures.
3. [Examples](examples.md), working code for the things people do most.

## Getting started, in detail

1. [Install Yam and control something](getting-started/install-and-first-control.md), from `npm install` to a browser and a native application driven by hand.
2. [Bindings in a plain Playwright project](getting-started/playwright-quick-start.md), the smaller thing to adopt if you already have a Playwright suite.
3. [Your first flow](getting-started/first-flow.md), from `yam init` to a replayed plan.
4. [One plan, three ways to run it](getting-started/one-plan-three-ways.md), as a test, a workflow and an agent tool.

## Guides

- [Record bindings](guides/record-bindings.md)
- [Heal bindings when the interface changes](guides/heal-bindings.md)
- [Write a flow](guides/write-a-flow.md)
- [Run in CI](guides/run-in-ci.md)
- [Run a story from cron](guides/run-from-cron.md)
- [Expose a story as an MCP tool](guides/expose-a-tool-over-mcp.md)
- [Add an adapter and pass conformance](guides/add-an-adapter.md)
- [Write a foreign runtime](guides/write-a-foreign-runtime.md)
- [Use the desktop app](guides/use-the-app.md)

## Concepts

- [The three layers](concepts/three-layers.md)
- [The agent surface](concepts/agent-surface.md)
- [Determinism and provenance](concepts/determinism-and-provenance.md)
- [Bindings and fingerprints](concepts/bindings-and-fingerprints.md)
- [The compiler tiers](concepts/compiler-tiers.md)
- [Behaviors](behaviors.md)
- [Privacy mode](privacy.md)

## Reference

Written by hand:

- [API reference](api.md), the four ways in and which to pick
- [The flow language](flow-language.md), every sentence pattern and IR action
- [The agent surface contract](agent-surface.md), what an adapter implements
- [MCP](mcp.md), the operation tools and the raw surface
- [The REPL](repl.md)
- [The local model, Tier 2](local-model.md) and [the fine-tune](finetune.md)

Generated from the code by `pnpm docs`, and checked in CI so they cannot drift:

- [Support matrix](reference/generated/support-matrix.md), which adapters have been driven and how far
- [The `yam` command line](reference/generated/cli.md)
- [Packages and their exports](reference/generated/packages/README.md)
- [JSON Schemas](reference/generated/schemas/README.md)
- [The local service HTTP API](reference/generated/http-api.md)

## Project

- [Surface-first mission proposal](spec/surface-first/README.md), with Yam-on-Yam gap analysis, requirements, design and implementation tasks
- [Changelog](../CHANGELOG.md) · [Versioning](project/versioning.md)
- [Reports](project/reports.md), the published numbers and how to regenerate them
- [Continuous integration](ci.md)
- [Contributing](../CONTRIBUTING.md) · [Developer guide](developer-guide.md) · [Security](project/security.md)
- [The specification](spec/), the source of truth: [requirements](spec/requirements.md), [HLD](spec/hld.md), [LLD](spec/lld.md), [tasks](spec/tasks.md), and every phase's [record and verification](spec/progress/)
