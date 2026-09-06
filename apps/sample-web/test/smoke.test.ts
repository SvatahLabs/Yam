/**
 * T0.5 Validate — "Smoke test per page and variant".
 *
 * The app is started on an ephemeral port and driven over HTTP, so this exercises
 * the real server, routing and variant application rather than the page strings.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAGES, startSampleApp, VARIANTS, DEFAULT_PORT, parseVariant, type SampleServer } from "../src/index.js";

let app: SampleServer;

beforeAll(async () => {
  app = await startSampleApp(0);
});
afterAll(async () => {
  await app.close();
});

const get = async (path: string) => {
  const res = await fetch(`${app.origin}${path}`);
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", body: await res.text() };
};

describe("the sample application serves every page", () => {
  it("fixes port 4173 as its default (LLD §16)", () => {
    expect(DEFAULT_PORT).toBe(4173);
  });

  it.each(PAGES.map((p) => [p.path, p.title] as const))("GET %s serves %s", async (path, title) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/html");
    expect(res.body).toContain(`<title>${title} · Yam Sample</title>`);
    expect(res.body.startsWith("<!doctype html>")).toBe(true);
  });

  it("serves the stylesheet and the canvas script", async () => {
    expect((await get("/app.css")).contentType).toContain("text/css");
    const js = await get("/canvas.js");
    expect(js.contentType).toContain("text/javascript");
    expect(js.body).toContain("canvas-control");
  });

  it("404s an unknown path", async () => {
    const res = await get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toContain('data-testid="not-found"');
  });
});

describe("the pages the sample flows drive", () => {
  it("the home page offers sign in and a docs link that opens a new tab", async () => {
    const { body } = await get("/");
    expect(body).toContain('data-testid="sign-in"');
    expect(body).toMatch(/data-testid="docs-link"[^>]*|[^>]*target="_blank"/);
  });

  it("the login page has username, password and a Sign In submit", async () => {
    const { body } = await get("/login");
    expect(body).toContain('id="username"');
    expect(body).toContain('id="password"');
    expect(body).toContain('value="Sign In"');
  });

  it("the dashboard has the sidebar the flows navigate", async () => {
    const { body } = await get("/dashboard");
    for (const id of ["sidebar-toggle", "nav-schedule-build", "nav-logout", "active-count"]) {
      expect(body, `dashboard is missing ${id}`).toContain(`data-testid="${id}"`);
    }
  });

  it("the Schedule Build page has the h1 the flows read and assert on", async () => {
    const { body } = await get("/schedule-build");
    expect(body).toMatch(/<h1[^>]*data-testid="schedule-heading"[^>]*>Enterprise<\/h1>/);
  });
});

describe("the widgets LLD §16 requires", () => {
  it("has a native dialog trigger", async () => {
    const { body } = await get("/widgets");
    expect(body).toContain('data-testid="show-alert"');
    expect(body).toContain('data-testid="show-confirm"');
  });

  it("has a single and a multiple select", async () => {
    const { body } = await get("/widgets");
    expect(body).toContain('data-testid="single-select"');
    expect(body).toMatch(/data-testid="multi-select"[^>]*multiple|multiple[^>]*data-testid="multi-select"/);
  });

  it("has an iframe whose document is served", async () => {
    const { body } = await get("/widgets");
    expect(body).toContain('src="/widgets/frame"');
    const frame = await get("/widgets/frame");
    expect(frame.status).toBe(200);
    expect(frame.body).toContain('data-testid="frame-input"');
  });

  it("has a link that opens a new tab", async () => {
    const { body } = await get("/widgets");
    expect(body).toMatch(/data-testid="open-new-tab"/);
    expect(body).toContain('target="_blank"');
  });

  it("has a file input and a drag pair", async () => {
    const { body } = await get("/widgets");
    expect(body).toContain('type="file"');
    expect(body).toContain('data-testid="drag-source"');
    expect(body).toContain('data-testid="drag-target"');
  });

  it("has a canvas-only control with no accessibility node", async () => {
    const { body } = await get("/widgets");
    expect(body).toContain('<canvas id="canvas-control"');
    // The control is painted, not marked up: no button element inside the section.
    const section = body.slice(body.indexOf('data-testid="section-canvas"'));
    expect(section.slice(0, section.indexOf("</section>"))).not.toContain("<button");
  });
});

describe("GET /api/active-count", () => {
  it("returns the active build count as JSON", async () => {
    const res = await fetch(`${app.origin}/api/active-count`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ activeCount: 3 });
  });
});

describe("variants (?variant=1..20)", () => {
  it("there are exactly twenty", () => {
    expect(VARIANTS).toHaveLength(20);
    expect(VARIANTS.map((v) => v.id)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("parses the query parameter, treating anything out of range as the baseline", () => {
    expect(parseVariant(null)).toBe(0);
    expect(parseVariant("")).toBe(0);
    expect(parseVariant("7")).toBe(7);
    expect(parseVariant("20")).toBe(20);
    expect(parseVariant("21")).toBe(0);
    expect(parseVariant("-1")).toBe(0);
    expect(parseVariant("nope")).toBe(0);
    expect(parseVariant("1.5")).toBe(0);
  });

  it.each(VARIANTS.map((v) => [v.id, v.title] as const))(
    "variant %i (%s) serves every page it names",
    async (id) => {
      const variant = VARIANTS.find((v) => v.id === id)!;
      expect(variant.pages.length).toBeGreaterThan(0);
      for (const path of variant.pages) {
        const res = await get(`${path}?variant=${id}`);
        expect(res.status, `${path}?variant=${id}`).toBe(200);
        expect(res.body).toContain("<html");
        expect(res.body).toContain("</html>");
      }
    },
  );

  it.each(PAGES.map((p) => p.path))("every variant still serves %s", async (path) => {
    for (const variant of VARIANTS) {
      const res = await get(`${path}?variant=${variant.id}`);
      expect(res.status, `${path}?variant=${variant.id}`).toBe(200);
    }
  });

  it("variant 0 is byte-identical to no variant at all", async () => {
    for (const page of PAGES) {
      expect((await get(`${page.path}?variant=0`)).body).toBe((await get(page.path)).body);
    }
  });

  it("names every variant over /api/variants, for the healing eval", async () => {
    const listed = (await (await fetch(`${app.origin}/api/variants`)).json()) as Array<{
      id: number;
      title: string;
      breaks: string[];
    }>;
    expect(listed).toHaveLength(20);
    for (const entry of listed) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.breaks.length).toBeGreaterThan(0);
    }
  });
});

describe("variant 9 is the duplicate-element case T1.5 needs", () => {
  it("produces two elements that answer to the same accessible name", async () => {
    const { body } = await get("/booking?variant=9");
    const matches = body.match(/>Book now</g) ?? [];
    expect(matches.length).toBe(2);
  });
});
