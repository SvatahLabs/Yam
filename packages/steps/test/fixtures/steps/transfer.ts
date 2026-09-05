/**
 * The example from LLD §5 and `docs/flow-language.md` §6, as a loadable file.
 *
 * It is here rather than inline in a test so the loader is exercised on a real
 * `steps/` directory, and so the documented example is one that actually
 * compiles — a documented example that has never been type-checked is a
 * documented example that is wrong.
 */
import { defineStep } from "../../../src/index.js";

export default defineStep(
  "Transfer {amount:number} from {from:target} to {to:target}",
  { sideEffect: true, description: "Moves funds between two accounts" },
  async ({ surface, resolve, args, expect }) => {
    const from = await resolve(args["from"] as never);
    const to = await resolve(args["to"] as never);
    await surface.act("click", from);
    await surface.act("type", to, { value: String(args["amount"]) });
    await expect(to, { kind: "value", value: { kind: "literal", value: String(args["amount"]) } });
  },
);

/** A second export, to show the id carries the export name. */
export const seed = defineStep(
  'Seed the database with {fixture:string}',
  { sideEffect: true },
  async ({ log, args }) => {
    log(`seeding ${String(args["fixture"])}`);
  },
);
