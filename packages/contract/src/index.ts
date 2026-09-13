/**
 * The contract: what every Yam client and the broker agree on (PK-07).
 *
 * The operation catalogue — every operation's name, its CLI flags, its MCP tool
 * name, its service path and its schemas — and the fingerprint derived from
 * them. It lived inside `@svatah/yam-surface-control`, which is the *broker's*
 * package, so a client that only wanted to know what the contract is had to
 * depend on the thing that implements it.
 *
 * It is its own package now because three installables depend on it and nothing
 * else: `@svatah/yam`, `@svatah/yam-mcp`, and the application that stages the
 * first. A contract change is then one version bump that all three observe,
 * rather than three packages that drifted — which is the difference between the
 * broker's `mismatched` state being diagnosable and being a guess.
 *
 * It depends on `@svatah/yam-schema` and `zod`, and on nothing that drives
 * anything. A package that described the contract *and* opened a browser would
 * not be a contract.
 */
export * from "./catalogue.js";
