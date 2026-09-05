# Bindings in a plain Playwright project — the ten-minute quick start

This is the whole of what adopting Svatah's bindings module looks like
(REQ-PKG-2): **one dependency and one import**. No flow files, no compiler, no
model — at run time or at record time.

## 1. Add the dependency

```bash
npm install --save-dev @svatah/playwright-test
```

## 2. Import `test` from it

```ts
// tests/login.spec.ts
import { test, expect } from "@svatah/playwright-test";

test("sign in", async ({ page, bind }) => {
  await page.goto("/login");

  await (await bind("login.username-field", "the username field")).fill("atul@example.com");
  await (await bind("login.password-field", "the password field")).fill("hunter2");
  await (await bind("login.sign-in-button", "the sign in button")).click();

  await expect(page).toHaveURL(/dashboard/);
});
```

`bind(id, phrase?)` returns a Playwright `Locator`, so everything you already do
with a locator still works. A project that has its own fixtures extends this
`test` instead of `@playwright/test`'s.

## 3. Record the bindings, once

```bash
SVATAH_MODE=record SVATAH_HEADED=1 npx playwright test
```

A browser opens and, for each unbound id, asks you to click the element. What you
clicked is turned into a ranked bundle of candidates — test id, id, role and
name, label, placeholder, an anchored CSS path, a relative XPath — plus a
structural fingerprint, and written to `bindings/login/username-field.yaml`.
Commit that directory: it is a reviewable file, not a database.

The binding records `provenance.model: "human"`, because a person chose it. No
model was involved.

## 4. Run

```bash
npx playwright test
```

`SVATAH_MODE=run` is the default. The resolver reads the store and tries the
candidates in order until one identifies exactly one element. There is no model
call and no network beyond your own application.

When a binding stops resolving, the failure names every candidate it tried, what
each one matched, and whether the page's shape has drifted from the one the
binding was recorded on — and a line goes to `.svatah/bind-failures.jsonl` for the
healer.

## 5. Heal

```bash
SVATAH_MODE=heal npx playwright test
```

On a failure, relocalization scores every element now on the page against the
recorded fingerprint. If one is clearly the element — above the threshold *and*
clear of the runner-up — the test continues against it and is annotated
`healed`. The repair is written to `.svatah/heal-proposals.jsonl` and **not**
applied to the store: a run that only passed because bindings were healed is
`healed`, never `passed` (REQ-HEAL-4), and a repair goes into your repository
through a diff someone reads.

## Recording without a person: `SVATAH_PICK`

Record mode needs somebody to click. In CI there is nobody, so
`SVATAH_PICK` names the element for each id:

```bash
SVATAH_MODE=record SVATAH_PICK='{"login.username-field":"username"}' npx playwright test
```

A bare word is read as a test id; anything else is a CSS selector. **This is a
test affordance, not a feature**: it exists so record mode can be exercised
headless, and it is how this repository's own CI proves the record path works. If
you find yourself reaching for it in a real project, you are writing selectors
again, which is the thing bindings are for not doing.

## Settings

| Environment | Fixture option | Default | What it is |
|---|---|---|---|
| `SVATAH_MODE` | `svatahMode` | `run` | `run`, `record` or `heal` |
| `SVATAH_BINDINGS` | `bindingsDir` | `bindings` | Where the store lives |
| `SVATAH_OUT` | `svatahOutputDir` | `.svatah` | Bind failures and heal proposals |
| `SVATAH_PICK` | `svatahPicks` | — | Element id → selector, for headless record |
| — | `svatahTestIdAttributes` | `data-testid`, `data-test-id`, `data-test` | Attributes treated as test ids |

## Running this example

From a checkout of this repository:

```bash
pnpm install && pnpm exec playwright install chromium && pnpm -r build
pnpm --filter example-plain-playwright test
```

`tests/lifecycle.spec.ts` is the end-to-end proof T1.6 asks for: it records three
bindings by programmatic pick, replays them headless, breaks them on
`?variant=3`, heals inline, and asserts the annotation reads `healed`.
