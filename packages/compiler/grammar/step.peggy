/*
 * The Tier 1 grammar (REQ-COMP-2, REQ-LANG-4..7, LLD §4.2).
 *
 * Patterns 1–30 of `docs/flow-language.md`, deterministic and offline. One
 * sentence in, one raw step out (REQ-COMP-1); a sentence it does not recognise
 * is a parse failure, which the compiler turns into `E_NO_MATCH` naming the
 * line.
 *
 * ## What this grammar deliberately does not know
 *
 * It emits *phrases* where targets go and *raw* value text where values go. It
 * has no dictionary, no data file and no secrets list, so it cannot resolve a
 * target to an element id or mark a data reference secret. `lower.ts` does that,
 * with the project in hand.
 *
 * The split is what makes the grammar testable on a sentence alone and what
 * keeps a project's configuration from changing which pattern a sentence hits.
 *
 * ## Ordering
 *
 * PEG choice is ordered, and several patterns are prefixes of others:
 * "Click the back button" is history, not a click on a button called "back";
 * "Move to X and click it" is hoverAndClick, not hover; "Run the script" is
 * evaluate, not an invoke of a story called "script". Each of those pairs is
 * ordered specific-first below, with a comment where the reason is not obvious.
 */

{{
  /** Collapse whitespace and lower-case a leading article, nothing else. */
  function phrase(raw) {
    const text = String(raw).trim().replace(/\s+/g, " ");
    return text.replace(/^(The|A|An)\b/, (word) => word.toLowerCase());
  }
  function target(raw, scope) {
    const out = { phrase: phrase(raw) };
    if (scope !== undefined) out.scope = scope;
    return out;
  }
  /** Drop undefined entries so the emitted object compares cleanly. */
  function step(parts) {
    const out = {};
    for (const [key, value] of Object.entries(parts)) {
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
}}

/* ── entry points ─────────────────────────────────────────────────────────── */

Step
  = _ g:GuardPrefix _ s:Sentence _ {
      return { ...s, guard: g };
    }
  / _ s:Sentence _ { return s; }

/** For a guard written on its own line, which the reader has already split off. */
GuardOnly
  = _ mode:GuardWord __ p:GuardBody _ { return { ...p, mode }; }

GuardPrefix
  = mode:GuardWord __ p:GuardBody _ "," { return { ...p, mode }; }

GuardWord
  = "only if"i { return "onlyIf"; }
  / "unless"i  { return "unless"; }

/* ── sentences, in the order patterns must be tried ───────────────────────── */

Sentence
  = History          // before Click: "Click the back button" is navigation
  / HoverAndClick    // before Hover: "Move to X and click it"
  / PressAndHold     // before Click:  "Click and hold X"
  / Navigate
  / DoubleClick
  / RightClick
  / Hover
  / Release
  / Drag
  / Type
  / Clear
  / KeyHold
  / Press
  / Submit
  / Upload
  / DeselectAll
  / Deselect
  / Select
  / SetChecked
  / Scroll
  / WaitForApi      // before WaitFor: "Wait for the "x" API to answer …"
  / WaitFor
  / Sleep
  / Frames
  / ResizeWindow    // before Windows: both start with a window noun
  / Windows
  / Quit
  / Dialog
  / Read
  / SetExpectation   // before Expectation: "Every button … should be visible"
                     // would otherwise read "Every button …" as a target phrase
  / Expectation
  / Evaluate
  / Screenshot
  / Api
  / SiteTool
  / Invoke
  / Click            // last of the pointer rules: it is the least specific

/* ── 1. navigate ──────────────────────────────────────────────────────────── */

Navigate
  = ("open"i / "navigate to"i / "navigates to"i / "go to"i / "opens"i) __ ("the"i __)? url:Value (__ "home page"i)? {
      return step({ action: "navigate", args: { url } });
    }

/* ── 2. history ───────────────────────────────────────────────────────────── */

History
  = ("go back"i / "click the back button"i / "clicks on the back button"i) { return step({ action: "back" }); }
  / ("go forward"i / "click the forward button"i / "clicks on the forward button"i) { return step({ action: "forward" }); }
  / ("refresh"i / "reload"i) __ "the page"i { return step({ action: "refresh" }); }

/* ── 3. click ─────────────────────────────────────────────────────────────── */

Click
  = ("click"i / "clicks"i) (__ "on"i)? __ t:Rest {
      return step({ action: "click", target: target(t) });
    }

/* ── 4. double and right click ────────────────────────────────────────────── */

DoubleClick
  = ("double-click"i / "double click"i / "double clicks"i) (__ "on"i)? __ t:Rest {
      return step({ action: "doubleClick", target: target(t) });
    }

RightClick
  = ("right-click"i / "right click"i / "context-click"i / "context click"i / "context clicks"i) (__ "on"i)? __ t:Rest {
      return step({ action: "rightClick", target: target(t) });
    }

/* ── 5, 6. hover ──────────────────────────────────────────────────────────── */

HoverAndClick
  = ("hover over"i / "move to"i / "moves to"i / "move over"i / "moves over"i) __ t:UntilAndClickIt __ "and click it"i {
      return step({ action: "hoverAndClick", target: target(t) });
    }

Hover
  = ("hover over"i / "hover on"i / "move to"i / "moves to"i / "move over"i / "moves over"i) __ t:Rest {
      return step({ action: "hover", target: target(t) });
    }

/* ── 7. press and hold, release ───────────────────────────────────────────── */

PressAndHold
  = ("press and hold"i / "click and hold"i / "clicks and holds"i) (__ "on"i)? __ t:Rest {
      return step({ action: "pressAndHold", target: target(t) });
    }

Release
  = ("release the mouse over"i / "release the mouse on"i / "release"i / "releases"i) __ t:Rest {
      return step({ action: "release", target: target(t) });
    }

/* ── 8. drag ──────────────────────────────────────────────────────────────── */

Drag
  = ("drag"i / "drags"i) __ a:UntilOnto __ ("onto"i / "on to"i / "to"i) __ b:Rest {
      return step({ action: "dragTo", target: target(a), target2: target(b) });
    }

/* ── 9. type ──────────────────────────────────────────────────────────────── */

Type
  = ("type"i / "types"i / "enter"i / "enters"i) __ v:Value __ ("into"i / "in"i) __ t:Rest {
      return step({ action: "type", target: target(t), args: { value: v } });
    }

/* ── 10. clear ────────────────────────────────────────────────────────────── */

Clear
  = ("clear"i / "clears"i) __ t:Rest { return step({ action: "clear", target: target(t) }); }

/* ── 11, 12. keys ─────────────────────────────────────────────────────────── */

Press
  = ("press"i / "presses"i) __ k:Value __ ("in"i / "on"i) __ t:Rest {
      return step({ action: "press", target: target(t), args: { key: k } });
    }
  / ("press"i / "presses"i) __ k:Value {
      return step({ action: "press", args: { key: k } });
    }

KeyHold
  = ("hold down"i / "holds down"i) __ ("the"i __)? k:Value (__ "key"i)? {
      return step({ action: "keyDown", args: { key: k } });
    }
  / ("let go of"i / "lets go of"i / "release the"i) __ ("the"i __)? k:Value (__ "key"i)? {
      return step({ action: "keyUp", args: { key: k } });
    }

/* ── 13. submit ───────────────────────────────────────────────────────────── */

Submit
  = ("submit"i / "submits"i) __ t:Rest { return step({ action: "submit", target: target(t) }); }

/* ── 14. upload ───────────────────────────────────────────────────────────── */

Upload
  = ("upload"i / "uploads"i / "attach"i / "attaches"i) __ v:Value __ ("to"i / "into"i) __ t:Rest {
      return step({ action: "upload", target: target(t), args: { path: v } });
    }

/* ── 15, 16. selects ──────────────────────────────────────────────────────── */

Select
  = "select the option with value"i __ v:Value __ "in"i __ t:Rest {
      return step({ action: "selectOption", target: target(t), args: { value: v } });
    }
  / ("select"i / "selects"i) __ "option"i __ n:Integer __ "in"i __ t:Rest {
      return step({ action: "selectOption", target: target(t), args: { index: n } });
    }
  / ("select"i / "selects"i) __ v:Value __ ("in"i / "from"i) __ t:Rest {
      return step({ action: "selectOption", target: target(t), args: { label: v } });
    }

Deselect
  = ("deselect"i / "deselects"i) __ "option"i __ n:Integer __ "in"i __ t:Rest {
      return step({ action: "deselectOption", target: target(t), args: { index: n } });
    }
  / ("deselect"i / "deselects"i) __ v:Value __ ("in"i / "from"i) __ t:Rest {
      return step({ action: "deselectOption", target: target(t), args: { label: v } });
    }

DeselectAll
  = ("deselect everything"i / "deselect all"i / "remove all selections"i) __ "in"i __ t:Rest {
      return step({ action: "deselectAll", target: target(t) });
    }

/* ── 17. checkboxes ───────────────────────────────────────────────────────── */

SetChecked
  = ("uncheck"i / "unchecks"i / "untick"i / "unticks"i) __ t:Rest {
      return step({ action: "setChecked", target: target(t), args: { checked: false } });
    }
  /*
   * `Check that …` is an assertion, not a checkbox (Draft 2.6, LLD §4.2).
   *
   * "Check the remember me box" ticks something; "Check that the sign in button
   * is visible" asserts something, and this rule is tried first. One word tells
   * them apart, which is why LLD §4.2 writes the alias as `Check that` and why
   * `AssertVerb` requires the `that` for this verb alone.
   */
  / ("check"i / "checks"i / "tick"i / "ticks"i) __ !("that"i !NameChar) t:Rest {
      return step({ action: "setChecked", target: target(t), args: { checked: true } });
    }

/* ── 18. scrolling ────────────────────────────────────────────────────────── */

Scroll
  = ("scroll"i / "scrolls"i) __ "to the top"i (__ "of the page"i)? { return step({ action: "scrollToTop" }); }
  / ("scroll"i / "scrolls"i) __ "to the bottom"i (__ "of the page"i)? { return step({ action: "scrollToBottom" }); }
  / ("scroll"i / "scrolls"i) __ t:UntilIntoView __ "into view"i {
      return step({ action: "scrollIntoView", target: target(t) });
    }
  / ("scroll"i / "scrolls"i) __ "to"i __ t:Rest {
      return step({ action: "scrollIntoView", target: target(t) });
    }

/* ── 19. waiting ──────────────────────────────────────────────────────────── */

Sleep
  = ("wait"i / "waits"i / "sleep"i / "sleeps"i) __ n:Number __ ("seconds"i / "second"i / "s"i) {
      return step({ action: "sleep", args: { seconds: n } });
    }

WaitFor
  = ("wait for"i / "waits for"i) __ t:UntilToBe __ "to be"i __ p:StateWord {
      return step({
        action: "waitFor",
        target: target(t),
        expect: { subject: "target", predicate: p },
      });
    }

/*
 * Pattern 19, extended to a service's answer (T12.7, LLD §13.9 Draft 2.15).
 *
 *   Wait for the "run status" API to answer "status" to be "passed"
 *   Wait for the "run status" API to answer "steps.0.status" to contain "pass"
 *
 * > pattern 19 extended to `Wait for the "<name>" API to answer <json-path>
 * > <predicate>` over a service response.
 *
 * Four of the parity gate's one-sided checks were the same shape: a button in
 * the ADE starts a *second* Svatah run and the flow has no way to wait for it
 * and read its result. A run is a thing the local service answers about, so
 * what was missing was not a new kind of waiting but a subject: this polls the
 * named request until the value at the JSON path satisfies the predicate, or
 * the step's timeout runs out.
 *
 * The request is a named one from `api/`, exactly as pattern 26's is, so the
 * URL, headers and method live in the project rather than in the sentence.
 */
WaitForApi
  = ("wait for"i / "waits for"i) __ "the"i __ name:QuotedText __ "api"i __ "to answer"i __
    path:QuotedText __ "to"i __ p:ApiPredicate {
      return step({
        action: "waitFor",
        args: { request: { literal: name }, jsonPath: { literal: path } },
        expect: { subject: "api", predicate: p },
      });
    }

/*
 * What a service's answer is compared with.
 *
 * `TargetPredicate`'s vocabulary is an element's — visible, enabled, checked —
 * and none of it means anything about a JSON value. These two do: the value at
 * the path *is* something, or *contains* it. `be` reads naturally here and does
 * not there, which is why this is its own rule rather than an alternative bolted
 * onto that one.
 */
ApiPredicate
  = ("be"i / "equal"i / "equals"i / "say"i / "says"i / "read"i / "reads"i) __ v:Value {
      return { kind: "text", value: v };
    }
  / ("contain"i / "contains"i) __ v:Value { return { kind: "textContains", value: v }; }
  / ("match"i / "matches"i) __ v:Value { return { kind: "textContains", value: v }; }

/* ── 20. windows and frames ───────────────────────────────────────────────── */

Windows
  = ("switch to"i / "switches to"i) __ "the new"i __ ("tab"i / "window"i) {
      return step({ action: "switchWindow", args: { which: { literal: "new" } } });
    }
  / ("switch back to"i / "switches back to"i / "switch to"i / "switches to"i) __ "the main"i __ ("tab"i / "window"i) {
      return step({ action: "switchWindow", args: { which: { literal: "main" } } });
    }
  / ("close the other"i / "closes the other"i) __ ("tabs"i / "windows"i) {
      return step({ action: "closeOtherWindows" });
    }

/* ── 33. resizing the window (T12.7, LLD §13.9 Draft 2.15) ────────────────── */

/*
 * "Resize the window to 1100 by 900."
 *
 * > pattern 33, `Resize the window to <w> by <h>` with `app.launch.size` as the
 * > initial size, performed through the window's size attribute.
 *
 * Three one-sided checks were toolbar rules measured at several widths, and
 * what stopped Svatah reaching them was that a flow could not change the width.
 * The numbers are bare, not quoted: they are a size, the same way pattern 24's
 * `should be 800 by 600` is one, and quoting them would make a size read like a
 * value somebody typed.
 */
ResizeWindow
  = ("resize"i / "resizes"i / "set"i / "sets"i) __ "the window"i __ ("to"i / "size to"i) __
    w:Number __ ("by"i / "x"i) __ h:Number {
      return step({ action: "resizeWindow", args: { width: w, height: h } });
    }

/* ── 31. quitting the application (T11.2, LLD §13.9) ──────────────────────── */

/*
 * "Quit the app", and the words a person would actually write for it.
 *
 * The desktop equivalent of closing the browser, and it is a *step* rather than
 * teardown because a flow that launches an application should be able to say
 * where it stops using it — LLD §13.9: "the language gains `Quit the app`
 * (pattern 31, `action: "quit"`), which ends the session through the graceful
 * route and fails if the process survives it."
 *
 * "Close the app" is here too, and it is deliberately not "close the window":
 * closing a window is something a window manager does and an application may
 * survive; quitting is what this means. A web adapter refuses the action
 * outright, the way a desktop adapter refuses `navigate`.
 */
Quit
  /*
   * Longest alternative first, in both choices.
   *
   * PEG does not backtrack into a choice that has already matched: `"quit"i`
   * matches the first four letters of "quits" and the sequence then fails on
   * the `s`, and `"app"i` matches the first three of "application" and leaves
   * `lication` for a caller that wants the end of the sentence. Both were real:
   * `Quits the application` and `Exit the application` fell through to a model
   * tier until this order was fixed.
   */
  = ("quits"i / "quit"i / "closes"i / "close"i / "exits"i / "exit"i) __ "the"i __
    ("application"i / "app"i) {
      return step({ action: "quit" });
    }

Frames
  = ("switch back to"i / "switches back to"i) __ "the main page"i {
      return step({ action: "switchFrame", args: { which: { literal: "main" } } });
    }
  / ("switch to"i / "switches to"i) __ "the"i __ name:QuotedText __ "frame"i {
      return step({ action: "switchFrame", target: target(`the ${name} frame`, "frame") });
    }

/* ── 21. dialogs ──────────────────────────────────────────────────────────── */

Dialog
  = ("accept"i / "accepts"i) __ "the dialog"i __ ("and check it said"i / "and validate"i) __ v:Value {
      return step({
        action: "dialog",
        args: { action: { literal: "accept" } },
        expect: { subject: "dialog", predicate: { kind: "text", value: v } },
      });
    }
  / ("dismiss"i / "dismisses"i / "reject"i / "rejects"i) __ "the dialog"i __ ("and check it said"i / "and validate"i) __ v:Value {
      return step({
        action: "dialog",
        args: { action: { literal: "dismiss" } },
        expect: { subject: "dialog", predicate: { kind: "text", value: v } },
      });
    }
  / ("answer"i / "answers"i) __ "the dialog with"i __ v:Value {
      return step({ action: "dialog", args: { action: { literal: "accept" }, text: v } });
    }
  / ("accept"i / "accepts"i) __ "the dialog"i { return step({ action: "dialog", args: { action: { literal: "accept" } } }); }
  / ("dismiss"i / "dismisses"i / "reject"i / "rejects"i) __ "the dialog"i { return step({ action: "dialog", args: { action: { literal: "dismiss" } } }); }

/* ── 22. read and capture ─────────────────────────────────────────────────── */

Read
  = Remember __ "the page title as"i __ n:Name {
      return step({ action: "read", capture: { name: n, from: "title" } });
    }
  / Remember __ "the page url as"i __ n:Name {
      return step({ action: "read", capture: { name: n, from: "url" } });
    }
  / Remember __ "the"i __ a:QuotedText __ "attribute of"i __ t:UntilAs __ "as"i __ n:Name {
      return step({
        action: "read",
        target: target(t),
        capture: { name: n, from: "attribute", attribute: a },
      });
    }
  / Remember __ "the"i __ kind:("text"i / "value"i) __ "of"i __ t:UntilAs __ "as"i __ n:Name {
      return step({
        action: "read",
        target: target(t),
        capture: { name: n, from: kind.toLowerCase() },
      });
    }

Remember = ("remember"i / "remembers"i / "save"i / "saves"i)

/* ── 23, 24. expectations ─────────────────────────────────────────────────── */

/*
 * Three surfaces, one IR (Draft 2.6, LLD §4.2).
 *
 * The `should` forms are canonical. The two families below say the same thing
 * and lower to the same step, because people writing a test write all three and
 * a grammar that accepted only one made the other two compile errors — or worse,
 * silently promoted them to the local model, where they cost a network round
 * trip to arrive at an answer the grammar already knew (Phase 4 verification,
 * F4; the synonym vocabulary listed the verbs all along).
 *
 *   The sign in button should be visible      canonical
 *   Expect the sign in button to be visible   infinitive
 *   Verify the sign in button is visible      third person
 *
 * The predicate rules are shared where the shape is shared: `Expect … to …` is
 * followed by exactly the infinitive `TargetPredicate` the `should` forms take,
 * so that family is three lines and no duplicated predicate table. The
 * third-person family needs its own — `says` rather than `say`, `has` rather
 * than `have` — and is `…Is` throughout.
 *
 * Page title and URL come before the target forms so "the page title" is read as
 * the subject it is rather than as an element phrase.
 */
Expectation
  = "the page title should"i __ p:TitlePredicate { return step({ action: "expect", expect: { subject: "page", predicate: p } }); }
  / "the url should"i __ p:UrlPredicate { return step({ action: "expect", expect: { subject: "page", predicate: p } }); }
  / ExpectVerb __ "the page title to"i __ p:TitlePredicate { return step({ action: "expect", expect: { subject: "page", predicate: p } }); }
  / ExpectVerb __ "the url to"i __ p:UrlPredicate { return step({ action: "expect", expect: { subject: "page", predicate: p } }); }
  / AssertVerb __ "the page title"i __ p:TitlePredicateIs { return step({ action: "expect", expect: { subject: "page", predicate: p } }); }
  / AssertVerb __ "the url"i __ p:UrlPredicateIs { return step({ action: "expect", expect: { subject: "page", predicate: p } }); }
  / ExpectVerb __ t:UntilTo __ "to"i __ p:TargetPredicate {
      return step({ action: "expect", target: target(t), expect: { subject: "target", predicate: p } });
    }
  / AssertVerb __ t:UntilIsVerb __ p:TargetPredicateIs {
      return step({ action: "expect", target: target(t), expect: { subject: "target", predicate: p } });
    }
  /*
   * A target phrase never begins with a quantifier (pattern 32, T12.7).
   *
   * Without this, `Every widget on this screen should have an id` — a noun the
   * set rule does not have — falls through to here and compiles into an
   * assertion about an *element* called "Every widget on this screen", which
   * fails at run time with a locator error naming a phrase nobody wrote. The
   * noun list is closed so that a typo is a compile error; this is what makes
   * it one.
   */
  / !(Quantifier __) t:UntilShould __ "should"i __ p:TargetPredicate {
      return step({ action: "expect", target: target(t), expect: { subject: "target", predicate: p } });
    }

/* ── 32. an assertion over a set (T12.7, LLD §13.9 Draft 2.15) ────────────── */

/*
 * A quantifier, a noun, a scope, and a predicate.
 *
 *   Every button on this screen should have an id
 *   No text on this screen should contain {data.card.number}
 *   Every row of the headers table should be visible
 *   No control in the settings pane should say "sk-"
 *
 * > pattern 32, an assertion over a set with a quantifier and a scope.
 *
 * This is the sentence a third of the parity gate's one-sided list was waiting
 * for. Patterns 23 and 24 assert about *one* element; nineteen of the checks
 * assert about all the rows of a table, all the controls on a screen, or that
 * no text anywhere is a secret — and every one of them recorded "the language
 * asserts about one element, not about a set" as a shortcoming (LLD §13.9).
 *
 * The **scope** is the step's own target, which is what makes this one pattern
 * rather than two: `of the headers table` and `in the settings pane` carry a
 * phrase the dictionary resolves and the resolver resolves, exactly like the
 * target of a click. `on this screen` carries none, and none means the window.
 *
 * There is no `Some …`: an existential over a set is what `The x should be
 * visible` already says about one element.
 */
SetExpectation
  = q:Quantifier __ noun:SetNoun __ ("of"i / "in"i / "on"i) __ !ThisScreen t:UntilShould __
    "should"i __ p:TargetPredicate {
      return step({
        action: "expect",
        target: target(t),
        expect: { subject: "set", predicate: p, set: { quantifier: q, of: noun } },
      });
    }
  / q:Quantifier __ noun:SetNoun (__ ("of"i / "in"i / "on"i) __ ThisScreen)? __
    "should"i __ p:TargetPredicate {
      return step({
        action: "expect",
        expect: { subject: "set", predicate: p, set: { quantifier: q, of: noun } },
      });
    }

/** The window, said the way a person says it. */
ThisScreen
  = ("this"i / "the"i) __ ("screen"i / "window"i / "page"i) !NameChar

Quantifier
  = "every"i !NameChar { return "every"; }
  / "each"i  !NameChar { return "every"; }
  / "all"i   !NameChar { return "every"; }
  / "no"i    !NameChar { return "no"; }
  / "none of the"i     { return "no"; }

/*
 * The nouns a set is made of, normalised to the singular.
 *
 * They are a closed list rather than any word, because the executor maps each
 * onto snapshot roles and a noun it cannot map is a step that would quietly
 * assert about nothing — which passes. A sentence that names a noun not here is
 * `E_NO_MATCH` and says so at compile time, where a typo belongs.
 */
SetNoun
  = ("controls"i / "control"i)     !NameChar { return "control"; }
  / ("buttons"i / "button"i)       !NameChar { return "button"; }
  / ("links"i / "link"i)           !NameChar { return "link"; }
  / ("fields"i / "field"i)         !NameChar { return "field"; }
  / ("rows"i / "row"i)             !NameChar { return "row"; }
  / ("cells"i / "cell"i)           !NameChar { return "cell"; }
  / ("headings"i / "heading"i)     !NameChar { return "heading"; }
  / ("items"i / "item"i)           !NameChar { return "item"; }
  / ("tabs"i / "tab"i)             !NameChar { return "tab"; }
  / ("checkboxes"i / "checkbox"i)  !NameChar { return "checkbox"; }
  / ("text"i / "texts"i)           !NameChar { return "text"; }
  / ("elements"i / "element"i)     !NameChar { return "element"; }

/** `Expect [that] …`, which is followed by an infinitive. */
ExpectVerb = ("expect"i / "expects"i) (__ "that"i !NameChar)?

/**
 * `Verify [that] …` and its synonyms, which are followed by a third person.
 *
 * LLD §4.2 names `Verify`, `Check that`, `Assert that`, `Ensure`, `Make sure`
 * and `Confirm`. `that` is optional after all of them rather than required
 * after two: "Check the sign in button is visible" is the same sentence.
 *
 * `Confirm the alert` is not an expectation and must stay one: it has no
 * predicate, so `TargetPredicateIs` finds nothing to match and the whole
 * alternative fails, exactly as it did before this rule existed.
 */
AssertVerb
  = ("verify"i / "verifies"i / "assert"i / "asserts"i / "ensure"i / "ensures"i
    / "make sure"i / "makes sure"i / "confirm"i / "confirms"i) (__ "that"i !NameChar)?
  /*
   * `Check` needs its `that`, because `Check the remember me box` is pattern 17
   * and has been since Draft 1. LLD §4.2 spells the alias `Check that` for
   * exactly this reason.
   */
  / ("check"i / "checks"i) __ "that"i !NameChar

TitlePredicateIs
  = ("contains"i / "contain"i) __ v:Value { return { kind: "titleContains", value: v }; }
  / ("is"i / "says"i / "reads"i / "equals"i) __ v:Value { return { kind: "title", value: v }; }

UrlPredicateIs
  = ("contains"i / "contain"i) __ v:Value { return { kind: "urlContains", value: v }; }
  / ("is"i / "says"i / "equals"i) __ v:Value { return { kind: "url", value: v }; }

/**
 * The third-person mirror of `TargetPredicate`, in the same order.
 *
 * The order is not cosmetic: `is 800 by 600` has to be tried before
 * `is a "<tag>"` and both before the bare state words, or a size is read as a
 * tag and a tag as a state.
 */
TargetPredicateIs
  = ("says"i / "reads"i) __ v:Value { return { kind: "text", value: v }; }
  / ("contains"i / "contain"i) __ v:Value { return { kind: "textContains", value: v }; }
  / "has the value"i __ v:Value { return { kind: "value", value: v }; }
  / "has the"i __ a:QuotedText __ "attribute"i __ v:Value { return { kind: "attribute", name: a, value: v }; }
  / "has the"i __ a:QuotedText __ "style"i __ v:Value { return { kind: "css", name: a, value: v }; }
  / "supports multiple selection"i { return { kind: "multiSelect" }; }
  / ("does not support"i / "supports no"i) __ "multiple selection"i { return { kind: "multiSelect", negate: true }; }
  / "is at"i __ ns:NumberList { return { kind: "location", numbers: ns }; }
  / "occupies"i __ ns:NumberList { return { kind: "box", numbers: ns }; }
  / "is"i __ w:Number __ "by"i __ h:Number { return { kind: "size", numbers: [w, h] }; }
  / ("is an"i / "is a"i) __ v:Value { return { kind: "tag", value: v }; }
  / "is not"i __ p:StateWord { return { ...p, negate: true }; }
  / "is"i __ p:StateWord { return p; }

TitlePredicate
  = ("contain"i / "contains"i) __ v:Value { return { kind: "titleContains", value: v }; }
  / ("be"i / "say"i / "says"i) __ v:Value { return { kind: "title", value: v }; }

UrlPredicate
  = ("contain"i / "contains"i) __ v:Value { return { kind: "urlContains", value: v }; }
  / ("be"i / "say"i / "says"i) __ v:Value { return { kind: "url", value: v }; }

TargetPredicate
  = ("say"i / "says"i / "read"i / "reads"i) __ v:Value { return { kind: "text", value: v }; }
  / ("contain"i / "contains"i) __ v:Value { return { kind: "textContains", value: v }; }
  /*
   * "have an id", "have a name" — a property that is there rather than one that
   * equals something (pattern 32, T12.7).
   *
   * "Every interactive control on the Flows screen is named and id'd" is a
   * Playwright case and was a one-sided check for exactly this: the language
   * could ask what an attribute *equals*, and the question is whether there is
   * one at all. `negate` on an empty value is that question, in the predicate
   * the IR already has: the attribute is not the empty string.
   */
  / "have an id"i !NameChar { return { kind: "attribute", name: "id", value: { literal: "" }, negate: true }; }
  / "have a name"i !NameChar { return { kind: "attribute", name: "name", value: { literal: "" }, negate: true }; }
  / "have no id"i !NameChar { return { kind: "attribute", name: "id", value: { literal: "" } }; }
  / "have no name"i !NameChar { return { kind: "attribute", name: "name", value: { literal: "" } }; }
  / "have the value"i __ v:Value { return { kind: "value", value: v }; }
  / "have the"i __ a:QuotedText __ "attribute"i __ v:Value { return { kind: "attribute", name: a, value: v }; }
  / "have the"i __ a:QuotedText __ "style"i __ v:Value { return { kind: "css", name: a, value: v }; }
  / "support multiple selection"i { return { kind: "multiSelect" }; }
  / "not support multiple selection"i { return { kind: "multiSelect", negate: true }; }
  / "be at"i __ ns:NumberList { return { kind: "location", numbers: ns }; }
  / "occupy"i __ ns:NumberList { return { kind: "box", numbers: ns }; }
  / "be"i __ w:Number __ "by"i __ h:Number { return { kind: "size", numbers: [w, h] }; }
  / ("be an"i / "be a"i) __ v:Value { return { kind: "tag", value: v }; }
  / "not be"i __ p:StateWord { return { ...p, negate: true }; }
  / "be"i __ p:StateWord { return p; }

StateWord
  = "visible"i    { return { kind: "visible" }; }
  / "hidden"i     { return { kind: "hidden" }; }
  / "enabled"i    { return { kind: "enabled" }; }
  / "disabled"i   { return { kind: "disabled" }; }
  / "unchecked"i  { return { kind: "unchecked" }; }
  / "checked"i    { return { kind: "checked" }; }
  / "selected"i   { return { kind: "selected" }; }
  / "present"i    { return { kind: "present" }; }
  / "absent"i     { return { kind: "absent" }; }

/* ── 25. scripts and screenshots ──────────────────────────────────────────── */

Evaluate
  = ("run"i / "runs"i / "execute"i / "executes"i) __ "the script"i __ v:Value __ "and remember the result as"i __ n:Name {
      return step({ action: "evaluate", args: { script: v }, capture: { name: n, from: "result" } });
    }
  / ("run"i / "runs"i / "execute"i / "executes"i) __ "the script"i __ v:Value {
      return step({ action: "evaluate", args: { script: v } });
    }

Screenshot
  = ("take"i / "takes"i) __ "a screenshot named"i __ v:Value {
      return step({ action: "screenshot", args: { name: v } });
    }
  / ("take"i / "takes"i) __ "a screenshot of"i __ t:Rest {
      return step({ action: "screenshot", target: target(t) });
    }
  / ("take"i / "takes"i) __ "a screenshot"i { return step({ action: "screenshot" }); }

/* ── 26. API ──────────────────────────────────────────────────────────────── */

Api
  = ("call"i / "calls"i / "invoke"i / "invokes"i / "hit"i / "hits"i) __ "the"i __ name:QuotedText __ "api"i __ "and remember the response as"i __ n:Name {
      return step({
        action: "api",
        args: { request: { literal: name } },
        capture: { name: n, from: "response" },
      });
    }
  / ("call"i / "calls"i / "invoke"i / "invokes"i / "hit"i / "hits"i) __ "the"i __ name:QuotedText __ "api"i __ "and remember"i __ path:QuotedText __ "as"i __ n:Name {
      return step({
        action: "api",
        args: { request: { literal: name } },
        capture: { name: n, from: "response", jsonPath: path },
      });
    }
  / ("call"i / "calls"i / "invoke"i / "invokes"i / "hit"i / "hits"i) __ "the"i __ name:QuotedText __ "api"i __ "with the session cookies"i {
      return step({ action: "api", args: { request: { literal: name }, withSessionCookies: true } });
    }
  / ("call"i / "calls"i / "invoke"i / "invokes"i / "hit"i / "hits"i) __ "the"i __ name:QuotedText __ "api"i __ "without cookies"i {
      return step({ action: "api", args: { request: { literal: name }, withSessionCookies: false } });
    }
  / ("call"i / "calls"i / "invoke"i / "invokes"i / "hit"i / "hits"i) __ "the"i __ name:QuotedText __ "api"i {
      return step({ action: "api", args: { request: { literal: name } } });
    }

/* ── 27. invoke another story ─────────────────────────────────────────────── */

Invoke
  = ("run"i / "runs"i) __ "the"i __ name:QuotedText __ "story"i __ "with"i __ inputs:InputList __ "and remember"i __ out:Name __ "as"i __ n:Name {
      return step({ action: "invoke", invoke: { story: name, inputs }, capture: { name: n, from: "output" } });
    }
  / ("run"i / "runs"i) __ "the"i __ name:QuotedText __ "story"i __ "with"i __ inputs:InputList {
      return step({ action: "invoke", invoke: { story: name, inputs } });
    }
  / ("run"i / "runs"i) __ "the"i __ name:QuotedText __ "story"i __ "and remember"i __ out:Name __ "as"i __ n:Name {
      return step({ action: "invoke", invoke: { story: name, inputs: {} }, capture: { name: n, from: "output" } });
    }
  / ("run"i / "runs"i) __ "the"i __ name:QuotedText __ "story"i {
      return step({ action: "invoke", invoke: { story: name, inputs: {} } });
    }

InputList
  = head:InputPair tail:(_ ("," / "and"i) _ !("remember"i) p:InputPair { return p; })* {
      const out = {};
      for (const pair of [head, ...tail]) out[pair.name] = pair.value;
      return out;
    }

InputPair
  = n:Name _ "=" _ v:Value { return { name: n, value: v }; }

/* ── 30. site tools (WebMCP, P2) ──────────────────────────────────────────── */

SiteTool
  = ("use"i / "uses"i) __ "the"i __ name:QuotedText __ "site tool"i __ "with"i __ args:InputList {
      return step({ action: "click", target: target(`the ${name} site tool`), args });
    }
  / ("use"i / "uses"i) __ "the"i __ name:QuotedText __ "site tool"i {
      return step({ action: "click", target: target(`the ${name} site tool`) });
    }

/* ── 28, 29. guard bodies ─────────────────────────────────────────────────── */

GuardBody
  = "the url"i __ p:UrlGuard { return { subject: "page", predicate: p }; }
  / "the page title"i __ p:TitleGuard { return { subject: "page", predicate: p }; }
  / left:Reference __ op:ExprOp __ right:ExprValue {
      return { subject: "scope", predicate: { kind: "expr", left, op, right } };
    }
  / left:Reference __ "is not empty"i {
      return { subject: "scope", predicate: { kind: "expr", left, op: "ne", right: { literal: "" } } };
    }
  / left:Reference __ "is empty"i {
      return { subject: "scope", predicate: { kind: "expr", left, op: "eq", right: { literal: "" } } };
    }
  /*
   * The phrase is carried, not dropped (T5.4).
   *
   * The IR's guard has a subject and a predicate and no target of its own
   * (LLD §3.2): a `target` guard is about the element *the step acts on*. The
   * grammar accepts a noun phrase here because that is how the sentence reads,
   * and the compiler compares it with the step's own target — so
   * `Only if the booking result is visible, Click the pay button` is a compile
   * error naming both, rather than a guard that silently asks about the pay
   * button (HLD principle 7: fail at authoring, not at replay).
   */
  / t:UntilIs __ "is not"i __ p:StateWord { return { subject: "target", predicate: { ...p, negate: true }, phrase: t }; }
  / t:UntilIs __ "is"i __ p:StateWord { return { subject: "target", predicate: p, phrase: t }; }

UrlGuard
  = ("contains"i / "contain"i) __ v:Value { return { kind: "urlContains", value: v }; }
  / ("is"i / "equals"i) __ v:Value { return { kind: "url", value: v }; }

TitleGuard
  = ("contains"i / "contain"i) __ v:Value { return { kind: "titleContains", value: v }; }
  / ("is"i / "equals"i) __ v:Value { return { kind: "title", value: v }; }

ExprOp
  = "is greater than"i { return "gt"; }
  / "is less than"i    { return "lt"; }
  / "matches"i         { return "matches"; }
  / "is not"i          { return "ne"; }
  / "is"i              { return "eq"; }

/** A guard's right-hand side: a quoted literal, a reference, or a bare number. */
ExprValue
  = v:Value { return v; }
  / n:Number { return { literal: String(n) }; }

/* ── values (REQ-LANG-5, 6) ───────────────────────────────────────────────── */

Value
  = s:QuotedString { return s; }
  / r:Reference { return r; }

/**
 * A quoted literal, which becomes a template when it embeds `{…}` references.
 *
 * `"BK-{bookingId}"` is one value made of two parts, not a literal containing
 * braces: the run has to substitute the capture (REQ-LANG-6).
 */
QuotedString
  = '"' parts:QuotedPart* '"' {
      if (parts.length === 1 && parts[0].literal !== undefined) return { literal: parts[0].literal };
      if (parts.length === 0) return { literal: "" };
      if (parts.every((p) => p.literal !== undefined)) {
        return { literal: parts.map((p) => p.literal).join("") };
      }
      return { template: parts };
    }

/*
 * A quoted literal's parts, with the escapes a multi-line value needs (T12.7).
 *
 * > `Type` accepts a multi-line value.
 *
 * A flow's step is one line — the file grammar says so (LLD §4.1) — so a value
 * with a newline in it has to be written with an escape, and until Draft 2.15
 * `\n` in a quoted string was a backslash followed by an `n`. "A flow is edited
 * and saved through the ADE" was a one-sided check because of it: typing a
 * whole flow file into a text area is a multi-line value and nothing else.
 *
 * Four escapes and no more: `\n`, `\t`, `\"` and `\\`. Anything else after a
 * backslash stays as it was written, so a Windows path in a value does not
 * silently lose its separators.
 */
QuotedPart
  = r:Reference { return r; }
  / chars:$(("\\" .) / (!('"' / "{" / "\\") .))+ {
      return {
        literal: chars.replace(/\\([\s\S])/g, (whole, one) =>
          one === "n" ? "\n" : one === "t" ? "\t" : one === '"' ? '"' : one === "\\" ? "\\" : whole,
        ),
      };
    }

/** The bare text of a quoted string, for names that are not values. */
QuotedText
  = '"' chars:$(!'"' .)* '"' { return chars; }

/**
 * `{name}`, `{Story name.name}`, `{data.path}`, `{input.name}` (REQ-LANG-6).
 *
 * `data` and `input` are reserved first segments; anything else with a dot is a
 * story-scoped capture, because a story name may contain spaces and a capture
 * name may not.
 */
Reference
  = "{" _ text:$(!"}" .)+ _ "}" {
      const raw = text.trim();
      if (raw.startsWith("data.")) return { data: raw.slice(5) };
      if (raw.startsWith("input.")) return { input: raw.slice(6) };
      const dot = raw.lastIndexOf(".");
      if (dot > 0) return { var: raw.slice(dot + 1), story: raw.slice(0, dot) };
      return { var: raw };
    }

/* ── scalars ──────────────────────────────────────────────────────────────── */

Name = $([A-Za-z_][A-Za-z0-9_]*)

Integer = digits:$("-"? [0-9]+) { return parseInt(digits, 10); }

Number = digits:$("-"? [0-9]+ ("." [0-9]+)?) { return parseFloat(digits); }

NumberList
  = head:Number tail:(_ "," _ n:Number { return n; })* { return [head, ...tail]; }

/* ── text runs ────────────────────────────────────────────────────────────── */

/** Everything to the end of the sentence. */
Rest = chars:$(.+) { return chars; }

/*
 * Everything up to the next occurrence of a keyword, as a whole word.
 *
 * Used where a target phrase is followed by a keyword rather than by the end of
 * the sentence — "Drag X onto Y", "The X should be visible". Matching the
 * keyword as a whole word is what stops "the shoulder strap" ending a phrase at
 * "should".
 *
 * peggy has no parameterised rules, so there is one rule per keyword. They are
 * mechanical and identical apart from the keyword, which is the price of not
 * hand-rolling a parser.
 */
UntilAndClickIt = chars:$((!(__ "and click it"i !NameChar) .)+) { return chars; }
UntilOnto       = chars:$((!(__ ("onto"i / "on to"i / "to"i) !NameChar) .)+) { return chars; }
UntilIntoView   = chars:$((!(__ "into view"i !NameChar) .)+) { return chars; }
UntilToBe       = chars:$((!(__ "to be"i !NameChar) .)+) { return chars; }
UntilAs         = chars:$((!(__ "as"i !NameChar) .)+) { return chars; }
UntilShould     = chars:$((!(__ "should"i !NameChar) .)+) { return chars; }
UntilIs         = chars:$((!(__ ("is not"i / "is"i) !NameChar) .)+) { return chars; }
UntilTo         = chars:$((!(__ "to"i !NameChar) .)+) { return chars; }
/*
 * Up to the verb a third-person expectation turns on (Draft 2.6, LLD §4.2).
 *
 * Third person only — `says`, not `say`. The set is what ends a target phrase,
 * and every word in it is one a phrase might otherwise contain: "the read more
 * link is visible" must end at `is`, not at `read`. Restricting the set to the
 * conjugated forms is what buys that, and costs nothing, because after
 * `Verify the …` the predicate is third person anyway.
 */
UntilIsVerb     = chars:$((!(__ ("is"i / "says"i / "reads"i / "contains"i / "has"i
                             / "supports"i / "occupies"i / "does"i) !NameChar) .)+) { return chars; }

NameChar = [A-Za-z0-9_-]

_  = [ \t]*
__ = [ \t]+
