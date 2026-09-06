// Yam workspace lint configuration.
//
// The substance of this file is the import-boundary enforcement required by
// LLD §1 and REQ-SURF-2 / REQ-PKG-1. Every boundary is expressed twice:
//
//   * `import/no-restricted-paths` — the rule LLD §1 names. It works on resolved
//     file paths, so it catches relative or deep imports that reach across
//     package directories.
//   * `no-restricted-imports` — the same boundaries expressed as package-name
//     patterns. This is what actually catches the normal case, a workspace
//     package importing `@svatah/<other>` by name, without depending on the
//     module resolver being able to follow pnpm's symlinks.
//   * `no-restricted-syntax` — the same boundaries expressed as selectors over
//     `import()` expressions and `require()` calls. `no-restricted-imports` only
//     sees static `import` and `export … from`; a dynamic import would otherwise
//     walk straight through the boundary (LLD §1, Draft 2.2).
//
// `import/no-restricted-paths` works on *resolved* paths, so it is only as good
// as the resolver: without one that understands TypeScript, a relative specifier
// like `../../gateway/src/index.js` resolves to nothing and the rule silently
// skips it. `eslint-import-resolver-typescript` is configured below so the `.js`
// specifier ESM requires maps back onto the `.ts` file on disk.
//
// A violation of any of the three rules fails `pnpm lint`. The fourth guard —
// that no package.json *declares* a forbidden package — is a test, not a lint
// rule: see `tools/repo-checks/test/import-boundaries.test.ts`.
//
// ## What these rules cannot see, and what does (P1-F5)
//
// All three work on specifiers that are literals in the source. Two forms are
// therefore outside their reach, and no configuration of them changes that:
//
//   * a **computed dynamic specifier** — `await import(`@svatah/${name}`)`, or
//     any expression the linter cannot evaluate. The selectors match a `Literal`
//     argument; a template or a variable is not one.
//   * **`createRequire`** — `createRequire(import.meta.url)("@svatah/yam-gateway")`,
//     and equally `process.getBuiltinModule`, `require.resolve` reached through
//     an alias, or anything else that gets to a module through a value rather
//     than through syntax.
//
// This is a limitation of static linting, not an oversight, and it is why LLD §1
// requires a dependency-graph test as well: **the guard that actually holds at
// run time is the transitive-closure test**, which reads every package.json and
// walks the whole `@svatah/*` closure. With pnpm's strict isolation a package
// can only resolve what its manifest declares, so a specifier the lint cannot
// read still fails at run time unless the dependency was declared — and if it
// was declared, the test fails first. The lint is the guard that *names the
// rule* where the code is written; the test is the guard that *holds*.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";

/** Every package under `packages/`, by directory name. */
const ADAPTERS = [
  "adapter-playwright",
  "adapter-http",
  "adapter-bidi",
  "adapter-appium",
  "adapter-uia",
  "adapter-ax",
];

const ALL_PACKAGES = [
  "schema",
  "surface",
  ...ADAPTERS,
  "bindings",
  "healer",
  "runtime",
  "playwright-test",
  "bindings-cli",
  "host-playwright",
  "spec",
  "steps",
  "compiler",
  "gateway",
  "recorder",
  "workflow",
  "tool",
  "trajectory",
  "cli",
  "service",
  "migrate",
  "conformance",
  // The builder surfaces (Draft 2.11, T9.1–T9.4).
  "screens",
  "sdk",
  "ui-tokens",
  "ui",
  "tui",
];

/**
 * The three boundaries of LLD §1, as { from, to, why } triples.
 * `from` and `to` are package directory names under `packages/`.
 */
const MODEL_FREE_CONSUMERS = [
  "runtime",
  "bindings",
  "healer",
  ...ADAPTERS,
  "surface",
  "playwright-test",
  // Draft 2.3 split `playwright-test` in two. LLD §1's bullet still names only
  // the old package, but both halves replay rather than author, so both carry
  // the rule the old one carried.
  "bindings-cli",
  "host-playwright",
  "workflow",
  "tool",
];
const MODEL_AND_AUTHORING = ["gateway", "recorder", "compiler", "trajectory"];

/**
 * Module (a) must not need module (b). Draft 2.3 added `bindings-cli` to the
 * list and `runtime` to what the list may not reach: the healer gets to the
 * executor through the `Replayer` plugin (LLD §10) and never by importing it,
 * which is what keeps `runtime` publishable in module (b).
 */
const MODULE_A = ["bindings", "healer", "playwright-test", "bindings-cli"];
const MODULE_B_CORE = ["spec", "steps", "compiler", "runtime"];

