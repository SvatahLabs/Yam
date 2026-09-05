# The Svatah flow language

A flow file is prose. There are no sigils, no locators, and no locator-type
prefixes — a step is one plain sentence, and the elements it names are resolved
through bindings recorded by driving the real application (REQ-LANG-4,
REQ-LANG-2 constraint 2).

This is the reference REQ-LANG-12 requires: the block grammar, story signatures,
guards, every sentence pattern with at least two examples, custom typed steps,
variables, and the table for migrating v1 and v2 flows.

- Design: [LLD §4](spec/lld.md), [LLD §5](spec/lld.md), [HLD §5.3](spec/hld.md)
- Requirements: REQ-LANG-1 … REQ-LANG-16, REQ-COMP-1, REQ-COMP-2
- The examples below are the entries in
  [`evals/compiler/golden.jsonl`](../evals/compiler/golden.jsonl), so the
  reference and the compiler eval cannot drift apart.

---

## 1. File structure

```
File     := (Blank | Comment | Block)*
Block    := Header NEWLINE SigLine* (StepLine | GuardLine | Comment)* (Blank | EOF)
Header   := Kind Meta? ':' Name          Kind := 'story' | 'scenario' | 'compose' | 'test' | 'run'
Meta     := '(' KV (',' KV)* ')'
SigLine  := ('inputs:' | 'outputs:') (Param (',' Param)*)   Param := Name ':' Type ('=' Default)?
GuardLine:= ('Only if' | 'Unless') Predicate                 applies to the next StepLine
StepLine := ('Only if' Predicate ',' | 'Unless' Predicate ',')? Sentence
Comment  := ('//' | '#') any
```

A block ends at a blank line or the next header. Story and scenario names are
unique per project (REQ-LANG-1). Indentation is ignored — indent for readability
(REQ-LANG-3).

| Kind | What it is |
|---|---|
| `story:` / `scenario:` | A named, ordered list of steps. Synonyms. |
| `compose:` | A named ordered list of story names; expands in place (REQ-LANG-10). |
| `test:` / `run:` | Which stories or compositions execute, in order. |

### Header metadata (REQ-LANG-2)

```
story (tags=smoke, onFailure=compensate:cancel booking, idempotent=false): Book a slot
```

| Key | Values | Meaning |
|---|---|---|
| `enabled` | `true` \| `false` | Skip the story without deleting it. |
| `dataProvider` | name | Run the story once per row of a data set. |
| `filePath` | path | Where the data provider reads from. |
| `continueOnFailure` | `true` \| `false` | Alias of `onFailure=continue`. |
| `onFailure` | `stop` \| `continue` \| `compensate:<story>` | The abort policy (REQ-AUTO-4). `stop` is the default. |
| `idempotent` | `true` \| `false` | Declares the story free of side effects; lint warns when a non-idempotent story is exposed as a tool (REQ-AUTO-8). |
| `tags` | comma-separated | Selection at run time. |

### Comments

`//` and `#` both start a comment line (REQ-LANG-3).

---

## 2. Story signatures (REQ-LANG-13)

`inputs:` and `outputs:` lines go directly under the header. A story with a
signature is invocable as a function — that is the whole of what makes the
workflow and tool behaviors possible (REQ-AUTO-5, REQ-BEH-2, REQ-BEH-3).

```
story: Book a slot
inputs: date: string, seats: number = 2, token: secret
outputs: bookingId: string, total: number
  Type {input.date} into the slot date field
  Click the Book now button
  Remember the text of the booking reference as bookingId
  Remember the text of the total as total
```

| Input types | Output types |
|---|---|
| `string`, `number`, `boolean`, `json`, `secret` | `string`, `number`, `boolean`, `json` |

- An input without a default must be supplied at run time (REQ-COMP-6).
- Every output must be a name captured somewhere in the story, or the compile
  fails.
- `secret` values are redacted in prompts, audit, results, traces, and in
  screenshots of the steps that inject them (REQ-NFR-6).

---

## 3. Variables (REQ-LANG-6, REQ-LANG-7)

Braces, always.

| Form | Reads |
|---|---|
| `{name}` | a capture in the current story, then an input of the current story |
| `{Story name.name}` | a capture of another story in the same flow |
| `{data.path}` | run-level data from `data.yaml` (REQ-LANG-9) |
| `{input.name}` | an input of the current story |

Capture with `… as <name>` or `Remember <target> as <name>` (REQ-LANG-7). A name
is never reassigned: a second capture under the same name is `E_VAR_REDEFINED`
at compile time (LLD §8.5).

Scoping at run time (REQ-RUN-6): run data is read-only and global; captures are
scoped to the flow and namespaced by story; inputs are scoped to the story.

### Data and secrets

`data.yaml` holds run-level data. Secrets are `${ENV}` indirections listed under
`secrets:`, so nothing sensitive is committed (REQ-LANG-9, REQ-NFR-6):

```yaml
user:
  email: "atul@example.com"
  password: "${SVATAH_SAMPLE_PASSWORD}"
secrets:
  - user.password
```

`SVATAH_DATA_*` environment variables override individual paths.

---

## 4. Targets

A target is the noun phrase naming an element: *the username field*, *the Book
now button*. It carries no locator and no locator type — writing one is a compile
error that points at `migrate` (REQ-LANG-4).

The phrase resolves to an element id through the project's target dictionary
(REQ-COMP-5). The id is the phrase normalised: the leading article dropped,
lower-cased, and every run of non-alphanumeric characters replaced with a hyphen
— *the sign in button* becomes `sign-in-button`. A phrase with no dictionary
entry compiles to `status: "unbound"` and is what the recorder grounds
(REQ-REC-1). A phrase that matches more than one element is
`W_AMBIGUOUS_TARGET`.

