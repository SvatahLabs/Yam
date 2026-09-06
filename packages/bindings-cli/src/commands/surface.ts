/**
 * `yam surface conform --adapter <name>` (LLD §15, REQ-SURF-3).
 *
 * The CLI is the only thing that registers adapters (LLD §1), so it is the only
 * place that can hand the conformance suite a live surface. The suite itself
 * knows nothing but `AgentSurface`.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fingerprint, relocalize } from "@svatah/yam-bindings";
import {
  DESKTOP_CASES,
  DESKTOP_HEALING_CASES,
  renderMarkdown,
  renderReport,
  runSurfaceConformance,
  type ConformanceReport,
  type DesktopHealing,
  type RecordedElement,
} from "@svatah/yam-conformance";
import { createSurface, listAdapters } from "@svatah/yam-surface";
import { DEFAULT_CONFIG, type Config } from "@svatah/yam-schema";
import { registerAllAdapters } from "../adapters.js";
import { boolOption, stringOption, type ParsedArgs } from "../args.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { sessionTarget } from "../session.js";

export interface CommandIo {
  out(text: string): void;
  err(text: string): void;
}

/** Where the sample application runs by default (LLD §16, T0.5). */
const DEFAULT_BASE_URL = "http://127.0.0.1:4173";

/**
 * The desktop healing cases' ground-truth key (Draft 2.8 LLD §16).
 *
 * The desktop equivalent of `apps/sample-web`'s `data-yam-eval`: the control
 * keeps its `automationId` across every variant, so it is what says whether a
 * proposal is the *right* element. Which is exactly why the relocalizer is told
 * to ignore it — §16's rule for the web eval, applied here: "removes the
 * attribute from synthesis, fingerprints, and `native` so it can never help
 * relocalization".
 */
const GROUND_TRUTH_ATTRIBUTE = "automationId";

/**
 * The healer the desktop healing cases are handed, and the file that carries
 * their state between the three passes over three APP_DIR variants.
 *
 * The suite knows nothing about `@svatah/yam-bindings`; the CLI does, and is the
 * only place that can hand it over (the same rule that makes this the only
 * place that registers adapters). The state is a file because each pass is a
 * separate `yam surface conform` against a separately launched APP_DIR.
 */
function desktopHealing(variant: number, statePath: string): DesktopHealing {
  const state: Record<string, RecordedElement> =
    existsSync(statePath) && variant !== 0
      ? (JSON.parse(readFileSync(statePath, "utf8")) as Record<string, RecordedElement>)
      : {};
  return {
    variant,
    async fingerprint(surface, ref) {
      return await fingerprint(surface, ref, { ignoreAttributes: [GROUND_TRUTH_ATTRIBUTE] });
    },
    async relocalize(surface, print, preferRole) {
      /*
       * "with the same weights and threshold as the web healing eval" (§16):
       * `relocalize`'s own defaults, which is exactly what `yam eval healing`
       * passes — it names neither a threshold nor a margin. Naming one here
       * would make the two numbers different the first time one moved.
       */
      const result = await relocalize(surface, print, {
        preferRole,
        ignoreAttributes: [GROUND_TRUTH_ATTRIBUTE],
      });
      return {
        outcome: result.outcome,
        ...(result.outcome === "relocalized" ? { ref: result.match.ref, score: result.match.score.total } : {}),
      };
    },
    recall(id) {
      return state[id];
    },
    remember(id, value) {
      state[id] = value;
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
    },
  };
}

export async function surfaceCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const sub = args.command[1];
  if (sub !== "conform") {
    io.err(
      `Unknown "surface" subcommand ${sub === undefined ? "(none given)" : `"${sub}"`}. ` +
        "Phase 1 implements `surface conform`.",
    );
    return EXIT.usage;
  }
  return await conform(args, io);
}

async function conform(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const adapter = stringOption(args, "adapter");
  if (adapter === undefined) {
    io.err("`surface conform` needs --adapter <name>.");
    return EXIT.usage;
  }

  registerAllAdapters();
  if (!listAdapters().includes(adapter)) {
    io.err(
      `No adapter registered under "${adapter}". Registered: ${listAdapters().join(", ") || "(none)"}.`,
    );
    return EXIT.usage;
  }

  /*
   * Flag, then `YAM_BASE_URL`, then `config.app`, then the sample app's port
   * (LLD §15, Draft 2.5). A conformance run against an application on an
   * ephemeral port should not have to repeat the flag every time.
   */
  const target = sessionTarget(args, {
    root: stringOption(args, "project") ?? ".",
    fallbackBaseUrl: DEFAULT_BASE_URL,
  });
  const baseUrl = target.baseUrl!;
  const headless = !boolOption(args, "headed");
  const only = stringOption(args, "only");
  const json = boolOption(args, "json");

  /*
   * `--process` for the desktop adapters (T6.1, T6.2, LLD §16).
   *
   * A desktop conformance run drives an application that is already running,
   * named by its process — the app is "Yam" — where a web run drives a
   * browser it opens at a URL. Both go into `app`, and the adapter uses the one
   * that means something to it.
   */
  const processName = stringOption(args, "process");
  const appPath = stringOption(args, "app-path");

  const config: Config = {
    ...DEFAULT_CONFIG,
    project: "surface-conformance",
    adapter: adapter as Config["adapter"],
    app: {
      ...target,
      ...(processName === undefined ? {} : { processName }),
      ...(appPath === undefined ? {} : { appPath }),
    },
    run: { ...DEFAULT_CONFIG.run, headless },
  };

  const session = {
    ...target,
    ...(processName === undefined ? {} : { processName }),
    ...(appPath === undefined ? {} : { appPath }),
  };

  /*
   * Which suite (LLD §14, §16). A desktop adapter drives the app and cannot
   * navigate; the web suite's every case begins with one. Choosing by the
   * surface's own `kind` rather than by the adapter's name is what keeps this
   * true for an adapter nobody here has heard of.
   */
  const probe = await createSurface(config);
  const desktop = probe.kind === "desktop";

  /*
   * The app variant this pass is looking at, and where the healing cases keep
   * what they recorded (Draft 2.8 LLD §16, T7.1). Without `--heal-state` the
   * healing cases have no healer and say so rather than passing.
   */
  const variant = Number(stringOption(args, "variant") ?? "0");
  const healState = stringOption(args, "heal-state");

  const report = await runSurfaceConformance({
    adapter,
    baseUrl,
    ...(desktop ? { cases: [...DESKTOP_CASES, ...DESKTOP_HEALING_CASES] } : {}),
    ...(desktop ? { variant } : {}),
    ...(desktop && healState !== undefined
      ? { healing: desktopHealing(variant, healState) }
      : {}),
    ...(only === undefined ? {} : { only: only.split(",").map((s) => s.trim()) }),
    openSurface: async () => {
      const surface = await createSurface(config);
      await surface.open(session as never);
      return surface;
    },
  });

  emit(report, args, io, json);
  return report.conformant ? EXIT.ok : EXIT.failed;
}

function emit(report: ConformanceReport, args: ParsedArgs, io: CommandIo, json: boolean): void {
  const markdownPath = stringOption(args, "report");
  if (markdownPath !== undefined) {
    mkdirSync(dirname(markdownPath), { recursive: true });
    writeFileSync(markdownPath, renderMarkdown(report), "utf8");
    io.err(`wrote ${markdownPath}`);
  }
  io.out(json ? JSON.stringify(report, null, 2) : renderReport(report));
}
