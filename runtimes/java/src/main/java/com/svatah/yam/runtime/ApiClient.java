package com.svatah.yam.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/**
 * The HTTP adapter, for `api` steps (T6.4, REQ-ADP-2, LLD §7.2).
 *
 * <p>The four conformance flows call one named request and read a field out of
 * the response, so this implements exactly that shape of `ApiRequest`: method,
 * templated URL, headers, and a JSON body. A request using a field this does not
 * implement fails the step by name rather than being sent without it — a request
 * silently missing its auth header would produce a 401 that looked like the
 * application's fault.
 *
 * <p>`java.net.http` rather than a dependency: it is in the JDK, it is enough,
 * and REQ-PKG-3 is easier to keep with one less thing in the tree.
 */
public final class ApiClient {

    private static final java.util.Set<String> IMPLEMENTED = java.util.Set.of(
            "name", "method", "url", "headers", "query", "json", "body", "timeoutMs",
            "followRedirects", "description");

    private final HttpClient http = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    /** Send one request, and answer with the schema's `ApiResponse` shape. */
    public JsonNode send(JsonNode request, Scope scope, String baseUrl) {
        for (java.util.Iterator<String> names = request.fieldNames(); names.hasNext(); ) {
            String field = names.next();
            if (!IMPLEMENTED.contains(field)) {
                throw new UnsupportedOperationException(
                        "the Java runtime's API client does not implement \"" + field + "\". "
                                + "Sending the request without it would produce a failure that "
                                + "looked like the application's.");
            }
        }

        String url = template(request.path("url").asText(""), scope);
        if (!url.matches("^[a-z][a-z0-9+.-]*:.*") && baseUrl != null && !baseUrl.isEmpty()) {
            url = baseUrl.replaceAll("/$", "") + (url.startsWith("/") ? url : "/" + url);
        }

        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofMillis(Artifacts.number(request.path("timeoutMs"), 10_000)));

        JsonNode headers = request.path("headers");
        headers.fieldNames().forEachRemaining(
                name -> builder.header(name, template(headers.path(name).asText(""), scope)));

        String method = request.path("method").asText("GET").toUpperCase(java.util.Locale.ROOT);
        HttpRequest.BodyPublisher body = HttpRequest.BodyPublishers.noBody();
        if (request.hasNonNull("json")) {
            body = HttpRequest.BodyPublishers.ofString(request.get("json").toString());
            builder.header("content-type", "application/json");
        } else if (request.hasNonNull("body")) {
            body = HttpRequest.BodyPublishers.ofString(template(request.get("body").asText(""), scope));
        }
        builder.method(method, body);

        try {
            HttpResponse<String> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            ObjectNode out = Artifacts.json().createObjectNode();
            out.put("status", response.statusCode());
            out.put("ok", response.statusCode() >= 200 && response.statusCode() < 400);
            out.put("text", response.body());
            try {
                out.set("json", Artifacts.json().readTree(response.body()));
            } catch (IOException notJson) {
                // A response that is not JSON has no `json`, which is what the
                // schema says and what a JSON-path capture will report.
            }
            ObjectNode responseHeaders = out.putObject("headers");
            for (Map.Entry<String, java.util.List<String>> header
                    : response.headers().map().entrySet()) {
                responseHeaders.put(header.getKey(), String.join(", ", header.getValue()));
            }
            return out;
        } catch (IOException | InterruptedException failed) {
            if (failed instanceof InterruptedException) Thread.currentThread().interrupt();
            throw new IllegalStateException("the API request failed: " + failed.getMessage(), failed);
        }
    }

    /** `{data.baseUrl}/api/x` with the scope applied (REQ-LANG-6). */
    private static String template(String text, Scope scope) {
        StringBuilder out = new StringBuilder();
        int at = 0;
        while (at < text.length()) {
            int open = text.indexOf('{', at);
            if (open < 0) {
                out.append(text, at, text.length());
                break;
            }
            int close = text.indexOf('}', open);
            if (close < 0) {
                out.append(text, at, text.length());
                break;
            }
            out.append(text, at, open);
            String reference = text.substring(open + 1, close);
            ObjectNode node = Artifacts.json().createObjectNode();
            if (reference.startsWith("data.")) {
                node.put("kind", "data").put("path", reference.substring(5));
            } else if (reference.startsWith("input.")) {
                node.put("kind", "input").put("name", reference.substring(6));
            } else {
                node.put("kind", "var").put("name", reference);
            }
            out.append(scope.resolve(node));
            at = close + 1;
        }
        return out.toString();
    }
}
