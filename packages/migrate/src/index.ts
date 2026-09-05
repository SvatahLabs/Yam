/**
 * @svatah/migrate
 *
 * v1 and v2 flows, `.locator` files and `.data` files into v3 flows, a seed
 * bindings store and `data.yaml` (REQ-LANG-11).
 *
 * Story names and step order are preserved exactly, so a reviewer can read the
 * two files side by side. Everything the migration had to guess at goes in the
 * review report, because a legacy locator says where an element was and never
 * what it is — and a target phrase derived from `xpath://li[4]/a/p` is a name
 * nobody would recognise.
 */
export { migrate, type MigrateOptions, type MigrateResult } from "./migrate.js";
export {
  extractAdeProject,
  readAdeDatabase,
  NOT_IMPORTED,
  type AdeDatabase,
  type FromAdeOptions,
  type FromAdeResult,
  type Table,
} from "./from-ade.js";
export { renderReviewReport, type ReportInput, type ReviewNote } from "./report.js";
export {
  parseLegacyStep,
  parseLocator,
  readLegacyFlow,
  type LegacyBlock,
  type LegacyFlow,
  type LegacyLocator,
  type LegacyStep,
} from "./v2.js";
export {
  hasInteriorPreposition,
  phraseFor,
  rewriteStep,
  valueFor,
  verbFor,
  type RewriteResult,
} from "./rewrite.js";
export {
  parseLocatorFile,
  parseLocatorLine,
  seedBinding,
  type MigratedLocator,
} from "./locators.js";
export { environmentName, looksSecret, migrateData, type MigratedData } from "./data.js";