Literal values are always double-quoted (REQ-LANG-5).

---

## 5. Sentence patterns

Every sentence compiles to exactly one IR step (REQ-COMP-1). Patterns 1–26 cover
the action vocabulary carried over from the Java framework; 27–30 are the Draft 2
additions (LLD §4.2).

The `origin.tier`, `origin.confidence`, `id`, `storyName`, `line`, `text` and
`timeoutMs` fields are filled in by the compiler for every step and are omitted
from the fragments below, which show only what the sentence determines.

### Pattern 1 — Navigate

**IR:** navigate

**Form:** `Open "<url>"` · `Navigate to "<url>"` · `Go to "<url>"` · `Open the {data.<path>} home page`

```
Open "https://sample.test/login"
Navigate to "/dashboard"
Open the {data.baseUrl} home page
Go to "https://sample.test/booking"
```

`Open "https://sample.test/login"` compiles to:

```json
{
  "action": "navigate",
  "args": {
    "url": {
      "kind": "literal",
      "value": "https://sample.test/login"
    }
  }
}
```

`Navigate to "/dashboard"` compiles to:

```json
{
  "action": "navigate",
  "args": {
    "url": {
      "kind": "literal",
      "value": "/dashboard"
    }
  }
}
```

### Pattern 2 — Browser history

**IR:** back, forward, refresh

**Form:** `Go back` · `Go forward` · `Refresh the page` · `Reload the page` · `Click the back button` · `Click the forward button`

```
Go back
Click the back button
Go forward
Click the forward button
```

`Go back` compiles to:

```json
{
  "action": "back"
}
```

`Click the back button` compiles to:

```json
{
  "action": "back"
}
```

### Pattern 3 — Click

**IR:** click

**Form:** `Click the <target>` · `Click on the <target>`

```
Click the sign in button
Click on the login button
Click the Schedule Build link
Click the logout link
```

`Click the sign in button` compiles to:

```json
{
  "action": "click",
  "target": {
    "ref": "sign-in-button",
    "phrase": "the sign in button",
    "status": "unbound"
  }
}
```

`Click on the login button` compiles to:

```json
{
  "action": "click",
  "target": {
    "ref": "login-button",
    "phrase": "the login button",
    "status": "unbound"
  }
}
```

### Pattern 4 — Double-click and right-click

**IR:** doubleClick, rightClick

**Form:** `Double-click the <target>` · `Right-click the <target>` · `Context click the <target>`

```
Double-click the builds table
Double click the project select
Right-click the drag source
Context click the announcement banner
```

`Double-click the builds table` compiles to:

```json
{
  "action": "doubleClick",
  "target": {
    "ref": "builds-table",
    "phrase": "the builds table",
    "status": "unbound"
  }
}
```

`Double click the project select` compiles to:

```json
{
  "action": "doubleClick",
  "target": {
    "ref": "project-select",
    "phrase": "the project select",
    "status": "unbound"
  }
}
```

### Pattern 5 — Hover

**IR:** hover

**Form:** `Hover over the <target>` · `Move to the <target>` · `Move over the <target>`

```
Hover over the dashboard link
Move to the widgets link
Move over the sidebar toggle
```

`Hover over the dashboard link` compiles to:

```json
{
  "action": "hover",
  "target": {
    "ref": "dashboard-link",
    "phrase": "the dashboard link",
    "status": "unbound"
  }
}
```

`Move to the widgets link` compiles to:

```json
{
  "action": "hover",
  "target": {
    "ref": "widgets-link",
    "phrase": "the widgets link",
    "status": "unbound"
  }
}
```

### Pattern 6 — Hover and click

**IR:** hoverAndClick

**Form:** `Move to the <target> and click it` · `Move over the <target> and click it`

```
Move to the dashboard link and click it
Move over the docs link and click it
```

`Move to the dashboard link and click it` compiles to:

```json
{
  "action": "hoverAndClick",
  "target": {
    "ref": "dashboard-link",
    "phrase": "the dashboard link",
    "status": "unbound"
  }
}
```

`Move over the docs link and click it` compiles to:

```json
{
  "action": "hoverAndClick",
  "target": {
    "ref": "docs-link",
    "phrase": "the docs link",
    "status": "unbound"
  }
}
```

### Pattern 7 — Press and hold, release

**IR:** pressAndHold, release

**Form:** `Press and hold the <target>` · `Click and hold the <target>` · `Release the <target>` · `Release the mouse over the <target>`

```
Press and hold the drag source
Click and hold the slot times select
Release the drag source
Release the mouse over the drop target
```

`Press and hold the drag source` compiles to:

```json
{
  "action": "pressAndHold",
  "target": {
    "ref": "drag-source",
    "phrase": "the drag source",
    "status": "unbound"
  }
}
```

`Click and hold the slot times select` compiles to:

```json
{
  "action": "pressAndHold",
  "target": {
    "ref": "slot-times-select",
    "phrase": "the slot times select",
    "status": "unbound"
  }
}
```

### Pattern 8 — Drag

**IR:** dragTo

**Form:** `Drag the <target> onto the <target2>`

```
Drag the drag source onto the drop target
Drag the nightly build row onto the queue panel
```

`Drag the drag source onto the drop target` compiles to:

```json
{
  "action": "dragTo",
  "target": {
    "ref": "drag-source",
    "phrase": "the drag source",
    "status": "unbound"
  },
  "target2": {
    "ref": "drop-target",
    "phrase": "the drop target",
    "status": "unbound"
  }
}
```