/**
 * Only `cli` (adapter registration) and the packages LLD §1 names may reach an
 * adapter — and all but `cli` are restricted to the Playwright one below.
 */
const MAY_IMPORT_ADAPTERS = ["cli", "bindings-cli", "playwright-test", "host-playwright"];

/** Everything but `cli` gets the Playwright adapter and no other. */
const PLAYWRIGHT_ONLY = ["playwright-test", "host-playwright", "bindings-cli"];

/**
 * The service holds no logic (T2.11, LLD §13.5).
 *
 * "Every handler calls the same functions the CLI calls; no logic lives in the
 * service (lint rule: `service` may import only `cli`'s command functions and
 * `schema`)."
 *
 * Stricter than the spec's parenthetical, and for a reason. The first draft had
 * the service import `@svatah/yam`, which satisfied the rule and made the
 * workspace graph cyclic — the CLI mounts `yam serve` — so a clean clone
 * failed to build with the service's type build running before the CLI had any
 * types. The CLI now *injects* those functions (`ServiceApi`), and the service
 * imports `schema` alone.
 *
 * The rule is stronger as a result: the service does not merely refrain from
 * calling the compiler or the executor, it has no way to reach them.
 */
const SERVICE_MAY_NOT_IMPORT = ALL_PACKAGES.filter(
  (name) => name !== "schema" && name !== "service",
);

/**
 * The screen model is over the wire and nothing else (Draft 2.11, LLD §13.7).
 *
 * "A screen's logic lives in `@svatah/yam-screens`; the ADE and `yam ui` render
 * it and add nothing." A screen reaches the world through a `ScreenService` it
 * is *handed* — the interface in `packages/screens/src/service.ts` — so it may
 * name `@svatah/yam-schema` for the wire shapes and nothing else in the workspace.
 *
 * Two things this stops. A screen that imported `@svatah/yam-runtime` or
 * `@svatah/yam-compiler` would be a screen doing work the CLI cannot (the review
 * rule of §13.6, from the other side). A screen that imported `@svatah/yam-sdk`
 * would make the graph cyclic: the SDK takes its `actions` from here (§13.8).
 */
const SCREENS_MAY_NOT_IMPORT = ALL_PACKAGES.filter(
  (name) => name !== "schema" && name !== "screens",
);

/**
 * Neither renderer imports a runtime package (Draft 2.11, working rule 3).
 *
 * `@svatah/yam-tui` is `yam ui`; the ADE is `apps/ade` and is held to the same
 * rule by its own manifest, which declares the surface packages and nothing
 * that replays a plan. A renderer that could reach the executor would be a
 * renderer that could do something the service cannot, and the whole point of
 * two renderers over one model is that neither can.
 */
const RENDERER_MAY_NOT_IMPORT = ALL_PACKAGES.filter(
  (name) => !["schema", "screens", "sdk", "ui", "ui-tokens", "tui"].includes(name),
);

/** The design system is React and tokens; it has no idea what a plan is. */
const UI_MAY_NOT_IMPORT = ALL_PACKAGES.filter((name) => !["ui-tokens", "ui"].includes(name));

export const BOUNDARIES = [
  ...SERVICE_MAY_NOT_IMPORT.map((to) => ({
    from: "service",
    to,
    why: "LLD §13.5: the service may import @svatah/yam and @svatah/yam-schema only; no logic lives in a handler.",
  })),
  ...SCREENS_MAY_NOT_IMPORT.map((to) => ({
    from: "screens",
    to,
    why: "LLD §13.7: the screen model is a view over the service it is handed; it may import @svatah/yam-schema and nothing else (REQ-ADE-10).",
  })),
  ...RENDERER_MAY_NOT_IMPORT.map((to) => ({
    from: "tui",
    to,
    why: "LLD §13.7: a renderer renders the model and adds nothing; it may not import a runtime package (REQ-TUI-1).",
  })),
  ...UI_MAY_NOT_IMPORT.map((to) => ({
    from: "ui",
    to,
    why: "LLD §13.7: the design system is components and tokens; it knows nothing about plans, runs or bindings (REQ-ADE-12).",
  })),
  ...MODEL_FREE_CONSUMERS.flatMap((from) =>
    MODEL_AND_AUTHORING.filter((to) => to !== from).map((to) => ({
      from,
      to,
      why: "LLD §1: replay and module (a) packages must stay model-free and authoring-free (REQ-RUN-1).",
    })),
  ),
  ...MODULE_A.flatMap((from) =>
    MODULE_B_CORE.filter((to) => to !== from).map((to) => ({
      from,
      to,
      why: "LLD §1: module (a) must not depend on module (b) (REQ-PKG-1). Replay reaches the executor through the Replayer plugin, LLD §10.",
    })),
  ),
  ...ALL_PACKAGES.filter(
    (from) => !MAY_IMPORT_ADAPTERS.includes(from) && !ADAPTERS.includes(from) && from !== "surface",
  ).flatMap((from) =>
    ADAPTERS.map((to) => ({
      from,
      to,
      why: "LLD §1: nothing above the surface may import an adapter directly (REQ-SURF-2).",
    })),
  ),
  // Everything but `cli` may reach the Playwright adapter, and only that one.
  ...PLAYWRIGHT_ONLY.flatMap((from) =>
    ADAPTERS.filter((a) => a !== "adapter-playwright").map((to) => ({
      from,
      to,
      why: `LLD §1: ${from} may import adapter-playwright only (REQ-SURF-2).`,
    })),
  ),
];

