/**
 * Electron Forge, with the Vite plus TypeScript layout (T3.6, LLD §13.6).
 *
 * Three entry points, because an Electron application is three programs: the
 * main process (Node), the preload script (both sides, and the only code that
 * is), and the renderer (a browser). Keeping them separate in the build is what
 * keeps them separate at run time.
 *
 * ## The fuses
 *
 * `@electron/fuses` flips the run-time switches Electron's security checklist
 * asks for, in the packaged binary rather than in a code path someone could
 * forget. `RunAsNode` off is the important one: with it on, the packaged app can
 * be re-launched as a plain Node process with the app's own privileges.
 *
 * ## Signing
 *
 * Off unless the environment asks, and never for the test build. What the
 * owner creates, the secret names, and how to check a signed build by hand are
 * in `docs/project/signing.md`; `tools/repo-checks/test/installers.test.ts`
 * loads this file under each environment and holds it to that.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import type { ForgeConfig, ForgePackagerOptions } from "@electron-forge/shared-types";

/**
 * The test build's own identity (P10-F7, T11.1).
 *
 * The Phase 10 verification: "the suite's app cases assume they own the
 * machine's APP_DIR. They stop leftovers by path, so any other instance, a gate run
 * or a person's, fails them." The two callers in this repository — the
 * Playwright cases in `test/shell.spec.ts` and the desktop gate in
 * `scripts/desktop-conformance.mjs` — both packaged into `out/` and both looked
 * for a process called `Yam`, so running the suite beside the gate meant
 * each one stopping the other's application mid-case.
 *
 * `YAM_APP_TEST_BUILD=1` (which `node scripts/package-app.mjs --test` sets)
 * gives the suite's build a product name, a bundle identifier and an output
 * directory of its own. Then `pgrep -f <executable>` cannot match the other's,
 * the accessibility bridge's `--process "Yam"` cannot address it, and a
 * person's own app — installed anywhere — is untouched by either.
 */
const testBuild = process.env["YAM_APP_TEST_BUILD"] === "1";
const productName = testBuild ? "Yam Test" : "Yam";
const here = dirname(fileURLToPath(import.meta.url));
/** `app-icon.icns`, `.ico` and `.png` — see `packages/ui/brand/README.md`. */
const appIcon = resolve(here, "..", "..", "packages", "ui", "brand", "app-icon");

/**
 * An environment variable, with the empty string read as unset.
 *
 * GitHub Actions expands a secret the repository does not have to `""`, not to
 * nothing, so `APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}`
 * on a fork sets the variable. Reading presence rather than content would try
 * to sign with an identity called "" and fail the build that was meant to come
 * out unsigned.
 */
function setting(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}

type MacSignOptions = Exclude<NonNullable<ForgePackagerOptions["osxSign"]>, true>;
type MacNotarizeOptions = NonNullable<ForgePackagerOptions["osxNotarize"]>;
/*
 * The subset of @electron/windows-sign's options both consumers accept. Not the
 * packager's own `WindowsSignOptions`: it and electron-winstaller reach the
 * same package through its ESM and CJS type files, whose `HASHES` enums
 * TypeScript treats as two unrelated types, so neither type is assignable to
 * the other even though the objects are identical.
 */
interface WindowsSignOptions {
  certificateFile: string;
  certificatePassword?: string;
  description: string;
  website: string;
}

/**
 * macOS: Developer ID signing, with the hardened runtime.
 *
 * `APPLE_SIGNING_IDENTITY` is the certificate's common name, "Developer ID
 * Application: <team> (<team id>)", or its SHA-1 hash; either is what `security
 * find-identity -v -p codesigning` prints. `APPLE_KEYCHAIN` is optional and
 * names the keychain it is in, which is how the release workflow's temporary
 * keychain is found without touching the runner's login keychain.
 *
 * @electron/osx-sign walks the whole bundle and signs every binary file it
 * finds, deepest first. That includes `Resources/yam`, the bundled CLI, whose
 * `node_modules` carries prebuilt shared libraries (`bare-fs`, `bare-url`) for
 * several platforms. Notarization rejects a bundle with a single unsigned
 * Mach-O file in it, so nothing is excluded from the walk.
 *
 * Entitlements are per file. The application and its plain helper get
 * `build/entitlements.mac.plist`, which explains each key it has and each it
 * leaves out. The GPU, renderer and plugin helpers keep @electron/osx-sign's
 * defaults, which are Chromium's own per-helper sets; one list for every helper
 * would give each of them the union.
 *
 * `continueOnError: false` because @electron/packager defaults it to `true`:
 * a signing failure is logged as a warning and the build carries on, unsigned,
 * with a successful exit. A release that asked for a signature and did not get
 * one should stop there. The option is real but missing from the published
 * type, hence the widened object.
 */
