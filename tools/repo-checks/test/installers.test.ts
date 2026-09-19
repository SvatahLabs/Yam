/**
 * The app installers: signed when the environment asks, unsigned when it does
 * not, and never signed for the test build (docs/project/signing.md).
 *
 * Signing cannot be run here. It needs an Apple Developer ID certificate, a
 * notarization account and a Windows code-signing certificate, and nothing in
 * this repository holds any of them. What can be checked is the decision that
 * leads up to it, which is where the failures that matter live:
 *
 * * a build with no credentials must be exactly the unsigned build it was, or
 *   every fork and every pull request stops producing installers;
 * * a secret a repository does not have reaches the job as `""`, not as
 *   nothing, and a configuration that took `""` for an identity would try to
 *   sign with it;
 * * half a set of notarization credentials must fail the build, because the
 *   alternative is an app that verifies on the build machine and is refused
 *   by Gatekeeper everywhere else;
 * * the test build (`YAM_APP_TEST_BUILD=1`) is what the suites package, and a
 *   signing identity in someone's shell must not reach it.
 *
 * So `apps/desktop/forge.config.ts` is loaded, for real, under each environment,
 * and the configuration Forge would receive is read back. Each load has its own
 * query string: the configuration decides at module scope, and the module cache
 * would otherwise hand every case the first case's answer.
 *
 * The release workflow is read as well, for the two things a YAML edit breaks
 * without any build failing: the Intel leg, and which steps can see a secret.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { fromRoot } from "../src/repo.js";

/** Every variable `forge.config.ts` reads to decide about signing. */
const SIGNING_VARIABLES = [
  "APPLE_SIGNING_IDENTITY",
  "APPLE_KEYCHAIN",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
  "WINDOWS_CERTIFICATE_FILE",
  "WINDOWS_CERTIFICATE_PASSWORD",
  "YAM_APP_TEST_BUILD",
] as const;

const APPLE_ID_ENV = {
  APPLE_SIGNING_IDENTITY: "Developer ID Application: Svatah Labs (TEAM123456)",
  APPLE_ID: "release@example.com",
  APPLE_APP_SPECIFIC_PASSWORD: "abcd-efgh-ijkl-mnop",
  APPLE_TEAM_ID: "TEAM123456",
};
const API_KEY_ENV = {
  APPLE_API_KEY: "/tmp/AuthKey_ABC123.p8",
  APPLE_API_KEY_ID: "ABC123",
  APPLE_API_ISSUER: "c055ca8c-e5a8-4836-b61d-aa5794eeb3f4",
};
const WINDOWS_ENV = {
  WINDOWS_CERTIFICATE_FILE: "C:\\certs\\yam.pfx",
  WINDOWS_CERTIFICATE_PASSWORD: "pfx-password",
};

interface Maker {
  name: string;
  platforms: string[];
  configOrConfigFetcher: Record<string, unknown>;
}
interface LoadedConfig {
  packagerConfig: Record<string, unknown> & {
    osxSign?: {
      identity?: string;
      keychain?: string;
      continueOnError?: boolean;
      optionsForFile?: (path: string) => { hardenedRuntime?: boolean; entitlements?: string };
    };
    osxNotarize?: Record<string, string>;
    windowsSign?: Record<string, string>;
    extendInfo?: Record<string, string>;
  };
  makers: Maker[];
}

const saved = new Map<string, string | undefined>();
let loads = 0;

/**
 * The configuration Forge would get, under exactly `env` and nothing inherited.
 * Every signing variable not named is removed first, so a developer's shell or
 * a CI job cannot make a case pass or fail.
 */
