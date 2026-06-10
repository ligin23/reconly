// ============================================================
// Reconly reconciliation engine — core types
// No React imports. No framework dependencies. Pure TypeScript.
// ============================================================

/** A single transaction from the bank or the ledger. */
export type Txn = {
  id: string;
  source: "bank" | "ledger";
  date: string;        // ISO yyyy-mm-dd
  description: string;
  amount: number;      // signed cents: negative = money out, positive = money in
  reference?: string;
  raw: Record<string, string>; // original CSV row, keyed by column header
};

/** How confident the engine is in a pairing. Confidence bands never overlap:
 *  exact = 100, near = 70–99, composite = 85 (fixed), fuzzy = 50–69. */
export type MatchType = "exact" | "near" | "fuzzy" | "composite";

/** Lifecycle state of a match — set by the engine, mutated by user decisions. */
export type MatchStatus = "suggested" | "accepted" | "rejected" | "manual";

/** A pairing of one bank txn and one ledger txn. */
export type Match = {
  id: string;
  bankTxnId: string;
  ledgerTxnId: string;
  type: MatchType;
  confidence: number;   // deterministic, 50–100; see engine.ts for formulas
  status: MatchStatus;
  reasons: string[];    // plain-English; generated from which checks fired
                        // SEAM: could later be LLM-enriched without UI changes
};

/** Amounts that prove (or disprove) full reconciliation. */
export type BalanceProof = {
  bankNetChange: number;       // signed cents: sum of all bank txn amounts
  ledgerNetChange: number;     // signed cents: sum of all ledger txn amounts
  clearedSum: number;          // signed cents: sum of accepted-match bank amounts
  unexplainedDifference: number; // bankNetChange − ledgerNetChange; 0 = reconciled
};

/** Full output of one reconciliation run. */
export type ReconResult = {
  matches: Match[];
  /** Composite suggestions (many ledger → one bank). Always "suggested" initially;
   *  items claimed here are removed from missingFromBooks/missingFromBank. */
  compositeMatches: AnyCompositeMatch[];
  missingFromBooks: Txn[]; // unmatched bank txns — on the statement, not in ledger
  missingFromBank: Txn[];  // unmatched ledger txns — in ledger, not yet on statement
  balanceProof: BalanceProof;
  reconciled: boolean;     // true ONLY when unexplainedDifference === 0
};

/**
 * A composite match: 2–COMPOSITE_MAX_GROUP ledger items that sum exactly to
 * one bank transaction. Always "suggested" — never auto-accepted.
 *
 * Role note: bankTxnId is the "one" side (bank for ledger→bank direction).
 * For the reverse direction, bankTxnId holds the ledger ID and ledgerTxnIds
 * hold the bank IDs. The field names reflect the current (only) built direction.
 */
export type CompositeMatch = {
  id: string;             // "composite:<bankTxnId>"
  bankTxnId: string;      // the single "one-side" transaction
  ledgerTxnIds: string[]; // 2–COMPOSITE_MAX_GROUP "many-side" transactions
  type: "composite";
  confidence: number;
  status: MatchStatus;
  reasons: string[];
  ambiguous: false;
  allCombinations: null;
};

/**
 * A composite candidate where multiple valid combinations exist.
 * Must never be auto-selected — always requires the user to choose one
 * combination (or reject all).
 */
export type AmbiguousCompositeMatch = {
  id: string;
  bankTxnId: string;
  /** Union of all ledger IDs across every competing combination. */
  ledgerTxnIds: string[];
  type: "composite";
  confidence: number;
  status: "suggested";
  reasons: string[];
  ambiguous: true;
  /** All competing combinations. User picks exactly one; each inner array is a
   *  complete, self-consistent combination of ledger IDs. */
  allCombinations: string[][];
};

/** Discriminated union for use in function signatures and ReconResult. */
export type AnyCompositeMatch = CompositeMatch | AmbiguousCompositeMatch;

/** {ok, text} shape the existing review UI expects. Use enrichReasons() to convert. */
export type ReasonDetail = { ok: boolean; text: string };
