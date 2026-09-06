/*
 * GENERATED FILE — do not edit.
 *
 * `node scripts/generate-clients.mjs` writes this from the service's own OpenAPI
 * description (`GET /openapi.json`, LLD §13.5, §13.8). It is committed so a client
 * builds without a running service, and a test regenerates it and diffs, so drift
 * between a client and the service is a red build rather than a discovery.
 *
 * Bodies are `unknown` on purpose: their types are `@svatah/schema`'s, and
 * re-deriving them here would make a second, subtly different set of the same
 * types (REQ-STD-1).
 */
package dev.svatah.sdk;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.stream.Stream;

/** Everything the service publishes. Nothing else exists. */
public class GeneratedClient {
  /** Every route, for the drift check and for a caller listing them. */
  public static final List<String> ENDPOINTS = List.of(
      "GET /api",
      "GET /bindings",
      "GET /bindings/{id}",
      "GET /data",
      "GET /events",
      "GET /events/sse",
      "GET /flows/{file}",
      "GET /health",
      "GET /openapi.json",
      "GET /plan",
      "GET /project",
      "GET /runs",
      "GET /runs/{id}",
      "GET /runs/{id}/audit",
      "GET /runs/{id}/results",
      "GET /runs/{id}/screenshots/{name}",
      "GET /tools",
      "POST /api/request",
      "POST /bindings/verify",
      "POST /compile",
      "POST /heal",
      "POST /migrate",
      "POST /record",
      "POST /record/{id}/decision",
      "POST /record/{id}/stop",
      "POST /run",
      "POST /surface/{session}/act",
      "POST /surface/{session}/check",
      "POST /surface/{session}/close",
      "POST /surface/{session}/open",
      "POST /surface/{session}/read",
      "POST /surface/{session}/snapshot",
      "POST /trajectory/compile",
      "PUT /api/{name}",
      "PUT /data",
      "PUT /flows/{file}"
  );

  /** Every event kind the stream carries. */
  public static final List<String> EVENT_KINDS = List.of(
      "step.result",
      "run.summary",
      "run.started",
      "run.failed",
      "record.started",
      "record.step",
      "record.decision",
      "record.candidates",
      "record.decision.expired",
      "record.finished",
      "record.failed",
      "heal.proposal",
      "heal.finished",
      "heal.failed",
      "tool.invocation",
      "log"
  );

  private final String url;
  private final String token;
  private final HttpClient http;

