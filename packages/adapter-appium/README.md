# @svatah/yam-adapter-appium

The Appium adapter: `AgentSurface` on Android and iOS (REQ-ADP-5, LLD §7.4).

One session, two worlds. Inside a **webview** the device is a browser and every
web candidate kind means what it means anywhere else; inside the **native app**
there is no DOM, and a screen is an XML page source converted into the same
snapshot shape a web page produces (REQ-SURF-4). Nothing above the surface knows
which of the two it is in — that is the point of the surface being a boundary.

## Configuring it

```yaml
# yam.config.yaml
adapter: appium
mobile:
  appium: "http://127.0.0.1:4723"
  capabilities:
    platformName: Android
    "appium:automationName": UiAutomator2
    "appium:deviceName": emulator-5554
    # A browser session (Android Chrome), or an app under test:
    browserName: Chrome
    # "appium:app": /path/to/sample.apk
app:
  # `10.0.2.2` is the emulator's route to the host machine.
  baseUrl: "http://10.0.2.2:4173"
```

| Variable | Meaning |
|---|---|
| `YAM_APPIUM_URL` | Where the Appium server is; overrides `mobile.appium` |
| `YAM_APPIUM_CAPS` | A JSON object of capabilities, merged **over** `mobile.capabilities` |

## The emulator gate

T4.2's Validate list has a half that no fake can establish, and this is it. The
adapter's conversion, candidate mapping, action table and predicates are unit
tested against recorded page sources and a fake device
(`pnpm --filter @svatah/yam-adapter-appium test`); what those cannot show is that a
real driver accepts these selectors and that a real screen looks like the
fixtures. Run this on a machine with an emulator:

```bash
# 1. A server and a device.
npm install -g appium
appium driver install uiautomator2
appium --port 4723 &
emulator -avd Pixel_7_API_34 -no-window &
adb wait-for-device

# 2. The sample application, reachable from the emulator at 10.0.2.2.
pnpm --filter sample-web start &

# 3. Android Chrome replays the migrated fixtures (T4.2's first Validate item).
cp -R evals/fixtures /tmp/appium-fixtures
sed -i '' 's/^adapter: playwright$/adapter: appium/' /tmp/appium-fixtures/yam.config.yaml
YAM_APPIUM_CAPS='{"platformName":"Android","appium:automationName":"UiAutomator2","browserName":"Chrome"}' \
YAM_BASE_URL=http://10.0.2.2:4173 \
  node packages/cli/dist/bin.js run /tmp/appium-fixtures --host none --flow flows/svatah.flow

# 4. The surface conformance subset that does not need windows, dialogs,
#    frames or a file picker — the capabilities a phone does not have.
YAM_APPIUM_CAPS='{"platformName":"Android","appium:automationName":"UiAutomator2","browserName":"Chrome"}' \
  node packages/cli/dist/bin.js surface conform --adapter appium \
    --base-url http://10.0.2.2:4173 \
    --only home.snapshot,home.click-navigates,login.snapshot-states,login.type-changes-value,\
login.checkbox-state,login.describe,login.locate-cardinality,dashboard.read-kinds,\
dashboard.state,widgets.select,errors.typed,capabilities.descriptor

# 5. Native: grounding and three steps against an app under test.
YAM_APPIUM_CAPS='{"platformName":"Android","appium:automationName":"UiAutomator2","appium:app":"/path/to/sample.apk"}' \
  node packages/cli/dist/bin.js record /tmp/native-project --gateway fake --rebind
```

Step 4 names a subset because the whole suite cannot pass on a phone and should
not: `widgets.dialog`, `widgets.frame`, `widgets.windows` and
`widgets.canvas-coords` need capabilities `APPIUM_CAPABILITIES` declares false,
and the suite skips a case whose capability is missing rather than failing it
(LLD §14). Running the whole suite is therefore also correct; the subset is what
a person watching wants to see.

## What a phone does not have

Capability flags declare it rather than emulating it (LLD §2.4). The executor
refuses a plan whose actions need a missing capability at start, not mid-run.

| Flag | | Why |
|---|---|---|
| `screenshot` | yes | `takeScreenshot`, masked by rewriting the PNG (see below) |
| `drag` | yes | W3C pointer actions with `pointerType: touch` |
| `restore` | yes | The context, and the URL when there is one |
| `dialogs` | **no** | A permission prompt is another application's window; an in-app modal is just more of the page source |
| `frames` | **no** | A phone has *contexts*, not frames. `switchFrame` switches context, which is the nearest thing the platform has |
| `windows` | **no** | There is one screen |
| `upload` | **no** | There is no file picker to drive |
| `trace` | **no** | Appium has no tracing |

## Masking a screenshot

The web adapters mask before the picture is taken — Playwright takes a mask
argument and the BiDi adapter paints an overlay into the page. Appium screenshots
the *device*, so there is nothing to paint into and the masking happens to the
PNG that comes back (`src/mask.ts`, about a page, with `node:zlib` doing the
compression).

It handles what the drivers emit — 8-bit RGB and RGBA, non-interlaced — and
**refuses** anything else rather than writing a picture it could not mask. A
refusal is recoverable; a screenshot of a password field is not (REQ-NFR-6).

## Why `AppiumClient` is an interface

WebdriverIO is the client, as LLD §7.4 chooses. It sits behind an interface so
that everything above it — the page-source conversion, the candidate mapping, the
context switching, the action table, the predicates — is testable without a
device. An adapter whose logic could only be exercised on an emulator would be an
adapter nobody could check, and the emulator gate above would be the only
evidence there ever was.
