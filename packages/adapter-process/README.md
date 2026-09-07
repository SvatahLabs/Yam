# @svatah/yam-adapter-process

Process and pseudo-terminal adapter: a terminal as a surface (T22, SF-22).

A snapshot of the **screen** rather than of the stream, input, keys — including
`Control+C`, which the terminal's line discipline turns into a real `SIGINT` —
exit state, and file reads bounded to a declared root. It adds nothing to the
operation catalogue: what a person does in a terminal is `type`, `press`,
`clear`, `waitFor`, `quit` and `screenshot`.

The pseudo-terminal is allocated by a program the operating system already
ships — `expect(1)` or `python3` with its `pty` module — so there is no
dependency and nothing to compile. A host with neither is refused with what was
looked for.

See [`docs/spec/hld.md`](../../docs/spec/hld.md) §12 for where this package sits and
[`docs/spec/lld.md`](../../docs/spec/lld.md) §1 for the import boundaries it must respect.