  public GeneratedClient(String url, String token) {
    this.url = url;
    this.token = token;
    this.http =
        HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10))
            .build();
  }

  /** A non-2xx answer, with the body the service sent. */
  public static class ServiceException extends RuntimeException {
    public final int status;

    public ServiceException(int status, String path, String body) {
      super(path + " answered " + status + ": " + body);
      this.status = status;
    }
  }

  /** The raw body, as text. Callers parse with their own JSON library. */
  protected String call(String verb, String path, String body, String contentType) {
    HttpRequest.Builder request =
        HttpRequest.newBuilder(URI.create(url + path)).header("authorization", "Bearer " + token);
    if (body == null) {
      request.method(verb.toUpperCase(), HttpRequest.BodyPublishers.noBody());
    } else {
      request.header("content-type", contentType);
      request.method(verb.toUpperCase(), HttpRequest.BodyPublishers.ofString(body));
    }
    try {
      HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() / 100 != 2) {
        throw new ServiceException(response.statusCode(), path, response.body());
      }
      return response.body();
    } catch (IOException | InterruptedException cause) {
      throw new RuntimeException(path + " could not be reached", cause);
    }
  }

  /** `GET /events/sse`, one JSON object per `data:` line. */
  public Stream<String> events() {
    HttpRequest request =
        HttpRequest.newBuilder(URI.create(url + "/events/sse"))
            .header("authorization", "Bearer " + token)
            .build();
    try {
      HttpResponse<Stream<String>> response = http.send(request, HttpResponse.BodyHandlers.ofLines());
      return response.body().filter(line -> line.startsWith("data:"))
          .map(line -> line.substring(5).trim());
    } catch (IOException | InterruptedException cause) {
      throw new RuntimeException("the event stream could not be reached", cause);
    }
  }

  protected static String segment(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
  }

  /** {@code GET /api} — Named API requests */
  public String getApi() {
    return call("get", "/api", null, "application/json");
  }

  /** {@code GET /bindings} — The bindings store */
  public String getBindings() {
    return call("get", "/bindings", null, "application/json");
  }

  /** {@code GET /bindings/{id}} — One binding */
  public String getBindingsById(String id) {
    return call("get", "/bindings/" + segment(id), null, "application/json");
  }

  /** {@code GET /data} — Run data, with secrets redacted */
  public String getData() {
    return call("get", "/data", null, "application/json");
  }

  /** {@code GET /events} — The event stream (WebSocket) */
  public String getEvents() {
    return call("get", "/events", null, "application/json");
  }

  /** {@code GET /events/sse} — The event stream (server-sent events) */
  public String getEventsSse() {
    return call("get", "/events/sse", null, "application/json");
  }

  /** {@code GET /flows/{file}} — Read a flow file */
  public String getFlowsByFile(String file) {
    return call("get", "/flows/" + segment(file), null, "text/plain");
  }

  /** {@code GET /health} — Liveness, for the ADE's spawn handshake */
  public String getHealth() {
    return call("get", "/health", null, "application/json");
  }

  /** {@code GET /openapi.json} — This document */
  public String getOpenapijson() {
    return call("get", "/openapi.json", null, "application/json");
  }

  /** {@code GET /plan} — The compiled plan, story by story */
  public String getPlan() {
    return call("get", "/plan", null, "application/json");
  }

  /** {@code GET /project} — Config, flows, stories, compositions, run blocks and API names */
  public String getProject() {
    return call("get", "/project", null, "application/json");
  }

  /** {@code GET /runs} — Every run's summary */
  public String getRuns() {
    return call("get", "/runs", null, "application/json");
  }

  /** {@code GET /runs/{id}} — One run's summary */
  public String getRunsById(String id) {
    return call("get", "/runs/" + segment(id), null, "application/json");
  }

  /** {@code GET /runs/{id}/audit} — One run's audit log */
  public String getRunsByIdAudit(String id) {
    return call("get", "/runs/" + segment(id) + "/audit", null, "application/json");
  }

  /** {@code GET /runs/{id}/results} — One run's step results */
  public String getRunsByIdResults(String id) {
    return call("get", "/runs/" + segment(id) + "/results", null, "application/json");
  }

  /** {@code GET /runs/{id}/screenshots/{name}} — A screenshot a run wrote */
  public String getRunsByIdScreenshotsByName(String id, String name) {
    return call("get", "/runs/" + segment(id) + "/screenshots/" + segment(name), null, "application/json");
  }

  /** {@code GET /tools} — The tools this project exposes, and every invocation served */
  public String getTools() {
    return call("get", "/tools", null, "application/json");
  }

  /** {@code POST /api/request} — Execute one API request ad hoc */
  public String postApiRequest(String body) {
    return call("post", "/api/request", body, "application/json");
  }

  /** {@code POST /bindings/verify} — Dry-resolve the store, or one binding */
  public String postBindingsVerify(String body) {
    return call("post", "/bindings/verify", body, "application/json");
  }

  /** {@code POST /compile} — Compile and lint */
  public String postCompile() {
    return call("post", "/compile", null, "application/json");
  }

  /** {@code POST /heal} — Heal a run; proposals arrive on the stream */
  public String postHeal(String body) {
    return call("post", "/heal", body, "application/json");
  }

  /** {@code POST /migrate} — Import a Svatah ADE prototype's electron-db directory into this project */
  public String postMigrate(String body) {
    return call("post", "/migrate", body, "application/json");
  }

  /** {@code POST /record} — Start a recording session; decisions arrive on the stream */
  public String postRecord(String body) {
    return call("post", "/record", body, "application/json");
  }

  /** {@code POST /record/{id}/decision} — Accept, re-pick or reject the grounding a session is waiting on */
  public String postRecordByIdDecision(String id, String body) {
    return call("post", "/record/" + segment(id) + "/decision", body, "application/json");
  }

  /** {@code POST /record/{id}/stop} — Stop a recording session */
  public String postRecordByIdStop(String id) {
    return call("post", "/record/" + segment(id) + "/stop", null, "application/json");
  }

  /** {@code POST /run} — Start a run; step events arrive on the stream */
  public String postRun(String body) {
    return call("post", "/run", body, "application/json");
  }

  /** {@code POST /surface/{session}/act} — Act in the explored session; `intent` is required */
  public String postSurfaceBySessionAct(String session, String body) {
    return call("post", "/surface/" + segment(session) + "/act", body, "application/json");
  }

  /** {@code POST /surface/{session}/check} — Check in the explored session; `intent` is required */
  public String postSurfaceBySessionCheck(String session, String body) {
    return call("post", "/surface/" + segment(session) + "/check", body, "application/json");
  }

  /** {@code POST /surface/{session}/close} — Close an explored session */
  public String postSurfaceBySessionClose(String session) {
    return call("post", "/surface/" + segment(session) + "/close", null, "application/json");
  }

  /** {@code POST /surface/{session}/open} — Open a surface session the explorer drives */
  public String postSurfaceBySessionOpen(String session, String body) {
    return call("post", "/surface/" + segment(session) + "/open", body, "application/json");
  }

  /** {@code POST /surface/{session}/read} — Read in the explored session; `intent` is required */
  public String postSurfaceBySessionRead(String session, String body) {
    return call("post", "/surface/" + segment(session) + "/read", body, "application/json");
  }

  /** {@code POST /surface/{session}/snapshot} — The driven session's snapshot, for the picker and the explorer */
  public String postSurfaceBySessionSnapshot(String session, String body) {
    return call("post", "/surface/" + segment(session) + "/snapshot", body, "application/json");
  }

  /** {@code POST /trajectory/compile} — Compile a captured trajectory into proposals/<date>/ */
  public String postTrajectoryCompile(String body) {
    return call("post", "/trajectory/compile", body, "application/json");
  }

  /** {@code PUT /api/{name}} — Save a named request under api/<name>.yaml */
  public String putApiByName(String name, String body) {
    return call("put", "/api/" + segment(name), body, "application/json");
  }

  /** {@code PUT /data} — Write data.yaml */
  public String putData(String body) {
    return call("put", "/data", body, "application/json");
  }

  /** {@code PUT /flows/{file}} — Write a flow file */
  public String putFlowsByFile(String file, String body) {
    return call("put", "/flows/" + segment(file), body, "text/plain");
  }

}
