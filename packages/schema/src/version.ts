/**
 * The version of the Yam artifact contract.
 *
 * Every artifact that crosses a process or a repository boundary carries this
 * string in its `schemaVersion` field (REQ-STD-1). It is independent of the npm
 * package version and is bumped on any change to the shapes in LLD §3.
 */
export const SCHEMA_VERSION = "1.0.0";

export type SchemaVersion = typeof SCHEMA_VERSION;
