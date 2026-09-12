# Frames

Frames of the proposed cockpit and of the command line, at the exact sizes the golden-frame check
(TV-11) will hold it to. They are text, not pictures, for the same reason the
check is text: a change to a view should be a diff.

```console
$ cat docs/spec/view-layers/frames/flows-120x40.txt    # Flows, a file open, events following
$ cat docs/spec/view-layers/frames/welcome-80x24.txt   # an empty directory, and what to do about it
$ cat docs/spec/view-layers/frames/surfaces-120x40.txt # the default screen: a live target, no project open
$ cat docs/spec/view-layers/frames/cli-front-door.txt   # yam, yam check, yam run — the CLI as a view layer (TV-17)
$ cat docs/spec/view-layers/frames/cli-json-and-errors.txt  # --json on stdout, and errors that name the next command
```

Every line is exactly as wide as the terminal it names and every frame is
exactly as tall — 120x40 and 80x24 — which is the whole of TV-04. Colour is not
in them; the artboards under `docs/spec/design/artboards/TUI-*.html` carry that,
and `pnpm artboards --shoot <dir>` renders them.

The heavy border is the focused region. `▌` is the cursor's gutter mark, which
is what replaces the full-width inverse bar the cockpit draws today.

The two `cli-*.txt` frames are not fixed-width: a command line wraps to the
terminal it is in, and pretending otherwise would be specifying the wrong thing.
What they fix is the *shape* — what is on stdout, what is on stderr, where the
next command goes, and what an exit code is called.
