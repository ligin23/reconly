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

/** How confident the engine is in a pairing. */
export type MatchType = "exact" | "near";

/** Lifecycle state of a match — set by the engine, mutated by user decisions. */
export type MatchStatus = "suggested" | "accepted" | "rejected" | "manual";

/** A pairing of one bank txn and one ledger txn. */
export type Match = {
  id: string;
  bankTxnId: string;
  ledgerTxnId: string;
  type: MatchType;
  confidence: number;   // deterministic, 70–100; see engine.ts for formula
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
  missingFromBooks: Txn[]; // unmatched bank txns — on the statement, not in ledger
  missingFromBank: Txn[];  // unmatched ledger txns — in ledger, not yet on statement
  balanceProof: BalanceProof;
  reconciled: boolean;     // true ONLY when unexplainedDifference === 0
};

/** {ok, text} shape the existing review UI expects. Use enrichReasons() to convert. */
export type ReasonDetail = { ok: boolean; text: string };
