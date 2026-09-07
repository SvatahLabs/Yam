/**
 * The MCP conformance corpus, written once and run over every transport
 * (T21, SF-03, SF-07, SF-08).
 *
 * SF-08 asks that a remote-capable client pass "the same conformance corpus …
 * as stdio". Written twice that would be two corpora that drift, and the one
 * thing a second transport has to establish is that it is the *same* server —
 * so it is written here, against an ordinary `Client` from the official SDK,
 * and each transport supplies one.
 *
 * Every case addresses the catalogue's own operations through their catalogue
 * tool names. A transport that could make one of these behave differently would
 * be a second contract, which is what the catalogue exists to prevent.
 */
import { expect } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SURFACE_TOOL_NAMES } from "@svatah/yam-surface-control";

/** The text a tool answered with, parsed when it is JSON. */
export function answer(result: unknown): Record<string, unknown> {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const first = content.find((one) => one.type === "text")?.text ?? "";
  try {
    return JSON.parse(first) as Record<string, unknown>;
  } catch {
    return { text: first };
  }
}

const errorCode = (envelope: Record<string, unknown>): string | undefined =>
  (envelope["error"] as { code?: string } | undefined)?.code;

const status = (envelope: Record<string, unknown>): string | undefined =>
  envelope["status"] as string | undefined;

export interface CorpusCase {
  readonly name: string;
  run(client: Client, context: { sampleUrl: string }): Promise<void>;
}

/**
 * The corpus.
 *
 * It opens one session and closes it, so a transport can be judged on the whole
 * of the primary journey and on the refusals — and so a run leaves the broker
 * as it found it.
 */