`Drag the nightly build row onto the queue panel` compiles to:

```json
{
  "action": "dragTo",
  "target": {
    "ref": "nightly-build-row",
    "phrase": "the nightly build row",
    "status": "unbound"
  },
  "target2": {
    "ref": "queue-panel",
    "phrase": "the queue panel",
    "status": "unbound"
  }
}
```

### Pattern 9 — Type

**IR:** type

**Form:** `Type <value> into the <target>` · `Enter <value> in the <target>`

```
Type "connected2atul@gmail.com" into the username field
Type "qwerty123" into the password field
Type {input.email} into the username field
Type {data.user.password} into the password field
```

`Type "connected2atul@gmail.com" into the username field` compiles to:

```json
{
  "action": "type",
  "target": {
    "ref": "username-field",
    "phrase": "the username field",
    "status": "unbound"
  },
  "args": {
    "value": {
      "kind": "literal",
      "value": "connected2atul@gmail.com"
    }
  }
}
```

`Type "qwerty123" into the password field` compiles to:

```json
{
  "action": "type",
  "target": {
    "ref": "password-field",
    "phrase": "the password field",
    "status": "unbound"
  },
  "args": {
    "value": {
      "kind": "literal",
      "value": "qwerty123"
    }
  }
}
```

### Pattern 10 — Clear

**IR:** clear

**Form:** `Clear the <target>`

```
Clear the location field
Clear the card number field
```

`Clear the location field` compiles to:

```json
{
  "action": "clear",
  "target": {
    "ref": "location-field",
    "phrase": "the location field",
    "status": "unbound"
  }
}
```

`Clear the card number field` compiles to:

```json
{
  "action": "clear",
  "target": {
    "ref": "card-number-field",
    "phrase": "the card number field",
    "status": "unbound"
  }
}
```

### Pattern 11 — Press a key

**IR:** press

**Form:** `Press "<key>"` · `Press "<key>" in the <target>`

```
Press "Enter"
Press "Escape"
Press "Tab" in the username field
Press "Control+A" in the card number field
```

`Press "Enter"` compiles to:

```json
{
  "action": "press",
  "args": {
    "key": {
      "kind": "literal",
      "value": "Enter"
    }
  }
}
```

`Press "Escape"` compiles to:

```json
{
  "action": "press",
  "args": {
    "key": {
      "kind": "literal",
      "value": "Escape"
    }
  }
}
```

### Pattern 12 — Hold and release a key

**IR:** keyDown, keyUp

**Form:** `Hold down the "<key>" key` · `Let go of the "<key>" key`

```
Hold down the "Shift" key
Hold down the "Control" key
Let go of the "Shift" key
Let go of the "Control" key
```

`Hold down the "Shift" key` compiles to:

```json
{
  "action": "keyDown",
  "args": {
    "key": {
      "kind": "literal",
      "value": "Shift"
    }
  }
}
```

`Hold down the "Control" key` compiles to:

```json
{
  "action": "keyDown",
  "args": {
    "key": {
      "kind": "literal",
      "value": "Control"
    }
  }
}
```

### Pattern 13 — Submit

**IR:** submit

**Form:** `Submit the <target>`

```
Submit the login form
Submit the booking form
```

`Submit the login form` compiles to:

```json
{
  "action": "submit",
  "target": {
    "ref": "login-form",
    "phrase": "the login form",
    "status": "unbound"
  }
}
```

`Submit the booking form` compiles to:

```json
{
  "action": "submit",
  "target": {
    "ref": "booking-form",
    "phrase": "the booking form",
    "status": "unbound"
  }
}
```

### Pattern 14 — Upload

**IR:** upload

**Form:** `Upload <value> to the <target>`

```
Upload "reports/summary.pdf" to the attach a report field
Upload {data.reportPath} to the attach a report field
```

`Upload "reports/summary.pdf" to the attach a report field` compiles to:

```json
{
  "action": "upload",
  "target": {
    "ref": "attach-a-report-field",
    "phrase": "the attach a report field",
    "status": "unbound"
  },
  "args": {
    "path": {
      "kind": "literal",
      "value": "reports/summary.pdf"
    }
  }
}
```

`Upload {data.reportPath} to the attach a report field` compiles to:

```json
{
  "action": "upload",
  "target": {
    "ref": "attach-a-report-field",
    "phrase": "the attach a report field",
    "status": "unbound"
  },
  "args": {
    "path": {
      "kind": "data",
      "path": "reportPath"
    }
  }
}
```

### Pattern 15 — Select an option

**IR:** selectOption

**Form:** `Select "<label>" in the <target>` · `Select option <n> in the <target>` · `Select the option with value "<v>" in the <target>`

```
Select "Adapters" in the project select
Select "Staging" in the environment select
Select option 2 in the expiry month select
Select the option with value "webkit" in the browsers select
```

`Select "Adapters" in the project select` compiles to:

```json
{
  "action": "selectOption",
  "target": {
    "ref": "project-select",
    "phrase": "the project select",
    "status": "unbound"
  },
  "args": {
    "label": {
      "kind": "literal",
      "value": "Adapters"
    }
  }
}
```

`Select "Staging" in the environment select` compiles to:

```json
{
  "action": "selectOption",
  "target": {
    "ref": "environment-select",
    "phrase": "the environment select",
    "status": "unbound"
  },
  "args": {
    "label": {
      "kind": "literal",
      "value": "Staging"
    }
  }
}
```

### Pattern 16 — Deselect

**IR:** deselectOption, deselectAll

