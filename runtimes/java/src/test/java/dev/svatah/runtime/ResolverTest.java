package dev.svatah.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The rules a foreign runtime has to get exactly right (T6.4, REQ-STD-3).
 *
 * <p>The conformance suite proves the whole runtime against a browser; these
 * prove the two pieces that would otherwise fail *silently*. A context pattern
 * that disagreed by one character picks a different binding entry and resolves a
 * different element — the run still passes, and the comparison catches it only
 * because the matched candidate differs. Pinning them here says which rule is
 * wrong when that happens.
 */
class ResolverTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Nested
    @DisplayName("context patterns (LLD §6.2)")
    class ContextPatterns {

        @Test
        @DisplayName("drops the origin, because a store is committed and shared")
        void dropsOrigin() {
            // Every fixture in this repository runs on an ephemeral port. A
            // stored origin would stop matching on the next run of the same
            // test, and the binding would silently fall back to the first entry.
            assertEquals("/login", Resolver.contextPattern("http://127.0.0.1:65431/login"));
            assertEquals("/login", Resolver.contextPattern("https://example.test/login"));
            assertEquals("/", Resolver.contextPattern("http://127.0.0.1:4173/"));
            assertEquals("/", Resolver.contextPattern("http://127.0.0.1:4173"));
        }

        @Test
        @DisplayName("generalises identifier-looking segments, so two orders are one context")
        void generalisesIds() {
            assertEquals("/orders/:id", Resolver.contextPattern("/orders/10482"));
            assertEquals("/orders/:id", Resolver.contextPattern("/orders/10483"));
            assertEquals(
                    "/u/:uuid/edit",
                    Resolver.contextPattern("/u/3f2504e0-4f89-11d3-9a0c-0305e82c3301/edit"));
            assertEquals("/orders/:id", Resolver.contextPattern("/orders/507f1f77bcf86cd799439011"));
        }

        @Test
        @DisplayName("drops the query, which changes what a page shows and not its shape")
        void dropsQuery() {
            assertEquals("/site-tools", Resolver.contextPattern("http://a.test/site-tools?webmcp=off"));
        }

        @Test
        @DisplayName("matches a stored pattern against a live URL from either side")
        void matches() {
            assertTrue(Resolver.patternMatches("/login", "http://127.0.0.1:9/login"));
            // An old store that carried a full origin keeps resolving.
            assertTrue(Resolver.patternMatches("http://127.0.0.1:65431/login", "http://a.test/login"));
            assertFalse(Resolver.patternMatches("/login", "http://a.test/dashboard"));
        }
    }

    @Nested
    @DisplayName("choosing an entry (LLD §6.3)")
    class EntrySelection {

        private JsonNode file(String json) {
            try {
                return JSON.readTree(json);
            } catch (Exception cause) {
                throw new IllegalStateException(cause);
            }
        }

        @Test
        @DisplayName("prefers the entry whose pattern matches the page")
        void byPattern() {
            JsonNode store = file("""
                    {"entries":[
                      {"context":{"pattern":"/dashboard","platform":"web"},"candidates":[]},
                      {"context":{"pattern":"/login","platform":"web"},"candidates":[]}
                    ]}""");
            JsonNode chosen = Resolver.entryFor(store, "http://a.test/login", "web");
            assertNotNull(chosen);
            assertEquals("/login", chosen.path("context").path("pattern").asText());
        }

        @Test
        @DisplayName("narrows by platform before it looks at the page")
        void byPlatform() {
            JsonNode store = file("""
                    {"entries":[
                      {"context":{"pattern":"/login","platform":"desktop"},"candidates":[]},
                      {"context":{"pattern":"/other","platform":"web"},"candidates":[]}
                    ]}""");
            JsonNode chosen = Resolver.entryFor(store, "http://a.test/login", "web");
            assertEquals("/other", chosen.path("context").path("pattern").asText());
        }

        @Test
        @DisplayName("falls back to the first entry rather than refusing")
        void fallsBack() {
            /*
             * Deliberate: a store recorded on one page still resolves on a page
             * it was not recorded on, and refusing would be worse than trying.
             * The candidates decide, not the context.
             */
            JsonNode store = file("""
                    {"entries":[{"context":{"pattern":"/login","platform":"web"},"candidates":[]}]}""");
            JsonNode chosen = Resolver.entryFor(store, "http://a.test/nowhere", "web");
            assertNotNull(chosen);
            assertEquals("/login", chosen.path("context").path("pattern").asText());
        }
    }
}
