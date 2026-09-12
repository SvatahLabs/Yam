# Wave 2 — what running it found

Wave 1 shipped with 4,432 tests green. The owner then ran `yam ui` and hit four
defects in the first few minutes. This is the record of them, of what each cost,
and — the part that matters — of why the wave-1 checks let every one of them
through.

## The defects

| # | What happened | Found by |
|---|---|---|
| D12 | `R` on Flows printed "Reconnecting to the event stream…" instead of recording. `capture.start` had never been reachable from the cockpit. | The owner, pressing it |
| D13 | `run.resume` (`R` on Run) and `api.send` (`Enter` on API) were eaten the same way — found while confirming D12 | Reading, then confirmed by D12's new check |
| D14 | Nothing on screen listed the nine screens or said which one you were on | The owner, looking for it |
| D15 | `c` refused with "Enter a URL to connect to" and there was nowhere to enter one | The owner, pressing it |
| D16 | Borders drew Ink's `"magenta"` rather than the lavender `accent` token | The owner, comparing with the artboards |
| D17 | Ran / refused / not-available / threw were one grey line with no mark | Implied by "it is not clear what to do" |

## Why the checks passed

**D12 and D13.** `test/palette-parity` and `test/action-parity` assert that every
action is *reachable*: bound to a key, present in the palette. Both passed. A key
that is declared, advertised in the footer, and eaten by an earlier `if` before
the table is consulted satisfies "reachable" perfectly. The reconnect handler on
`R` was not in `COMMAND_KEYS` — it was an inline `if` in the input handler — so
no comparison of declarations could see it, however thorough.

The lesson is narrow and worth stating: **a key is spent by the code that
consumes it, not by the table that describes it.** `test/keys-reach.test.tsx`
presses each declared key into the real handler and asserts the action ran. Put
the bug back and it names exactly the five broken bindings.

Wave 1's record claims the `record.stop`-on-`q` fix "closed that class". It did
not. It closed the instances a table could see.

**D15.** Same shape. An action that always refuses is reachable. The check now
follows a prompted action through to the end.

**D14 and D16.** Neither had a check, and neither was going to: the terminal
artboards do not draw a rail, and no rule said the chrome must read the tokens.
`TUI-Session.html` contains the word "Session" twice and no other screen name —
so the cockpit faithfully implemented a mock that was already missing the thing
the owner went looking for. The mocks were mine, and the gap starts there.

## Caught while fixing

The rail strip was numbered `1`–`9` first. It sits one row above regions numbered
`1`–`4`: the same digits on one screen meaning two things, which is precisely the
ambiguity TV-15 rejected for the mode strip. Letters instead, and a rule that the
strip may use no key a region is focused with.

The strip's property test found, on its first run, that the current entry was
admitted to the row without being measured — "5 Agents and tools" is twenty
columns and the row came to twenty-three at eighty.

`layout.ts` held a *third* copy of the cockpit's key table for the footer, beside
`COMMAND_KEYS`, free to drift. It had already drifted.

`test/surfaces.test.ts` asserted the message contained "Enter a URL" — pinning
copy that promised "a browser, app, device or API" for a field that took the
first only. A test can hold a defect in place; this one did.

## Not done

Say-mode still holds a sentence rather than running it: that needs the runtime to
take a broker session, unchanged from wave 1 and still out of scope.

The `yam mcp --http` client name is still a placeholder.

## The suite

34 packages, **4,480 tests**, green. Nothing published, nothing pushed, no tag.
