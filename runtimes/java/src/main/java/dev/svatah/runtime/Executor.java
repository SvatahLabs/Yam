package dev.svatah.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.microsoft.playwright.ElementHandle;
import com.microsoft.playwright.options.SelectOption;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The executor (T6.4, LLD §8, REQ-RUN-1..10, REQ-STD-3).
 *
 * <pre>
 * runStep(step):
 *   args = scope.resolve(step.args)
 *   if step.guard: …
 *   target = step.target ? resolver.resolve(…) : undefined
 *   switch step.action …
 * </pre>
 *
 * <p>No model, and no network but the platform and the API adapter
 * (REQ-RUN-1). What this runtime has to reproduce is not the TypeScript code but
 * the *published behaviour*: for every step, the same status and the same
 * matched candidate (LLD §14).
 *
 * <p>An action or a predicate this runtime does not implement fails the step
 * with a clear message rather than being skipped. A conformance runtime that
 * quietly passed over what it could not do would report a green suite and prove
 * nothing.
 */
public final class Executor {

    /**
     * A predicate that did not hold (LLD §8.4's `assertion` class).
     *
     * A `RuntimeException` rather than an `AssertionError`, because the step
     * loop catches `RuntimeException`: an `Error` would escape it and take the
     * whole run down over one failed expectation, which is exactly the failure
     * the results file exists to record.
     */
    public static final class CheckFailure extends RuntimeException {
        CheckFailure(String message) {
            super(message);
        }
    }

    private final Surface surface;
    private final Map<String, JsonNode> bindings;
    private final Map<String, JsonNode> apis;
    private final Scope scope;
    private final ApiClient api;
    private final String platform;
    private final List<ObjectNode> results = new ArrayList<>();

    public Executor(
            Surface surface,
            Map<String, JsonNode> bindings,
            Map<String, JsonNode> apis,
            Scope scope,
            ApiClient api) {
        this.surface = surface;
        this.bindings = bindings;
        this.apis = apis;
        this.scope = scope;
        this.api = api;
        this.platform = "web";
    }

    public List<ObjectNode> results() {
        return results;
    }

    /**
     * Run one story's steps, stopping the flow on a failure (REQ-RUN-4's
     * default `stop` policy: remaining steps are `skipped`).
     *
     * @return true when the story passed
     */
    public boolean runStory(
            JsonNode story, String flow, String behavior, Map<String, Object> inputs) {
        String name = story.path("name").asText("");
        scope.enterStory(name, inputs);
        boolean stopped = false;

        for (JsonNode step : story.path("steps")) {
            /*
             * Every step is timed, including a skipped one (T7.4, LLD §3.4).
             *
             * `StepResult` requires `startedAt`, `endedAt` and `durationMs` and
             * does not make them conditional on the status, so a skipped step
             * records the instant it was skipped and a zero duration rather
             * than being written without them. Phase 6's runtime wrote none of
             * the three on any line and was still reported conformant, because
             * the suite compared a projection and never validated the file
             * (Phase 6 verification, F2).
             */
            Instant startedAt = Instant.now();
            if (stopped) {
                record(flow, behavior, story, step, "skipped", null, null, startedAt);
                continue;
            }
            /*
             * The matched candidate is recorded whether the step passed or
             * failed (LLD §3.4, §14). A step that resolved its element and then
             * failed to act on it — clicking a `<datalist>` option, which a
             * browser refuses — has a `matched`, and the conformance suite
             * compares it: dropping it on failure made every such step differ
             * from the fixture while the status agreed, which is the exact
             * disagreement the suite exists to catch.
             */
            Resolver.Resolution[] matched = new Resolver.Resolution[1];
            try {
                runStep(step, matched);
                record(flow, behavior, story, step, "passed", matched[0], null, startedAt);
            } catch (RuntimeException failure) {
                record(flow, behavior, story, step, "failed", matched[0], failure, startedAt);
                stopped = true;
            }
        }
        return !stopped;
    }

