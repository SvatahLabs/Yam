# `@svatah/yam-sdk`

The typed TypeScript client for the Yam local service (REQ-SDK-1, LLD §13.8).

```ts
import { connect } from "@svatah/yam-sdk";

const client = connect();                              // YAM_SERVICE_URL / _TOKEN
const project = await client.getProject();
const { runId } = (await client.postRun({ flows: ["flows/simple.flow"] })) as { runId: string };

const stop = client.subscribe((event) => {
  if (event.kind === "run.summary") stop();
});

await client.run("bindings.verify", {});               // the screen model's actions
```

Four things, and only the first is generated:

1. **`GeneratedClient`** — one method per route, written by
   `node scripts/generate-clients.mjs` from `packages/service/openapi.json`.
   `tools/repo-checks/test/client-drift.test.ts` regenerates and diffs, so a
   route the service renamed is a red build.
2. **`subscribe()`** — the event stream over SSE (default) or WebSocket, which
   an OpenAPI description cannot express as anything but "a string".
   `fetch` rather than `EventSource`, because `EventSource` cannot send an
   `Authorization` header and the token is not going in a URL.
3. **`actions`** — `@svatah/yam-screens`'s registry, so an agent out of process runs
   the same action a person clicks, by the same id.
4. **`connect()`** — `YAM_SERVICE_URL` and `YAM_SERVICE_TOKEN`, then the
   lock file `YAM_SERVICE_LOCK` names. **Never a model credential.**

Bodies are `unknown`. Their types are `@svatah/yam-schema`'s — `StepResult`,
`Summary`, `BindingFile` — and re-deriving them from a JSON Schema round-trip
would make a second, subtly different set of the same types (REQ-STD-1).

`YamClient` satisfies `@svatah/yam-screens`'s `ScreenService` structurally, so
every screen loads against it with nothing to adapt.
