# Sample application variants

`apps/sample-web` serves a baseline application at `?variant=0` (the default) and
twenty deliberate UI changes at `?variant=1` .. `?variant=20`.

They exist so healing can be measured honestly. Record the bindings against the
baseline, replay against each variant, and count how many resolve again without a
model. That is the relocalization number REQ-HEAL-5 requires be published
(threshold 0.60 without a model, 0.85 with one call), and T1.5 and T1.8 are the
tasks that measure it.

Every variant is a change a real front-end change would produce, and every variant
breaks at least one class of locator candidate. A test
(`test/variant-diff.test.ts`) diffs the binding-relevant properties of every
element between the baseline and each variant, and fails if a variant changes
nothing a binding reads, changes a page it does not declare, or duplicates
another variant.

## Running it

```bash
pnpm --filter sample-web start          # http://localhost:4173
```

```
http://localhost:4173/login             # baseline
http://localhost:4173/login?variant=5   # password field id renamed
http://localhost:4173/api/variants      # this table, as JSON
```

`PORT` overrides the port; `PORT=0` asks the operating system for a free one,
which is what the tests use.

## Pages

| Path | Page |
|---|---|
| `/` | Home |
| `/login` | Login |
| `/dashboard` | Dashboard |
| `/schedule-build` | Schedule Build |
| `/booking` | Booking |
| `/checkout` | Checkout |
| `/widgets` | Widgets |
| `/widgets/frame` | Embedded frame |
| `/docs` | Docs |
| `/logout` | Logged out |

Plus `GET /api/active-count` (the "active count" API the sample flows call),
`GET /api/variants`, `/app.css` and `/canvas.js`.

## The twenty variants

| # | Change | Kind | Pages | Breaks |
|---|---|---|---|---|
| 1 | Sign-in call to action renamed | `text` | `/` | `text`, `role (by accessible name)` |
| 2 | Test id dropped from the username field | `attribute` | `/login` | `testid` |
| 3 | Login fields wrapped in an extra layout div | `structure` | `/login` | `xpath`, `css (descendant paths)` |
| 4 | Submit button value changed | `text` | `/login` | `text`, `css (attribute value)`, `xpath (value predicate)` |
| 5 | Password field id renamed | `identifier` | `/login` | `id`, `css (#id)`, `xpath (@id)` |
| 6 | Sidebar items reordered | `ordering` | `/dashboard`, `/schedule-build`, `/booking`, `/checkout` | `xpath (positional)`, `css (:nth-child)`, `candidate nth` |
| 7 | Logout became an icon-only button | `text` | `/dashboard`, `/schedule-build`, `/booking`, `/checkout` | `text`, `link text` |
| 8 | Dashboard heading rewritten | `text` | `/dashboard` | `text`, `role (by accessible name)` |
| 9 | A second Book button appears | `ambiguity` | `/booking` | `text`, `role (now matches two elements)` |
| 10 | CSS classes hashed by the build | `attribute` | `/`, `/login`, `/dashboard`, `/schedule-build`, `/booking`, `/checkout`, `/widgets`, `/logout` | `css (class selectors)` |
| 11 | Search field became a search input | `attribute` | `/booking` | `css (attribute selectors)`, `role (textbox → searchbox)` |
| 12 | Schedule Build heading demoted to h2 | `tag` | `/schedule-build` | `xpath (//h1)`, `css (h1)`, `role (heading level)` |
| 13 | Nav toggle text moved into a child span | `structure` | `/`, `/login`, `/dashboard`, `/schedule-build`, `/booking`, `/checkout`, `/widgets`, `/logout` | `xpath (text())`, `css (:has-text)` |
| 14 | Placeholders removed from the login form | `attribute` | `/login` | `placeholder` |
| 15 | Labels detached from their inputs | `attribute` | `/login`, `/checkout` | `label`, `role (by accessible name)` |
| 16 | CVV field keeps only its name | `identifier` | `/checkout` | `id`, `testid`, `css (#id)` |
| 17 | A banner was added above the main content | `ordering` | `/`, `/login`, `/dashboard`, `/schedule-build`, `/booking`, `/checkout`, `/widgets` | `xpath (positional)`, `css (:nth-child)`, `candidate nth` |
| 18 | An extra first option in every select | `ordering` | `/schedule-build`, `/booking`, `/checkout`, `/widgets` | `xpath (positional)`, `candidate nth`, `selectOption by index` |
| 19 | Next button moved into a toolbar | `structure` | `/booking` | `xpath`, `css (descendant paths)`, `ancestor role path` |
| 20 | Login moved into a modal dialog | `context` | `/login` | `context hash`, `xpath`, `ancestor role path`, `scope (page → dialog)` |

