package dev.svatah.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * `svatah-runtime-java <project> [--plan p] [--run-id r] [--base-url u] [--flow f]`
 * (T6.4, REQ-STD-3, LLD §14, §15).
 *
 * <p>Executes `plan.json` and bindings without the TypeScript compiler, and
 * writes `results.jsonl` and `summary.json` in the published schemas. The
 * conformance harness then compares them with the fixture the TypeScript runtime
 * produced: identical status and identical matched candidate for every step
 * (LLD §14).
 *
 * <p>Exit code follows LLD §15: 0 when everything passed, 1 on a failure.
 */
public final class Main {

    public static void main(String[] argv) {
        /*
         * Options accumulate. `--flow a --flow b` selects two flows, exactly as
         * `svatah run` does, and a parser that kept only the last value ran one
         * quarter of the conformance suite and reported the rest as missing —
         * which looked like a runtime that could not execute them.
         */
        Map<String, List<String>> options = new LinkedHashMap<>();
        List<String> positional = new ArrayList<>();
        for (int at = 0; at < argv.length; at += 1) {
            if (argv[at].startsWith("--")) {
                String name = argv[at].substring(2);
                String value = at + 1 < argv.length && !argv[at + 1].startsWith("--")
                        ? argv[++at]
                        : "true";
                options.computeIfAbsent(name, key -> new ArrayList<>()).add(value);
            } else {
                positional.add(argv[at]);
            }
        }

        Path root = Path.of(positional.isEmpty() ? "." : positional.get(0)).toAbsolutePath().normalize();
        JsonNode config = Artifacts.readConfig(root);

        Path planPath = root.resolve(option(options, "plan", ".svatah/plan.json"));
        if (!Files.exists(planPath)) {
            System.err.println(
                    "No plan at " + planPath + ". A foreign runtime consumes `plan.json`; compile it "
                            + "first with `svatah compile <project> --stable` (REQ-STD-3).");
            System.exit(2);
        }
        JsonNode plan = Artifacts.readJson(planPath);

        /*
         * The base URL, by LLD §15's precedence: the flag, then the environment,
         * then `config.app`. Every command that opens a session applies the same
         * order, and a runtime that ignored it could not be pointed at the
         * ephemeral port a fixture server takes.
         */
        String baseUrl = options.containsKey("base-url") ? options.get("base-url").get(0) : null;
        if (baseUrl == null) baseUrl = System.getenv("SVATAH_BASE_URL");
        if (baseUrl == null) baseUrl = Artifacts.text(config.path("app").path("baseUrl"), "");

        Map<String, JsonNode> bindings = Artifacts.readBindings(root, config);
        Map<String, JsonNode> apis = Artifacts.readApiRequests(root, config);
        Map<String, Object> data = Artifacts.readData(root, config);
        List<String> secrets = Artifacts.readSecretPaths(root, config);

        String runId = option(options, "run-id", "java-" + System.currentTimeMillis());
        String behavior = option(options, "behavior", "test");
        List<String> onlyFlows = options.getOrDefault("flow", List.of());

        /*
         * Story inputs (`--input k=v` and `SVATAH_INPUT_<NAME>`, LLD §15, §10).
         *
         * A story with a signature is a function, and a runtime that ignored its
         * arguments would type the empty string into the login form and then
         * report every step after it as a locator failure — which is exactly
         * what this did before, and it read as a runtime that could not find the
         * sidebar rather than as one that never logged in.
         */
        Map<String, Object> inputs = new LinkedHashMap<>();
        for (Map.Entry<String, String> variable : System.getenv().entrySet()) {
            if (!variable.getKey().startsWith("SVATAH_INPUT_")) continue;
            inputs.put(variable.getKey().substring("SVATAH_INPUT_".length()).toLowerCase(
                    java.util.Locale.ROOT), variable.getValue());
        }
        for (String pair : options.getOrDefault("input", List.of())) {
            int equals = pair.indexOf('=');
            if (equals <= 0) continue;
            inputs.put(pair.substring(0, equals), pair.substring(equals + 1));
        }
        double timeoutMs = Artifacts.number(config.path("run").path("stepTimeoutMs"), 10_000);

        Map<String, JsonNode> byName = new LinkedHashMap<>();
        for (JsonNode story : plan.path("stories")) byName.put(story.path("name").asText(""), story);

        List<ObjectNode> results = new ArrayList<>();
        Map<String, ObjectNode> flows = new LinkedHashMap<>();

        for (java.util.Iterator<String> names = plan.path("runs").fieldNames(); names.hasNext(); ) {
            String flow = names.next();
            if (!onlyFlows.isEmpty() && !onlyFlows.contains(flow)) continue;

            List<String> order = expand(plan, plan.path("runs").path(flow));
            ObjectNode flowStatus = Artifacts.json().createObjectNode();
            int before = results.size();

            /*
             * One session per flow (REQ-RUN-3), opened at the base URL before
             * the first story runs (LLD §8). Flows are run in sequence here
             * rather than in parallel: a conformance runtime is compared on its
             * results, and `config.run.workers` changes how long it takes and
             * nothing about what it writes.
             */
            try (Surface surface = new Surface(config, baseUrl, timeoutMs)) {
                surface.open();
                Scope scope = new Scope(data, secrets);
                Executor executor = new Executor(surface, bindings, apis, scope, new ApiClient());

                for (String name : order) {
                    JsonNode story = byName.get(name);
                    if (story == null) continue;
                    /*
                     * "Run-level inputs reach only the stories that declare
                     * them" (LLD §8.1's `validate inputs against
                     * story.signature`). A story with no signature gets none,
                     * so one `--input password=…` does not leak into every
                     * story in the run.
                     */
                    if (!executor.runStory(story, flow, behavior, inputsFor(story, inputs))) break;
                }
                results.addAll(executor.results());
            } catch (RuntimeException broken) {
                ObjectNode result = Artifacts.json().createObjectNode();
                result.put("behavior", behavior);
                result.put("flow", flow);
                result.put("story", order.isEmpty() ? flow : order.get(0));
                result.put("stepId", flow + "#session");
                result.put("line", 1);
                result.put("text", "open a session for " + flow);
                result.put("status", "failed");
                result.putObject("failure")
                        .put("class", "infrastructure")
                        .put("message", String.valueOf(broken.getMessage()));
                results.add(result);
            }

            List<ObjectNode> mine = results.subList(before, results.size());
            long passed = mine.stream().filter(r -> r.path("status").asText().equals("passed")).count();
            long failed = mine.stream().filter(r -> r.path("status").asText().equals("failed")).count();
            long skipped = mine.stream().filter(r -> r.path("status").asText().equals("skipped")).count();
            flowStatus.put("status", failed > 0 ? "failed" : "passed");
            flowStatus.put("passed", passed);
            flowStatus.put("failed", failed);
            flowStatus.put("skipped", skipped);
            flows.put(flow, flowStatus);
        }

        Path directory = root.resolve(Artifacts.text(config.path("run").path("outputDir"), "runs"))
                .resolve(runId);
        write(directory, results, flows, plan, runId, behavior);

        long failures = results.stream().filter(r -> r.path("status").asText().equals("failed")).count();
        System.out.printf(
                "%s: %d passed, %d failed, %d skipped → %s%n",
                runId,
                results.stream().filter(r -> r.path("status").asText().equals("passed")).count(),
                failures,
                results.stream().filter(r -> r.path("status").asText().equals("skipped")).count(),
                directory);
        System.exit(failures > 0 ? 1 : 0);
    }

