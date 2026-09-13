/**
 * What this build is, read from its own `package.json`.
 *
 * There was no version constant anywhere in the CLI — which is why
 * `yam --version` printed "No Yam project here": the flag reached the project
 * check because nothing had claimed it. `PK-08` needs one for a different
 * reason: when three installables share a broker, a mismatch has to name which
 * of them is old, and a build that cannot say what it is cannot be named.
 *
 * `createRequire` rather than an import assertion, because the package is
 * bundled and the JSON must be read at run time from beside `dist/`.
 */
import { createRequire } from "node:module";

const read = (): string => {
  try {
    const manifest = createRequire(import.meta.url)("../package.json") as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
};

export const VERSION: string = read();