const macEntitlements = resolve(here, "build", "entitlements.mac.plist");
const appleIdentity = testBuild ? undefined : setting("APPLE_SIGNING_IDENTITY");

function macSigning(identity: string): MacSignOptions {
  if (!existsSync(macEntitlements)) {
    throw new Error(
      `APPLE_SIGNING_IDENTITY is set, but ${macEntitlements} does not exist. ` +
        "It is what lets V8 run under the hardened runtime; see docs/project/signing.md.",
    );
  }
  const keychain = setting("APPLE_KEYCHAIN");
  const options: MacSignOptions & { continueOnError: boolean } = {
    identity,
    ...(keychain === undefined ? {} : { keychain }),
    optionsForFile: (filePath: string) =>
      /\((GPU|Renderer|Plugin)\)\.app/.test(filePath)
        ? { hardenedRuntime: true }
        : { hardenedRuntime: true, entitlements: macEntitlements },
    continueOnError: false,
  };
  return options;
}

/**
 * macOS: notarization, in either of the two ways notarytool accepts.
 *
 * An App Store Connect API key (`APPLE_API_KEY`, the path to the `.p8` file,
 * with `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`) is preferred when both are
 * present: it belongs to the team rather than to a person, and it survives that
 * person's password changing. An Apple ID (`APPLE_ID`, an app-specific password
 * in `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`) is the other.
 *
 * Half a set is an error, not a quiet fallback to "signed but not notarized":
 * that app passes `codesign --verify` on the build machine and is then refused
 * by Gatekeeper on every machine that downloads it.
 */
function macNotarization(): MacNotarizeOptions | undefined {
  const apiKey = { key: setting("APPLE_API_KEY"), id: setting("APPLE_API_KEY_ID"), issuer: setting("APPLE_API_ISSUER") };
  if (apiKey.key !== undefined && apiKey.id !== undefined && apiKey.issuer !== undefined) {
    return { appleApiKey: apiKey.key, appleApiKeyId: apiKey.id, appleApiIssuer: apiKey.issuer };
  }
  const appleId = { id: setting("APPLE_ID"), password: setting("APPLE_APP_SPECIFIC_PASSWORD"), team: setting("APPLE_TEAM_ID") };
  if (appleId.id !== undefined && appleId.password !== undefined && appleId.team !== undefined) {
    return { appleId: appleId.id, appleIdPassword: appleId.password, teamId: appleId.team };
  }
  const partial = [
    "APPLE_API_KEY",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ].filter((name) => setting(name) !== undefined);
  if (partial.length > 0) {
    throw new Error(
      `Notarization credentials are incomplete: only ${partial.join(", ")} set. ` +
        "Set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER, or APPLE_ID, " +
        "APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID (docs/project/signing.md).",
    );
  }
  return undefined;
}

const osxSign = appleIdentity === undefined ? undefined : macSigning(appleIdentity);
/* Notarizing needs a signature, so without an identity the credentials are not even read. */
const osxNotarize = osxSign === undefined ? undefined : macNotarization();

