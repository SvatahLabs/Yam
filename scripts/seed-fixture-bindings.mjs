#!/usr/bin/env node
/**
 * Records the seed bindings the compatibility milestone runs with (T2.10).
 *
 * "Run the migrated fixtures with hand-completed seed bindings on
 * `apps/sample-web`."
 *
 * Hand-completed means a person says *which element* each phrase means; it does
 * not mean a person writes candidate YAML by hand. So the mapping below is the
 * hand-completed part — one line per element, phrase to selector — and the
 * candidates are **synthesised against the live page**, exactly as the recorder
 * will (T3.3). That matters: a hand-written bundle would be one candidate deep
 * and would say nothing about whether synthesis works on this application.
 *
 *   node scripts/seed-fixture-bindings.mjs [--check]
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalYaml, SCHEMA_VERSION } from "@svatah/yam-schema";
import { contextHash, contextPattern, fingerprint, synthesise } from "@svatah/yam-bindings";
import { PlaywrightSurface } from "@svatah/yam-adapter-playwright";
import { startSampleApp } from "sample-web";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const BINDINGS_DIR = "evals/fixtures/bindings";

/** A fixed timestamp, so the store is byte-stable across recordings. */
const AT = "2026-09-02T00:00:00.000Z";

/**
 * The hand-completed part: which element each phrase means.
 *
 * `page` is where the element lives, `selector` is how a person would point at
 * it. Nothing here becomes a candidate — the candidates come from synthesis.
 */
export const ELEMENTS = [
  // The application shell, reachable from every page.
  { id: "nav.nav-toggle", page: "/", selector: '[data-testid="nav-toggle"]', phrase: "the nav toggle" },
  { id: "nav.dashboard-link", page: "/", selector: '[data-testid="dashboard-link"]', phrase: "the dashboard link" },
  { id: "nav.book-a-slot-link", page: "/", selector: '[data-testid="booking-link"]', phrase: "the Book a slot link" },

  { id: "home.sign-in-button", page: "/", selector: '[data-testid="sign-in"]', phrase: "the sign in button" },
  { id: "home.home-heading", page: "/", selector: '[data-testid="home-heading"]', phrase: "the home heading" },

  { id: "login.username-field", page: "/login", selector: '[data-testid="username"]', phrase: "the username field" },
  { id: "login.password-field", page: "/login", selector: '[data-testid="password"]', phrase: "the password field" },
  { id: "login.login-button", page: "/login", selector: '[data-testid="login-submit"]', phrase: "the login button" },

  { id: "app.sidebar-toggle", page: "/dashboard", selector: '[data-testid="sidebar-toggle"]', phrase: "the sidebar toggle" },
  { id: "app.schedule-build-link", page: "/dashboard", selector: '[data-testid="nav-schedule-build"]', phrase: "the Schedule Build link" },
  { id: "app.bookings-link", page: "/dashboard", selector: '[data-testid="nav-bookings"]', phrase: "the Bookings link" },
  { id: "app.checkout-link", page: "/dashboard", selector: '[data-testid="nav-checkout"]', phrase: "the Checkout link" },
  { id: "app.logout-link", page: "/dashboard", selector: '[data-testid="nav-logout"]', phrase: "the logout link" },

  { id: "schedule.schedule-heading", page: "/schedule-build", selector: '[data-testid="schedule-heading"]', phrase: "the schedule heading" },

  { id: "booking.location-field", page: "/booking", selector: '[data-testid="location"]', phrase: "the location field" },
  { id: "booking.slot-date-field", page: "/booking", selector: '[data-testid="slot-date"]', phrase: "the slot date field" },
  { id: "booking.next-button", page: "/booking", selector: '[data-testid="booking-next"]', phrase: "the next button" },
  { id: "booking.book-now-button", page: "/booking", selector: '[data-testid="book-now"]', phrase: "the Book now button" },
  { id: "booking.booking-result", page: "/booking", selector: '[data-testid="booking-result"]', phrase: "the booking result" },

  { id: "checkout.card-number-field", page: "/checkout", selector: '[data-testid="card"]', phrase: "the card number field" },
  { id: "checkout.expiry-month-select", page: "/checkout", selector: '[data-testid="expiry-month"]', phrase: "the expiry month select" },
  { id: "checkout.expiry-year-select", page: "/checkout", selector: '[data-testid="expiry-year"]', phrase: "the expiry year select" },
  { id: "checkout.cvv-field", page: "/checkout", selector: '[data-testid="cvv"]', phrase: "the CVV field" },
  { id: "checkout.pay-button", page: "/checkout", selector: '[data-testid="pay"]', phrase: "the pay button" },

  /*
   * Three elements the sample application has but that cannot be *clicked*.
   *
   * `execution.flow` clicks a datalist suggestion and two `<option>`s, because
   * the site it was recorded against rendered them as list items. The sample
   * application renders them as the HTML controls they are, and a browser does
   * not let you click an `<option>`.
   *
   * They are bound anyway — the binding is correct, and `bindings verify`
   * resolves them — so that what fails is the *step*, visibly, rather than the
   * binding. See the compatibility record for the four steps this affects.
   */
  { id: "booking.indiranagar-suggestion", page: "/booking", selector: '#locations option[value="Indiranagar"]', phrase: "the Indiranagar suggestion" },
  { id: "booking.09-00-slot-time", page: "/booking", selector: '[data-testid="slot-times"] option[value="09:00"]', phrase: "the 09:00 slot time" },
  { id: "booking.18-00-slot-time", page: "/booking", selector: '[data-testid="slot-times"] option[value="18:00"]', phrase: "the 18:00 slot time" },
];

