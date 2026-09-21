# `@svatah/yam-page-script`

The DOM walker an adapter evaluates **inside a page**: roles, accessible names,
states, boxes and references, in the normalised shape of LLD §2.2.

Four functions, each serialised to its source and run in the page:

| | |
|---|---|
| `walkDocument` | the snapshot's node list, registering each element so a `Ref` can be turned back into it |
| `describeElement` | everything candidate synthesis and fingerprinting read from one element (LLD §3.3, §7.4) |
| `locateInPage` | a stored `Candidate` to refs, by the same role and name rules the walker uses |
| `actionabilityOf` | the visibility, enabledness and box an actionability wait is decided from (LLD §7.3) |

Because each is evaluated in the page, each is self-contained: no imports, no
reference to anything outside its own body. The role table and the
accessible-name rules are repeated inside each one, and this package has no
dependencies — there is nothing here for one to reach.

## Who uses it, and who does not

`@svatah/yam-adapter-bidi` and `@svatah/yam-adapter-appium`: the two adapters
that drive a web page and have no ARIA snapshot of their own.

`@svatah/yam-adapter-playwright` does **not**. It snapshots through Playwright's
own ARIA snapshot, and that independence is the point: REQ-ADP-4 asks BiDi to
prove the surface boundary, and `snapshot-parity.test.ts` drives both adapters
over the same pages and requires the same roles, names and states out of each.
Two implementations, checked against one another.

Sharing this between BiDi and Appium costs nothing of that. Appium was never
BiDi's oracle, and a third copy of the accessible-name rules would only be a
third place for them to drift.
