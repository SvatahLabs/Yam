# Page-source fixtures

Android `uiautomator2` and iOS `XCUITest` page sources, in the exact shape those
drivers emit: `<hierarchy>` / `<AppiumAUT>` roots, class names as XML tags,
`bounds="[l,t][r,b]"` on Android and `x`/`y`/`width`/`height` on iOS, the boolean
attributes each driver publishes, and XML-escaped label text.

**They are hand-authored, not captured from a device.** No emulator was
available to this phase (see `docs/spec/progress/phase-4.md`, T4.2), so these
were written against the drivers' documented output rather than recorded from
one. What they exercise is the *conversion*: the role map, the accessible-name
order, the bounds arithmetic, the state derivation and the XPath builder — all of
which are pure functions of the XML and none of which need a device to be wrong.

What they cannot establish is that a real device emits exactly this. That is the
emulator gate, and `packages/adapter-appium/README.md` gives the commands.

| File | What it covers |
|---|---|
| `android-login.xml` | The common controls: a text view, two edit texts (one a password), a checkbox, an enabled button and a disabled one, and a hidden error with a zero box |
| `android-list.xml` | Repeated rows with identical text — the case an XPath candidate has to index — and an application's own `FancyButton` class, which no table names |
| `ios-login.xml` | The same screen through `XCUITest`: different tag names, different geometry attributes, `value="0"` instead of `checked="false"` |
