# @svatah/yam-playwright-test

The Playwright Test host (LLD §9). Two things live here, and LLD §1 makes this
the one package that may hold either: the **`bind()` fixture** for plain
Playwright tests — the whole of module (a)'s adoption story — and, from Phase 2,
the generated spec per flow that runs the executor inside Playwright Test.

It is the only package besides the CLI allowed to import an `adapter-*` package,
and it imports exactly one: the Playwright adapter.

## `bind()` in a plain Playwright test

One dependency, one import (REQ-PKG-2):

```ts
import { test, expect } from "@svatah/yam-playwright-test";

test("sign in", async ({ page, bind }) => {
  await page.goto("/login");
  await (await bind("login.username-field", "the username field")).fill("me@example.com");
  await (await bind("login.sign-in-button")).click();
  await expect(page).toHaveURL(/dashboard/);
});
```

`bind(id, phrase?)` returns a Playwright `Locator`, so everything you already do
with a locator still works. A project with its own fixtures extends this `test`
instead of `@playwright/test`'s.

The ten-minute quick start, with the record and heal passes explained, is in
[`examples/plain-playwright/README.md`](../../examples/plain-playwright/README.md).

## Modes (LLD §6.5)

| `YAM_MODE` | What happens |
|---|---|
| `run` (default) | The resolver reads the store and returns a `Locator`. No model, no network beyond the application. A failure names every candidate tried and writes `.yam/bind-failures.jsonl`. |
| `record` | An id with no binding for the current context is grounded by a person clicking it, and synthesised with `provenance.model: "human"`. |
| `heal` | On a failure, relocalization runs inline, the resolution is retried once, and the test is annotated `healed`. The repair is staged to `.yam/heal-proposals.jsonl`, never applied. |

A healed run is `healed`, not `passed` (REQ-HEAL-4, ADR-6): a repair reaches the
repository through a diff someone reads, so "green" keeps meaning that a
deterministic replay passed.

## Recording without a person

`YAM_PICK` (or the `yamPicks` fixture option) names the element for each id
so record mode runs headless:

```bash
YAM_MODE=record YAM_PICK='{"login.username-field":"username"}' npx playwright test
```

A bare word is a test id; anything else is a CSS selector. **This is a test
affordance, not a feature.** It exists so the record path can be exercised in CI,
and it is how this repository proves that path works. Reaching for it in a real
project means writing selectors again, which is the thing bindings are for not
doing.

## Licence

Apache-2.0.
