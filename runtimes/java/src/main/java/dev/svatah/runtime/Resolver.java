package dev.svatah.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The resolver (T6.4, LLD §6.2, §6.3, REQ-RUN-5).
 *
 * <pre>
 * resolve(target, surface, entries, opts):
 *   entry = entries matching (platform, pattern) first, else first
 *   for c in entry.candidates: refs = surface.locate(c) within candidateTimeoutMs
 *      if refs.length == 1 → return { ref, candidateIndex, by }
 *      if refs.length &gt; 1 and c.nth != null → return refs[c.nth]
 * </pre>
 *
 * <p>Every rule here has to match the TypeScript implementation exactly, because
 * the runtime conformance suite compares the <em>matched candidate</em> and not
 * only the status (LLD §14). A resolver that tried the same candidates in a
 * different order would pass every step and fail the comparison — which is the
 * point of comparing the candidate at all.
 */
public final class Resolver {

    /** What a resolution produced, or why it did not. */
    public record Resolution(String ref, int candidateIndex, String by) {}

    public static final class LocatorFailure extends RuntimeException {
        public final List<String> tried;

        LocatorFailure(String message, List<String> tried) {
            super(message);
            this.tried = tried;
        }
    }

    private Resolver() {}

    /**
     * The entry that applies here (LLD §6.3's "entries matching (platform,
     * pattern) first, else first").
     *
     * <p>Order matters and is not obvious: platform narrows the pool, then an
     * exact context hash wins, then a matching URL pattern, then the first
     * entry. The last fallback is what makes a store recorded on one page still
     * resolve on a page it was not recorded on — deliberately, because refusing
     * would be worse than trying.
     */
    public static JsonNode entryFor(JsonNode file, String url, String platform) {
        List<JsonNode> entries = new ArrayList<>();
        for (JsonNode one : file.path("entries")) entries.add(one);
        if (entries.isEmpty()) return null;

        List<JsonNode> pool = new ArrayList<>();
        for (JsonNode one : entries) {
            if (platform.equals(one.path("context").path("platform").asText(""))) pool.add(one);
        }
        if (pool.isEmpty()) pool = entries;

        if (url != null) {
            for (JsonNode one : pool) {
                if (patternMatches(one.path("context").path("pattern").asText(""), url)) return one;
            }
        }
        return pool.get(0);
    }

    /**
     * Resolve one element id against the live page.
     *
     * <p>No model and no network beyond the platform (REQ-RUN-1). A `webmcp`
     * candidate is skipped rather than tried: this runtime does not read a
     * site's tool declaration (REQ-ADP-9 is the TypeScript adapter's), and
     * locating one would be a guaranteed miss reported as an ordinary one.
     */
    public static Resolution resolve(
            Surface surface, JsonNode file, String id, String url, String platform) {
        JsonNode entry = entryFor(file, url, platform);
        if (entry == null) {
            throw new LocatorFailure("no binding entry for \"" + id + "\"", List.of());
        }

        List<String> tried = new ArrayList<>();
        int index = -1;
        for (JsonNode candidate : entry.path("candidates")) {
            index += 1;
            String by = candidate.path("by").asText("");
            if (by.equals("webmcp")) continue;

            List<String> refs;
            try {
                refs = surface.locate(candidate);
            } catch (RuntimeException failed) {
                tried.add(by + " (" + failed.getMessage() + ")");
                continue;
            }
            if (refs.size() == 1) return new Resolution(refs.get(0), index, by);
            if (refs.size() > 1 && candidate.hasNonNull("nth")) {
                int nth = candidate.path("nth").asInt();
                if (nth >= 0 && nth < refs.size()) {
                    return new Resolution(refs.get(nth), index, by);
                }
            }
            tried.add(by + " matched " + refs.size());
        }

        throw new LocatorFailure(
                "\"" + id + "\" did not resolve. Tried: "
                        + (tried.isEmpty() ? "(no candidates)" : String.join(", ", tried)),
                tried);
    }

    /* ── context patterns (LLD §6.2) ──────────────────────────────────────── */

    private static final Pattern DIGITS = Pattern.compile("^\\d+$");
    private static final Pattern UUID = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
    private static final Pattern LONG_HEX = Pattern.compile("^[0-9a-fA-F]{24,}$");

    /**
     * A URL as a context pattern: the path, with identifier-looking segments
     * generalised, and no origin.
     *
     * <p>The origin is dropped because a bindings store is committed and shared,
     * and every fixture in this repository runs on an ephemeral port — a stored
     * origin would stop matching on the next run of the same test. Getting this
     * wrong is the most likely way for this runtime to disagree with the
     * TypeScript one while both look right.
     */
    public static String contextPattern(String url) {
        String path;
        try {
            path = new URI(url).getPath();
            if (path == null || path.isEmpty()) path = "/";
        } catch (Exception notAUrl) {
            path = url;
        }
        String[] segments = path.split("/", -1);
        StringBuilder out = new StringBuilder();
        for (int at = 0; at < segments.length; at += 1) {
            if (at > 0) out.append('/');
            String segment = segments[at];
            if (segment.isEmpty()) continue;
            if (DIGITS.matcher(segment).matches() || LONG_HEX.matcher(segment).matches()) {
                out.append(":id");
            } else if (UUID.matcher(segment).matches()) {
                out.append(":uuid");
            } else {
                out.append(segment);
            }
        }
        String generalised = out.toString();
        return generalised.isEmpty() ? "/" : generalised;
    }

    /** Whether a stored pattern applies to a URL. Both sides are normalised. */
    public static boolean patternMatches(String pattern, String url) {
        if (pattern.equals(url)) return true;
        String live = contextPattern(url);
        return live.equals(pattern) || live.equals(contextPattern(pattern));
    }

    /** Every phrase a binding file declares, for a failure message. */
    public static List<String> phrases(Map<String, JsonNode> bindings, String id) {
        List<String> out = new ArrayList<>();
        JsonNode file = bindings.get(id);
        if (file != null) for (JsonNode one : file.path("phrases")) out.add(one.asText());
        return out;
    }
}
