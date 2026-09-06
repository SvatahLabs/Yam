# Migration review

`yam migrate evals/migrate/source evals/migrate/expected`

Story names and step order are preserved exactly, so the old file and the new one
read side by side. What follows is everything the migration had to guess at.

## What was written

| File | Stories | Steps |
|---|---|---|
| `flows/execution.flow` | 7 | 31 |
| `flows/natural_language_login.flow` | 3 | 12 |
| `flows/simple.flow` | 3 | 13 |
| `flows/svatah.flow` | 1 | 16 |

Also written:

- `bindings/migrated/dashboard-link.yaml`
- `bindings/migrated/docs-link.yaml`
- `bindings/migrated/login-button.yaml`
- `bindings/migrated/logout.yaml`
- `bindings/migrated/password.yaml`
- `bindings/migrated/schedule-build-tab.yaml`
- `bindings/migrated/schedule-build-title.yaml`
- `bindings/migrated/toggle-sidebar.yaml`
- `bindings/migrated/username.yaml`
- `flows/test.flow`

Every step was converted.

## Steps that need a look (39)

A legacy locator says where an element was, never what it is. Where the original prose said nothing, the phrase below was derived from the locator — rename it to what the element actually is, and the bindings will be recorded against a name a person recognises.

- **sample/execution.flow:2** — The target phrase "the Start your wonderful journey" was derived from the locator `linkText:Start your wonderful journey`, because the original said nothing about what the element is. Rename it.
  > `+click+ on the search tab on the home Page using ~linkText:Start your wonderful journey~`
- **sample/execution.flow:8** — The target phrase "the suggested location as Indranagar" has a preposition inside it, which usually means the sigils left a seam — the original wrote the value between the two halves of the name. It is left as it stands because removing it would turn "the sign in button" into "the sign button"; read the page and rename it.
  > `+click+ on the suggested location as Indranagar defined by ~xpath://body~`
- **sample/execution.flow:12** — The target phrase "the div 3 div 2 div 3" was derived from the locator `xpath://div[3]/div[2]/div[3]`, because the original said nothing about what the element is. Rename it.
  > `+click+ on the element defined by ~xpath://div[3]/div[2]/div[3]~ to select starting date`
- **sample/execution.flow:15** — The target phrase "the div 3 div 2 div 3" was derived from the locator `xpath://div[3]/div[2]/div[3]`, because the original said nothing about what the element is. Rename it.
  > `+click+ on the element defined by ~xpath://div[3]/div[2]/div[3]~ to select end date`
- **sample/execution.flow:18** — The target phrase "the then for seconds" has a preposition inside it, which usually means the sigils left a seam — the original wrote the value between the two halves of the name. It is left as it stands because removing it would turn "the sign in button" into "the sign button"; read the page and rename it.
  > `user then +waits+ for *8* seconds`
- **sample/execution.flow:21** — The target phrase "the book now" was derived from the locator `link:book-now`, because the original said nothing about what the element is. Rename it.
  > `+click+ on the element defined by ~link:book-now~`
- **sample/execution.flow:29** — The target phrase "the form div 3 img" was derived from the locator `xpath://form/div[3]/img`, because the original said nothing about what the element is. Rename it.
  > `+click+ on the element identified by the locator ~xpath://form/div[3]/img~`
- **sample/execution.flow:30** — The target phrase "the checkoutButton" was derived from the locator `id:checkoutButton`, because the original said nothing about what the element is. Rename it.
  > `+click+ on the element identified by the locator ~id:checkoutButton~ to checkout the car`
- **sample/execution.flow:33** — The target phrase "the card" was derived from the locator `id:card`, because the original said nothing about what the element is. Rename it.
  > `+click+ on the element defined by identifier ~id:card~`
- **sample/execution.flow:34** — The target phrase "the expiry month" was derived from the locator `id:expiry-month`, because the original said nothing about what the element is. Rename it.
  > `+click+ on the element defined by identifier ~id:expiry-month~`
- **sample/execution.flow:35** — The target phrase "the expiry month" was derived from the locator `id:expiry-month`, because the original said nothing about what the element is. Rename it.
  > `+type+ on the element defined by identifier ~id:expiry-month~ and enter month as *08*`
- **sample/execution.flow:36** — The target phrase "the expiry year" was derived from the locator `id:expiry-year`, because the original said nothing about what the element is. Rename it.
  > `+click+ on the element defined by identifier ~id:expiry-year~`
- **sample/execution.flow:37** — The target phrase "the expiry year" was derived from the locator `id:expiry-year`, because the original said nothing about what the element is. Rename it.
  > `+type+ on the element defined by identifier ~id:expiry-year~ and enter year as *2019*`
- **sample/execution.flow:38** — The target phrase "the cvv" was derived from the locator `id:cvv`, because the original said nothing about what the element is. Rename it.
  > `+click+ on the element defined by identifier ~id:cvv~`
- **sample/execution.flow:40** — The target phrase "the input type text" was derived from the locator `xpath://input[@type='text']`, because the original said nothing about what the element is. Rename it.
  > `+click+ on the element defined by identifier ~xpath://input[@type='text']~`
- **sample/natural_language_login.flow:5** — The inline locator was removed; it belongs in the bindings store, not in the flow (REQ-LANG-4).
  > `Click the login button with xpath://input[@value='Sign In']`
- **sample/natural_language_login.flow:6** — "Verify the Schedule Build page appears" became an expectation on "the Schedule Build". The original asserted a *page*; name the element that proves the page is there.
  > `Verify the Schedule Build page appears`
