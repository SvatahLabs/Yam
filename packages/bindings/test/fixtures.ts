/** Binding fixtures for the store and resolver tests. */
import {
  HUMAN_PROVENANCE_MODEL,
  SCHEMA_VERSION,
  type BindingEntry,
  type BindingFile,
  type Candidate,
  type Fingerprint,
  type Provenance,
} from "@svatah/yam-schema";

export const humanProvenance: Provenance = {
  model: HUMAN_PROVENANCE_MODEL,
  promptVersion: "n/a",
  at: "2026-09-02T10:00:00.000Z",
  tokensIn: 0,
  tokensOut: 0,
};

export const fingerprint: Fingerprint = {
  tag: "input",
  attrs: { id: "username", name: "username", type: "text" },
  text: "",
  neighbours: { before: ["Username"], after: ["Password"] },
  rolePath: ["main", "form"],
  box: [16, 120, 348, 34],
  index: 0,
};

export function candidate(partial: Partial<Candidate> & Pick<Candidate, "by">): Candidate {
  return { score: 0.9, ...partial } as Candidate;
}

export function entry(overrides: Partial<BindingEntry> = {}): BindingEntry {
  return {
    context: {
      pattern: "http://127.0.0.1:4173/login",
      hash: "a".repeat(64),
      platform: "web",
      viewport: [1280, 720],
    },
    candidates: [
      candidate({ by: "testid", value: "username", score: 0.98 }),
      candidate({ by: "label", value: "Username", score: 0.9 }),
      candidate({ by: "css", value: "#username", score: 0.7 }),
    ],
    fingerprint,
    recordedAt: "2026-09-02T10:00:00.000Z",
    provenance: humanProvenance,
    verified: true,
    ...overrides,
  };
}

export function file(id = "login.username-field", overrides: Partial<BindingFile> = {}): BindingFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    phrases: ["the username field"],
    entries: [entry()],
    ...overrides,
  };
}
