package dev.svatah.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * The published artifacts, read (T6.4, REQ-STD-3, LLD §14).
 *
 * <p>This class is the whole of what a foreign runtime has to understand: a
 * {@code plan.json}, a directory of binding files, a {@code data.yaml} and a
 * config. If any of it needed knowledge that is not in the schemas, REQ-STD-3
 * would be false — so everything here is read straight from the published shapes
 * with no lookaside, and every place the schema was ambiguous is a comment.
 *
 * <p>Deliberately untyped beyond {@link JsonNode}. A generated model would be a
 * second definition of the schemas and would drift; walking the tree is uglier
 * and cannot disagree with the file.
 */
public final class Artifacts {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ObjectMapper YAML = new ObjectMapper(new YAMLFactory());

    private Artifacts() {}

    public static JsonNode readJson(Path path) {
        try {
            return JSON.readTree(Files.readString(path));
        } catch (IOException cause) {
            throw new UncheckedIOException("could not read " + path, cause);
        }
    }

    public static JsonNode readYaml(Path path) {
        try {
            return YAML.readTree(Files.readString(path));
        } catch (IOException cause) {
            throw new UncheckedIOException("could not read " + path, cause);
        }
    }

    public static ObjectMapper json() {
        return JSON;
    }

    /**
     * The project's configuration.
     *
     * <p>{@code svatah.config.yaml} or {@code svatah.config.json}, and a project
     * with neither runs on the defaults — which is what the TypeScript reader
     * does (LLD §3.5), and the reason the fixture project's own config is a
     * partial one.
     */
    public static JsonNode readConfig(Path root) {
        for (String name : List.of("svatah.config.yaml", "svatah.config.yml")) {
            Path path = root.resolve(name);
            if (Files.exists(path)) return readYaml(path);
        }
        Path asJson = root.resolve("svatah.config.json");
        if (Files.exists(asJson)) return readJson(asJson);
        return JSON.createObjectNode();
    }

    /**
     * Run data, with {@code ${ENV}} indirection resolved (REQ-LANG-9).
     *
     * <p>A value of the form {@code ${NAME}} is read from the environment. That
     * is the whole of the secret mechanism from a runtime's point of view: the
     * runtime never sees a secret in a file, and the paths listed under
     * {@code secrets:} are the values it must keep out of everything it writes
     * (REQ-NFR-6).
     */
    public static Map<String, Object> readData(Path root, JsonNode config) {
        String file = text(config.path("data").path("file"), "data.yaml");
        Path path = root.resolve(file);
        if (!Files.exists(path)) return Map.of();
        JsonNode tree = file.endsWith(".json") ? readJson(path) : readYaml(path);
        Map<String, Object> out = new LinkedHashMap<>();
        tree.fieldNames().forEachRemaining(name -> {
            if (name.equals("secrets")) return;
            out.put(name, resolveEnv(tree.get(name)));
        });
        return out;
    }

    /** The `data.*` paths declared secret, whose values must never be written. */
    public static List<String> readSecretPaths(Path root, JsonNode config) {
        String file = text(config.path("data").path("file"), "data.yaml");
        Path path = root.resolve(file);
        if (!Files.exists(path)) return List.of();
        JsonNode tree = file.endsWith(".json") ? readJson(path) : readYaml(path);
        List<String> out = new ArrayList<>();
        for (JsonNode one : tree.path("secrets")) out.add(one.asText());
        return out;
    }

    private static Object resolveEnv(JsonNode node) {
        if (node.isObject()) {
            Map<String, Object> out = new LinkedHashMap<>();
            node.fieldNames().forEachRemaining(name -> out.put(name, resolveEnv(node.get(name))));
            return out;
        }
        if (node.isArray()) {
            List<Object> out = new ArrayList<>();
            for (JsonNode one : node) out.add(resolveEnv(one));
            return out;
        }
        if (!node.isTextual()) return node.isNumber() ? node.numberValue() : node.asText();
        String value = node.asText();
        if (value.startsWith("${") && value.endsWith("}")) {
            String name = value.substring(2, value.length() - 1);
            String fromEnv = System.getenv(name);
            return fromEnv == null ? "" : fromEnv;
        }
        return value;
    }

    /**
     * Every binding file under the store, keyed by element id.
     *
     * <p>The id is the path below the store with the extension dropped and the
     * separators turned into dots — {@code bindings/login/username-field.yaml}
     * is {@code login.username-field} — which is what LLD §6.1 says and what the
     * plan's {@code target.ref} carries. The file also names its own {@code id},
     * and the two are checked against each other: a file that disagreed with its
     * path would resolve for one runtime and not the other.
     */
    public static Map<String, JsonNode> readBindings(Path root, JsonNode config) {
        Path dir = root.resolve(text(config.path("bindings").path("dir"), "bindings"));
        Map<String, JsonNode> out = new LinkedHashMap<>();
        if (!Files.isDirectory(dir)) return out;
        try (Stream<Path> files = Files.walk(dir)) {
            files.filter(p -> p.toString().endsWith(".yaml") || p.toString().endsWith(".yml"))
                    .sorted()
                    .forEach(p -> {
                        JsonNode file = readYaml(p);
                        String fromPath = dir.relativize(p).toString()
                                .replaceAll("\\.(yaml|yml)$", "")
                                .replace(java.io.File.separatorChar, '.');
                        String declared = text(file.path("id"), fromPath);
                        if (!declared.equals(fromPath)) {
                            throw new IllegalStateException(
                                    p + " declares id \"" + declared + "\" but its path says \""
                                            + fromPath + "\". A binding that disagrees with its own "
                                            + "path resolves for one runtime and not another.");
                        }
                        out.put(declared, file);
                    });
        } catch (IOException cause) {
            throw new UncheckedIOException("could not read the bindings store", cause);
        }
        return out;
    }

    /** Named API requests from `api/*.yaml` (REQ-LANG-8, REQ-ADP-2). */
    public static Map<String, JsonNode> readApiRequests(Path root, JsonNode config) {
        Path dir = root.resolve(text(config.path("api").path("dir"), "api"));
        Map<String, JsonNode> out = new LinkedHashMap<>();
        if (!Files.isDirectory(dir)) return out;
        try (Stream<Path> files = Files.list(dir)) {
            files.filter(p -> p.toString().endsWith(".yaml") || p.toString().endsWith(".yml"))
                    .sorted()
                    .forEach(p -> {
                        JsonNode request = readYaml(p);
                        out.put(text(request.path("name"), p.getFileName().toString()), request);
                    });
        } catch (IOException cause) {
            throw new UncheckedIOException("could not read the API requests", cause);
        }
        return out;
    }

    public static String text(JsonNode node, String fallback) {
        return node != null && node.isTextual() && !node.asText().isEmpty() ? node.asText() : fallback;
    }

    public static int number(JsonNode node, int fallback) {
        return node != null && node.isNumber() ? node.asInt() : fallback;
    }

    public static boolean bool(JsonNode node, boolean fallback) {
        return node != null && node.isBoolean() ? node.asBoolean() : fallback;
    }
}
