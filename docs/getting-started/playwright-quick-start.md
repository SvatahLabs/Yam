# Bindings in a plain Playwright project

The first thing to adopt is the piece that works on its own: bindings and
model-free healing for an existing Playwright project. One dependency, one
import, no flow language, no compiler, and no model at record time or at run
time. The full worked example, timed against a ten-minute budget in CI, is
[`examples/plain-playwright/`](../../examples/plain-playwright/README.md).

## 1. Add the dependency

```bash
npm install --save-dev @svatah/yam-playwright-test
```

## 2. Import `test` from it

```ts
import { test, expect } from "@svatah/yam-playwright-test";

test("sign in", async ({ page, bind }) => {
  await page.goto("/login");
  await (await bind("login.username-field", "the username field")).fill("me@example.com");
  await (await bind("login.password-field", "the password field")).fill("hunter2");
  await (await bind("login.sign-in-button", "the sign in button")).click();
  await expect(page).toHaveURL(/dashboard/);
});
```

`bind(id, phrase?)` returns a Playwright `Locator`, so everything you already do
with a locator still works. A project with its own fixtures extends this `test`
instead of the one from `@playwright/test`.

## 3. Record once

```bash
YAM_MODE=record YAM_HEADED=1 npx playwright test
```

A browser opens and asks you to click each unbound element. What you clicked
becomes a ranked bundle of candidates plus a structural fingerprint, written to
`bindings/login/username-field.yaml`. Commit that directory: it is a reviewable
file, not a database, and it records `provenance.model: "human"`.

## 4. Run

```bash
npx playwright test
```

Run mode is the default. The resolver reads the store and tries the candidates
in order until exactly one element matches. No model, no network beyond your
own application.

## 5. Heal

```bash
YAM_MODE=heal npx playwright test
```

When a binding stops resolving, relocalization scores every element now on the
page against the recorded fingerprint. A clear winner is used and the test is
annotated `healed`, never `passed`. The repair is staged in
`.yam/heal-proposals.jsonl` for a person to review; nothing is written to the
store.

## Settings

| Environment | Default | What it is |
|---|---|---|
| `YAM_MODE` | `run` | `run`, `record` or `heal` |
| `YAM_BINDINGS` | `bindings` | where the store lives |
| `YAM_OUT` | `.yam` | bind failures and heal proposals |
| `YAM_PICK` | | element id to selector, for headless record in CI |

Next: [your first flow](first-flow.md), which adds the flow language and the
compiler on top of the same bindings.
