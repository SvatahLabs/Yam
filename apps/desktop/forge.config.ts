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
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import type { ForgeConfig } from "@electron-forge/shared-types";

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
     * naming `.icns` here would build on macOS and fail on Windows.
     */
    icon: resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "ui", "brand", "app-icon"),
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
  },
  rebuildConfig: {},

  /*
   * One maker per platform, all three from the same configuration (T3.6:
   * "installers for macOS, Windows, Linux in CI"). ZIP on macOS rather than DMG:
   * a DMG needs a signing identity to be useful, and CI has none — an unsigned
   * ZIP is honest about what it is.
   */
  makers: [
    new MakerZIP({}, ["darwin", "linux", "win32"]),
    new MakerSquirrel({ name: testBuild ? "yam_test" : "yam" }, ["win32"]),
    /*
     * `bin` is the executable's name inside the packaged app, and the packager
     * names it after `packagerConfig.name`. Unset, the Debian maker assumes the
     * npm name, `@svatah/yam-desktop`, and `make` on Linux failed looking for
     * `out/Yam-linux-x64/@svatah/yam-desktop`.
     */
    new MakerDeb(
      { options: { name: testBuild ? "yam-test" : "yam", productName, bin: productName } },
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
