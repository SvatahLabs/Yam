// Svatah workspace lint configuration.
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
  "workflow",
  "tool",
];
const MODEL_AND_AUTHORING = ["gateway", "recorder", "compiler", "trajectory"];

/** Module (a) — bindings, healer, playwright-test — must not need the flow language. */
const MODULE_A = ["bindings", "healer", "playwright-test"];
const FLOW_LANGUAGE = ["spec", "steps", "compiler"];

/** Only `cli` (adapter registration) and `playwright-test` (Playwright only) may reach an adapter. */
const MAY_IMPORT_ADAPTERS = ["cli", "playwright-test"];

export const BOUNDARIES = [
  ...MODEL_FREE_CONSUMERS.flatMap((from) =>
    MODEL_AND_AUTHORING.filter((to) => to !== from).map((to) => ({
      from,
      to,
      why: "LLD §1: replay and module (a) packages must stay model-free and authoring-free (REQ-RUN-1).",
    })),
  ),
  ...MODULE_A.flatMap((from) =>
    FLOW_LANGUAGE.filter((to) => to !== from).map((to) => ({
      from,
      to,
      why: "LLD §1: module (a) must not depend on module (b)'s flow language (REQ-PKG-1).",
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
  // playwright-test may reach the Playwright adapter, and only that one.
  ...ADAPTERS.filter((a) => a !== "adapter-playwright").map((to) => ({
    from: "playwright-test",
    to,
    why: "LLD §1: playwright-test may import adapter-playwright only (REQ-SURF-2).",
  })),
];

/** `import/no-restricted-paths` zones, keyed on resolved file paths. */
const zones = BOUNDARIES.map(({ from, to, why }) => ({
  target: `./packages/${from}/src`,
  from: `./packages/${to}`,
  message: `@svatah/${from} must not import @svatah/${to}. ${why}`,
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
            group: [`@svatah/${to}`, `@svatah/${to}/*`],
            message: `@svatah/${from} must not import @svatah/${to}. ${why}`,
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
          const message = `@svatah/${from} must not import @svatah/${to}. ${why}`;
          const pattern = `/^@svatah\\u002F${to}(\\u002F|$)/`;
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
      globals: { console: "readonly", process: "readonly", URL: "readonly", fetch: "readonly" },
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