- **sample/natural_language_login.flow:9** — The inline locator was removed; it belongs in the bindings store, not in the flow (REQ-LANG-4).
  > `Click the logout button with xpath://li[9]/a/p`
- **sample/natural_language_login.flow:10** — "Verify the home page appears" became an expectation on "the home". The original asserted a *page*; name the element that proves the page is there.
  > `Verify the home page appears`
- **sample/natural_language_login.flow:13** — The inline locator was removed; it belongs in the bindings store, not in the flow (REQ-LANG-4).
  > `Type connected2atul@gmail.com into the username field with id:username`
- **sample/natural_language_login.flow:14** — The inline locator was removed; it belongs in the bindings store, not in the flow (REQ-LANG-4).
  > `Type qwerty123 into the password field with id:password`
- **sample/natural_language_login.flow:15** — The inline locator was removed; it belongs in the bindings store, not in the flow (REQ-LANG-4).
  > `Click the login button with xpath://input[@value='Sign In']`
- **sample/natural_language_login.flow:17** — The inline locator was removed; it belongs in the bindings store, not in the flow (REQ-LANG-4).
  > `Verify the Welcome message appears with xpath://h1`
- **sample/natural_language_login.flow:17** — "Verify the Welcome message appears" became an expectation on "the Welcome message". The original asserted a *page*; name the element that proves the page is there.
  > `Verify the Welcome message appears with xpath://h1`
- **sample/natural_language_login.flow:24** — "test : Run all login stories" names no story or composition in this file, so it ran nothing. The label is kept and "Login stories" listed beneath it — check that is what was meant.
- **sample/simple.flow:2** — The target phrase "the sign in button" was derived from the locator `sign in button`, because the original said nothing about what the element is. Rename it.
  > `user +clicks+ the ~sign in button~ on the home page`
- **sample/simple.flow:3** — The target phrase "the username" was derived from the locator `username`, because the original said nothing about what the element is. Rename it.
  > `user +types+ the ~username~ as *connected2atul@gmail.com*`
- **sample/simple.flow:4** — The target phrase "the password" was derived from the locator `password`, because the original said nothing about what the element is. Rename it.
  > `user +types+ the ~password~ as *qwerty123*`
- **sample/simple.flow:7** — The target phrase "the element" was derived from the locator `xpath://h1`, because the original said nothing about what the element is. Rename it.
  > `user +saves text+ as var : enterprise  for ~xpath://h1~ on the Schedule Build Page`
- **sample/simple.flow:8** — The target phrase "the element" was derived from the locator `xpath://h1`, because the original said nothing about what the element is. Rename it.
  > `user +validates text+ on the Schedule Build Page using ~xpath://h1~ with *#enterprise#*`
- **sample/simple.flow:14** — The target phrase "the username in field" has a preposition inside it, which usually means the sigils left a seam — the original wrote the value between the two halves of the name. It is left as it stands because removing it would turn "the sign in button" into "the sign button"; read the page and rename it.
  > `user +types+ the username *connected2atul@gmail.com* in field ~id:username~`
- **sample/simple.flow:18** — The target phrase "the element" was derived from the locator `xpath://h1`, because the original said nothing about what the element is. Rename it.
  > `user +validates text+ on the Schedule Build Page using ~xpath://h1~ with *#I want to validate login.enterprise#*`
- **sample/svatah.flow:2** — The target phrase "the body nav div div navbar translate button" was derived from the locator `css : body > nav > div > div.navbar-translate > button`, because the original said nothing about what the element is. Rename it.
  > `user +clicks+ on ~css : body > nav > div > div.navbar-translate > button~`
- **sample/svatah.flow:7** — The target phrase "the dashboard link" was derived from the locator `dashboard link`, because the original said nothing about what the element is. Rename it.
  > `user +moves to element and click+ ~dashboard link~`
- **sample/svatah.flow:9** — The target phrase "the dashboard link" was derived from the locator `dashboard link`, because the original said nothing about what the element is. Rename it.
  > `user +waits for the presence+ of ~dashboard link~`
- **sample/svatah.flow:11** — The target phrase "the username" was derived from the locator `username`, because the original said nothing about what the element is. Rename it.
  > `user +waits for the presence+ of ~username~`
- **sample/svatah.flow:12** — The target phrase "the username" was derived from the locator `username`, because the original said nothing about what the element is. Rename it.
  > `user +types+ the ~username~ as *connected2atul@gmail.com*`
- **sample/svatah.flow:19** — The target phrase "the logout" was derived from the locator `logout`, because the original said nothing about what the element is. Rename it.
  > `+click+ on ~logout~`
- **sample/svatah.flow:20** — The target phrase "the username" was derived from the locator `username`, because the original said nothing about what the element is. Rename it.
  > `user +types+ the ~username~ as *#val*`

## Elements defined more than once (6)

Two files defined the same element. The first definition was kept; check that it is the one you want.

- **locator/svatah.locator** — "the username" is also defined elsewhere; the first definition was kept (3 candidates, versus 3 here).
- **locator/svatah.locator** — "the password" is also defined elsewhere; the first definition was kept (3 candidates, versus 3 here).
- **locator/svatah.locator** — "the login button" is also defined elsewhere; the first definition was kept (4 candidates, versus 3 here).
- **locator/svatah.locator** — "the dashboard link" is also defined elsewhere; the first definition was kept (4 candidates, versus 3 here).
- **locator/svatah.locator** — "the Schedule Build Tab" is also defined elsewhere; the first definition was kept (2 candidates, versus 2 here).
- **locator/svatah.locator** — "the Schedule Build Title" is also defined elsewhere; the first definition was kept (2 candidates, versus 3 here).