async function configWith(env: Partial<Record<(typeof SIGNING_VARIABLES)[number], string>>): Promise<LoadedConfig> {
  for (const name of SIGNING_VARIABLES) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  Object.assign(process.env, env);
  loads += 1;
  const url = `${pathToFileURL(fromRoot("apps/desktop/forge.config.ts")).href}?case=${String(loads)}`;
  const module = (await import(/* @vite-ignore */ url)) as { default: LoadedConfig };
  return module.default;
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

const maker = (config: LoadedConfig, name: string): Maker => {
  const found = config.makers.find((one) => one.name === name);
  expect(found, `no ${name} maker`).toBeDefined();
  return found!;
};

describe("signing is off unless the environment asks", () => {
  it("has no signing keys at all without the environment", async () => {
    const config = await configWith({});
    for (const key of ["osxSign", "osxNotarize", "windowsSign", "extendInfo"]) {
      expect(Object.keys(config.packagerConfig), `packagerConfig.${key} without any signing variable`).not.toContain(key);
    }
    expect(maker(config, "squirrel").configOrConfigFetcher).not.toHaveProperty("windowsSign");
    expect(maker(config, "dmg").configOrConfigFetcher).not.toHaveProperty("additionalDMGOptions");
  });

  it("reads an empty value as unset, which is what a missing Actions secret expands to", async () => {
    const empty = Object.fromEntries(SIGNING_VARIABLES.filter((name) => name !== "YAM_APP_TEST_BUILD").map((name) => [name, ""]));
    const config = await configWith(empty);
    expect(config.packagerConfig).not.toHaveProperty("osxSign");
    expect(config.packagerConfig).not.toHaveProperty("osxNotarize");
    expect(config.packagerConfig).not.toHaveProperty("windowsSign");
  });
});

describe("macOS: Developer ID and notarization", () => {
  it("signs with the hardened runtime and the app's entitlements, and notarizes with an Apple ID", async () => {
    const config = await configWith({ ...APPLE_ID_ENV, APPLE_KEYCHAIN: "/tmp/yam-signing.keychain-db" });
    const sign = config.packagerConfig.osxSign!;
    expect(sign.identity).toBe(APPLE_ID_ENV.APPLE_SIGNING_IDENTITY);
    expect(sign.keychain).toBe("/tmp/yam-signing.keychain-db");
    // @electron/packager defaults this to true: a failed signature would be a warning and a green build.
    expect(sign.continueOnError).toBe(false);

    const app = sign.optionsForFile!("/out/Yam-darwin-arm64/Yam.app");
    expect(app.hardenedRuntime).toBe(true);
    expect(app.entitlements).toBe(fromRoot("apps/desktop/build/entitlements.mac.plist"));
    // The typed helpers keep Chromium's narrower defaults.
    const renderer = sign.optionsForFile!("/out/Yam.app/Contents/Frameworks/Yam Helper (Renderer).app");
    expect(renderer.hardenedRuntime).toBe(true);
    expect(renderer).not.toHaveProperty("entitlements");

    expect(config.packagerConfig.osxNotarize).toEqual({
      appleId: APPLE_ID_ENV.APPLE_ID,
      appleIdPassword: APPLE_ID_ENV.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: APPLE_ID_ENV.APPLE_TEAM_ID,
    });
    expect(config.packagerConfig.extendInfo).toHaveProperty("NSAppleEventsUsageDescription");
    expect(maker(config, "dmg").configOrConfigFetcher["additionalDMGOptions"]).toEqual({
      "code-sign": { "signing-identity": APPLE_ID_ENV.APPLE_SIGNING_IDENTITY },
    });
  });

  it("notarizes with an App Store Connect API key, preferring it when both are set", async () => {
    const config = await configWith({ ...APPLE_ID_ENV, ...API_KEY_ENV });
    expect(config.packagerConfig.osxSign).toBeDefined();
    expect(config.packagerConfig.osxNotarize).toEqual({
      appleApiKey: API_KEY_ENV.APPLE_API_KEY,
      appleApiKeyId: API_KEY_ENV.APPLE_API_KEY_ID,
      appleApiIssuer: API_KEY_ENV.APPLE_API_ISSUER,
    });
  });

  it("refuses half a set of notarization credentials rather than ship an app Gatekeeper refuses", async () => {
    await expect(
      configWith({ APPLE_SIGNING_IDENTITY: APPLE_ID_ENV.APPLE_SIGNING_IDENTITY, APPLE_ID: APPLE_ID_ENV.APPLE_ID }),
    ).rejects.toThrow(/Notarization credentials are incomplete: only APPLE_ID set/);
  });

  it("does not notarize without an identity, because notarizing needs a signature", async () => {
    const { APPLE_SIGNING_IDENTITY: _identity, ...credentials } = APPLE_ID_ENV;
    const config = await configWith({ ...credentials, ...API_KEY_ENV });
    expect(config.packagerConfig).not.toHaveProperty("osxSign");
    expect(config.packagerConfig).not.toHaveProperty("osxNotarize");
  });

  it("keeps the entitlements in the repository, with only the exceptions it explains", () => {
    const plist = fromRoot("apps/desktop/build/entitlements.mac.plist");
    expect(existsSync(plist)).toBe(true);
    /*
     * The root `.gitignore` ignores every `build/` directory. A plist that
     * exists here and is ignored is missing from every checkout, and the
     * release job's signed build then stops at "entitlements do not exist".
     */
    const ignored = spawnSync("git", ["check-ignore", "-q", "apps/desktop/build/entitlements.mac.plist"], {
      cwd: fromRoot("."),
    });
    expect(
      ignored.status,
      "apps/desktop/build/entitlements.mac.plist is git-ignored; add `!apps/desktop/build/` to .gitignore",
    ).not.toBe(0);
    const keys = [...readFileSync(plist, "utf8").matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]).sort();
    expect(keys, "each entitlement is explained in the plist; change both together").toEqual([
      "com.apple.security.automation.apple-events",
      "com.apple.security.cs.allow-jit",
    ]);
  });
});

