"""
GENERATED FILE — do not edit.

`node scripts/generate-clients.mjs` writes this from the service's own OpenAPI
description (`GET /openapi.json`, LLD §13.5, §13.8). It is committed so a client
builds without a running service, and a test regenerates it and diffs, so drift
between a client and the service is a red build rather than a discovery.

Bodies are `unknown` on purpose: their types are `@svatah/yam-schema`'s, and
re-deriving them here would make a second, subtly different set of the same
types (REQ-STD-1).
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Iterator, Optional


ENDPOINTS = [
    {"id": "deleteSessionsBySession", "verb": "delete", "path": "/sessions/{session}"},
    {"id": "getAgentsClients", "verb": "get", "path": "/agents/clients"},
    {"id": "getApi", "verb": "get", "path": "/api"},
    {"id": "getBindings", "verb": "get", "path": "/bindings"},
    {"id": "getBindingsById", "verb": "get", "path": "/bindings/{id}"},
    {"id": "getData", "verb": "get", "path": "/data"},
    {"id": "getEvents", "verb": "get", "path": "/events"},
    {"id": "getEventsSse", "verb": "get", "path": "/events/sse"},
    {"id": "getFlowsByFile", "verb": "get", "path": "/flows/{file}"},
    {"id": "getHealth", "verb": "get", "path": "/health"},
    {"id": "getOpenapijson", "verb": "get", "path": "/openapi.json"},
    {"id": "getPlan", "verb": "get", "path": "/plan"},
    {"id": "getProject", "verb": "get", "path": "/project"},
    {"id": "getRuns", "verb": "get", "path": "/runs"},
    {"id": "getRunsById", "verb": "get", "path": "/runs/{id}"},
    {"id": "getRunsByIdAudit", "verb": "get", "path": "/runs/{id}/audit"},
    {"id": "getRunsByIdResults", "verb": "get", "path": "/runs/{id}/results"},
    {"id": "getRunsByIdScreenshotsByName", "verb": "get", "path": "/runs/{id}/screenshots/{name}"},
    {"id": "getSessions", "verb": "get", "path": "/sessions"},
    {"id": "getSessionsBySessionCapabilities", "verb": "get", "path": "/sessions/{session}/capabilities"},
    {"id": "getSessionsBySessionEvents", "verb": "get", "path": "/sessions/{session}/events"},
    {"id": "getSessionsBySessionScreenshotpng", "verb": "get", "path": "/sessions/{session}/screenshot.png"},
    {"id": "getTargets", "verb": "get", "path": "/targets"},
    {"id": "getTools", "verb": "get", "path": "/tools"},
    {"id": "postAgentsTest", "verb": "post", "path": "/agents/test"},
    {"id": "postApiRequest", "verb": "post", "path": "/api/request"},
    {"id": "postBindingsVerify", "verb": "post", "path": "/bindings/verify"},
    {"id": "postCapture", "verb": "post", "path": "/capture"},
    {"id": "postCaptureByIdStop", "verb": "post", "path": "/capture/{id}/stop"},
    {"id": "postCompile", "verb": "post", "path": "/compile"},
    {"id": "postHeal", "verb": "post", "path": "/heal"},
    {"id": "postMigrate", "verb": "post", "path": "/migrate"},
    {"id": "postRecord", "verb": "post", "path": "/record"},
    {"id": "postRecordByIdDecision", "verb": "post", "path": "/record/{id}/decision"},
    {"id": "postRecordByIdStop", "verb": "post", "path": "/record/{id}/stop"},
    {"id": "postRun", "verb": "post", "path": "/run"},
    {"id": "postRunsByIdStop", "verb": "post", "path": "/runs/{id}/stop"},
    {"id": "postSessions", "verb": "post", "path": "/sessions"},
    {"id": "postSessionsBySessionAct", "verb": "post", "path": "/sessions/{session}/act"},
    {"id": "postSessionsBySessionCheck", "verb": "post", "path": "/sessions/{session}/check"},
    {"id": "postSessionsBySessionControl", "verb": "post", "path": "/sessions/{session}/control"},
    {"id": "postSessionsBySessionDescribe", "verb": "post", "path": "/sessions/{session}/describe"},
    {"id": "postSessionsBySessionRead", "verb": "post", "path": "/sessions/{session}/read"},
    {"id": "postSessionsBySessionRequest", "verb": "post", "path": "/sessions/{session}/request"},
    {"id": "postSessionsBySessionScreenshot", "verb": "post", "path": "/sessions/{session}/screenshot"},
    {"id": "postSessionsBySessionSnapshot", "verb": "post", "path": "/sessions/{session}/snapshot"},
    {"id": "postSurfaceBySessionSnapshot", "verb": "post", "path": "/surface/{session}/snapshot"},
    {"id": "postTrajectoryCompile", "verb": "post", "path": "/trajectory/compile"},
    {"id": "putApiByName", "verb": "put", "path": "/api/{name}"},
    {"id": "putData", "verb": "put", "path": "/data"},
    {"id": "putFlowsByFile", "verb": "put", "path": "/flows/{file}"},
]

EVENT_KINDS = ["step.result", "run.summary", "run.started", "run.failed", "record.started", "record.step", "record.decision", "record.candidates", "record.decision.expired", "record.finished", "record.failed", "capture.started", "capture.step", "capture.finished", "capture.failed", "heal.proposal", "heal.finished", "heal.failed", "tool.invocation", "log"]


class ServiceError(RuntimeError):
    """A non-2xx answer, with the body the service sent."""

    def __init__(self, status: int, path: str, body: str) -> None:
        super().__init__(f"{path} answered {status}: {body[:400]}")
        self.status = status
        self.path = path
        self.body = body


@dataclass(frozen=True)
class ServiceConnection:
    url: str
    token: str


class GeneratedClient:
    """Everything the service publishes. Nothing else exists."""

    def __init__(self, connection: ServiceConnection) -> None:
        self._connection = connection

    def _call(self, verb: str, path: str, body: Any = None, text: bool = False) -> Any:
        headers = {"authorization": f"Bearer {self._connection.token}"}
        data: Optional[bytes] = None
        if body is not None:
            headers["content-type"] = "text/plain" if text else "application/json"
            raw = body if isinstance(body, str) else json.dumps(body)
            data = raw.encode("utf-8")
        request = urllib.request.Request(
            f"{self._connection.url}{path}",
            data=data,
            headers=headers,
            method=verb.upper(),
        )
        try:
            with urllib.request.urlopen(request) as response:
                answer = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:  # noqa: PERF203
            raise ServiceError(error.code, path, error.read().decode("utf-8")) from error
        if text:
            return answer
        return json.loads(answer) if answer != "" else None

    def events(self) -> Iterator[dict]:
        """`GET /events/sse`, one decoded JSON object per `data:` line."""
        request = urllib.request.Request(
            f"{self._connection.url}/events/sse",
            headers={"authorization": f"Bearer {self._connection.token}"},
        )
        with urllib.request.urlopen(request) as stream:
            for line in stream:
                decoded = line.decode("utf-8").rstrip("\n")
                if decoded.startswith("data:"):
                    yield json.loads(decoded[5:].strip())

    def delete_sessions_by_session(self, session) -> Any:
        """`DELETE /sessions/{session}` — Close a surface session (SF-05)"""
        return self._call("delete", f"/sessions/{session}")

    def get_agents_clients(self) -> Any:
        """`GET /agents/clients` — Who is connected over MCP right now"""
        return self._call("get", f"/agents/clients")

    def get_api(self) -> Any:
        """`GET /api` — Named API requests"""
        return self._call("get", f"/api")

    def get_bindings(self) -> Any:
        """`GET /bindings` — The bindings store"""
        return self._call("get", f"/bindings")

    def get_bindings_by_id(self, id) -> Any:
        """`GET /bindings/{id}` — One binding"""
        return self._call("get", f"/bindings/{id}", text=True)

    def get_data(self) -> Any:
        """`GET /data` — Run data, with secrets redacted"""
        return self._call("get", f"/data")

    def get_events(self) -> Any:
        """`GET /events` — The event stream (WebSocket)"""
        return self._call("get", f"/events")

    def get_events_sse(self) -> Any:
        """`GET /events/sse` — The event stream (server-sent events)"""
        return self._call("get", f"/events/sse", text=True)

    def get_flows_by_file(self, file) -> Any:
        """`GET /flows/{file}` — Read a flow file"""
        return self._call("get", f"/flows/{file}", text=True)

    def get_health(self) -> Any:
        """`GET /health` — Liveness, for the app's spawn handshake"""
        return self._call("get", f"/health")

    def get_openapijson(self) -> Any:
        """`GET /openapi.json` — This document"""
        return self._call("get", f"/openapi.json")

    def get_plan(self) -> Any:
        """`GET /plan` — The compiled plan, story by story"""
        return self._call("get", f"/plan")

    def get_project(self) -> Any:
        """`GET /project` — Config, flows, stories, compositions, run blocks and API names"""
        return self._call("get", f"/project")

    def get_runs(self) -> Any:
        """`GET /runs` — Every run's summary"""
        return self._call("get", f"/runs")

    def get_runs_by_id(self, id) -> Any:
        """`GET /runs/{id}` — One run's summary"""
        return self._call("get", f"/runs/{id}")

    def get_runs_by_id_audit(self, id) -> Any:
        """`GET /runs/{id}/audit` — One run's audit log"""
        return self._call("get", f"/runs/{id}/audit")

    def get_runs_by_id_results(self, id) -> Any:
        """`GET /runs/{id}/results` — One run's step results"""
        return self._call("get", f"/runs/{id}/results")

    def get_runs_by_id_screenshots_by_name(self, id, name) -> Any:
        """`GET /runs/{id}/screenshots/{name}` — A screenshot a run wrote"""
        return self._call("get", f"/runs/{id}/screenshots/{name}")

    def get_sessions(self) -> Any:
        """`GET /sessions` — List active surface sessions (SF-05)"""
        return self._call("get", f"/sessions")

    def get_sessions_by_session_capabilities(self, session) -> Any:
        """`GET /sessions/{session}/capabilities` — A session's adapter capabilities (SF-09)"""
        return self._call("get", f"/sessions/{session}/capabilities")

    def get_sessions_by_session_events(self, session) -> Any:
        """`GET /sessions/{session}/events` — What this session did, and the steps a proposal compiles from (T17, SF-19)"""
        return self._call("get", f"/sessions/{session}/events")

    def get_sessions_by_session_screenshotpng(self, session) -> Any:
        """`GET /sessions/{session}/screenshot.png` — A picture of the surface, as PNG bytes, for the desktop's preview"""
        return self._call("get", f"/sessions/{session}/screenshot.png")

    def get_targets(self) -> Any:
        """`GET /targets` — Discover available targets and adapter readiness (SF-04)"""
        return self._call("get", f"/targets")

    def get_tools(self) -> Any:
        """`GET /tools` — The tools this project exposes, and every invocation served"""
        return self._call("get", f"/tools")

    def post_agents_test(self) -> Any:
        """`POST /agents/test` — Start the MCP server an agent is told to use, and complete a handshake with it"""
        return self._call("post", f"/agents/test")

    def post_api_request(self, body: Any = None) -> Any:
        """`POST /api/request` — Execute one API request ad hoc"""
        return self._call("post", f"/api/request", body=body)

    def post_bindings_verify(self, body: Any = None) -> Any:
        """`POST /bindings/verify` — Dry-resolve the store, or one binding"""
        return self._call("post", f"/bindings/verify", body=body)

    def post_capture(self, body: Any = None) -> Any:
        """`POST /capture` — Record a flow from what a person does; sentences arrive on the stream"""
        return self._call("post", f"/capture", body=body)

    def post_capture_by_id_stop(self, id) -> Any:
        """`POST /capture/{id}/stop` — End a capture, writing the flow and its bindings"""
        return self._call("post", f"/capture/{id}/stop")

    def post_compile(self) -> Any:
        """`POST /compile` — Compile and lint"""
        return self._call("post", f"/compile")

    def post_heal(self, body: Any = None) -> Any:
        """`POST /heal` — Heal a run; proposals arrive on the stream"""
        return self._call("post", f"/heal", body=body)

    def post_migrate(self, body: Any = None) -> Any:
        """`POST /migrate` — Import a Yam prototype's electron-db directory into this project"""
        return self._call("post", f"/migrate", body=body)

    def post_record(self, body: Any = None) -> Any:
        """`POST /record` — Start a recording session; decisions arrive on the stream"""
        return self._call("post", f"/record", body=body)

    def post_record_by_id_decision(self, id, body: Any = None) -> Any:
        """`POST /record/{id}/decision` — Accept, re-pick or reject the grounding a session is waiting on"""
        return self._call("post", f"/record/{id}/decision", body=body)

    def post_record_by_id_stop(self, id) -> Any:
        """`POST /record/{id}/stop` — Stop a recording session"""
        return self._call("post", f"/record/{id}/stop")

    def post_run(self, body: Any = None) -> Any:
        """`POST /run` — Start a run; step events arrive on the stream"""
        return self._call("post", f"/run", body=body)

    def post_runs_by_id_stop(self, id) -> Any:
        """`POST /runs/{id}/stop` — Stop a run that is going"""
        return self._call("post", f"/runs/{id}/stop")

    def post_sessions(self, body: Any = None) -> Any:
        """`POST /sessions` — Connect to a target and open a surface session (SF-04)"""
        return self._call("post", f"/sessions", body=body)

    def post_sessions_by_session_act(self, session, body: Any = None) -> Any:
        """`POST /sessions/{session}/act` — Perform a validated action on the surface (SF-11)"""
        return self._call("post", f"/sessions/{session}/act", body=body)

    def post_sessions_by_session_check(self, session, body: Any = None) -> Any:
        """`POST /sessions/{session}/check` — Check a predicate against the surface (SF-11)"""
        return self._call("post", f"/sessions/{session}/check", body=body)

    def post_sessions_by_session_control(self, session, body: Any = None) -> Any:
        """`POST /sessions/{session}/control` — Take, release or report who holds a target (T16, SF-13)"""
        return self._call("post", f"/sessions/{session}/control", body=body)

    def post_sessions_by_session_describe(self, session, body: Any = None) -> Any:
        """`POST /sessions/{session}/describe` — Describe a specific element on the surface (SF-10)"""
        return self._call("post", f"/sessions/{session}/describe", body=body)

    def post_sessions_by_session_read(self, session, body: Any = None) -> Any:
        """`POST /sessions/{session}/read` — Read a value from the surface (SF-11)"""
        return self._call("post", f"/sessions/{session}/read", body=body)

    def post_sessions_by_session_request(self, session, body: Any = None) -> Any:
        """`POST /sessions/{session}/request` — Send an HTTP request on an HTTP surface (T15, SF-04)"""
        return self._call("post", f"/sessions/{session}/request", body=body)

    def post_sessions_by_session_screenshot(self, session, body: Any = None) -> Any:
        """`POST /sessions/{session}/screenshot` — Take a screenshot of the current surface (SF-11)"""
        return self._call("post", f"/sessions/{session}/screenshot", body=body)

    def post_sessions_by_session_snapshot(self, session, body: Any = None) -> Any:
        """`POST /sessions/{session}/snapshot` — A semantic snapshot of the surface (SF-10)"""
        return self._call("post", f"/sessions/{session}/snapshot", body=body)

    def post_surface_by_session_snapshot(self, session, body: Any = None) -> Any:
        """`POST /surface/{session}/snapshot` — The driven session's snapshot, for the picker and the explorer"""
        return self._call("post", f"/surface/{session}/snapshot", body=body)

    def post_trajectory_compile(self, body: Any = None) -> Any:
        """`POST /trajectory/compile` — Compile a captured trajectory into proposals/<date>/"""
        return self._call("post", f"/trajectory/compile", body=body)

    def put_api_by_name(self, name, body: Any = None) -> Any:
        """`PUT /api/{name}` — Save a named request under api/<name>.yaml"""
        return self._call("put", f"/api/{name}", body=body)

    def put_data(self, body: Any = None) -> Any:
        """`PUT /data` — Write data.yaml"""
        return self._call("put", f"/data", body=body)

    def put_flows_by_file(self, file, body: Any = None) -> Any:
        """`PUT /flows/{file}` — Write a flow file"""
        return self._call("put", f"/flows/{file}", body=body, text=True)
