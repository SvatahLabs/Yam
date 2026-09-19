# Generated clients

Python and Java clients for the Yam local service, generated from the same
OpenAPI description as `@svatah/yam-sdk` (REQ-SDK-2, LLD §13.8).

```console
$ pnpm clients          # regenerate all three
$ pnpm clients:check    # fail if a committed client has drifted
$ pnpm clients:smoke    # run both smoke scripts against a live service
```

They are conformance artifacts of REQ-STD-1's message schemas as much as they
are clients: a route or an event kind that reaches one and not the others is a
failing drift check.

## The generator is ours, and why

T9.3's environment note: "the generators must be permissively licensed
(REQ-PKG-3). If a generator cannot be found under a permissive licence, write a
minimal generator of your own from the OpenAPI description and say so."

`openapi-generator` is Apache-2.0 and would satisfy the licence, but it is a
30 MB Java jar fetched from Maven Central at build time — a network dependency
in the build of a project whose replay path has none — and a second toolchain to
pin. `openapi-typescript` and `orval` are MIT and generate TypeScript only.

What is actually needed is small: 36 routes with path parameters, a body or not,
JSON or text back. `scripts/generate-clients.mjs` is about two hundred lines and
emits all three, and the drift check is what makes it trustworthy.

## Neither client has a dependency

`urllib` and `java.net.http` are enough for a loopback HTTP client and a
`text/event-stream` reader. A client for a *local* service that pulled in
`requests` or an HTTP library would have a licence surface larger than its code
(REQ-PKG-3) — and it means `javac` alone compiles the Java one, so the smoke
path has no network in it.

## `python`

```console
$ export YAM_SERVICE_URL=... YAM_SERVICE_TOKEN=...   # yam serve prints them
$ python3 clients/python/smoke.py
GET /project      clients-smoke: 7 flow(s), 22 story/stories
POST /run         started 00mto7o3c8a3h79n
GET /events/sse   10 event(s): run.started, step.result, run.summary
GET /runs/00mto7o3c8a3h79n/results  8 step(s), matching the stream
python 3.14.3: 3 of 3 — the client is conformant
```

To be published as `svatah-yam` on PyPI, versioned with the npm tarballs. It is
not on PyPI yet; use it from this directory.

## `java`

```console
$ javac -d /tmp/yam clients/java/src/main/java/com/svatah/yam/sdk/GeneratedClient.java \
                       clients/java/Smoke.java
$ java -cp /tmp/yam Smoke
```

To be published as `com.svatah.yam:svatah-yam`, versioned with the npm tarballs.
It is not on Maven Central yet; build it from this directory. The Gradle build is
for publishing; nothing in the smoke path needs it.