/**
 * Windows: Authenticode, from a PFX file.
 *
 * `WINDOWS_CERTIFICATE_FILE` is the path to the `.pfx` and
 * `WINDOWS_CERTIFICATE_PASSWORD` its password. The same options go to two
 * places, because two different programs produce executables: the packager
 * signs what is in the app (`Yam.exe`, its DLLs, any `.node` addon) before
 * Squirrel packs it, and Squirrel signs what it builds around it (`Setup.exe`
 * and the `Update.exe` inside the package). Signing only one leaves the other
 * half to SmartScreen. Both hand the work to @electron/windows-sign, which runs
 * its vendored `signtool` twice per file, SHA-1 then an appended SHA-256
 * signature, each timestamped by `WINDOWS_TIMESTAMP_SERVER`, or by DigiCert when
 * that is unset.
 *
 * A certificate on a hardware token or in a cloud HSM (every new OV and EV
 * certificate since June 2023), and Azure Trusted Signing, do not come as a
 * PFX. @electron/windows-sign takes `signWithParams` or a `hookModulePath` for
 * those; `docs/project/signing.md` says what that would look like. It is not
 * wired here, because nothing here can test it.
 */
const windowsCertificate = testBuild ? undefined : setting("WINDOWS_CERTIFICATE_FILE");
const windowsSign: WindowsSignOptions | undefined =
  windowsCertificate === undefined
    ? undefined
    : {
        certificateFile: windowsCertificate,
        certificatePassword: setting("WINDOWS_CERTIFICATE_PASSWORD"),
        description: productName,
        website: "https://yam.svatah.com",
      };

/*
 * One line, on the platform being built, saying what this build will be. A
 * person reading a release log should not have to infer "unsigned" from the
 * absence of a notarization step. Once per process: Forge can load this file
 * more than once in a `make`.
 */
const said = Symbol.for("yam.forge-config.signing-said");
const globals = globalThis as { [said]?: boolean };
if (globals[said] !== true && (process.platform === "darwin" || process.platform === "win32")) {
  globals[said] = true;
  const line =
    process.platform === "darwin"
      ? testBuild
        ? "macOS: the test build is never signed."
        : osxSign === undefined
          ? "macOS: unsigned build (APPLE_SIGNING_IDENTITY is not set)."
          : osxNotarize === undefined
            ? "macOS: signed with Developer ID, NOT notarized (no notarization credentials): Gatekeeper will refuse it."
            : `macOS: signed with Developer ID and notarized (${"appleApiKey" in osxNotarize ? "App Store Connect API key" : "Apple ID"}).`
      : testBuild
        ? "Windows: the test build is never signed."
        : windowsSign === undefined
          ? "Windows: unsigned build (WINDOWS_CERTIFICATE_FILE is not set)."
          : "Windows: signed with the certificate in WINDOWS_CERTIFICATE_FILE.";
  process.stderr.write(`[forge.config] ${line}\n`);
}

