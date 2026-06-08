// ============================================================
// Reconly reconciliation engine
// Pure TypeScript. No React. No framework. No AI. No randomness.
// Independently unit-testable.
// ============================================================

import { normalize } from "./normalize";
import { descriptionSimilarity } from "./similarity";
import type {
  Txn,
  Match,
  MatchType,
  ReconResult,
  BalanceProof,
  ReasonDetail,
} from "./types";

// ---- Constants -------------------------------------------------------

/** Maximum date gap (inclusive) for a near match, in days. */
export const DATE_WINDOW = 5;

/**
 * Minimum description similarity score (0–1) for a near match to be proposed.
 * Below this the engine won't suggest a pairing even if amounts/dates match.
 */
export const NEAR_DESC_THRESHOLD = 0.15;

// ---- Internal helpers ------------------------------------------------

function dateDiffDays(isoA: string, isoB: string): number {
  const msPerDay = 86_400_000;
  return Math.round(
    Math.abs(new Date(isoA).getTime() - new Date(isoB).getTime()) / msPerDay
  );
}

function formatCents(cents: number): string {
  const abs = Math.abs(cents) / 100;
  return (
    "$" +
    abs.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/**
 * Confidence score for a near match.
 * Formula: 70 + round(dateScore × 15 + descScore × 14), clamped [70, 99].
 *   dateScore = (DATE_WINDOW − dateDiff) / DATE_WINDOW  →  0–1
 *   descScore = similarity result                        →  0–1
 * Maximum possible: 70 + 15 + 14 = 99 ✓
 * Exact matches always return 100 (separate code path).
 */
function computeNearConfidence(dateDiff: number, descSim: number): number {
  const dateScore = (DATE_WINDOW - dateDiff) / DATE_WINDOW;
  const raw = 70 + Math.round(dateScore * 15 + descSim * 14);
  return Math.max(70, Math.min(99, raw));
}

/**
 * Build the reasons array from which checks fired.
 * These strings are the source of truth for the "Why?" panel in the UI.
 * They are not free text — each originates from a specific boolean check.
 */
function buildReasons(
  matchType: MatchType,
  dateDiff: number,
  descSim: number,
  amount: number
): string[] {
  const reasons: string[] = [];

  // --- Amount check (always present) ---
  reasons.push(`Amounts match exactly (${formatCents(amount)})`);

  if (matchType === "exact") {
    reasons.push("Same date");
    reasons.push("Descriptions match");
    return reasons;
  }

  // --- Date check ---
  if (dateDiff === 0) {
    reasons.push("Same day");
  } else {
    reasons.push(
      `Dates differ by ${dateDiff} day${dateDiff === 1 ? "" : "s"}`
    );
  }

  // --- Description check ---
  if (descSim >= 0.5) {
    reasons.push("Names look like the same company");
  } else if (descSim >= 0.25) {
    reasons.push("Names look similar");
  } else {
    reasons.push("Wording is quite different");
  }

  return reasons;
}

// ---- Public API -------------------------------------------------------

/**
 * Convert a flat reasons string[] into {ok, text}[] for the review UI.
 *
 * Rules: a reason is "ok" (green check) when it describes something that
 * supports the match; "not ok" (yellow minus) when it highlights a difference.
 * This is the seam that Phase 3 uses to wire engine output to the existing UI.
 */
export function enrichReasons(reasons: string[]): ReasonDetail[] {
  const negativePatterns = [
    /^dates differ/i,
    /^wording is quite different/i,
    /^names don.t/i,
    /^amount is off/i,
    /^hard to tell/i,
    /^might be/i,
    /^logged twice/i,
  ];
  return reasons.map((text) => ({
    ok: !negativePatterns.some((re) => re.test(text)),
    text,
  }));
}

/**
 * Run the reconciliation engine.
 *
 * Matching rules:
 *   Exact  — same amount AND same date AND normalized descriptions equal
 *            → confidence 100, status "accepted"
 *   Near   — same amount AND date within ±DATE_WINDOW days AND description
 *            similarity ≥ NEAR_DESC_THRESHOLD
 *            → confidence deterministic [70–99], status "suggested"
 *
 * Assignment is one-to-one, resolved greedily highest-confidence-first.
 * Balance proof: unexplainedDifference = bankNetChange − ledgerNetChange.
 *   A high match % with a nonzero unexplainedDifference is NOT reconciled.
 */
export function reconcile(
  bankTxns: Txn[],
  ledgerTxns: Txn[]
): ReconResult {
  // ---- 1. Generate candidate pairs ---------------------------------
  type Candidate = {
    bankId: string;
    ledgerId: string;
    matchType: MatchType;
    confidence: number;
    reasons: string[];
  };

  const candidates: Candidate[] = [];

  for (const bank of bankTxns) {
    for (const ledger of ledgerTxns) {
      // Amounts must match to the cent (signed)
      if (bank.amount !== ledger.amount) continue;

      const dateDiff = dateDiffDays(bank.date, ledger.date);
      const normBank = normalize(bank.description);
      const normLedger = normalize(ledger.description);

      if (dateDiff === 0 && normBank === normLedger) {
        // Exact match
        candidates.push({
          bankId: bank.id,
          ledgerId: ledger.id,
          matchType: "exact",
          confidence: 100,
          reasons: buildReasons("exact", 0, 1, bank.amount),
        });
      } else if (dateDiff <= DATE_WINDOW) {
        const descSim = descriptionSimilarity(normBank, normLedger);
        if (descSim >= NEAR_DESC_THRESHOLD) {
          const confidence = computeNearConfidence(dateDiff, descSim);
          candidates.push({
            bankId: bank.id,
            ledgerId: ledger.id,
            matchType: "near",
            confidence,
            reasons: buildReasons("near", dateDiff, descSim, bank.amount),
          });
        }
      }
    }
  }

  // ---- 2. Greedy one-to-one assignment (highest confidence first) --
  candidates.sort((a, b) => b.confidence - a.confidence);

  const usedBankIds = new Set<string>();
  const usedLedgerIds = new Set<string>();
  const matches: Match[] = [];

  for (const c of candidates) {
    if (usedBankIds.has(c.bankId) || usedLedgerIds.has(c.ledgerId)) continue;
    usedBankIds.add(c.bankId);
    usedLedgerIds.add(c.ledgerId);
    matches.push({
      id: `${c.bankId}:${c.ledgerId}`,
      bankTxnId: c.bankId,
      ledgerTxnId: c.ledgerId,
      type: c.matchType,
      confidence: c.confidence,
      status: c.matchType === "exact" ? "accepted" : "suggested",
      reasons: c.reasons,
    });
  }

  // ---- 3. Categorize unmatched txns --------------------------------
  const missingFromBooks = bankTxns.filter((t) => !usedBankIds.has(t.id));
  const missingFromBank = ledgerTxns.filter((t) => !usedLedgerIds.has(t.id));

  // ---- 4. Balance proof -------------------------------------------
  // unexplainedDifference = bankNetChange − ledgerNetChange
  // If the bank has an extra fee not in the ledger:
  //   bankNetChange is lower (more negative) than ledgerNetChange
  //   → difference is non-zero → NOT reconciled
  // A high match percentage alone does NOT make this zero.
  const bankNetChange = bankTxns.reduce((s, t) => s + t.amount, 0);
  const ledgerNetChange = ledgerTxns.reduce((s, t) => s + t.amount, 0);
  const clearedSum = matches
    .filter((m) => m.status === "accepted")
    .reduce((s, m) => {
      const t = bankTxns.find((b) => b.id === m.bankTxnId);
      return s + (t?.amount ?? 0);
    }, 0);
  const unexplainedDifference = bankNetChange - ledgerNetChange;

  const balanceProof: BalanceProof = {
    bankNetChange,
    ledgerNetChange,
    clearedSum,
    unexplainedDifference,
  };

  return {
    matches,
    missingFromBooks,
    missingFromBank,
    balanceProof,
    reconciled: unexplainedDifference === 0,
  };
}