    /**
     * One step. Throws on failure, which the caller classifies.
     *
     * @param out receives the matched candidate as soon as the target resolves,
     *     so a step that fails *after* resolving still records what it found.
     */
    private void runStep(JsonNode step, Resolver.Resolution[] out) {
        Map<String, String> args = scope.resolveArgs(step.path("args"));
        String action = step.path("action").asText("");

        Resolver.Resolution matched = null;
        JsonNode target = step.path("target");
        if (target.isObject()) {
            matched = resolve(target);
            out[0] = matched;
        }

        switch (action) {
            case "navigate" -> {
                surface.navigate(args.getOrDefault("url", ""));
                surface.invalidate();
            }
            case "back" -> {
                surface.page().goBack();
                surface.invalidate();
            }
            case "forward" -> {
                surface.page().goForward();
                surface.invalidate();
            }
            case "refresh" -> {
                surface.page().reload();
                surface.invalidate();
            }
            case "click" -> handle(matched).click();
            case "doubleClick" -> handle(matched).dblclick();
            case "hover" -> handle(matched).hover();
            case "hoverAndClick" -> {
                ElementHandle element = handle(matched);
                element.hover();
                element.click();
            }
            case "type" -> handle(matched).fill(args.getOrDefault("value", ""));
            case "clear" -> handle(matched).fill("");
            case "press" -> {
                if (matched == null) surface.page().keyboard().press(args.getOrDefault("key", ""));
                else handle(matched).press(args.getOrDefault("key", ""));
            }
            case "submit" -> handle(matched).evaluate(
                    "el => { const f = el instanceof HTMLFormElement ? el : el.closest('form');"
                            + " if (f === null) throw new Error('The element is not inside a form.');"
                            + " f.requestSubmit(); }");
            case "selectOption" -> {
                String value = args.containsKey("value") ? args.get("value") : args.getOrDefault("label", "");
                String by = args.getOrDefault("by", "value");
                SelectOption option = new SelectOption();
                if (by.equals("label")) option.setLabel(value);
                else if (by.equals("index")) option.setIndex(Integer.parseInt(value));
                else option.setValue(value);
                handle(matched).selectOption(option);
            }
            case "setChecked" -> handle(matched)
                    .setChecked(Boolean.parseBoolean(args.getOrDefault("checked", "true")));
            case "scrollIntoView" -> handle(matched).scrollIntoViewIfNeeded();
            case "scrollToTop" -> surface.page().evaluate("() => window.scrollTo(0, 0)");
            case "scrollToBottom" ->
                    surface.page().evaluate("() => window.scrollTo(0, document.body.scrollHeight)");
            case "sleep" -> {
                long ms = (long) Double.parseDouble(args.getOrDefault("ms", "0"));
                try {
                    Thread.sleep(ms);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
            case "waitFor" -> {
                String state = args.getOrDefault("state", "visible");
                handle(matched).waitForElementState(
                        switch (state) {
                            case "hidden" -> com.microsoft.playwright.options.ElementState.HIDDEN;
                            case "visible" -> com.microsoft.playwright.options.ElementState.VISIBLE;
                            default -> com.microsoft.playwright.options.ElementState.STABLE;
                        });
            }
            case "read" -> {
                Object value = read(step, matched);
                capture(step, value);
            }
            case "expect" -> check(step, matched);
            case "api" -> {
                String name = args.getOrDefault("name", step.path("target").path("phrase").asText(""));
                JsonNode request = apis.get(name);
                if (request == null) {
                    throw new IllegalStateException("no API request named \"" + name + "\"");
                }
                JsonNode response = api.send(request, scope, surface.absolute(""));
                capture(step, response);
            }
            case "screenshot" -> {
                // A conformance run compares statuses and matched candidates, not
                // images; taking one would write a file nothing reads.
            }
            default -> throw new UnsupportedOperationException(
                    "the Java runtime has no \"" + action + "\" action. A conformance runtime that "
                            + "skipped what it cannot do would report a green suite and prove nothing.");
        }

        // An expectation attached to an acting step runs after it (LLD §8.2).
        if (!action.equals("expect") && step.path("expect").isObject()) check(step, matched);
        if (!action.equals("read") && !action.equals("api") && step.path("capture").isObject()) {
            capture(step, read(step, matched));
        }
    }

    private Resolver.Resolution resolve(JsonNode target) {
        String id = target.path("ref").asText("");
        JsonNode file = bindings.get(id);
        if (file == null) {
            throw new Resolver.LocatorFailure(
                    "no binding for \"" + id + "\" (\"" + target.path("phrase").asText("") + "\")",
                    List.of());
        }
        return Resolver.resolve(surface, file, id, surface.page().url(), platform);
    }

    private ElementHandle handle(Resolver.Resolution matched) {
        if (matched == null) throw new IllegalStateException("this action needs a target");
        return surface.handleFor(matched.ref());
    }

    private Object read(JsonNode step, Resolver.Resolution matched) {
        JsonNode capture = step.path("capture");
        String from = capture.path("from").asText("text");
        return switch (from) {
            case "text" -> handle(matched).innerText().trim();
            case "value" -> handle(matched).inputValue();
            case "attribute" -> handle(matched).getAttribute(capture.path("attribute").asText(""));
            case "title" -> surface.page().title();
            default -> handle(matched).innerText().trim();
        };
    }

    private void capture(JsonNode step, Object value) {
        JsonNode capture = step.path("capture");
        if (!capture.isObject()) return;
        Object stored = value;
        String jsonPath = capture.path("jsonPath").asText("");
        if (!jsonPath.isEmpty() && value instanceof JsonNode node) {
            JsonNode at = node;
            for (String segment : jsonPath.replace("$.", "").split("\\.")) {
                if (segment.isEmpty()) continue;
                at = at.path(segment);
            }
            stored = at.isTextual() ? at.asText() : at.toString();
        } else if (value instanceof JsonNode node) {
            stored = node.toString();
        }
        scope.capture(capture.path("name").asText(""), stored);
    }

    /** A predicate (LLD §2.3, ADR-7). A false one fails the step (`assertion`). */
    private void check(JsonNode step, Resolver.Resolution matched) {
        JsonNode expect = step.path("expect");
        String subject = expect.path("subject").asText("target");
        JsonNode predicate = expect.path("predicate");
        String kind = predicate.path("kind").asText("");
        boolean negate = Artifacts.bool(predicate.path("negate"), false);
        String expected = scope.resolve(predicate.path("value"));

        boolean ok;
        String actual;
        switch (kind) {
            case "visible", "hidden" -> {
                boolean shown = matched != null && handle(matched).isVisible();
                ok = kind.equals("visible") == shown;
                actual = String.valueOf(shown);
            }
            case "present", "absent" -> {
                boolean there = matched != null;
                ok = kind.equals("present") == there;
                actual = String.valueOf(there);
            }
            case "enabled", "disabled" -> {
                boolean enabled = handle(matched).isEnabled();
                ok = kind.equals("enabled") == enabled;
                actual = String.valueOf(enabled);
            }
            case "checked", "unchecked" -> {
                boolean checked = handle(matched).isChecked();
                ok = kind.equals("checked") == checked;
                actual = String.valueOf(checked);
            }
            case "text", "textContains" -> {
                actual = subject.equals("page")
                        ? surface.page().innerText("body").trim()
                        : handle(matched).innerText().trim();
                ok = kind.equals("text") ? actual.equals(expected) : actual.contains(expected);
            }
            case "value" -> {
                actual = handle(matched).inputValue();
                ok = actual.equals(expected);
            }
            case "title", "titleContains" -> {
                actual = surface.page().title();
                ok = kind.equals("title") ? actual.equals(expected) : actual.contains(expected);
            }
            case "url", "urlContains" -> {
                actual = surface.page().url();
                ok = kind.equals("url") ? actual.equals(expected) : actual.contains(expected);
            }
            case "attribute" -> {
                actual = String.valueOf(handle(matched).getAttribute(predicate.path("name").asText("")));
                ok = actual.equals(expected);
            }
            default -> throw new UnsupportedOperationException(
                    "the Java runtime has no \"" + kind + "\" predicate.");
        }

        if (negate) ok = !ok;
        if (!ok) {
            throw new CheckFailure(
                    "expected " + kind + " " + (expected.isEmpty() ? "" : "\"" + expected + "\" ")
                            + "but found \"" + scope.redact(actual) + "\"");
        }
    }

    /* ── results (LLD §3.4, §8.6) ─────────────────────────────────────────── */

    private void record(
            String flow,
            String behavior,
            JsonNode story,
            JsonNode step,
            String status,
            Resolver.Resolution matched,
            RuntimeException failure,
            Instant startedAt) {
        Instant endedAt = Instant.now();
        ObjectNode result = Artifacts.json().createObjectNode();
        result.put("behavior", behavior);
        result.put("flow", flow);
        result.put("story", story.path("name").asText(""));
        result.put("stepId", step.path("id").asText(""));
        result.put("line", step.path("line").asInt());
        result.put("text", step.path("text").asText(""));
        result.put("status", status);
        result.put("startedAt", timestamp(startedAt));
        result.put("endedAt", timestamp(endedAt));
        result.put("durationMs", Duration.between(startedAt, endedAt).toMillis());
        if (matched != null) {
            ObjectNode node = result.putObject("matched");
            node.put("ref", matched.ref());
            node.put("candidateIndex", matched.candidateIndex());
            node.put("by", matched.by());
        }
        if (failure != null) {
            ObjectNode node = result.putObject("failure");
            node.put("class", classOf(failure));
            node.put("message", scope.redact(String.valueOf(failure.getMessage())));
        }
        results.add(result);
    }

    /**
     * An instant as the schemas write one: RFC 3339 with an offset, in UTC.
     *
     * `z.string().datetime({ offset: true })` accepts `Z` as well as `+05:30`,
     * and `Instant.toString()` is the `Z` form with a variable number of
     * fractional digits — `2026-09-04T10:00:00Z` when the instant lands on a
     * whole second, which is a shape the validator takes. Truncating to
     * milliseconds keeps the artifact comparable with the TypeScript runtime's,
     * whose `toISOString()` always writes three.
     */
    static String timestamp(Instant at) {
        return DateTimeFormatter.ISO_INSTANT.format(at.truncatedTo(ChronoUnit.MILLIS));
    }

    /** LLD §8.4's failure classes, from the exception's type. */
    private static String classOf(RuntimeException failure) {
        if (failure instanceof Resolver.LocatorFailure) return "locator";
        if (failure instanceof CheckFailure) return "assertion";
        if (failure instanceof UnsupportedOperationException) return "script";
        String message = String.valueOf(failure.getMessage());
        if (message.contains("Timeout") || message.contains("timeout")) return "timeout";
        if (failure instanceof com.microsoft.playwright.PlaywrightException) {
            // Playwright reports "element is not visible", "not an <select>" and
            // a resolution failure through one type, so the message decides.
            if (message.contains("waiting for locator") || message.contains("strict mode")) {
                return "locator";
            }
            return "script";
        }
        return "unknown";
    }

    /** A step result as the schema's `StepResult`, for `results.jsonl`. */
    public static Map<String, Object> summaryOf(List<ObjectNode> results) {
        Map<String, Object> totals = new LinkedHashMap<>();
        for (String status : List.of("passed", "failed", "skipped", "healed", "aborted")) {
            long count = results.stream().filter(r -> r.path("status").asText("").equals(status)).count();
            totals.put(status, count);
        }
        return totals;
    }
}
