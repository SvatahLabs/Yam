/**
 * A plain Playwright test using Yam bindings.
 *
 * The only difference from an ordinary Playwright spec is the import: `test`
 * comes from `@svatah/yam-playwright-test` instead of `@playwright/test`, which adds
 * `bind` to the fixtures. There is no flow file, no compiler and no model
 * (REQ-REC-11, REQ-PKG-1, REQ-PKG-2).
 *
 * `bind("login.username-field")` names the element; where that element *is* lives
 * in `bindings/login/username-field.yaml`, recorded once by clicking it.
 */
import { test, expect } from "@svatah/yam-playwright-test";

test("sign in", async ({ page, bind }) => {
  await page.goto("/login");

  await (await bind("login.username-field", "the username field")).fill("atul@example.com");
  await (await bind("login.password-field", "the password field")).fill("hunter2");
  await (await bind("login.sign-in-button", "the sign in button")).click();

  await expect(page).toHaveURL(/dashboard/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome back, Enterprise");
});