const config: ForgeConfig = {
  outDir: testBuild ? "out-test" : "out",
  packagerConfig: {
    name: productName,
    appBundleId: testBuild ? "com.svatah.yam.test" : "com.svatah.yam",
    /*
     * The app's own icon (TV-A08, TV-20).
     *
     * There was none, so every packaged build shipped Electron's default — the
     * one thing about the product a person sees before they have opened it. The
     * mark is vendored in `packages/ui/brand/`, from the brand repository, so a
     * build here does not depend on a checkout of another one.
     *
     * No extension: the packager appends the one each platform wants, and
     * naming `.icns` here would build on macOS and fail on Windows. Which means
     * every one of them has to exist — with only `app-icon.png` vendored, the
     * macOS and Windows builds found no icon, said nothing, and shipped
     * Electron's after all.
     */
    icon: appIcon,
    // The project directory is the only source of truth (REQ-ADE-2), so there is
    // nothing to sign a manifest of and nothing to bundle but the app.
    asar: true,
    /*
     * The bundled CLI (T8.1, LLD §13.6: "locate the bundled CLI").
     *
     * `scripts/stage-app-cli.mjs` writes it here with `pnpm deploy`, and Forge
     * copies it to `Resources/yam`. Outside the asar on purpose: the app
     * *spawns* the CLI, and a program inside an asar has no path a `spawn` can
     * use. Phase 7 shipped an application with nothing here, which is why a
     * packaged app could not open a project even with a Node to hand (P7-F1).
     */
    extraResource: [".stage/yam"],
    /*
     * Present only when the environment asked for them (see "Signing" above).
     * Spread rather than set to `undefined`, so an unsigned configuration has no
     * signing keys at all and the test can say so without a special case.
     */
    ...(osxSign === undefined ? {} : { osxSign }),
    ...(osxNotarize === undefined ? {} : { osxNotarize }),
    ...(windowsSign === undefined ? {} : { windowsSign }),
    /*
     * The purpose string for the Automation prompt that
     * `com.apple.security.automation.apple-events` makes possible. macOS shows
     * it when Yam first drives System Events, and for an app built against a
     * current SDK it refuses the request outright when the key is missing.
     * Signed builds only, with the entitlement it belongs to, so that the
     * unsigned app's Info.plist is exactly what it was before signing existed.
     */
    ...(osxSign === undefined
      ? {}
      : {
          extendInfo: {
            NSAppleEventsUsageDescription:
              "Yam drives the applications you ask it to automate through System Events.",
          },
        }),
  },
  rebuildConfig: {},

  /*
   * One maker per platform, all three from the same configuration (T3.6:
   * "installers for macOS, Windows, Linux in CI").
   */
  makers: [
    /*
     * The ZIP stays on macOS beside the DMG. It is what an updater downloads:
     * Squirrel.Mac and `update.electronjs.org` take a ZIP of the `.app`, never
     * a disk image, so dropping it would close the door on auto-update.
     */
    new MakerZIP({}, ["darwin", "linux", "win32"]),
    /*
     * The disk image a person on a Mac expects: open it, drag Yam to
     * Applications. Unsigned it is still the right shape — the Gatekeeper
     * warning is about the app inside, and a ZIP gets the same one.
     *
     * No `name`, so Forge names the file `Yam-<version>-<arch>.dmg`, and the
     * arm64 and Intel images of one release cannot overwrite each other when
     * they are attached to it. `title` is the mounted volume's name. ULFO is
     * LZFSE, which macOS has read since 10.11 — this app needs 13 — and is
     * both smaller and faster to open than the default zlib image.
     *
     * With an identity the image is signed too, so the file a person downloads
     * says who made it before it is opened; the app inside is the part that is
     * notarized and stapled (docs/project/signing.md).
     */
    new MakerDMG(
      {
        title: productName,
        icon: `${appIcon}.icns`,
        format: "ULFO",
        overwrite: true,
        ...(appleIdentity === undefined
          ? {}
          : { additionalDMGOptions: { "code-sign": { "signing-identity": appleIdentity } } }),
      },
      ["darwin"],
    ),
    /*
     * The installers carry the mark too; each maker's default is Electron's.
     * `authors` because Squirrel's package is a NuGet package, which will not
     * build without one — "Authors is required." — and the default is the
     * `author` in package.json, which no package here has.
     */
    new MakerSquirrel(
      {
        name: testBuild ? "yam_test" : "yam",
        authors: "Svatah Labs",
        setupIcon: `${appIcon}.ico`,
        // The installer's own executables; the app's were signed by the packager.
        ...(windowsSign === undefined ? {} : { windowsSign }),
      },
      ["win32"],
    ),
    /*
     * `bin` is the executable's name inside the packaged app, and the packager
     * names it after `packagerConfig.name`. Unset, the Debian maker assumes the
     * npm name, `@svatah/yam-desktop`, and `make` on Linux failed looking for
     * `out/Yam-linux-x64/@svatah/yam-desktop`.
     */
    new MakerDeb(
      {
        options: {
          name: testBuild ? "yam-test" : "yam",
          productName,
          bin: productName,
          icon: `${appIcon}.png`,
        },
      },
      ["linux"],
    ),
  ],

  plugins: [
    new VitePlugin({
      build: [
        { entry: "src/main/index.ts", config: "vite.main.config.ts", target: "main" },
        { entry: "src/preload/index.ts", config: "vite.preload.config.ts", target: "preload" },
      ],
      renderer: [{ name: "main_window", config: "vite.renderer.config.ts" }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      // The packaged binary must not be re-runnable as plain Node.
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