describe("Windows: Authenticode", () => {
  it("signs the app with the packager and the installer with Squirrel, from the same certificate", async () => {
    const config = await configWith(WINDOWS_ENV);
    expect(config.packagerConfig.windowsSign).toMatchObject({
      certificateFile: WINDOWS_ENV.WINDOWS_CERTIFICATE_FILE,
      certificatePassword: WINDOWS_ENV.WINDOWS_CERTIFICATE_PASSWORD,
    });
    expect(maker(config, "squirrel").configOrConfigFetcher["windowsSign"]).toEqual(config.packagerConfig.windowsSign);
    expect(config.packagerConfig).not.toHaveProperty("osxSign");
  });
});

describe("the test build", () => {
  it("is never signed, whatever the environment holds", async () => {
    const config = await configWith({ ...APPLE_ID_ENV, ...API_KEY_ENV, ...WINDOWS_ENV, YAM_APP_TEST_BUILD: "1" });
    expect(config.packagerConfig["name"]).toBe("Yam Test");
    for (const key of ["osxSign", "osxNotarize", "windowsSign", "extendInfo"]) {
      expect(Object.keys(config.packagerConfig), `the test build has packagerConfig.${key}`).not.toContain(key);
    }
    expect(maker(config, "squirrel").configOrConfigFetcher).not.toHaveProperty("windowsSign");
    expect(maker(config, "dmg").configOrConfigFetcher).not.toHaveProperty("additionalDMGOptions");
  });
});

describe("the macOS makers", () => {
  it("make a DMG on macOS and keep the ZIP an updater downloads", async () => {
    const config = await configWith({});
    const dmg = maker(config, "dmg");
    expect(dmg.platforms).toEqual(["darwin"]);
    expect(dmg.configOrConfigFetcher).toMatchObject({ title: "Yam", format: "ULFO" });
    // No `name`: Forge then puts the version and arch in the file name, so two Macs' images cannot collide.
    expect(dmg.configOrConfigFetcher).not.toHaveProperty("name");
    expect(existsSync(String(dmg.configOrConfigFetcher["icon"]))).toBe(true);
    expect(maker(config, "zip").platforms).toContain("darwin");
  });
});

/* ── the release workflow ─────────────────────────────────────────────────── */

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}
interface Job {
  env?: Record<string, string>;
  strategy?: { matrix?: { include?: Array<Record<string, string>>; os?: string[] } };
  steps: Step[];
}
const releaseText = readFileSync(fromRoot(".github", "workflows", "release.yml"), "utf8");
const release = parse(releaseText) as { env?: Record<string, string>; jobs: Record<string, Job> };
const installers = release.jobs["app-installers"]!;

