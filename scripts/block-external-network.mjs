/**
 * Refuse every connection that is not to the machine itself (T3.5, REQ-RUN-1,
 * REQ-NFR-1).
 *
 *   NODE_OPTIONS="--import=./scripts/block-external-network.mjs" \
 *     node packages/cli/dist/bin.js run evals/fixtures --host none
 *
 * "The executor makes no model calls"; "replay has no network dependency other
 * than the target platform." Both are structural — `runtime` cannot import
 * `gateway`, and the lint and the dependency-graph test say so — but a structural
 * argument is a thing a reader has to follow. This is the thing a reader can run:
 * with it loaded, a replay that reached for a model would fail loudly, and one
 * that passes has demonstrably reached for nothing.
 *
 * Loopback is allowed because that is where `apps/sample-web` is. Everything else
 * — `api.anthropic.com` included, and named there so the failure reads clearly —
 * throws.
 *
 * Four doors, because Node has four. `fetch` is what the gateway uses; `http` and
 * `https` are what an older client would; `net` and `tls` are underneath all of
 * them, and patching only the top would leave a socket open for anything that
 * skipped it.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function refuse(host, how) {
  return new Error(
    `Blocked a ${how} connection to ${host}. This replay is running with external network ` +
      "access disabled: the executor makes no model calls and needs no network beyond the " +
      "application under test (REQ-RUN-1, REQ-NFR-1).",
  );
}

function allowed(host) {
  return host === undefined || host === "" || LOOPBACK.has(String(host).toLowerCase());
}

/* fetch — what the model gateway uses. */
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const href =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const { hostname } = new URL(href);
  if (!allowed(hostname)) throw refuse(hostname, "fetch");
  return await realFetch(input, init);
};

/* http / https — what an older client would use. */
for (const [module, name] of [
  [http, "http"],
  [https, "https"],
]) {
  for (const method of ["request", "get"]) {
    const real = module[method].bind(module);
    module[method] = (...args) => {
      const first = args[0];
      const host =
        typeof first === "string" || first instanceof URL
          ? new URL(String(first)).hostname
          : (first?.hostname ?? first?.host);
      if (!allowed(host)) throw refuse(host, name);
      return real(...args);
    };
  }
}

/* net / tls — underneath all of the above. */
const realNetConnect = net.connect.bind(net);
net.connect = (...args) => {
  const host = typeof args[0] === "object" ? args[0]?.host : args[1];
  if (!allowed(host)) throw refuse(host, "tcp");
  return realNetConnect(...args);
};

const realTlsConnect = tls.connect.bind(tls);
tls.connect = (...args) => {
  const host = typeof args[0] === "object" ? args[0]?.host : args[1];
  if (!allowed(host)) throw refuse(host, "tls");
  return realTlsConnect(...args);
};
