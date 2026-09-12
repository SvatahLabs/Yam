# TV-T00 — can the terminal do this?

Answered 2026-09-09 against `fdb5d6e`. The spike itself is deleted, as the task
says; this is what it found. **Verdict: TV-T02, TV-T03 and TV-T05 are confirmed
in shape. No wave is re-planned.** Two corrections to the design, both small,
are recorded below.

## How it was measured

A throwaway Ink application — a status bar, two bordered regions at computed
heights and a footer — run under a **real pseudo-terminal**, not a pipe. `script(1)`
could not be used (it needs a controlling terminal, and this session's stdio is a
socket), so the harness was `pty.openpty()` with the child on the slave and the
size set through `TIOCSWINSZ`, which also made the resize testable from outside.

The frames were then replayed into **a real VT emulator** (`pyte`) rather than
regex-stripped, because "does the frame fill the terminal" is a question about a
screen buffer and cannot be answered from a byte stream. Both techniques are
worth rebuilding as the golden-frame harness in TV-T06.

## What it found

### 1 · The alternate screen holds, and gives the terminal back

Entered once, left once, no scrollback disturbed. **Correction to the design:**
the restore must be *idempotent*. The first version wrote the restore sequence
twice — once from `process.on("exit")` and once after `waitUntilExit()` — which
is invisible on a good day and a double reset on a bad one.

### 2 · Fixed-height regions fill the terminal exactly (TV-04)

Measured on the emulated screen, at the three sizes the specification names:

| Terminal | Rows with content | Longest line | Last row |
|---|---|---|---|
| 80×24 | 24 of 24 | 80 of 80 | the footer |
| 120×40 | 40 of 40 | 120 of 120 | the footer |
| 200×50 | 50 of 50 | 200 of 200 | the footer |

No short frame, no overflow, no trailing blank rows. Ink will do this **given
explicit `width` and `height` on every box** — which is exactly the solver's job,
and the reason `layout.ts` computes numbers rather than asking Ink to grow
anything.

### 3 · Resize re-solves (TV-04)

`SIGWINCH` arrives, Node re-reads `process.stdout.columns`/`rows`, Ink re-renders,
and the emulator confirms the new frame fills the new size: 120×40 → 100×32,
32 of 32 rows, longest line 100.

*Harness fact, not a product one:* a child in a pty with no controlling terminal
is not sent `SIGWINCH` by the kernel, so the harness sends it. A real terminal
does this itself.

### 4 · The mouse arrives, but not through Ink (TV-10)

The SGR 1006 sequence reaches the process intact — 22 bytes, `\e[<0;30;10M\e[<0;30;10m`,
logged off the raw `process.stdin` — and **Ink's `useInput` does not surface it**:
the click counter never moved. **This confirms the design rather than changing
it:** `design.md` already puts mouse decoding in `input.ts`, and TV-T15 must
attach its own `stdin` listener rather than expecting `useInput` to deliver
escape sequences.

### 5 · A live stream is comfortable; the cost is bytes, not milliseconds

120 frames paced at 25 ms produced **205 writes, 412 KB, 0.113 ms average per
write, 23 ms of writing in total**. Unpaced, 200 state updates coalesced into
**33 writes** — Ink batches, which is why the naive "one write per event" fear
does not materialise.

*Do not quote the first number this spike produced.* An early run reported
0.07 ms and was measuring the React round trip, not the terminal write; the
honest figures are the ones above, and the React round trip alone is p95 1.92 ms.

The number worth carrying forward is **2–3 KB per redraw at 120×40**. Locally
that is nothing. Over a slow `ssh` link a 10 Hz stream is ~25 KB/s, which is the
reason TV-09's subscription should coalesce events into frames rather than
render one frame per event.
