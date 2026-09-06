Adapters — the platforms a plan can replay on

The adapter is named in yam.config.yaml under adapter:, and every adapter
implements the same surface, so the plan and the bindings do not change
between them.

  playwright   web, the default; needs a browser: npx playwright install chromium
  bidi         web through WebDriver BiDi in a stock browser (Firefox, Chrome)
  http         named requests from api/*.yaml; no browser
  appium       Android Chrome and native apps; needs an Appium server
  uia          Windows applications through UI Automation; Windows only
  ax           macOS applications through Accessibility; needs the permission
               granted to the terminal (System Settings → Privacy & Security)

yam surface doctor --adapter ax|uia says whether this host is ready for a
desktop adapter. yam surface conform --adapter <name> runs the conformance
suite against one, which is how a new adapter proves itself.
