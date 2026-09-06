/**
 * WebMCP: the site's own declaration of what its controls do (T6.3,
 * REQ-ADP-9, LLD §6.3, §4.2 pattern 30).
 *
 * > WebMCP-aware behaviour: when a page declares tools, the recorder may store a
 * > `webmcp` candidate and the executor prefers it over locators for that
 * > binding.
 *
 * ## Why a site tool beats a locator
 *
 * Every other candidate says *where* an element is: this CSS selector, this
 * role and name, this point. A declared tool says what the page will *do* —
 * "book-slot takes a location and a date" — which is information the page
 * publishes deliberately and maintains, rather than a shape Yam inferred
 * from a rendering. A tool survives the redesign that breaks every locator on
 * the page, and it cannot be ambiguous.
 *
 * That is why the resolver prefers it, and why the preference is checked *per
 * resolution* rather than once: a page that stops declaring the tool has to
 * fall through to the locators recorded behind it, in the same run, without the
 * binding changing (LLD §6.3).
 *
 * ## The API is a draft, and this reads it as one
 *
 * `navigator.modelContext` is the Web MCP proposal's entry point. No browser
 * ships it, its shape is not settled, and a site today provides it itself. So
 * the reader tries the spellings that exist rather than one, and reports what
 * it found:
 *
 * | Reading the tools | `modelContext.tools`, `.availableTools`, `.getTools()`, `.listTools()` |
 * | Calling one | `modelContext.callTool(name, args)`, `.call(name, args)`, or the tool object's own `execute(args)` |
 *
 * A page that offers none of them declares no tools, which is the same answer
 * as a page that declares none — and the right one, because a tool this adapter
 * cannot call is a tool it must not prefer.
 */
import type { Frame } from "playwright";

/** One tool a page declares. */
export interface DeclaredTool {
  readonly name: string;
  readonly description?: string;
  /** The JSON Schema of its arguments, when the page publishes one. */
  readonly inputSchema?: unknown;
}

/**
 * Every tool the page currently declares, in declaration order.
 *
 * Never throws: a page with no `navigator.modelContext`, a getter that throws,
 * a `getTools()` that rejects — all of them mean "no tools", and a resolution
 * that failed because reading the declaration failed would be a locator failure
 * with the wrong cause attached.
 */
export async function declaredTools(frame: Frame): Promise<DeclaredTool[]> {
  return await frame
    .evaluate(async () => {
      const context = (navigator as unknown as { modelContext?: Record<string, unknown> })
        .modelContext;
      if (context === undefined || context === null) return [];

      const read = async (): Promise<unknown> => {
        for (const key of ["tools", "availableTools"]) {
          const value = context[key];
          if (Array.isArray(value)) return value;
        }
        for (const key of ["getTools", "listTools"]) {
          const method = context[key];
          if (typeof method === "function") {
            return await (method as () => unknown | Promise<unknown>).call(context);
          }
        }
        return [];
      };

      const value = await read();
      if (!Array.isArray(value)) return [];
      return value
        .map((one) => {
          const tool = one as { name?: unknown; description?: unknown; inputSchema?: unknown };
          return typeof tool.name === "string" && tool.name !== ""
            ? {
                name: tool.name,
                ...(typeof tool.description === "string"
                  ? { description: tool.description }
                  : {}),
                ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
              }
            : undefined;
        })
        .filter((one): one is DeclaredTool => one !== undefined);
    })
    .catch(() => []);
}

/** Whether the page declares a tool by this name, right now. */
export async function declaresTool(frame: Frame, name: string): Promise<boolean> {
  return (await declaredTools(frame)).some((tool) => tool.name === name);
}

export interface ToolCall {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
}

/**
 * Call a declared tool.
 *
 * The failure modes are kept apart on purpose. "The page has no such tool" is a
 * resolution problem — the declaration went away between resolving and acting —
 * and "the tool threw" is the site's own error, which belongs in the step's
 * failure message unchanged. Collapsing the two would make a booking that the
 * site rejected look like a binding that went stale.
 */
export async function callTool(
  frame: Frame,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<ToolCall> {
  return await frame.evaluate(
    async ({ tool, argv }: { tool: string; argv: Record<string, unknown> }) => {
      const context = (navigator as unknown as { modelContext?: Record<string, unknown> })
        .modelContext;
      if (context === undefined || context === null) {
        return { ok: false, error: "the page declares no navigator.modelContext" };
      }

      try {
        for (const key of ["callTool", "call", "invoke"]) {
          const method = context[key];
          if (typeof method === "function") {
            const value = await (
              method as (name: string, args: unknown) => unknown | Promise<unknown>
            ).call(context, tool, argv);
            return { ok: true, value: value ?? null };
          }
        }

        /*
         * No dispatcher, so the tool object carries its own `execute` — which is
         * the shape the proposal's `registerTool` produces. Reading the list
         * again rather than caching it is deliberate: between the resolve and
         * the act the page may have replaced it.
         */
        const list = (Array.isArray(context["tools"]) ? context["tools"] : context["availableTools"]) as
          | Array<{ name?: unknown; execute?: unknown; callback?: unknown }>
          | undefined;
        const found = list?.find((one) => one.name === tool);
        const execute = found?.execute ?? found?.callback;
        if (typeof execute === "function") {
          const value = await (execute as (args: unknown) => unknown | Promise<unknown>).call(
            found,
            argv,
          );
          return { ok: true, value: value ?? null };
        }
        return { ok: false, error: `no tool named "${tool}" is declared` };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    { tool: name, argv: { ...args } },
  );
}