    /** The inputs a story declares, taken from what the run was given. */
    private static Map<String, Object> inputsFor(JsonNode story, Map<String, Object> supplied) {
        Map<String, Object> out = new LinkedHashMap<>();
        JsonNode declared = story.path("signature").path("inputs");
        declared.fieldNames().forEachRemaining(name -> {
            if (supplied.containsKey(name)) out.put(name, supplied.get(name));
            else if (declared.path(name).has("default")) {
                out.put(name, declared.path(name).path("default").asText());
            }
        });
        return out;
    }

    private static String option(Map<String, List<String>> options, String name, String fallback) {
        List<String> values = options.get(name);
        return values == null || values.isEmpty() ? fallback : values.get(0);
    }

    /** A run block's names, with compositions expanded in place (REQ-LANG-10). */
    private static List<String> expand(JsonNode plan, JsonNode names) {
        List<String> out = new ArrayList<>();
        for (JsonNode name : names) {
            JsonNode composition = plan.path("compositions").path(name.asText());
            if (composition.isArray()) {
                for (JsonNode one : composition) out.add(one.asText());
            } else {
                out.add(name.asText());
            }
        }
        return out;
    }

    private static void write(
            Path directory,
            List<ObjectNode> results,
            Map<String, ObjectNode> flows,
            JsonNode plan,
            String runId,
            String behavior) {
        try {
            Files.createDirectories(directory);
            StringBuilder lines = new StringBuilder();
            for (ObjectNode result : results) {
                ObjectNode one = result.deepCopy();
                one.put("runId", runId);
                lines.append(one.toString()).append('\n');
            }
            Files.writeString(directory.resolve("results.jsonl"), lines.toString());

            ObjectNode summary = Artifacts.json().createObjectNode();
            summary.put("schemaVersion", plan.path("schemaVersion").asText("1.0.0"));
            summary.put("runId", runId);
            summary.put("behavior", behavior);
            summary.put("planHash", plan.path("hash").asText(""));
            summary.put("bindingsHash", "none");
            summary.put("configHash", "none");
            summary.putObject("invoker")
                    .put("kind", "ci")
                    .put("id", "svatah-runtime-java")
                    .put("via", "cli");
            ObjectNode flowNode = summary.putObject("flows");
            flows.forEach(flowNode::set);
            ObjectNode totals = summary.putObject("totals");
            Executor.summaryOf(results).forEach((status, count) -> totals.put(status, (Long) count));
            long failed = results.stream().filter(r -> r.path("status").asText().equals("failed")).count();
            summary.put("exitCode", failed > 0 ? 1 : 0);
            Files.writeString(
                    directory.resolve("summary.json"),
                    Artifacts.json().writerWithDefaultPrettyPrinter().writeValueAsString(summary) + "\n");
        } catch (IOException cause) {
            throw new UncheckedIOException("could not write the run directory", cause);
        }
    }

    private Main() {}
}
