/**
 * sample-web — the sample application the surface, grounding, healing and
 * conformance suites run against (LLD §16).
 *
 * `pnpm --filter sample-web start` serves it on port 4173.
 */
export { PAGES, pageFor, APP_CSS, CANVAS_JS, type Page } from "./pages.js";
export {
  VARIANTS,
  VARIANT_IDS,
  variantById,
  applyVariant,
  type Variant,
  type VariantKind,
} from "./variants.js";
export {
  createSampleApp,
  startSampleApp,
  parseVariant,
  DEFAULT_PORT,
  type SampleServer,
} from "./server.js";
