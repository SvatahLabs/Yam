/**
 * What an adapter can actually reach on this host, and which version of it
 * (T23, SF-09, SF-23).
 *
 * ## The gap this closes
 *
 * Readiness used to be `registered && the platform matches`, and wave 4's
 * coverage report said exactly what was wrong with it:
 *
 * > Neither is `available: true`, which means registered and on a matching
 * > platform — a claim about this machine, not about the adapter.
 *
 * `appium: available` on a machine with no Appium server, `bidi: available` on
 * a machine with no browser started with a BiDi endpoint. Both were true
 * statements about a `Record<string, string[]>` and false statements about the
 * host. SF-09 asks readiness to report "adapter version, readiness and reasons
 * for unavailable operations", and there was no version anywhere.
 *
 * ## What a probe is
 *
 * A question asked of the host, answered with what the host said. Every probe
 * here either finds the thing and reports **the version it found**, or does not
 * and reports **what would have to be true** — never a platform table standing
 * in for either. A probe that costs a process spawn is bounded and cached for
 * the life of the process, because `yam surface doctor` asks all of them at
 * once and a person is waiting.
 *
 * ## Why a version range
 *
 * "Each newly supported capability gets a reproducible conformance result, its
 * limitations and its version range" (T23). The range is what this repository
 * has actually driven, not what upstream supports — a reader deciding whether
 * their Appium 1.x will work needs the first number, and the second is a
 * promise nobody here can keep.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { platform } from "node:os";

export interface AdapterProbe {
  /** Whether the thing this adapter drives is reachable on this host. */
  readonly present: boolean;
  /** What the host said its version is, when it could be asked. */
  readonly version?: string;
  /** What would have to be true, in the host's words where there are any. */
  readonly reason?: string;
  /** The versions this repository has driven; not a claim about others. */
  readonly range?: string;
}

/** Run a probe command, bounded, and answer with its first line of output. */
function ask(command: string, args: readonly string[], timeoutMs = 10_000): string | undefined {
  const ran = spawnSync(command, [...args], { encoding: "utf8", timeout: timeoutMs });
  if (ran.error !== undefined || ran.status !== 0) return undefined;
  const said = `${ran.stdout ?? ""}${ran.stderr ?? ""}`.trim();
  return said === "" ? undefined : said.split("\n")[0];
}

/** Ask an HTTP endpoint, briefly, and answer with the JSON it gave. */
async function askHttp(url: string, timeoutMs = 1_500): Promise<unknown> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
}

const cache = new Map<string, AdapterProbe>();

/**
 * The version ranges this repository has driven.
 *
 * One place, so a reader of the support matrix and a reader of `surface doctor`
 * are told the same thing, and so a range that moves moves once.
 */
export const DRIVEN_RANGES: Readonly<Record<string, string>> = {
  playwright: "Playwright 1.5x, Chromium and Firefox as it bundles them",
  bidi: "WebDriver BiDi as Chrome 130+ and Firefox 130+ speak it",
  appium: "Appium 2.x, over the W3C WebDriver protocol",
  ax: "macOS 13+ (the AXUIElement API and System Events)",
  uia: "Windows 10 1809+ (UI Automation)",
  http: "any HTTP/1.1 or HTTP/2 endpoint",
  process: "a pseudo-terminal from expect(1) or python3's pty module",
  atspi: "AT-SPI2 over D-Bus, as GNOME 40+ and GTK 3.24+ publish it",
};

/** Probe one adapter. Cached: `doctor` asks for all of them at once. */
export async function probeAdapter(adapter: string): Promise<AdapterProbe> {
  const already = cache.get(adapter);
  if (already !== undefined) return already;
  const answer = await runProbe(adapter);
  const withRange: AdapterProbe = {
    ...answer,
    ...(DRIVEN_RANGES[adapter] === undefined ? {} : { range: DRIVEN_RANGES[adapter] }),
  };
  cache.set(adapter, withRange);
  return withRange;
}

/** For a test that wants a fresh answer. */
export function forgetProbes(): void {
  cache.clear();
}