**Form:** `Deselect "<label>" in the <target>` · `Deselect option <n> in the <target>` · `Deselect everything in the <target>` · `Remove all selections in the <target>`

```
Deselect "Firefox" in the browsers select
Deselect option 1 in the slot times select
Deselect everything in the browsers select
Remove all selections in the slot times select
```

`Deselect "Firefox" in the browsers select` compiles to:

```json
{
  "action": "deselectOption",
  "target": {
    "ref": "browsers-select",
    "phrase": "the browsers select",
    "status": "unbound"
  },
  "args": {
    "label": {
      "kind": "literal",
      "value": "Firefox"
    }
  }
}
```

`Deselect option 1 in the slot times select` compiles to:

```json
{
  "action": "deselectOption",
  "target": {
    "ref": "slot-times-select",
    "phrase": "the slot times select",
    "status": "unbound"
  },
  "args": {
    "index": 1
  }
}
```

### Pattern 17 — Checkboxes

**IR:** setChecked

**Form:** `Check the <target>` · `Tick the <target>` · `Uncheck the <target>`

```
Check the remember me box
Uncheck the remember me box
Tick the terms checkbox
```

`Check the remember me box` compiles to:

```json
{
  "action": "setChecked",
  "target": {
    "ref": "remember-me-box",
    "phrase": "the remember me box",
    "status": "unbound"
  },
  "args": {
    "checked": true
  }
}
```

`Uncheck the remember me box` compiles to:

```json
{
  "action": "setChecked",
  "target": {
    "ref": "remember-me-box",
    "phrase": "the remember me box",
    "status": "unbound"
  },
  "args": {
    "checked": false
  }
}
```

### Pattern 18 — Scrolling

**IR:** scrollIntoView, scrollToTop, scrollToBottom

**Form:** `Scroll to the <target>` · `Scroll the <target> into view` · `Scroll to the top of the page` · `Scroll to the bottom of the page`

```
Scroll to the builds table
Scroll the canvas control into view
Scroll to the top of the page
Scroll to the bottom of the page
```

`Scroll to the builds table` compiles to:

```json
{
  "action": "scrollIntoView",
  "target": {
    "ref": "builds-table",
    "phrase": "the builds table",
    "status": "unbound"
  }
}
```

`Scroll the canvas control into view` compiles to:

```json
{
  "action": "scrollIntoView",
  "target": {
    "ref": "canvas-control",
    "phrase": "the canvas control",
    "status": "unbound"
  }
}
```

### Pattern 19 — Waiting

**IR:** sleep, waitFor

**Form:** `Wait <n> seconds` · `Wait for the <target> to be <state>`

```
Wait 5 seconds
Wait 8 seconds
Wait for the dashboard link to be visible
Wait for the username field to be present
```

`Wait 5 seconds` compiles to:

```json
{
  "action": "sleep",
  "args": {
    "seconds": 5
  }
}
```

`Wait 8 seconds` compiles to:

```json
{
  "action": "sleep",
  "args": {
    "seconds": 8
  }
}
```

### Pattern 20 — Windows and frames

**IR:** switchWindow, closeOtherWindows, switchFrame

**Form:** `Switch to the new tab` · `Switch back to the main tab` · `Close the other tabs` · `Switch to the "<name>" frame` · `Switch back to the main page`

```
Switch to the new tab
Switch back to the main tab
Close the other tabs
Switch to the "Embedded widget" frame
```

`Switch to the new tab` compiles to:

```json
{
  "action": "switchWindow",
  "args": {
    "which": {
      "kind": "literal",
      "value": "new"
    }
  }
}
```

`Switch back to the main tab` compiles to:

```json
{
  "action": "switchWindow",
  "args": {
    "which": {
      "kind": "literal",
      "value": "main"
    }
  }
}
```

### Pattern 21 — Dialogs

**IR:** dialog

**Form:** `Accept the dialog` · `Dismiss the dialog` · `Answer the dialog with "<text>"` · `Accept the dialog and check it said "<text>"`

```
Accept the dialog
Dismiss the dialog
Answer the dialog with "Atul"
Accept the dialog and check it said "Are you sure?"
```

`Accept the dialog` compiles to:

```json
{
  "action": "dialog",
  "args": {
    "action": {
      "kind": "literal",
      "value": "accept"
    }
  }
}
```

`Dismiss the dialog` compiles to:

```json
{
  "action": "dialog",
  "args": {
    "action": {
      "kind": "literal",
      "value": "dismiss"
    }
  }
}
```

### Pattern 22 — Read and capture

**IR:** read

**Form:** `Remember the text of the <target> as <name>` · `Remember the value of the <target> as <name>` · `Remember the "<attr>" attribute of the <target> as <name>` · `Remember the page title as <name>`

```
Remember the text of the schedule heading as enterprise
Remember the value of the username field as typedUser
Remember the "href" attribute of the docs link as docsHref
Remember the page title as pageTitle
```

`Remember the text of the schedule heading as enterprise` compiles to:

```json
{
  "action": "read",
  "target": {
    "ref": "schedule-heading",
    "phrase": "the schedule heading",
    "status": "unbound"
  },
  "capture": {
    "name": "enterprise",
    "from": "text"
  }
}
```

`Remember the value of the username field as typedUser` compiles to:

```json
{
  "action": "read",
  "target": {
    "ref": "username-field",
    "phrase": "the username field",
    "status": "unbound"
  },
  "capture": {
    "name": "typedUser",
    "from": "value"
  }
}
```

### Pattern 23 — Expect an element state

**IR:** expect

