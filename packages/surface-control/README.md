# @svatah/yam-surface-control

The shared surface-control core (SF-01..SF-14): the one operation catalogue, the
session broker, and the dispatcher that the CLI, the MCP server, the local
service and the desktop are all clients of. Live control lives here rather than
in the CLI's project-loading, so connect → inspect → act → verify works with no
project, flow, binding or model credential.

**One public contract.** A single catalogue of operation descriptors —
`targets`, `connect`, `snapshot`, `describe`, `capabilities`, `act`, `read`,
`check`, `screenshot`, `sessions`, `close` — is the source the CLI parsing/help,
the MCP tool schemas and the service routes are all derived from. An argument
added to the catalogue reaches every interface, or none.

## What it exports

```ts
OPERATIONS                       // the v1 catalogue: one descriptor per operation
operationByName / …ByCliSubcommand / …ByMcpTool / …ByServicePath

createSessionStore()             // session lifecycle: launch/attach, TTL, close
startBroker() / callBroker()     // the loopback broker that owns sessions across processes
discoverBroker() / writeBrokerDescriptor()   // owner-only descriptor in the OS state dir

discoverTargets() / discoverAdapters() / checkAdapterReadiness()   // SF-04, SF-09
createReferenceStore()           // generation-bound references (SF-10)
createCoordinationStore()        // leases, idempotency, deadlines (SF-11, SF-13, SF-14)
createEventStore() / createRedactionPolicy()   // redacted session events (SF-12, SF-15)

successEnvelope() / failedEnvelope() / refusedEnvelope()   // the versioned result envelope
generateOpenApiPaths() / generateTypeScriptClient() / …Python / …Java   // codegen
```

## Session ownership

The broker persists across short CLI invocations, binds to loopback, and
authenticates every client with a per-process token that is never written to the
repository, a process argument or a copied MCP config. It distinguishes closing
a launched resource from detaching a user-owned one, serialises mutations per
target, and reports an outcome as `succeeded`, `failed`, `refused`, `cancelled`
or `unknown` — `verified` is true only when an explicit postcondition passed.

## Import boundary

Depends only on `@svatah/yam-schema` and `@svatah/yam-surface`. It imports no
compiler, recorder, gateway or service; an import-boundary check enforces it
(LLD §1), which is what lets the same core sit under the CLI, the MCP server and
the service without a cycle.

## Licence

Apache-2.0.
