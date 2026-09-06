package com.svatah.yam.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** Value references and redaction (T6.4, LLD §3.1, §8.5, REQ-NFR-6). */
class ScopeTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static com.fasterxml.jackson.databind.JsonNode ref(String json) {
        try {
            return JSON.readTree(json);
        } catch (Exception cause) {
            throw new IllegalStateException(cause);
        }
    }

    @Test
    @DisplayName("resolves each ValueRef kind the IR has")
    void kinds() {
        Scope scope = new Scope(
                Map.of("user", Map.of("email", "a@b.c"), "date", "2026-09-03"), List.of());
        scope.enterStory("S", Map.of("email", "typed@b.c"));
        scope.capture("booking", "BK-1");

        assertEquals("x", scope.resolve(ref("{\"kind\":\"literal\",\"value\":\"x\"}")));
        assertEquals("a@b.c", scope.resolve(ref("{\"kind\":\"data\",\"path\":\"user.email\"}")));
        assertEquals("typed@b.c", scope.resolve(ref("{\"kind\":\"input\",\"name\":\"email\"}")));
        assertEquals("BK-1", scope.resolve(ref("{\"kind\":\"var\",\"name\":\"booking\"}")));
        assertEquals(
                "BK-1 on 2026-09-03",
                scope.resolve(ref("""
                        {"kind":"template","parts":[
                          {"kind":"var","name":"booking"},
                          {"kind":"literal","value":" on "},
                          {"kind":"data","path":"date"}]}""")));
    }

    @Test
    @DisplayName("a bare {name} is this story's captures, then its inputs")
    void scoping() {
        Scope scope = new Scope(Map.of(), List.of());
        scope.enterStory("S", Map.of("who", "from-input"));
        assertEquals("from-input", scope.resolve(ref("{\"kind\":\"var\",\"name\":\"who\"}")));
        scope.capture("who", "from-capture");
        assertEquals("from-capture", scope.resolve(ref("{\"kind\":\"var\",\"name\":\"who\"}")));
    }

    @Test
    @DisplayName("{Story.name} reads another story's captures")
    void crossStory() {
        Scope scope = new Scope(Map.of(), List.of());
        scope.enterStory("Book", Map.of());
        scope.capture("reference", "BK-42");
        scope.enterStory("Cancel", Map.of());
        assertEquals(
                "BK-42",
                scope.resolve(ref("{\"kind\":\"var\",\"story\":\"Book\",\"name\":\"reference\"}")));
    }

    @Test
    @DisplayName("a secret never reaches anything the runtime writes")
    void redaction() {
        /*
         * REQ-NFR-6 redacts by *value*, not by name: a password that reached a
         * failure message through any path at all is caught, including one read
         * back out of the page rather than typed into it.
         */
        Scope scope = new Scope(
                Map.of("user", Map.of("password", "hunter2000")), List.of("user.password"));
        assertEquals(
                "expected \"«redacted»\" but found \"«redacted»\"",
                scope.redact("expected \"hunter2000\" but found \"hunter2000\""));
        // Too short to redact safely: blanking "on" would blank half a report.
        Scope shortSecret = new Scope(Map.of("a", "on"), List.of("a"));
        assertEquals("on the page", shortSecret.redact("on the page"));
    }
}