async function runProbe(adapter: string): Promise<AdapterProbe> {
  switch (adapter) {
    case "http":
      /*
       * Nothing to probe: an HTTP surface is `fetch`, which this runtime has.
       * Saying "present" here is a claim about Node, and it is true.
       */
      return { present: true, version: process.version };

    case "playwright": {
      /*
       * Resolved, not shelled out to (P-W2-F5).
       *
       * This ran `npx --no-install playwright --version`, which asks whether a
       * *binary* is reachable from the current working directory — and the
       * service's working directory is the person's project, not this package.
       * In a packaged application that answer is always no, however well
       * installed Playwright is: the app reported the adapter unavailable and
       * told a person to install what was already inside its own bundle, four
       * directories away under `node_modules/.pnpm/playwright@1.62.1`.
       *
       * What the adapter does is `import "playwright"`, so that is what is
       * checked: Node's own resolution, from this module, which is the same
       * resolution the adapter gets. A working directory cannot change it and a
       * missing `npx` cannot break it.
       *
       * The browser is a second question with a second answer. `playwright`
       * resolving means the package is there; `chromium.executablePath()`
       * existing means there is something to drive. They fail for different
       * reasons and send a person to different commands, so they are reported
       * apart.
       */
      const require_ = createRequire(import.meta.url);
      let version: string;
      try {
        const manifest = require_("playwright/package.json") as { version?: unknown };
        if (typeof manifest.version !== "string") throw new Error("no version");
        version = manifest.version;
      } catch {
        return {
          present: false,
          reason:
            "Playwright is not installed where Yam can load it. `npm i -D playwright` in the " +
            "project, or use the ax adapter, which needs no browser package.",
        };
      }
      try {
        const { chromium } = (await import("playwright")) as {
          chromium: { executablePath(): string };
        };
        const browser = chromium.executablePath();
        if (browser === "" || !existsSync(browser)) {
          return {
            present: false,
            version,
            reason:
              `Playwright ${version} is installed but has no browser to drive. Run ` +
              "`npx playwright install chromium`.",
          };
        }
      } catch {
        return {
          present: false,
          version,
          reason:
            `Playwright ${version} is installed but could not say where its browser is. Run ` +
            "`npx playwright install chromium`.",
        };
      }
      return { present: true, version };
    }

    case "bidi": {
      /*
       * BiDi drives a browser somebody else started with a BiDi endpoint. What
       * can be probed is whether such a browser is reachable, and where it is
       * expected — not whether a browser exists.
       */
      const endpoint = process.env["YAM_BIDI_URL"];
      if (endpoint === undefined) {
        return {
          present: false,
          reason:
            "no BiDi endpoint is named. Start Chrome or Firefox with a WebDriver BiDi endpoint " +
            "and set YAM_BIDI_URL to it.",
        };
      }
      const status = (await askHttp(`${endpoint.replace(/\/$/u, "")}/status`)) as
        | { value?: { build?: { version?: string } } }
        | undefined;
      return status === undefined
        ? { present: false, reason: `nothing answered at ${endpoint}.` }
        : { present: true, version: status.value?.build?.version ?? "answered, no version given" };
    }

    case "appium": {
      /*
       * An Appium server answers `/status` with its build. A device is a second
       * question and this does not claim to have asked it — which is the
       * distinction the old table could not make at all.
       */
      const endpoint = process.env["YAM_APPIUM_URL"] ?? "http://127.0.0.1:4723";
      const status = (await askHttp(`${endpoint.replace(/\/$/u, "")}/status`)) as
        | { value?: { build?: { version?: string } } }
        | undefined;
      return status === undefined
        ? {
            present: false,
            reason:
              `no Appium server answered at ${endpoint}. Start one (\`appium\`) and attach a ` +
              "device or emulator; set YAM_APPIUM_URL for a server elsewhere.",
          }
        : {
            present: true,
            version: status.value?.build?.version ?? "answered, no version given",
            reason: "a server answered; whether a device is attached is a separate question",
          };
    }

    case "ax": {
      if (platform() !== "darwin") {
        return { present: false, reason: `the accessibility API is macOS's; this host is ${platform()}.` };
      }
      const version = ask("sw_vers", ["-productVersion"]);
      return version === undefined
        ? { present: false, reason: "macOS did not answer `sw_vers`." }
        : {
            present: true,
            version: `macOS ${version}`,
            reason:
              "the API is here; whether the program running Yam has the Accessibility permission " +
              "is what `yam surface doctor` asks separately",
          };
    }

    case "uia": {
      if (platform() !== "win32") {
        return { present: false, reason: `UI Automation is Windows'; this host is ${platform()}.` };
      }
      const version = ask("cmd", ["/c", "ver"]);
      return { present: true, ...(version === undefined ? {} : { version }) };
    }

    case "process": {
      /*
       * The pty allocators, asked for by name. This duplicates nothing: the
       * adapter's own `ptyReadiness` is the authority and `surface-control` may
       * not import an adapter (LLD §1), so the probe asks the same programs the
       * same way and says which it found.
       */
      if (platform() === "win32") {
        return {
          present: false,
          reason:
            "a pseudo-terminal on Windows is a ConPTY, which neither `expect` nor Python's " +
            "`pty` module provides; no Windows terminal surface is implemented.",
        };
      }
      const expect = ask("expect", ["-v"]);
      if (expect !== undefined) return { present: true, version: expect };
      const python = ask("python3", ["-c", "import pty, sys; print(sys.version.split()[0])"]);
      if (python !== undefined) return { present: true, version: `python3 ${python}` };
      return {
        present: false,
        reason:
          "no pseudo-terminal could be allocated: neither `expect` (it ships with macOS and is " +
          "the `expect` package on Linux) nor a `python3` with its `pty` module is on this host.",
      };
    }

    case "atspi": {
      if (platform() !== "linux") {
        return {
          present: false,
          reason: `AT-SPI is Linux's accessibility bus; this host is ${platform()}.`,
        };
      }
      const gdbus = ask("gdbus", ["--version"]);
      if (gdbus === undefined) {
        return {
          present: false,
          reason:
            "`gdbus` is not on this host. It ships with GLib; install it (Debian: " +
            "`libglib2.0-bin`) so the accessibility bus can be reached.",
        };
      }
      const bus = ask("gdbus", [
        "call",
        "--session",
        "--dest",
        "org.a11y.Bus",
        "--object-path",
        "/org/a11y/bus",
        "--method",
        "org.a11y.Bus.GetAddress",
      ]);
      return bus === undefined
        ? {
            present: false,
            version: gdbus,
            reason:
              "`org.a11y.Bus` did not answer on the session bus. The accessibility bus is off, " +
              "or there is no session bus here. Turn accessibility on (GNOME: " +
              "`gsettings set org.gnome.desktop.interface toolkit-accessibility true`) and make " +
              "sure `at-spi2-registryd` is running.",
          }
        : { present: true, version: gdbus };
    }

    default:
      return { present: false, reason: `there is no probe for "${adapter}".` };
  }
}