### Kinds

| Kind | What the healer has to cope with |
|---|---|
| `text` | Visible text or an accessible name changed. |
| `attribute` | A non-identifying attribute appeared or disappeared. |
| `identifier` | An `id`, `name` or test id was renamed or removed. |
| `structure` | The tree around the element changed shape. |
| `ordering` | Sibling or option indices shifted. |
| `ambiguity` | A second element now answers to the same description. |
| `tag` | The element's tag changed. |
| `context` | The element moved into a different context, changing the context hash (LLD §6.2). |

## Detail

### Variant 1 — Sign-in call to action renamed

**Kind:** `text` · **Pages:** `/?variant=1`

The home page button reads "Log in" instead of "Sign in".

Breaks: `text`, `role (by accessible name)`.

### Variant 2 — Test id dropped from the username field

**Kind:** `attribute` · **Pages:** `/login?variant=2`

A refactor removed `data-testid` from the login username input.

Breaks: `testid`.

### Variant 3 — Login fields wrapped in an extra layout div

**Kind:** `structure` · **Pages:** `/login?variant=3`

Each login field gained a wrapper element, deepening the tree.

Breaks: `xpath`, `css (descendant paths)`.

### Variant 4 — Submit button value changed

**Kind:** `text` · **Pages:** `/login?variant=4`

The login submit reads "Submit" instead of "Sign In".

Breaks: `text`, `css (attribute value)`, `xpath (value predicate)`.

### Variant 5 — Password field id renamed

**Kind:** `identifier` · **Pages:** `/login?variant=5`

`#password` became `#user-password`; the label's `for` moved with it.

Breaks: `id`, `css (#id)`, `xpath (@id)`.

### Variant 6 — Sidebar items reordered

**Kind:** `ordering` · **Pages:** `/dashboard?variant=6`, `/schedule-build?variant=6`, `/booking?variant=6`, `/checkout?variant=6`

Schedule Build moved from second to last in the sidebar.

Breaks: `xpath (positional)`, `css (:nth-child)`, `candidate nth`.

### Variant 7 — Logout became an icon-only button

**Kind:** `text` · **Pages:** `/dashboard?variant=7`, `/schedule-build?variant=7`, `/booking?variant=7`, `/checkout?variant=7`

The sidebar logout link lost its visible text and kept only an aria-label.

Breaks: `text`, `link text`.

### Variant 8 — Dashboard heading rewritten

**Kind:** `text` · **Pages:** `/dashboard?variant=8`

"Welcome back, Enterprise" became "Your builds".

Breaks: `text`, `role (by accessible name)`.

### Variant 9 — A second Book button appears

**Kind:** `ambiguity` · **Pages:** `/booking?variant=9`

The booking page gained a duplicate "Book now" button in a sticky footer.

Breaks: `text`, `role (now matches two elements)`.

### Variant 10 — CSS classes hashed by the build

**Kind:** `attribute` · **Pages:** `/?variant=10`, `/login?variant=10`, `/dashboard?variant=10`, `/schedule-build?variant=10`, `/booking?variant=10`, `/checkout?variant=10`, `/widgets?variant=10`, `/logout?variant=10`

