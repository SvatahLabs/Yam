package com.svatah.yam.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Run data, story inputs and captures (T6.4, LLD §3.1, §8.5).
 *
 * <p>Resolving a {@code ValueRef} is the one piece of the IR every action
 * touches, and getting the scoping rules wrong would show up as a step typing
 * the empty string rather than as an error — so the rules are stated here in
 * full: {@code {name}} is this story's captures then its inputs,
 * {@code {Story.name}} is that story's captures, {@code {data.path}} is the run
 * data, {@code {input.name}} is this story's inputs.
 */
public final class Scope {

    private final Map<String, Object> data;
    private final Map<String, Map<String, Object>> captures = new LinkedHashMap<>();
    private final Map<String, Map<String, Object>> inputs = new LinkedHashMap<>();
    /** Every secret *value*, so nothing written can carry one (REQ-NFR-6). */
    private final List<String> secrets = new ArrayList<>();
    private String story = "";

    public Scope(Map<String, Object> data, List<String> secretPaths) {
        this.data = data;
        for (String path : secretPaths) {
            Object value = readPath(data, path);
            // Four characters is the floor: redacting "on" would blank half a
            // report and tell a reader nothing. The same rule as LLD §8.5.
            if (value instanceof String text && text.length() >= 4) secrets.add(text);
        }
    }

    public void enterStory(String name, Map<String, Object> storyInputs) {
        story = name;
        captures.computeIfAbsent(name, key -> new LinkedHashMap<>());
        inputs.put(name, storyInputs == null ? Map.of() : storyInputs);
    }

    public void capture(String name, Object value) {
        captures.computeIfAbsent(story, key -> new LinkedHashMap<>()).put(name, value);
    }

    /** A `ValueRef` (LLD §3.1) as the string an action sends. */
    public String resolve(JsonNode ref) {
        if (ref == null || ref.isNull()) return "";
        if (ref.isTextual()) return ref.asText();
        if (ref.isNumber() || ref.isBoolean()) return ref.asText();

        String kind = ref.path("kind").asText("");
        return switch (kind) {
            case "literal" -> ref.path("value").asText("");
            case "template" -> {
                StringBuilder out = new StringBuilder();
                for (JsonNode part : ref.path("parts")) out.append(resolve(part));
                yield out.toString();
            }
            case "data" -> asString(readPath(data, ref.path("path").asText("")));
            case "input" -> asString(inputs.getOrDefault(story, Map.of()).get(ref.path("name").asText("")));
            case "var" -> {
                String name = ref.path("name").asText("");
                String from = ref.path("story").asText("");
                if (!from.isEmpty()) {
                    yield asString(captures.getOrDefault(from, Map.of()).get(name));
                }
                Map<String, Object> mine = captures.getOrDefault(story, Map.of());
                if (mine.containsKey(name)) yield asString(mine.get(name));
                yield asString(inputs.getOrDefault(story, Map.of()).get(name));
            }
            default -> "";
        };
    }

    /** An `args` map with every value resolved. */
    public Map<String, String> resolveArgs(JsonNode args) {
        Map<String, String> out = new LinkedHashMap<>();
        if (args == null || !args.isObject()) return out;
        args.fieldNames().forEachRemaining(name -> out.put(name, resolve(args.get(name))));
        return out;
    }

    /** Redact every secret value from a string that is about to be written. */
    public String redact(String text) {
        if (text == null) return null;
        String out = text;
        for (String secret : secrets) out = out.replace(secret, "«redacted»");
        return out;
    }

    private static Object readPath(Map<String, Object> tree, String path) {
        Object cursor = tree;
        for (String segment : path.split("\\.")) {
            if (!(cursor instanceof Map<?, ?> map)) return null;
            cursor = map.get(segment);
        }
        return cursor;
    }

    private static String asString(Object value) {
        return value == null ? "" : String.valueOf(value);
    }
}
