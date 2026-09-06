/**
 * T1.3 Validate — "round-trip byte identity".
 *
 * The bindings store is committed and reviewed as files (REQ-REC-9), so the only
 * property that really matters is this one: writing the same bindings twice
 * produces the same bytes. Without it a re-record produces a diff of noise and
 * nobody reads the parts that changed.
 *
 * Refs: REQ-REC-6, REQ-REC-9, LLD §6.1.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalYaml } from "@svatah/yam-schema";
import { DataError } from "@svatah/yam-surface";
import {
  BindingsStore,
  elementIdFromPhrase,
  idToSegments,
  isElementId,
  pathToId,
  readBindingIndex,
} from "../src/index.js";
import { candidate, entry, file } from "./fixtures.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "yam-bindings-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("element ids and paths (LLD §6.1)", () => {
  it("maps an id onto bindings/<app>/<page>/<element>.yaml", () => {
    expect(idToSegments("login.username-field")).toEqual(["login", "username-field.yaml"]);
    expect(idToSegments("shop.checkout.pay-button")).toEqual(["shop", "checkout", "pay-button.yaml"]);
    expect(idToSegments("sign-in-button")).toEqual(["sign-in-button.yaml"]);
  });

  it("reads an id back out of a path", () => {
    expect(pathToId("login/username-field.yaml")).toBe("login.username-field");
    expect(pathToId("shop/checkout/pay-button.yaml")).toBe("shop.checkout.pay-button");
  });

  it("rejects an id that is not a path written with dots", () => {
    for (const bad of ["Login.Username", "login/username", "login..username", "", "login.Username"]) {
      expect(isElementId(bad), `"${bad}" should not be a valid id`).toBe(false);
    }
    expect(() => idToSegments("Login.Username")).toThrow(DataError);
    expect(() => idToSegments("Login.Username")).toThrow(/LLD §6.1/);
  });

  it("normalises a target phrase into an id (docs/flow-language.md §4)", () => {
    expect(elementIdFromPhrase("the sign in button")).toBe("sign-in-button");
    expect(elementIdFromPhrase("The Username Field")).toBe("username-field");
    expect(elementIdFromPhrase("a Book now button")).toBe("book-now-button");
    expect(elementIdFromPhrase("CVV field")).toBe("cvv-field");
  });
});

describe("round-trip byte identity (T1.3)", () => {
  it("writes, reads and rewrites the same bytes", () => {
    const store = BindingsStore.empty(dir);
    store.put("login.username-field", entry(), "the username field");
    store.put("login.sign-in-button", entry({ candidates: [candidate({ by: "testid", value: "login-submit" })] }));

    const first = store.save();
    expect(first.written).toHaveLength(2);

    const bytes = new Map(
      store.ids().map((id) => [id, readFileSync(join(dir, ...idToSegments(id)), "utf8")]),
    );

    const reloaded = BindingsStore.load(dir);
    expect(reloaded.ids()).toEqual(store.ids());
    expect(reloaded.toObject()).toEqual(store.toObject());

    const second = reloaded.save();
    // Nothing changed, so nothing is rewritten: a re-record that found the same
    // bindings must leave `git status` clean.
    expect(second.written).toEqual([]);
    for (const [id, before] of bytes) {
      expect(readFileSync(join(dir, ...idToSegments(id)), "utf8"), id).toBe(before);
    }
  });

  it("writes canonical YAML with sorted keys", () => {
    const store = BindingsStore.empty(dir);
    store.put("login.username-field", entry(), "the username field");
    store.save();

    const text = readFileSync(join(dir, "login", "username-field.yaml"), "utf8");
    expect(text).toBe(canonicalYaml(store.get("login.username-field")));
    expect(store.render("login.username-field")).toBe(text);

    // Sorted keys, top level: entries, id, phrases, schemaVersion.
    const topLevel = text.split("\n").filter((l) => /^\w/.test(l)).map((l) => l.split(":")[0]);
    expect(topLevel).toEqual([...topLevel].sort());
  });

  it("is independent of the order things were put in", () => {
    const a = BindingsStore.empty(join(dir, "a"));
    a.put("login.username-field", entry(), "the username field");
    a.put("login.sign-in-button", entry());
    a.save();

    const b = BindingsStore.empty(join(dir, "b"));
    b.put("login.sign-in-button", entry());
    b.put("login.username-field", entry(), "the username field");
    b.save();

    expect(b.hash()).toBe(a.hash());
    for (const id of a.ids()) {
      expect(readFileSync(join(dir, "b", ...idToSegments(id)), "utf8")).toBe(
        readFileSync(join(dir, "a", ...idToSegments(id)), "utf8"),
      );
    }
  });

  it("hashes the whole store, and the hash moves when a binding does", () => {
    const store = BindingsStore.empty(dir);
    store.put("login.username-field", entry());
    const before = store.hash();
    expect(before).toMatch(/^[0-9a-f]{64}$/);

    store.put("login.username-field", entry({ candidates: [candidate({ by: "id", value: "username" })] }));
    expect(store.hash()).not.toBe(before);
  });
});

describe("loading (LLD §6.1)", () => {
  it("a missing directory is an empty store, not an error", () => {
    const store = BindingsStore.load(join(dir, "absent"));
    expect(store.ids()).toEqual([]);
    expect(store.has("anything")).toBe(false);
  });

  it("refuses a file whose declared id disagrees with its path", () => {
    mkdirSync(join(dir, "login"), { recursive: true });
    writeFileSync(
      join(dir, "login", "username-field.yaml"),
      canonicalYaml(file("login.something-else")),
      "utf8",
    );
    expect(() => BindingsStore.load(dir)).toThrow(/declares id .* but its path says/);
  });

  it("refuses a file that is not a valid bindings file", () => {
    mkdirSync(join(dir, "login"), { recursive: true });
    writeFileSync(join(dir, "login", "broken.yaml"), "id: login.broken\nentries: []\n", "utf8");
    expect(() => BindingsStore.load(dir)).toThrow(/not a valid bindings file/);
  });

  it("refuses YAML it cannot parse", () => {
    mkdirSync(join(dir, "login"), { recursive: true });
    writeFileSync(join(dir, "login", "bad.yaml"), "id: [unclosed\n", "utf8");
    expect(() => BindingsStore.load(dir)).toThrow(/not valid YAML/);
  });
});

describe("entries and contexts (REQ-REC-6)", () => {
  it("replaces the entry for a context rather than accumulating copies", () => {
    const store = BindingsStore.empty(dir);
    store.put("login.username-field", entry());
    store.put("login.username-field", entry({ candidates: [candidate({ by: "id", value: "username" })] }));

    expect(store.entries("login.username-field")).toHaveLength(1);
    expect(store.entries("login.username-field")[0]!.candidates[0]!.by).toBe("id");
  });

  it("replaces the entry a repair supersedes, even though its context moved", () => {
    // A heal changes the context hash — the page's shape changed, which is why
    // the binding broke — so without saying what it replaces the store would keep
    // the broken entry *and* the repaired one, with the broken one first
    // (LLD §6.3 selects by hash, then pattern, then position). The next run would
    // resolve the broken entry and fail exactly as before.
    const store = BindingsStore.empty(dir);
    const broken = entry({ candidates: [candidate({ by: "xpath", value: "//form/div[1]/input" })] });
    store.put("login.username-field", broken);

    const repaired = entry({
      context: { ...broken.context, hash: "b".repeat(64) },
      candidates: [candidate({ by: "testid", value: "username" })],
    });
    store.put("login.username-field", repaired, undefined, { replaces: broken.context });

    expect(store.entries("login.username-field")).toHaveLength(1);
    expect(store.entryFor("login.username-field", {})!.candidates[0]!.by).toBe("testid");
  });

  it("keeps a different context as a separate entry when nothing was superseded", () => {
    const store = BindingsStore.empty(dir);
    store.put("login.username-field", entry());
    store.put(
      "login.username-field",
      entry({ context: { pattern: "http://127.0.0.1:4173/login", hash: "b".repeat(64), platform: "web" } }),
    );
    expect(store.entries("login.username-field")).toHaveLength(2);
  });

  it("selects an entry by context hash first, then by url pattern, then the first", () => {
    const store = BindingsStore.empty(dir);
    const onPage = entry();
    const inDialog = entry({
      context: { pattern: "http://127.0.0.1:4173/booking", hash: "b".repeat(64), platform: "web" },
    });
    store.put("login.username-field", onPage);
    store.put("login.username-field", inDialog);

    expect(store.entryFor("login.username-field", { hash: "b".repeat(64) })).toEqual(inDialog);
    expect(
      store.entryFor("login.username-field", { url: "http://127.0.0.1:4173/booking" }),
    ).toEqual(inDialog);
    expect(store.entryFor("login.username-field", {})).toEqual(onPage);
    expect(
      store.entryFor("login.username-field", { url: "http://127.0.0.1:4173/nowhere" }),
    ).toEqual(onPage);
  });

  it("prefers an entry recorded on the same platform", () => {
    const store = BindingsStore.empty(dir);
    const web = entry();
    const mobile = entry({
      context: { pattern: "app://booking", hash: "c".repeat(64), platform: "mobile" },
    });
    store.put("login.username-field", web);
    store.put("login.username-field", mobile);

    expect(store.entryFor("login.username-field", { platform: "mobile" })).toEqual(mobile);
    expect(store.entryFor("login.username-field", { platform: "web" })).toEqual(web);
    // A platform with no entry falls back rather than resolving nothing.
    expect(store.entryFor("login.username-field", { platform: "desktop" })).toEqual(web);
  });

  it("collects phrases without duplicating them, and keeps them sorted", () => {
    const store = BindingsStore.empty(dir);
    store.put("login.username-field", entry(), "the username field");
    store.put("login.username-field", entry(), "the email field");
    store.addPhrase("login.username-field", "the username field");
    expect(store.phrases("login.username-field")).toEqual(["the email field", "the username field"]);
  });
});

describe("saving (REQ-REC-9)", () => {
  it("removes the file for an element taken out of the store", () => {
    const store = BindingsStore.empty(dir);
    store.put("login.username-field", entry());
    store.put("login.sign-in-button", entry());
    store.save();
    expect(existsSync(join(dir, "login", "sign-in-button.yaml"))).toBe(true);

    expect(store.remove("login.sign-in-button")).toBe(true);
    const result = store.save();
    expect(result.removed).toHaveLength(1);
    expect(existsSync(join(dir, "login", "sign-in-button.yaml"))).toBe(false);
    expect(existsSync(join(dir, "login", "username-field.yaml"))).toBe(true);
  });

  it("refuses to render bindings that are not there", () => {
    expect(() => BindingsStore.empty(dir).render("login.absent")).toThrow(/No bindings for/);
  });
});

describe("readBindingIndex (P3-F1, LLD §4.3, Draft 2.5)", () => {
  /*
   * The dictionary's entries come through the store's loader, so the reader has
   * no opinion about how a phrase list is written — YAML does. Phase 3 read the
   * text with a regular expression and only the first of these six spellings
   * survived it.
   */
  const spellings: ReadonlyArray<[string, string]> = [
    ["double-quoted", 'phrases:\n  - "the sign in button"\n'],
    ["unquoted", "phrases:\n  - the sign in button\n"],
    ["single-quoted", "phrases:\n  - 'the sign in button'\n"],
    ["flow style", 'phrases: ["the sign in button"]\n'],
    ["indented four spaces", 'phrases:\n    - "the sign in button"\n'],
    ["a block scalar", 'phrases:\n  - >-\n      the sign in\n      button\n'],
  ];

  const write = (phrases: string): void => {
    const store = BindingsStore.empty(dir);
    store.put("login.sign-in-button", entry(), "placeholder");
    store.save();
    const path = join(dir, "login", "sign-in-button.yaml");
    const body = readFileSync(path, "utf8").replace(/^phrases:\n {2}- .*\n/m, phrases);
    writeFileSync(path, body, "utf8");
  };

  for (const [how, phrases] of spellings) {
    it(`reads a phrase list written ${how}`, () => {
      write(phrases);
      expect(readBindingIndex(dir)).toEqual([
        {
          id: "login.sign-in-button",
          phrases: ["the sign in button"],
          file: "login/sign-in-button.yaml",
        },
      ]);
    });
  }

  it("reports an empty phrase list as empty rather than as absent", () => {
    // What `W_BINDING_NO_PHRASES` is raised from: the entry exists and is
    // addressable by id; it just cannot be named by a sentence (LLD §6.5).
    write("phrases: []\n");
    expect(readBindingIndex(dir)).toEqual([
      { id: "login.sign-in-button", phrases: [], file: "login/sign-in-button.yaml" },
    ]);
  });

  it("is an empty list for a directory that is not there", () => {
    expect(readBindingIndex(join(dir, "absent"))).toEqual([]);
  });

  it("throws the loader's error for a file the store would refuse", () => {
    write('phrases:\n  - "the sign in button"\n');
    writeFileSync(join(dir, "login", "broken.yaml"), "entries: [\n", "utf8");
    expect(() => readBindingIndex(dir)).toThrow(DataError);
  });
});