export async function recordSeedBindings(destination) {
  const app = await startSampleApp(0);
  const surface = new PlaywrightSurface({ headless: true, timeoutMs: 10_000 });
  await surface.open({ baseUrl: app.origin });

  const files = new Map();

  try {
    // Grouped by page, so each page is loaded once and the context hash each
    // binding records is the hash of the page it was found on.
    const pages = [...new Set(ELEMENTS.map((e) => e.page))];
    for (const page of pages) {
      await surface.act("navigate", undefined, { url: `${app.origin}${page}` });
      const snapshot = await surface.snapshot();

      for (const element of ELEMENTS.filter((e) => e.page === page)) {
        const refs = await surface.locate({ by: "css", value: element.selector, score: 1 });
        if (refs.length !== 1) {
          throw new Error(
            `${element.id}: "${element.selector}" matched ${refs.length} elements on ${page}. ` +
              "The mapping in this script is the hand-completed part; fix it here.",
          );
        }
        const ref = refs[0];

        const candidates = await synthesise(surface, ref);
        if (candidates.length === 0) {
          throw new Error(`${element.id}: synthesis produced no candidate.`);
        }

        files.set(element.id, {
          schemaVersion: SCHEMA_VERSION,
          id: element.id,
          phrases: [element.phrase],
          entries: [
            {
              context: {
                pattern: contextPattern(`${app.origin}${page}`),
                hash: contextHash(snapshot, ref).hash,
                platform: "web",
              },
              candidates,
              fingerprint: await fingerprint(surface, ref),
              recordedAt: AT,
              provenance: {
                model: "human",
                promptVersion: "seed:hand-completed",
                at: AT,
                tokensIn: 0,
                tokensOut: 0,
              },
              // Every candidate was verified against the live page by synthesis,
              // and the element was pointed at by hand.
              verified: true,
            },
          ],
        });
      }
    }
  } finally {
    await surface.close().catch(() => undefined);
    await app.close();
  }

  for (const [id, file] of files) {
    const [group, name] = id.includes(".") ? [id.slice(0, id.indexOf(".")), id.slice(id.indexOf(".") + 1)] : ["", id];
    const path = join(destination, group, `${name}.yaml`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, canonicalYaml(file), "utf8");
  }
  return files;
}

/** Every YAML under a directory, as `path → contents`. */
export function storeSnapshot(dir) {
  const out = new Map();
  const walk = (current, prefix) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else if (entry.name.endsWith(".yaml")) out.set(`${prefix}${entry.name}`, readFileSync(path, "utf8"));
    }
  };
  walk(dir, "");
  return out;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = join(ROOT, BINDINGS_DIR);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  const files = await recordSeedBindings(target);
  console.log(`recorded ${files.size} bindings into ${BINDINGS_DIR}`);
}
