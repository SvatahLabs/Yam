package com.svatah.yam.runtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.BrowserType;
import com.microsoft.playwright.ElementHandle;
import com.microsoft.playwright.Locator;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import com.microsoft.playwright.options.AriaRole;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The agent surface, over Playwright for Java (T6.4, LLD §2, §7.1).
 *
 * <p>Narrower than {@code @svatah/yam-adapter-playwright} on purpose. A conformance
 * runtime has to execute the published artifacts and produce identical results —
 * it does not have to be a second product (HLD §13 Phase 6). What is here is
 * what the runtime conformance fixture exercises, and anything else fails loudly
 * rather than approximately, because a runtime that silently did something
 * *nearly* right would make the comparison meaningless.
 *
 * <p>The one thing it must match exactly is the **candidate → locator table**
 * (LLD §7.1, §6.3). A `by: "role"` candidate that meant something slightly
 * different here would resolve to a different element and the whole suite would
 * be comparing two different runs.
 */
public final class Surface implements AutoCloseable {

    private final Playwright playwright;
    private final Browser browser;
    private final BrowserContext context;
    private Page page;
    private final String baseUrl;
    private final double timeoutMs;
    private final List<String> testIdAttributes;
    /** Handles minted by {@link #locate}, keyed `h0`, `h1`, … exactly as LLD §2.2. */
    private final List<ElementHandle> handles = new ArrayList<>();

    public Surface(JsonNode config, String baseUrl, double timeoutMs) {
        this.baseUrl = baseUrl;
        this.timeoutMs = timeoutMs;
        this.testIdAttributes = new ArrayList<>();
        for (JsonNode one : config.path("bindings").path("testIdAttributes")) {
            testIdAttributes.add(one.asText());
        }
        if (testIdAttributes.isEmpty()) {
            testIdAttributes.addAll(List.of("data-testid", "data-test", "data-qa"));
        }

        playwright = Playwright.create();
        String name = Artifacts.text(config.path("run").path("browser"), "chromium");
        BrowserType type = switch (name) {
            case "firefox" -> playwright.firefox();
            case "webkit" -> playwright.webkit();
            default -> playwright.chromium();
        };
        browser = type.launch(new BrowserType.LaunchOptions()
                .setHeadless(Artifacts.bool(config.path("run").path("headless"), true)));
        context = browser.newContext();
        context.setDefaultTimeout(timeoutMs);
        page = context.newPage();
    }

    public Page page() {
        return page;
    }

    /** Where a flow starts, exactly as the TypeScript executor opens it (LLD §8). */
    public void open() {
        if (baseUrl != null && !baseUrl.isEmpty()) page.navigate(baseUrl);
    }

    public void navigate(String url) {
        page.navigate(absolute(url));
    }

    public String absolute(String url) {
        if (url.matches("^[a-z][a-z0-9+.-]*:.*") || baseUrl == null || baseUrl.isEmpty()) return url;
        String left = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        String right = url.startsWith("/") ? url : "/" + url;
        return left + right;
    }

    /**
     * A stored candidate → the elements it matches, as references (LLD §6.3).
     *
     * <p>Returns every match, and never throws for none: the resolver decides
     * what zero or several mean, which is what makes "exactly one" its rule
     * rather than the adapter's.
     */
    public List<String> locate(JsonNode candidate) {
        Locator locator = locatorFor(candidate);
        if (locator == null) return List.of();
        List<String> refs = new ArrayList<>();
        for (Locator one : locator.all()) {
            ElementHandle handle = one.elementHandle();
            if (handle == null) continue;
            handles.add(handle);
            refs.add("h" + (handles.size() - 1));
        }
        return refs;
    }

    /**
     * The candidate → locator table (LLD §7.1).
     *
     * <p>This is the part that has to agree with the TypeScript adapter
     * character for character. Where Playwright for Java and Playwright for Node
     * spell the same thing differently — {@code getByTestId} honours one
     * configured attribute at a time in both — the *behaviour* is matched, not
     * the spelling.
     */
    private Locator locatorFor(JsonNode candidate) {
        String by = candidate.path("by").asText("");
        String value = candidate.path("value").asText("");
        boolean exact = Artifacts.bool(candidate.path("exact"), true);

        return switch (by) {
            case "role" -> {
                AriaRole role = ariaRole(candidate.path("role").asText(""));
                if (role == null) yield null;
                Page.GetByRoleOptions options = new Page.GetByRoleOptions();
                String name = candidate.path("name").asText("");
                if (!name.isEmpty()) options.setName(name).setExact(exact);
                yield page.getByRole(role, options);
            }
            case "label" -> page.getByLabel(value, new Page.GetByLabelOptions().setExact(exact));
            case "placeholder" ->
                    page.getByPlaceholder(value, new Page.GetByPlaceholderOptions().setExact(exact));
            case "altText" -> page.getByAltText(value, new Page.GetByAltTextOptions().setExact(exact));
            case "title" -> page.getByTitle(value, new Page.GetByTitleOptions().setExact(exact));
            case "text" -> page.getByText(value, new Page.GetByTextOptions().setExact(exact));
            case "testid" -> {
                /*
                 * The attribute the *candidate* names, not the one a global
                 * setting names. A store can hold candidates on `data-testid`
                 * and on `data-qa` at once, and `setTestIdAttribute` is global
                 * per selector engine — so this is a plain attribute selector,
                 * which is what the TypeScript adapter does for the same reason.
                 */
                String attribute = Artifacts.text(candidate.path("attribute"),
                        testIdAttributes.isEmpty() ? "data-testid" : testIdAttributes.get(0));
                yield page.locator("[" + attribute + "=\"" + cssEscape(value) + "\"]");
            }
            case "css" -> page.locator(value);
            case "xpath" -> page.locator("xpath=" + value);
            case "id" -> page.locator("[id=\"" + cssEscape(value) + "\"]");
            case "name" -> page.locator("[name=\"" + cssEscape(value) + "\"]");
            /*
             * `coords` names a point and `webmcp` names a declared tool; neither
             * is a locator. This runtime resolves neither — which is honest, and
             * a plan needing one is reported rather than half-run.
             */
            case "coords", "webmcp" -> null;
            default -> throw new IllegalStateException(
                    "no rule for a \"" + by + "\" candidate. A candidate kind this runtime does "
                            + "not implement must fail the step, not resolve to something else.");
        };
    }

    private static String cssEscape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static AriaRole ariaRole(String role) {
        if (role.isEmpty()) return null;
        try {
            return AriaRole.valueOf(role.toUpperCase(Locale.ROOT).replace("-", ""));
        } catch (IllegalArgumentException unknown) {
            return null;
        }
    }

    public ElementHandle handleFor(String ref) {
        int index = Integer.parseInt(ref.substring(1));
        if (!ref.startsWith("h") || index < 0 || index >= handles.size()) {
            throw new IllegalStateException("\"" + ref + "\" is not a reference this runtime issued.");
        }
        return handles.get(index);
    }

    /** A navigation loses every reference (LLD §2.2). */
    public void invalidate() {
        handles.clear();
    }

    public double timeoutMs() {
        return timeoutMs;
    }

    @Override
    public void close() {
        try {
            context.close();
        } finally {
            try {
                browser.close();
            } finally {
                playwright.close();
            }
        }
    }
}
