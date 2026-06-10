// ============================================================
// Copilot request schema — the contract between the chat UI and
// /api/copilot. Shared by the route (validation) and the
// context builder (construction), so the two cannot drift.
//
// Security role: this schema is the first wall on a public,
// unauthenticated endpoint. A request that is not exactly
// { question, context } in this shape is rejected with 400
// before any LLM call — which also prevents the route being
// used as a free generic LLM proxy.
//
// Privacy role: the field set below IS the whitelist from the
// transparency notice ("dates, descriptions, and amounts").
// If you add a field here, update the notice in the chat UI.
// ============================================================

import { z } from "zod";

/** Money values are pre-formatted display strings ("-$1,234.56"), never raw
 *  numbers. The model quotes them verbatim; it cannot recompute what it never
 *  receives as a number. */
const money = z
  .string()
  .max(24)
  .regex(/^-?\$[\d,]+\.\d{2}$/, "must be a formatted dollar amount");

/** ISO date, yyyy-mm-dd. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Small non-negative integer counts. */
const count = z.number().int().min(0).max(100_000);

/** Engine reason strings — already plain English, length-capped. */
const reasons = z.array(z.string().max(200)).max(10);

export const DESCRIPTION_MAX = 120;
export const QUESTION_MAX = 500;
export const MAX_ITEMS = 120;

const contextItemSchema = z
  .object({
    source: z.enum(["bank", "ledger", "user-added"]),
    date: isoDate,
    /** Masked + sanitized by the context builder before it gets here. */
    description: z.string().max(DESCRIPTION_MAX),
    amount: money,
    bucket: z.enum([
      "missing-from-books",
      "missing-from-bank",
      "suggested-match",
      "duplicate-set-aside",
      "user-added",
    ]),
    reasons,
  })
  .strict();

const summarySchema = z
  .object({
    periodLabel: z.string().max(64),
    reconciled: z.boolean(),
    bankNetChange: money,
    ledgerNetChange: money,
    clearedSum: money,
    unexplainedDifference: money,
    counts: z
      .object({
        exactMatches: count,
        nearMatches: count,
        fuzzyMatches: count,
        compositeMatches: count,
        missingFromBooks: count,
        missingFromBank: count,
        userAdded: count,
        duplicatesSetAside: count,
      })
      .strict(),
  })
  .strict();

export const reconContextSchema = z
  .object({
    summary: summarySchema,
    /** Discrepancy items only — matched items travel as counts in the summary.
     *  The context builder caps this list; the schema enforces the cap. */
    items: z.array(contextItemSchema).max(MAX_ITEMS),
    /** How many discrepancy items were dropped by the size cap. Never hide a
     *  truncation: the model is told to acknowledge a shortened list. */
    omittedItemCount: count,
  })
  .strict();

export const copilotRequestSchema = z
  .object({
    question: z.string().min(1).max(QUESTION_MAX),
    context: reconContextSchema,
    /** Client-minted opaque id; used only as a secondary rate-limit key. */
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  })
  .strict();

export type ReconContext = z.infer<typeof reconContextSchema>;
export type ReconContextItem = z.infer<typeof contextItemSchema>;
export type CopilotRequest = z.infer<typeof copilotRequestSchema>;