**Form:** `The <target> should be <state>` · `The <target> should not be <state>` · `The <target> should support multiple selection`

```
The sign in button should be visible
The login error should be hidden
The login submit should be enabled
The book now button should be disabled
```

`The sign in button should be visible` compiles to:

```json
{
  "action": "expect",
  "target": {
    "ref": "sign-in-button",
    "phrase": "the sign in button",
    "status": "unbound"
  },
  "expect": {
    "subject": "target",
    "predicate": {
      "kind": "visible"
    }
  }
}
```

`The login error should be hidden` compiles to:

```json
{
  "action": "expect",
  "target": {
    "ref": "login-error",
    "phrase": "the login error",
    "status": "unbound"
  },
  "expect": {
    "subject": "target",
    "predicate": {
      "kind": "hidden"
    }
  }
}
```

### Pattern 24 — Expect text, value, title, URL, attribute, style, tag, geometry

**IR:** expect

**Form:** `The <target> should say <value>` · `The <target> should contain <value>` · `The <target> should have the value <value>` · `The page title should be <value>` · `The URL should contain <value>` · `The <target> should have the "<name>" attribute <value>` · `The <target> should have the "<name>" style <value>` · `The <target> should be an "<tag>"` · `The <target> should be at <x>, <y>`

```
The schedule heading should say "Enterprise"
The schedule heading should say {enterprise}
The dashboard heading should contain "Welcome"
The username field should have the value "atul"
```

`The schedule heading should say "Enterprise"` compiles to:

```json
{
  "action": "expect",
  "target": {
    "ref": "schedule-heading",
    "phrase": "the schedule heading",
    "status": "unbound"
  },
  "expect": {
    "subject": "target",
    "predicate": {
      "kind": "text",
      "value": {
        "kind": "literal",
        "value": "Enterprise"
      }
    }
  }
}
```

`The schedule heading should say {enterprise}` compiles to:

```json
{
  "action": "expect",
  "target": {
    "ref": "schedule-heading",
    "phrase": "the schedule heading",
    "status": "unbound"
  },
  "expect": {
    "subject": "target",
    "predicate": {
      "kind": "text",
      "value": {
        "kind": "var",
        "name": "enterprise"
      }
    }
  }
}
```

### Pattern 25 — Evaluate and screenshot

**IR:** evaluate, screenshot

**Form:** `Run the script "<js>"` · `Run the script "<js>" and remember the result as <name>` · `Take a screenshot named "<name>"` · `Take a screenshot of the <target>`

```
Run the script "window.scrollTo(0, 0)"
Run the script "return document.title" and remember the result as title
Take a screenshot named "after-login"
Take a screenshot of the builds table
```

`Run the script "window.scrollTo(0, 0)"` compiles to:

```json
{
  "action": "evaluate",
  "args": {
    "script": {
      "kind": "literal",
      "value": "window.scrollTo(0, 0)"
    }
  }
}
```

`Run the script "return document.title" and remember the result as title` compiles to:

```json
{
  "action": "evaluate",
  "args": {
    "script": {
      "kind": "literal",
      "value": "return document.title"
    }
  },
  "capture": {
    "name": "title",
    "from": "result"
  }
}
```

### Pattern 26 — Call an API

**IR:** api

**Form:** `Call the "<name>" API` · `Call the "<name>" API and remember the response as <name>` · `Call the "<name>" API and remember "<jsonPath>" as <name>` · `Call the "<name>" API with the session cookies`

```
Call the "active count" API and remember the response as activeCount
Call the "active count" API and remember "$.activeCount" as activeCount
Call the "create booking" API with the session cookies
Call the "create booking" API and remember "$.id" as bookingId
```

`Call the "active count" API and remember the response as activeCount` compiles to:

```json
{
  "action": "api",
  "args": {
    "request": {
      "kind": "literal",
      "value": "active count"
    }
  },
  "capture": {
    "name": "activeCount",
    "from": "response"
  }
}
```

`Call the "active count" API and remember "$.activeCount" as activeCount` compiles to:

```json
{
  "action": "api",
  "args": {
    "request": {
      "kind": "literal",
      "value": "active count"
    }
  },
  "capture": {
    "name": "activeCount",
    "from": "response",
    "jsonPath": "$.activeCount"
  }
}
```

### Pattern 27 — Run another story

**IR:** invoke

**Form:** `Run the "<Story name>" story` · `Run the "<Story name>" story with <a>=<value>, <b>=<value>` · `… and remember <output> as <name>`

```
Run the "Validate login" story
Run the "Book a slot" story with date={data.date}
Run the "Book a slot" story with date={data.date} and remember bookingId as booking
Run the "Validate login" story with email={input.email}, password={data.pw}
```

`Run the "Validate login" story` compiles to:

```json
{
  "action": "invoke",
  "invoke": {
    "story": "Validate login",
    "inputs": {}
  }
}
```

`Run the "Book a slot" story with date={data.date}` compiles to:

```json
{
  "action": "invoke",
  "invoke": {
    "story": "Book a slot",
    "inputs": {
      "date": {
        "kind": "data",
        "path": "date"
      }
    }
  }
}
```

### Pattern 28 — Guards

**IR:** (a `guard` on the step)

**Form:** `Only if <predicate>, <sentence>` · `Unless <predicate>, <sentence>` · a standalone `Only if <predicate>` / `Unless <predicate>` line before a step

```
Only if the login error is hidden, click the sign in button
Unless the announcement banner is visible, click the dashboard link
Only if the URL contains "/login", type {input.email} into the username field
Unless the remember me box is checked, check the remember me box
```

