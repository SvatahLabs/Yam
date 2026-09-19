/** Where a cookie goes (RFC 6265 §5.4, REQ-ADP-3). */
import { describe, expect, it } from "vitest";
import { cookiesFor, type StoredCookie } from "../src/cookies.js";

describe("cookiesFor sends a cookie where a browser would", () => {
  const jar: StoredCookie[] = [
    { name: "host", value: "h", domain: "app.example.com" },
    { name: "domain", value: "d", domain: ".example.com" },
    { name: "admin", value: "a", domain: "127.0.0.1", path: "/admin" },
    { name: "secure", value: "s", domain: "localhost", secure: true },
  ];

  it("keeps a host-only cookie to its host, and a domain cookie to its subdomains", () => {
    expect(cookiesFor("https://app.example.com/", jar)).toEqual({ host: "h", domain: "d" });
    expect(cookiesFor("https://api.app.example.com/", jar)).toEqual({ domain: "d" });
    expect(cookiesFor("https://notexample.com/", jar)).toEqual({});
  });

  it("matches a path at a slash, and a Secure cookie over https only", () => {
    expect(cookiesFor("http://127.0.0.1/admin/users", jar)).toEqual({ admin: "a" });
    expect(cookiesFor("http://127.0.0.1/administrator", jar)).toEqual({});
    expect(cookiesFor("http://localhost/", jar)).toEqual({});
    expect(cookiesFor("https://localhost/", jar)).toEqual({ secure: "s" });
  });
});