export const MCP_CORPUS: readonly CorpusCase[] = [
  {
    name: "every surface operation of the catalogue is offered as a tool",
    async run(client) {
      const listed = await client.listTools();
      const names = new Set(listed.tools.map((one) => one.name));
      for (const tool of SURFACE_TOOL_NAMES) {
        expect(names, `${tool} is in the catalogue and must be a tool`).toContain(tool);
      }
    },
  },
  {
    name: "every tool carries an input schema and an annotation",
    async run(client) {
      const listed = await client.listTools();
      for (const tool of listed.tools.filter((one) => SURFACE_TOOL_NAMES.includes(one.name))) {
        expect(tool.inputSchema, `${tool.name} has an input schema`).toBeDefined();
        expect(tool.description, `${tool.name} says what it does`).toBeTruthy();
      }
    },
  },
  {
    name: "the primary journey: connect, snapshot, act, read, check, describe, close",
    async run(client, { sampleUrl }) {
      const connected = answer(
        await client.callTool({
          name: "surface_connect",
          arguments: { url: `${sampleUrl}/login`, adapter: "playwright" },
        }),
      );
      expect(status(connected), JSON.stringify(connected).slice(0, 300)).toBe("succeeded");
      const session = (connected["result"] as { sessionId: string }).sessionId;
      expect(session).toMatch(/^s_/);

      try {
        const snapshot = answer(
          await client.callTool({
            name: "surface_snapshot",
            arguments: { session, interactiveOnly: true },
          }),
        );
        expect(status(snapshot)).toBe("succeeded");
        const text = (snapshot["result"] as { text: string }).text;
        expect(text).toContain("[ref=");
        const username = /textbox "Username"(?: \[[^\]]*\])* \[ref=(\w+)\]/.exec(text)?.[1];
        expect(username, text.slice(0, 400)).toBeDefined();

        /* capabilities: what this target can be asked for (SF-09) */
        const caps = answer(
          await client.callTool({ name: "surface_capabilities", arguments: { session } }),
        );
        expect(status(caps)).toBe("succeeded");

        /* describe: an element, by the reference the snapshot gave (SF-11) */
        const described = answer(
          await client.callTool({
            name: "surface_describe",
            arguments: { session, ref: username },
          }),
        );
        expect(status(described)).toBe("succeeded");

        /* act, then read the value back */
        const typed = answer(
          await client.callTool({
            name: "surface_act",
            arguments: {
              session,
              action: "type",
              ref: username,
              args: { value: "ada@example.test" },
            },
          }),
        );
        expect(status(typed), JSON.stringify(typed).slice(0, 300)).toBe("succeeded");

        const read = answer(
          await client.callTool({
            name: "surface_read",
            arguments: { session, kind: "value", ref: username },
          }),
        );
        expect((read["result"] as { value: string }).value).toBe("ada@example.test");

        /* check: a postcondition that holds */
        const holds = answer(
          await client.callTool({
            name: "surface_check",
            arguments: { session, predicate: { kind: "visible" }, subject: "ref", ref: username },
          }),
        );
        expect(status(holds)).toBe("succeeded");

        /* sessions: this one is listed, through the same broker */
        const listed = answer(
          await client.callTool({ name: "surface_sessions", arguments: {} }),
        );
        const ids = ((listed["result"] as { sessions: Array<{ sessionId: string }> }).sessions ?? [])
          .map((one) => one.sessionId);
        expect(ids).toContain(session);
      } finally {
        const closed = answer(
          await client.callTool({ name: "surface_close", arguments: { session } }),
        );
        expect(status(closed)).toBe("succeeded");
      }

      /* …and a closed session is not found, which is what closing means */
      const after = answer(
        await client.callTool({ name: "surface_snapshot", arguments: { session } }),
      );
      expect(errorCode(after)).toBe("SESSION_NOT_FOUND");
    },
  },
  {
    name: "a postcondition that does not hold fails, and keeps what it observed",
    async run(client, { sampleUrl }) {
      const connected = answer(
        await client.callTool({
          name: "surface_connect",
          arguments: { url: `${sampleUrl}/login`, adapter: "playwright" },
        }),
      );
      const session = (connected["result"] as { sessionId: string }).sessionId;
      try {
        const result = await client.callTool({
          name: "surface_check",
          arguments: {
            session,
            predicate: { kind: "textContains", value: "this text is not on the sign-in page" },
            subject: "page",
          },
        });
        const envelope = answer(result);
        expect(status(envelope)).toBe("failed");
        expect(errorCode(envelope)).toBe("CHECK_FAILED");
        expect(result.isError, "a failed check is a tool error").toBe(true);
      } finally {
        await client.callTool({ name: "surface_close", arguments: { session } });
      }
    },
  },
  {
    name: "a reference nothing issued is refused, not resolved to whatever holds its id",
    async run(client, { sampleUrl }) {
      const connected = answer(
        await client.callTool({
          name: "surface_connect",
          arguments: { url: `${sampleUrl}/login`, adapter: "playwright" },
        }),
      );
      const session = (connected["result"] as { sessionId: string }).sessionId;
      try {
        const snapshot = answer(
          await client.callTool({ name: "surface_snapshot", arguments: { session } }),
        );
        const anchor = (snapshot["result"] as { snapshotId?: string }).snapshotId;
        await client.callTool({
          name: "surface_snapshot",
          arguments: { session, maxNodes: 5 },
        });
        const refused = answer(
          await client.callTool({
            name: "surface_describe",
            arguments: { session, ref: "e999999", snapshot: anchor },
          }),
        );
        expect(errorCode(refused)).toBe("STALE_REFERENCE");
      } finally {
        await client.callTool({ name: "surface_close", arguments: { session } });
      }
    },
  },
  {
    name: "an action missing a required argument is refused before dispatch",
    async run(client, { sampleUrl }) {
      const connected = answer(
        await client.callTool({
          name: "surface_connect",
          arguments: { url: `${sampleUrl}/login`, adapter: "playwright" },
        }),
      );
      const session = (connected["result"] as { sessionId: string }).sessionId;
      try {
        const snapshot = answer(
          await client.callTool({
            name: "surface_snapshot",
            arguments: { session, interactiveOnly: true },
          }),
        );
        const text = (snapshot["result"] as { text: string }).text;
        const username = /textbox "Username"(?: \[[^\]]*\])* \[ref=(\w+)\]/.exec(text)?.[1];
        const refused = answer(
          await client.callTool({
            name: "surface_act",
            arguments: { session, action: "type", ref: username },
          }),
        );
        expect(errorCode(refused)).toBe("INVALID_ARGUMENT");
      } finally {
        await client.callTool({ name: "surface_close", arguments: { session } });
      }
    },
  },
  {
    name: "a session id nothing opened is not found, on any transport",
    async run(client) {
      const answered = answer(
        await client.callTool({
          name: "surface_snapshot",
          arguments: { session: "s_nothingopenedthis" },
        }),
      );
      expect(errorCode(answered)).toBe("SESSION_NOT_FOUND");
    },
  },
  {
    name: "a tool the server does not have is an error, not a silent nothing",
    async run(client) {
      /*
       * The SDK reports an unknown tool as a tool result with `isError`, not as
       * a rejected promise, and it says the tool's name. Both are what a caller
       * needs; what would be wrong is an empty success, which is what an
       * earlier draft of this case would have accepted.
       */
      const result = await client.callTool({ name: "surface_teleport", arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("surface_teleport");
    },
  },
];