`Only if the login error is hidden, click the sign in button` compiles to:

```json
{
  "action": "click",
  "target": {
    "ref": "sign-in-button",
    "phrase": "the sign in button",
    "status": "unbound"
  },
  "guard": {
    "subject": "target",
    "predicate": {
      "kind": "hidden"
    },
    "mode": "onlyIf"
  }
}
```

`Unless the announcement banner is visible, click the dashboard link` compiles to:

```json
{
  "action": "click",
  "target": {
    "ref": "dashboard-link",
    "phrase": "the dashboard link",
    "status": "unbound"
  },
  "guard": {
    "subject": "target",
    "predicate": {
      "kind": "visible"
    },
    "mode": "unless"
  }
}
```

### Pattern 29 — Scope predicates for guards

**IR:** (an `expr` guard predicate)

**Form:** `{name} is "<v>"` · `{name} is not empty` · `{name} is greater than <n>` · `{name} is less than <n>` · `{name} matches "<regex>"`

```
Only if {activeCount} is "3", click the refresh count button
Only if {activeCount} is not empty, click the refresh count button
Only if {activeCount} is greater than 3, click the refresh count button
Only if {activeCount} is less than 3, click the refresh count button
```

`Only if {activeCount} is "3", click the refresh count button` compiles to:

```json
{
  "action": "click",
  "target": {
    "ref": "refresh-count-button",
    "phrase": "the refresh count button",
    "status": "unbound"
  },
  "guard": {
    "subject": "scope",
    "predicate": {
      "kind": "expr",
      "left": {
        "kind": "var",
        "name": "activeCount"
      },
      "op": "eq",
      "right": {
        "kind": "literal",
        "value": "3"
      }
    },
    "mode": "onlyIf"
  }
}
```

`Only if {activeCount} is not empty, click the refresh count button` compiles to:

```json
{
  "action": "click",
  "target": {
    "ref": "refresh-count-button",
    "phrase": "the refresh count button",
    "status": "unbound"
  },
  "guard": {
    "subject": "scope",
    "predicate": {
      "kind": "expr",
      "left": {
        "kind": "var",
        "name": "activeCount"
      },
      "op": "ne",
      "right": {
        "kind": "literal",
        "value": ""
      }
    },
    "mode": "onlyIf"
  }
}
```

### Pattern 30 — Site tools (WebMCP)

**IR:** (an `act` preferring a `webmcp` candidate)

**Form:** `Use the "<tool name>" site tool` · `Use the "<tool name>" site tool with <a>=<value>`

```
Use the "book-slot" site tool
Use the "book-slot" site tool with date={data.date}
```

`Use the "book-slot" site tool` compiles to:

```json
{
  "action": "click",
  "target": {
    "ref": "book-slot-site-tool",
    "phrase": "the book-slot site tool",
    "status": "unbound"
  }
}
```

`Use the "book-slot" site tool with date={data.date}` compiles to:

```json
{
  "action": "click",
  "target": {
    "ref": "book-slot-site-tool",
    "phrase": "the book-slot site tool",
    "status": "unbound"
  },
  "args": {
    "date": {
      "kind": "data",
      "path": "date"
    }
  }
}
```

---

## 6. Custom typed steps (Tier 0) — REQ-LANG-15, REQ-LANG-16

The prose model needs an escape hatch for logic. A `steps/` directory of
TypeScript files exports `defineStep(template, meta, handler)`; the template is a
sentence with typed placeholders, and it is matched **before** the grammar
(LLD §5).

```ts
import { defineStep } from "@svatah/flow";

export default defineStep(
  "Transfer {amount:number} from {from:target} to {to:target}",
  { sideEffect: true, description: "Moves funds between two accounts" },
  async ({ surface, resolve, args, scope, expect }) => {
    const from = await resolve(args.from);
    const to = await resolve(args.to);
    await surface.act("click", from);
    await surface.act("type", to, { value: String(args.amount) });
    await expect(to, { kind: "value", value: { kind: "literal", value: String(args.amount) } });
  },
);
```

Placeholder types are `string`, `number`, `boolean`, `target` and `value`. A
`target` placeholder becomes a `TargetRef` the recorder grounds like any other; a
`value` placeholder accepts a quoted literal or a variable reference.

The handler receives a `StepContext` exposing only the surface, the resolver, the
scope, an expectation helper and audit. It cannot reach the adapter — that is a
type-level guarantee, not a convention.

A sentence that matches both a custom template and a grammar pattern is
`E_STEP_AMBIGUOUS`, naming both (REQ-LANG-16). Custom steps are human-authored,
so they carry no provenance; lint records `W_CUSTOM` so they stay visible.

```
Transfer 250 from the current account to the savings account
Transfer {input.amount} from the current account to the savings account
Seed the database with "bookings-fixture"
```

`Transfer 250 from the current account to the savings account` compiles to:

```json
{
  "action": "custom",
  "sideEffect": true,
  "custom": {
    "id": "steps/transfer.ts#default",
    "params": {
      "amount": {
        "kind": "literal",
        "value": "250"
      },
      "from": {
        "kind": "literal",
        "value": "accounts.current"
      },
      "to": {
        "kind": "literal",
        "value": "accounts.savings"
      }
    }
  }
}
```
---

## 7. The IR action vocabulary

Every sentence compiles to exactly one of these `Action` values (LLD §3.2). The
schema is [`packages/schema/json/ir.schema.json`](../packages/schema/json/ir.schema.json).

