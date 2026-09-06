/**
 * The compiler golden set (REQ-COMP-9, T0.6, T4.4).
 *
 * The reader moved into `@svatah/yam-compiler` at T4.4, when `yam eval compiler`
 * was built: the thing that *scores* the compiler and the thing that *checks the
 * corpus* have to read the same file with the same code, or a corpus that passed
 * the check could still be unscoreable.
 *
 * This is the re-export the Phase 0 note promised.
 */
export {
  goldenEntrySchema,
  materialise,
  readGolden,
  GOLDEN_PROVENANCE,
  type GoldenEntry,
} from "@svatah/yam-compiler";