/**
 * The npm specifier of a workspace package directory (Draft 2.18): the CLI is the
 * umbrella package `@svatah/yam`; every other package is `@svatah/yam-<dir>`.
 */
const specifierOf = (dir) => (dir === "cli" ? "@svatah/yam" : `@svatah/yam-${dir}`);

/** `import/no-restricted-paths` zones, keyed on resolved file paths. */
const zones = BOUNDARIES.map(({ from, to, why }) => ({
  target: `./packages/${from}/src`,
  from: `./packages/${to}`,
  message: `${specifierOf(from)} must not import ${specifierOf(to)}. ${why}`,
}));

/**
 * `no-restricted-imports` overrides, one config block per source package, listing
 * the `@svatah/*` specifiers that package may not name.
 */
const specifierBlocks = ALL_PACKAGES.map((from) => {
  const forbidden = BOUNDARIES.filter((b) => b.from === from);
  if (forbidden.length === 0) return null;
  return {
    files: [`packages/${from}/src/**/*.ts`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: forbidden.map(({ to, why }) => ({
            group: [specifierOf(to), `${specifierOf(to)}/*`],
            message: `${specifierOf(from)} must not import ${specifierOf(to)}. ${why}`,
          })),
        },
      ],
      // `no-restricted-imports` does not see `import("…")` or `require("…")`.
      // These selectors do, for the package-name form; the relative form is
      // caught by `import/no-restricted-paths`, which visits import expressions
      // too now that the TypeScript resolver can resolve them (LLD §1).
      "no-restricted-syntax": [
        "error",
        ...forbidden.flatMap(({ to, why }) => {
          const message = `${specifierOf(from)} must not import ${specifierOf(to)}. ${why}`;
          const pattern = `/^${specifierOf(to).replace("/", "\\u002F")}(\\u002F|$)/`;
          return [
            { selector: `ImportExpression > Literal[value=${pattern}]`, message },
            {
              selector: `CallExpression[callee.name="require"] > Literal[value=${pattern}]`,
              message,
            },
          ];
        }),
      ],
    },
  };
}).filter((b) => b !== null);

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "legacy/**",
      "**/*.d.ts",
      "apps/sample-web/public/**",
      "docs/**",
      // Electron Forge's Vite output and its installers (T3.6). Bundled code is
      // not source and linting it says nothing about this repository.
      "**/.vite/**",
      "apps/ade/out/**",
      // `.yam/` is a project's scratch directory — a compiled plan, a heal
      // diff, a model cache — and is git-ignored everywhere. It is generated
      // output, not source, and linting it says nothing about this repository.
      "**/.yam/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { import: importPlugin },
    settings: {
      // Without this, `import/no-restricted-paths` cannot resolve a relative
      // specifier such as `../../gateway/src/index.js` (ESM writes `.js`, the
      // file on disk is `.ts`) and skips it silently — the bypass Draft 2.2 §1
      // closes.
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: [
            "packages/*/tsconfig.json",
            "tools/*/tsconfig.json",
            "apps/*/tsconfig.json",
          ],
        },
      },
      "import/parsers": { "@typescript-eslint/parser": [".ts", ".tsx"] },
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        // The renderer is a browser (T3.6); these are its, not Node's. The
        // scripts that *drive* a browser carry expressions evaluated inside one
        // (`page.evaluate`, `Runtime.evaluate`), so they are read here too.
        document: "readonly",
        window: "readonly",
        getComputedStyle: "readonly",
        Response: "readonly",
        Blob: "readonly",
        AbortController: "readonly",
        TextDecoderStream: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "import/no-restricted-paths": ["error", { zones }],
    },
  },
  ...specifierBlocks,
  {
    // Repo tooling and tests are outside the package graph.
    files: ["scripts/**/*.mjs", "tools/**/*.ts", "**/test/**/*.ts", "**/*.config.ts"],
    rules: {
      "import/no-restricted-paths": "off",
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },
);