| Group | Actions | Patterns |
|---|---|---|
| Navigation | `navigate`, `back`, `forward`, `refresh` | 1, 2 |
| Pointer | `click`, `doubleClick`, `rightClick`, `hover`, `hoverAndClick`, `pressAndHold`, `release`, `dragTo` | 3–8 |
| Keyboard and input | `type`, `clear`, `press`, `keyDown`, `keyUp`, `submit`, `upload` | 9–14 |
| Selection | `selectOption`, `deselectOption`, `deselectAll`, `setChecked` | 15–17 |
| Scrolling | `scrollIntoView`, `scrollToTop`, `scrollToBottom` | 18 |
| Waiting | `sleep`, `waitFor` | 19 |
| Windows and frames | `switchWindow`, `closeOtherWindows`, `switchFrame` | 20 |
| Dialogs | `dialog` | 21 |
| Reading and diagnostics | `read`, `expect`, `evaluate`, `screenshot` | 22–25 |
| Services | `api` | 26 |
| Composition | `invoke` | 27 |
| Escape hatch | `custom` | §6 |

The 22 assert and validate actions of the Java vocabulary collapse into the single
`expect` action carrying a predicate (HLD ADR-7). The same predicates serve as
guards, which is why one collapse buys two features.

### Predicates

| Group | Kinds |
|---|---|
| State | `visible`, `hidden`, `enabled`, `disabled`, `checked`, `unchecked`, `selected`, `present`, `absent`, `multiSelect` |
| Value | `text`, `textContains`, `value`, `title`, `titleContains`, `url`, `urlContains`, `tag` |
| Named value | `attribute`, `css` |
| Geometry | `location`, `size`, `box` |
| Scope expression | `expr` with `eq`, `ne`, `gt`, `lt`, `matches` |

Any predicate may carry `negate: true`, which is what *should not be* compiles to.

---

## 8. Migrating v1 and v2 flows

`svatah migrate <src> <dest>` converts v1 and v2 flows, `.locator` files and
`.data` files into v3 flows, a seed bindings store and `data.yaml`, preserving
story names and step order (REQ-LANG-11). Nothing about v1 or v2 is supported at
run time — `migrate` is the only path.

### What v3 removes

| v1 / v2 | v3 | Why |
|---|---|---|
| `+action+` | the verb in the sentence | No sigils (constraint 1). |
| `~locator~`, `~xpath://…~`, `~id:username~` | a noun phrase, resolved through bindings | No locators in flows (constraint 2). |
| `*value*` | `"value"` | Literals are double-quoted (REQ-LANG-5). |
| `$[key:value]$` | `data.yaml` plus `{data.key}` | Data lives in one place (REQ-LANG-9). |
| `#var#`, `#story.var#`, `$key` | `{var}`, `{Story name.var}`, `{data.key}` | One brace form (REQ-LANG-6). |
| `var : name`, `var(type) : name` | `… as name`, `Remember … as name` | One capture form (REQ-LANG-7). |
| `story : Name` | `story: Name` | Unchanged apart from spacing. |

### Action mapping

The Java action names on the left are the vocabulary in
`legacy/src/main/java/com/svatah/automator/mappers/SeleniumActionMapper.java`;
the synonyms each one accepted are in `ActionSynonyms.java` and are carried into
Tier 1 as the sentence forms above (REQ-COMP-2).

