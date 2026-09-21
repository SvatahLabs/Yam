# @svatah/yam-adapter-atspi

Linux AT-SPI accessibility adapter (T23, SF-23).

**Implemented and validated.** The role table, reference scope, state inversion,
action selection and every refusal are pure functions of an `AtspiNode[]` and
are driven by `test/tree.test.ts` against recorded trees. The bridge's
conversation with a live accessibility bus is driven by CI's
`desktop-conformance` Linux leg, against the packaged application on a virtual
display; the generated
[support matrix](../../docs/reference/generated/support-matrix.md) reports what
that run measured.

That leg's first run, on 2026-09-21, found four defects on exactly the seam this
package's own tests do not cross — states named from a PyGObject enum's `str()`,
`getText` answering with one U+FFFC per embedded child, no `parent` on a
snapshot node, and no `native` bag on a description. All four are fixed and each
has a test. It is the reason the package says *validated* now and did not
before: the pure functions were right, and the conversation with the bus was
where the adapter actually was.

## Asking about an element after the window changed

A `check` or a reference `waitFor` re-reads the window and finds the element
again by what identifies it: the D-Bus object address the walker publishes,
then the application's automation id or the accessible name with the role.
Where nothing distinguishes two elements — two unnamed rows, or two rows with
the same automation id, and no object address — and the window has changed
around them, the answer is a `LocateError` saying so, never an answer about the
neighbour that moved into the old position. A label whose name changed at the
same place, with nothing added or removed beside it, is the same label renamed.

`title`, `titleContains`, `box`, `size` and `location` are answered (the title
from the fresh read, geometry from `Component.GetExtents`). `setChecked` reads
the current state first and clicks only when it differs. An element whose
Action interface failed to answer is refused as an `ActionabilityError` (try
again), not as unsupported. A reference `waitFor` waits for `attached`, `detached`,
`visible`, `hidden`, `enabled` or `disabled`, and refuses any other state as a
`DataError`.

See [`docs/spec/hld.md`](../../docs/spec/hld.md) §12 for where this package sits and
[`docs/spec/lld.md`](../../docs/spec/lld.md) §1 for the import boundaries it must respect.
