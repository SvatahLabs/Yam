# `@svatah/yam-tui`

`yam ui` — the terminal cockpit, and the second renderer of the screen model
(REQ-TUI-1, LLD §13.7).

```console
$ yam ui                                  # the cockpit, on the current project
$ yam ui --screen run --run comp          # opened on one run
$ yam ui --json                           # the model's state, and nothing drawn
$ yam ui --capture 4000 > panes.txt       # draw for four seconds, then quit
```

Four numbered panes — tree, main, inspector, audit — with `1`–`4` to focus one,
`Tab` to cycle, `j`/`k` to move, `Enter` to open what the cursor is on, the
screen's own single-letter accelerators, and the command palette on `^K`. No
tmux; it runs in any terminal.

## It renders the model and adds nothing

Everything a person reads here is a `ScreenState` from `@svatah/yam-screens`, loaded
by the same `load()` the ADE calls. Every key runs an `Action` from the same
registry the ADE's ⌘K shows, resolved by the same id.
`tools/repo-checks/test/palette-parity.test.ts` holds the two renderers to that.

That is what `--json` is for: it prints the loaded screen and draws nothing, and
`tools/repo-checks/test/tui-pty.test.ts` compares that output — key for key —
with `screenById("run").load(client, { runId: "comp" })` evaluated in another
process. A cockpit that had massaged a number for the terminal would fail it.

Colour comes from `@svatah/yam-ui-tokens`'s `STATUS` table, by the same names the
browser uses: a terminal has no CSS variables, and it has the same seven tones.
A status word never appears without its colour and a colour never without its
word.

## Opening a service

Exactly as the ADE does (LLD §13.6): `--url`/`--token`, or
`YAM_SERVICE_URL`/`YAM_SERVICE_TOKEN`, or else `yam serve --port 0` is
spawned, its handshake read, and it is stopped on exit.

## `--capture <ms>`

Draw for that long and then quit, giving the terminal back. It is the product's
own flag rather than a test hook: a cockpit that can only be left by pressing a
key cannot be captured by anything that is not a person, and REQ-ADE-13's point
is that an agent gets what a person gets. `pnpm ui:capture` uses it to write
`reports/ui-flows.txt` and `reports/ui-run.txt`.

## Testing

- `packages/tui/test/cockpit.test.tsx` — the panes, the keys and the palette,
  through `ink-testing-library`. Runs anywhere.
- `tools/repo-checks/test/tui-pty.test.ts` — the cockpit inside a real
  pseudo-terminal (`script(1)`, no dependency), in colour, plus the `--json`
  comparison.

Typing into a pseudo-terminal means writing to its *master*, and `script` gives
a caller no way to reach one — so the keys are proven in the first file and the
drawing in the second. The phase's environment note allows that split and asks
that it be said.
