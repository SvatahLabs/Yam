/**
 * The Tier 0 step the golden set's `custom` entries compile against
 * (g-149, g-150; LLD §5, `docs/flow-language.md` §6).
 */
import { defineStep } from "@svatah/yam-steps";

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
