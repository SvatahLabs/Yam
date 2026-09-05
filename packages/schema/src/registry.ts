import type { z } from "zod";

import {
  bindingEntrySchema,
  bindingFileSchema,
  candidateSchema,
  fingerprintSchema,
} from "./bindings.js";
import { configSchema } from "./config.js";
import {
  planSchema,
  predicateSchema,
  signatureSchema,
  stepSchema,
  storySchema,
  targetRefSchema,
} from "./ir.js";
import { proposalSchema } from "./proposal.js";
import { provenanceSchema } from "./provenance.js";
import {
  auditLineSchema,
  checkpointSchema,
  invokerSchema,
  stepResultSchema,
  summarySchema,
} from "./results.js";
import {
  capabilitiesSchema,
  elementDescriptionSchema,
  apiRequestSchema,
  apiResponseSchema,
  sessionInitSchema,
  sessionStateSchema,
  snapshotSchema,
  surfaceActMessageSchema,
  surfaceCapabilitiesMessageSchema,
  surfaceCheckMessageSchema,
  surfaceLocateMessageSchema,
  surfaceReadMessageSchema,
  surfaceSnapshotMessageSchema,
} from "./surface.js";
import { valueRefSchema } from "./values.js";

/**
 * Every schema that is published as a JSON Schema file under
 * `packages/schema/json/` (REQ-STD-1).
 *
 * The key is the file's base name, so `plan` becomes `plan.schema.json`. The list
 * is the single source the generator and the drift test both read, so a schema
 * cannot be added to the package without being published.
 */
export interface PublishedSchema {
  /** Base name of the generated file, without `.schema.json`. */
  readonly name: string;
  /** One-line description written into the generated file. */
  readonly description: string;
  readonly schema: z.ZodTypeAny;
}

export const PUBLISHED_SCHEMAS: readonly PublishedSchema[] = [
  // Shared building blocks.
  { name: "provenance", description: "Provenance of a model-produced artifact (LLD §3.5)", schema: provenanceSchema },
  { name: "value-ref", description: "How a step refers to a value (LLD §3.1)", schema: valueRefSchema },

  // Step IR and plan.
  { name: "predicate", description: "Expectation and guard predicates (LLD §3.2)", schema: predicateSchema },
  { name: "target-ref", description: "The target of a step (LLD §3.2)", schema: targetRefSchema },
  { name: "ir", description: "One compiled step (LLD §3.2)", schema: stepSchema },
  { name: "signature", description: "A story's typed inputs and outputs (LLD §3.2)", schema: signatureSchema },
  { name: "story", description: "A named, ordered list of steps (LLD §3.2)", schema: storySchema },
  { name: "plan", description: "plan.json — the compiled IR for a project (LLD §3.2)", schema: planSchema },

  // Bindings.
  { name: "candidate", description: "One locator candidate (LLD §3.3)", schema: candidateSchema },
  { name: "fingerprint", description: "A structural fingerprint of an element (LLD §3.3)", schema: fingerprintSchema },
  { name: "binding-entry", description: "One recorded binding for one context (LLD §3.3)", schema: bindingEntrySchema },
  { name: "bindings", description: "A bindings store file (LLD §3.3)", schema: bindingFileSchema },

  // Results, audit, checkpoints.
  { name: "invoker", description: "Who invoked a run (LLD §3.4)", schema: invokerSchema },
  { name: "results", description: "One line of results.jsonl (LLD §3.4)", schema: stepResultSchema },
  { name: "summary", description: "summary.json for a run (LLD §3.4)", schema: summarySchema },
  { name: "audit", description: "One line of audit.jsonl (LLD §3.4)", schema: auditLineSchema },
  { name: "checkpoint", description: "State sufficient to resume a flow (LLD §3.4)", schema: checkpointSchema },

  // Config and proposals.
  { name: "config", description: "svatah.config.yaml (LLD §3.5)", schema: configSchema },
  { name: "proposal", description: "A trajectory-compiled proposal (HLD §6.6)", schema: proposalSchema },

  // Surface (LLD §2.5).
  { name: "surface.snapshot", description: "Agent surface: snapshot() request and response (LLD §2.5)", schema: surfaceSnapshotMessageSchema },
  { name: "surface.act", description: "Agent surface: act() request and response (LLD §2.5)", schema: surfaceActMessageSchema },
  { name: "surface.check", description: "Agent surface: check() request and response (LLD §2.5)", schema: surfaceCheckMessageSchema },
  { name: "surface.read", description: "Agent surface: read() request and response (LLD §2.5)", schema: surfaceReadMessageSchema },
  { name: "surface.locate", description: "Agent surface: locate() request and response (LLD §2.1)", schema: surfaceLocateMessageSchema },
  { name: "surface.capabilities", description: "Agent surface: the capabilities descriptor (LLD §2.4)", schema: surfaceCapabilitiesMessageSchema },
  { name: "surface.snapshot-node", description: "Agent surface: one normalised snapshot node (LLD §2.2)", schema: snapshotSchema.shape.nodes.element },
  { name: "surface.capabilities-flags", description: "Agent surface: the capability flags (LLD §2.4)", schema: capabilitiesSchema },
  { name: "surface.session-init", description: "Agent surface: how a session is opened (LLD §2.1)", schema: sessionInitSchema },
  { name: "surface.session-state", description: "Agent surface: restorable session state (LLD §2.1)", schema: sessionStateSchema },
  { name: "surface.element-description", description: "Agent surface: describe() output (LLD §2.1)", schema: elementDescriptionSchema },
  { name: "surface.api-request", description: "HTTP adapter: a named request (REQ-ADP-2)", schema: apiRequestSchema },
  { name: "surface.api-response", description: "HTTP adapter: a response (REQ-ADP-2)", schema: apiResponseSchema },
];

/** Look one up by base name. */
export function publishedSchema(name: string): PublishedSchema | undefined {
  return PUBLISHED_SCHEMAS.find((s) => s.name === name);
}