/** The secrets a step's environment names, e.g. `APPLE_ID` for `${{ ... secrets.APPLE_ID ... }}`. */
const secretsOf = (values: Record<string, string> | undefined): string[] =>
  Object.values(values ?? {}).flatMap((value) => [...value.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((match) => match[1]!));

const SIGNING_SECRET = /^(APPLE_|WINDOWS_CERTIFICATE)/;

describe("the release workflow's installers", () => {
  it("builds macOS on Apple silicon and on a native Intel runner, with an artifact name per arch", () => {
    const legs = installers.strategy?.matrix?.include ?? [];
    expect(legs).toContainEqual({ os: "macos-latest", arch: "arm64" });
    const intel = legs.filter((leg) => leg["arch"] === "x64" && leg["os"]!.startsWith("macos"));
    expect(intel, "no Intel macOS leg").toHaveLength(1);
    // A native runner, not a cross-build from the arm64 one.
    expect(intel[0]!["os"]).toMatch(/intel/);
    expect(legs.map((leg) => leg["os"])).toEqual(expect.arrayContaining(["ubuntu-latest", "windows-latest"]));
    const upload = installers.steps.find((step) => step.uses?.startsWith("actions/upload-artifact"));
    expect(upload?.with?.["name"]).toContain("${{ matrix.arch }}");
  });

  it("hands the signing secrets to Make, and the certificates only to the steps that install them", () => {
    const make = installers.steps.find((step) => step.name === "Make");
    expect(make?.run).toContain("pnpm --filter @svatah/yam-desktop make");
    expect(secretsOf(make?.env).sort()).toEqual([
      "APPLE_API_ISSUER",
      "APPLE_API_KEY_ID",
      "APPLE_API_KEY_P8",
      "APPLE_APP_SPECIFIC_PASSWORD",
      "APPLE_ID",
      "APPLE_SIGNING_IDENTITY",
      "APPLE_TEAM_ID",
      "WINDOWS_CERTIFICATE_PASSWORD",
    ]);
    // Each narrowed to the runner that uses it.
    for (const [name, value] of Object.entries(make?.env ?? {})) {
      expect(value, `${name} reaches every runner`).toMatch(
        name.startsWith("APPLE_") ? /runner\.os == 'macOS'/ : /runner\.os == 'Windows'/,
      );
    }

    const holders = installers.steps.filter((step) => secretsOf(step.env).some((one) => SIGNING_SECRET.test(one)));
    expect(holders.map((step) => step.name).sort()).toEqual([
      "Install the Developer ID certificate",
      "Install the Windows code-signing certificate",
      "Make",
    ]);
    expect(secretsOf(installers.steps.find((step) => step.name === "Install the Developer ID certificate")?.env).sort()).toEqual([
      "APPLE_CERTIFICATE_P12",
      "APPLE_CERTIFICATE_PASSWORD",
    ]);
    expect(secretsOf(installers.steps.find((step) => step.name === "Install the Windows code-signing certificate")?.env)).toEqual([
      "WINDOWS_CERTIFICATE_P12",
    ]);
  });

  it("names no signing secret anywhere else: not in a job or workflow env, not in a script, not in another job", () => {
    expect(secretsOf(release.env).filter((one) => SIGNING_SECRET.test(one))).toEqual([]);
    for (const [name, job] of Object.entries(release.jobs)) {
      expect(secretsOf(job.env).filter((one) => SIGNING_SECRET.test(one)), `${name} has signing secrets in its env`).toEqual([]);
      for (const step of job.steps) {
        expect(step.run ?? "", `a script in ${name} interpolates a signing secret`).not.toMatch(/secrets\.(APPLE_|WINDOWS_)/);
      }
    }
    // Every mention in the file is one of the step environments counted above.
    const mentions = [...releaseText.matchAll(/secrets\.(APPLE_[A-Z0-9_]+|WINDOWS_CERTIFICATE[A-Z0-9_]*)/g)].length;
    const inSteps = installers.steps.flatMap((step) => secretsOf(step.env)).filter((one) => SIGNING_SECRET.test(one)).length;
    expect(mentions).toBe(inSteps);
  });

  it("says whether what it made is signed, from the files rather than from the secrets", () => {
    const verdict = installers.steps.find((step) => step.name === "Signed or unsigned");
    expect(verdict?.run).toContain("codesign");
    expect(verdict?.run).toContain("Get-AuthenticodeSignature");
    expect(verdict?.run).toContain("UNSIGNED");
  });
});
