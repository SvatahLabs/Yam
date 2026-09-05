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
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import type { ForgeConfig } from "@electron-forge/shared-types";

const config: ForgeConfig = {
  packagerConfig: {
    name: "Svatah ADE",
    // The project directory is the only source of truth (REQ-ADE-2), so there is
    // nothing to sign a manifest of and nothing to bundle but the app.
    asar: true,
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
    new MakerSquirrel({ name: "svatah_ade" }, ["win32"]),
    new MakerDeb({ options: { name: "svatah-ade", productName: "Svatah ADE" } }, ["linux"]),
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
