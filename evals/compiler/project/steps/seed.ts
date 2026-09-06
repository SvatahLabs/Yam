/** The second Tier 0 step the golden set uses (g-151). */
import { defineStep } from "@svatah/yam-steps";

export const seedDatabase = defineStep(
  "Seed the database with {fixture:string}",
  { sideEffect: true, description: "Loads a named fixture into the database" },
  async ({ log, args }) => {
    log(`seeding ${String(args["fixture"])}`);
  },
);