A CSS-modules migration replaced every `btn*` class with a hashed name.

Breaks: `css (class selectors)`.

### Variant 11 — Search field became a search input

**Kind:** `attribute` · **Pages:** `/booking?variant=11`

The booking location field's `type` changed from `text` to `search`.

Breaks: `css (attribute selectors)`, `role (textbox → searchbox)`.

### Variant 12 — Schedule Build heading demoted to h2

**Kind:** `tag` · **Pages:** `/schedule-build?variant=12`

The page heading became an `h2` under a new section title.

Breaks: `xpath (//h1)`, `css (h1)`, `role (heading level)`.

### Variant 13 — Nav toggle text moved into a child span

**Kind:** `structure` · **Pages:** `/?variant=13`, `/login?variant=13`, `/dashboard?variant=13`, `/schedule-build?variant=13`, `/booking?variant=13`, `/checkout?variant=13`, `/widgets?variant=13`, `/logout?variant=13`

The navbar toggle wraps its label in a span for icon alignment.

Breaks: `xpath (text())`, `css (:has-text)`.

### Variant 14 — Placeholders removed from the login form

**Kind:** `attribute` · **Pages:** `/login?variant=14`

A design review removed placeholder text in favour of labels alone.

Breaks: `placeholder`.

### Variant 15 — Labels detached from their inputs

**Kind:** `attribute` · **Pages:** `/login?variant=15`, `/checkout?variant=15`

The `for` attributes were dropped, so labels no longer name their controls.

Breaks: `label`, `role (by accessible name)`.

### Variant 16 — CVV field keeps only its name

**Kind:** `identifier` · **Pages:** `/checkout?variant=16`

`#cvv` lost its `id` and its `data-testid`; only `name="cvv"` remains.

Breaks: `id`, `testid`, `css (#id)`.

### Variant 17 — A banner was added above the main content

**Kind:** `ordering` · **Pages:** `/?variant=17`, `/login?variant=17`, `/dashboard?variant=17`, `/schedule-build?variant=17`, `/booking?variant=17`, `/checkout?variant=17`, `/widgets?variant=17`

A dismissible announcement bar shifted every sibling index below it.

Breaks: `xpath (positional)`, `css (:nth-child)`, `candidate nth`.

### Variant 18 — An extra first option in every select

**Kind:** `ordering` · **Pages:** `/schedule-build?variant=18`, `/booking?variant=18`, `/checkout?variant=18`, `/widgets?variant=18`

Selects gained a "Choose…" placeholder option, shifting option indices.

Breaks: `xpath (positional)`, `candidate nth`, `selectOption by index`.

### Variant 19 — Next button moved into a toolbar

**Kind:** `structure` · **Pages:** `/booking?variant=19`

The booking Next button moved out of the form and into a toolbar above it.

Breaks: `xpath`, `css (descendant paths)`, `ancestor role path`.

### Variant 20 — Login moved into a modal dialog

**Kind:** `context` · **Pages:** `/login?variant=20`

Signing in happens in a modal, so the whole form sits under a dialog.

Breaks: `context hash`, `xpath`, `ancestor role path`, `scope (page → dialog)`.

## Notes for the healing eval

- **Variant 9 is the negative case.** Two elements answer to "Book now", so a
  relocalizer that accepts the best score without checking the margin will pick the
  wrong one. T1.5 requires no false accept here.
- **Variant 20 changes the context hash**, not just the candidates. A binding scoped
  to the page context should not be silently reused inside the dialog context
  (LLD §6.2, REQ-REC-6).
- **Variant 10 is the one a fingerprint should shrug off**: only class names change,
  so text, role, neighbours and the role path are all intact.
- Variants may be combined by a later suite, but the published number is measured
  one variant at a time, against a recording taken at variant 0.