| v1 / v2 action | v3 sentence | IR |
|---|---|---|
| `navigate`, `open` | `Open "<url>"` | `navigate` |
| `back`, `clicks on back button` | `Go back` | `back` |
| `forward`, `clicks on forward button` | `Go forward` | `forward` |
| `refresh`, `reload` | `Refresh the page` | `refresh` |
| `click` | `Click the <target>` | `click` |
| `doubleClick` | `Double-click the <target>` | `doubleClick` |
| `contextClick` | `Right-click the <target>` | `rightClick` |
| `moveToElement` | `Hover over the <target>` | `hover` |
| `moveToElementAndClick` | `Move to the <target> and click it` | `hoverAndClick` |
| `clickAndHold` | `Press and hold the <target>` | `pressAndHold` |
| `release` | `Release the <target>` | `release` |
| `type` | `Type "<v>" into the <target>` | `type` |
| `clear` | `Clear the <target>` | `clear` |
| `keyDown` | `Hold down the "<key>" key` | `keyDown` |
| `keyUp` | `Let go of the "<key>" key` | `keyUp` |
| `submit`, `click enter` | `Submit the <target>` | `submit` |
| `selectByVisibleText`, `select` | `Select "<label>" in the <target>` | `selectOption` |
| `selectByIndex` | `Select option <n> in the <target>` | `selectOption` |
| `selectByValue` | `Select the option with value "<v>" in the <target>` | `selectOption` |
| `deselectByVisibleText`, `deselect` | `Deselect "<label>" in the <target>` | `deselectOption` |
| `deselectByIndex` | `Deselect option <n> in the <target>` | `deselectOption` |
| `deselectByValue` | `Deselect the option with value "<v>" in the <target>` | `deselectOption` |
| `deselectAll`, `remove all selections` | `Deselect everything in the <target>` | `deselectAll` |
| `scrollIntoView` | `Scroll to the <target>` | `scrollIntoView` |
| `scrollToTop` | `Scroll to the top of the page` | `scrollToTop` |
| `scrollToBottom` | `Scroll to the bottom of the page` | `scrollToBottom` |
| `wait`, `sleep` | `Wait <n> seconds` | `sleep` |
| `explicitWaitForElementPresence` | `Wait for the <target> to be present` | `waitFor` |
| `explicitWaitForElementVisibility` | `Wait for the <target> to be visible` | `waitFor` |
| `switchToChildWindow`, `switch to new tab` | `Switch to the new tab` | `switchWindow` |
| `switchToMainWindow`, `switch to main tab` | `Switch back to the main tab` | `switchWindow` |
| `closeOtherWindows` | `Close the other tabs` | `closeOtherWindows` |
| `switchToFrame` | `Switch to the "<name>" frame` | `switchFrame` |
| `acceptAlert` | `Accept the dialog` | `dialog` |
| `dismissAlert` | `Dismiss the dialog` | `dialog` |
| `acceptAndValidateAlertText` | `Accept the dialog and check it said "<t>"` | `dialog` + `expect` |
| `rejectAndValidateAlertText` | `Dismiss the dialog and check it said "<t>"` | `dialog` + `expect` |
| `getText`, `save text`, `copy text` | `Remember the text of the <target> as <name>` | `read` |
| `assertDisplayed`, `isDisplayed` | `The <target> should be visible` | `expect` `visible` |
| `assertNotDisplayed` | `The <target> should be hidden` | `expect` `hidden` |
| `assertEnabled` | `The <target> should be enabled` | `expect` `enabled` |
| `assertDisabled` | `The <target> should be disabled` | `expect` `disabled` |
| `assertSelected` | `The <target> should be selected` | `expect` `selected` |
| `assertNotSelected` | `The <target> should not be selected` | `expect` `selected` negated |
| `assertElementPresent` | `The <target> should be present` | `expect` `present` |
| `assertAlertPresent` | `The dialog should be present` | `expect` `present` on the dialog |
| `assertAlertNotPresent` | `The dialog should be absent` | `expect` `absent` on the dialog |
| `assertMultipleSelectionSupported` | `The <target> should support multiple selection` | `expect` `multiSelect` |
| `assertMultipleSelectionNotSupported` | `The <target> should not support multiple selection` | `expect` `multiSelect` negated |
| `isMultipleSelectionSupported` | `The <target> should support multiple selection` | `expect` `multiSelect` |
| `validateText`, `verifyText` | `The <target> should say "<t>"` | `expect` `text` |
| `validateContainsText` | `The <target> should contain "<t>"` | `expect` `textContains` |
| `validateTitle` | `The page title should be "<t>"` | `expect` `title` |
| `validateTagName` | `The <target> should be an "<tag>"` | `expect` `tag` |
| `validateAttributeValue` | `The <target> should have the "<a>" attribute "<v>"` | `expect` `attribute` |
| `validateCssValue` | `The <target> should have the "<p>" style "<v>"` | `expect` `css` |
| `validateLocation` | `The <target> should be at <x>, <y>` | `expect` `location` |
| `validateDimension` | `The <target> should be <w> by <h>` | `expect` `size` |
| `validateRectangle` | `The <target> should occupy <x>, <y>, <w>, <h>` | `expect` `box` |
| `executeScript` | `Run the script "<js>"` | `evaluate` |
| `executeAsyncScript` | `Run the script "<js>"` | `evaluate` |
| `invoke`, `call`, `hit` (API) | `Call the "<name>" API` | `api` |

### Worked examples

The four flows the frozen Java project shipped are migrated by hand in
[`evals/fixtures/flows/`](../evals/fixtures/flows/), with the originals under
`legacy/src/test/resources/sample/`. They are the compatibility baseline
REQ-NFR-8 names.

Before (v1):

```
story : I want to validate login
user +clicks+ the ~sign in button~ on the home page
user +types+ the ~username~ as *connected2atul@gmail.com*
user +saves text+ as var : enterprise  for ~xpath://h1~ on the Schedule Build Page
user +validates text+ on the Schedule Build Page using ~xpath://h1~ with *#enterprise#*
```

After (v3):

```
story (tags=smoke): I want to validate login
inputs: email: string, password: secret
outputs: enterprise: string
  Click the sign in button
  Type {input.email} into the username field
  Remember the text of the schedule heading as enterprise
  The schedule heading should say {enterprise}
```

---

## 9. Lint

`svatah lint` reports (REQ-COMP-8):

| Code | Meaning |
|---|---|
| `W_AMBIGUOUS_TARGET` | A phrase matches more than one element. |
| `W_TIER2` | The step was compiled by the local model. |
| `W_TIER3` | The step was compiled by the frontier model. |
| `W_LOW_CONFIDENCE` | `origin.confidence` is below `compile.confidenceThreshold`. |
| `W_UNUSED_CAPTURE` | A captured name is never read. |
| `W_LONG_SLEEP` | A `sleep` of more than 5 seconds. |
| `W_CUSTOM` | The step is a Tier 0 custom step. |
| `W_SIDE_EFFECT_TOOL` | A story with side effects is exposed as a tool but is not marked `idempotent`. |

Errors, which fail the compile:

| Code | Meaning |
|---|---|
| `E_DUP_STORY` | Two stories share a name. |
| `E_TEST_EMPTY` | A `test:` / `run:` block names nothing. |
| `E_SIGIL` | A v1 or v2 sigil or an inline locator appears in a step. Points at `migrate`. |
| `E_VAR_UNDEFINED` | A reference is not defined earlier in order. |
| `E_VAR_REDEFINED` | A name is captured twice. |
| `E_OUTPUT_UNCAPTURED` | A declared output is never captured. |
| `E_INPUT_REQUIRED` | An input without a default was not supplied at run time. |
| `E_STEP_AMBIGUOUS` | A sentence matches both a custom step and a grammar pattern. |
| `E_UNKNOWN_STORY` | A `compose:`, `test:` or `invoke` names a story that does not exist. |
