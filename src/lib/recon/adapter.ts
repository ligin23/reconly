// ============================================================
// Engine → UI adapter
// Converts ReconResult + Txn[] into the display shapes the
// existing React components expect (ReviewItem, SimpleTxn, etc.)
// No React imports. Pure conversion functions.
// ============================================================

import { enrichReasons } from "./engine";
import type { Match, Txn, BalanceProof } from "./types";
import type {
  ReviewItem,
  SimpleTxn,
  MissingTxn,
  Counts,
  TxnType,
} from "@/lib/sample-data";

// ---- Date formatting ------------------------------------------------

/**
 * Convert an ISO yyyy-mm-dd date to the short display format the UI uses.
 * Uses local-timezone construction (not UTC) so the date doesn't shift.
 * "2026-03-24" → "Mar 24"
 */
export function formatDisplayDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const d = new Date(year, month - 1, day); // local midnight, no TZ shift
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---- Amount helpers -------------------------------------------------

/** Signed cents → absolute cents + TxnType for display components. */
function signedToDisplay(cents: number): { amount: number; type: TxnType } {
  return { amount: Math.abs(cents), type: cents >= 0 ? "in" : "out" };
}

// ---- Txn conversions -----------------------------------------------

/** Engine Txn → SimpleTxn (display shape used in the matched list). */
export function toSimpleTxn(txn: Txn): SimpleTxn {
  const { amount, type } = signedToDisplay(txn.amount);
  return {
    date: formatDisplayDate(txn.date),
    desc: txn.description,
    who: txn.description,
    amount,
    type,
  };
}

/** Engine Txn → MissingTxn (SimpleTxn + hint for the missing-from-* lists). */
export function toMissingTxn(txn: Txn, source: "bank" | "ledger"): MissingTxn {
  const base = toSimpleTxn(txn);
  const hint =
    source === "bank"
      ? "This is on your bank statement but has no matching entry in your books yet."
      : "This is in your books but your bank hasn't processed it yet — usually just a matter of time.";
  return { ...base, hint };
}

// ---- Match conversion -----------------------------------------------

/**
 * Convert an engine Match + its Txn sources to a ReviewItem.
 * Only call for matches with status "suggested" (the review queue).
 */
export function toReviewItem(
  match: Match,
  bankTxns: Txn[],
  ledgerTxns: Txn[]
): ReviewItem {
  const bankTxn = bankTxns.find((t) => t.id === match.bankTxnId)!;
  const ledgerTxn = ledgerTxns.find((t) => t.id === match.ledgerTxnId)!;
  const { amount, type } = signedToDisplay(bankTxn.amount);
  return {
    id: match.id,
    confidence: match.confidence,
    amount,
    type,
    bank: {
      date: formatDisplayDate(bankTxn.date),
      desc: bankTxn.description,
      sub: `Bank • ${formatDisplayDate(bankTxn.date)}`,
    },
    books: {
      date: formatDisplayDate(ledgerTxn.date),
      desc: ledgerTxn.description,
      sub: `Logged ${formatDisplayDate(ledgerTxn.date)}`,
    },
    reasons: enrichReasons(match.reasons),
  };
}

// ---- Dashboard display helpers -------------------------------------

const MATCHED_DISPLAY_LIMIT = 12;

/**
 * Build the full set of display-layer values the dashboard needs, given
 * the current (possibly mutated) match list and the original engine output.
 */
export function buildDashboardData(
  matches: Match[],
  bankTxns: Txn[],
  ledgerTxns: Txn[],
  baseMissingFromBooks: Txn[],
  baseMissingFromBank: Txn[]
): {
  counts: Counts;
  matched: SimpleTxn[];
  matchedExtraCount: number;
  reviewItems: ReviewItem[];
  missingFromBooks: MissingTxn[];
  missingFromBank: MissingTxn[];
} {
  const accepted = matches.filter(
    (m) => m.status === "accepted" || m.status === "manual"
  );
  const suggested = matches.filter((m) => m.status === "suggested");
  const rejected = matches.filter((m) => m.status === "rejected");

  // Rejected matches: both sides become unmatched
  const rejectedBankIds = new Set(rejected.map((m) => m.bankTxnId));
  const rejectedLedgerIds = new Set(rejected.map((m) => m.ledgerTxnId));

  const missingFromBooks: MissingTxn[] = [
    ...baseMissingFromBooks.map((t) => toMissingTxn(t, "bank")),
    ...bankTxns
      .filter((t) => rejectedBankIds.has(t.id))
      .map((t) => toMissingTxn(t, "bank")),
  ];

  const missingFromBank: MissingTxn[] = [
    ...baseMissingFromBank.map((t) => toMissingTxn(t, "ledger")),
    ...ledgerTxns
      .filter((t) => rejectedLedgerIds.has(t.id))
      .map((t) => toMissingTxn(t, "ledger")),
  ];

  const counts: Counts = {
    matched: accepted.length,
    review: suggested.length,
    missingFromBooks: missingFromBooks.length,
    missingFromBank: missingFromBank.length,
  };

  const matched = accepted
    .slice(0, MATCHED_DISPLAY_LIMIT)
    .map((m) => toSimpleTxn(bankTxns.find((t) => t.id === m.bankTxnId)!));

  const matchedExtraCount = Math.max(0, accepted.length - MATCHED_DISPLAY_LIMIT);

  const reviewItems = suggested.map((m) =>
    toReviewItem(m, bankTxns, ledgerTxns)
  );

  return {
    counts,
    matched,
    matchedExtraCount,
    reviewItems,
    missingFromBooks,
    missingFromBank,
  };
}

// ---- Balance proof display ------------------------------------------

/**
 * Format cents as a signed dollar string for the Breakdown panel.
 * The bank and ledger net-change values are signed, but we want to show
 * them as plain dollar amounts (the sign just tells you net in vs out
 * for the period, which is shown as context, not as positive/negative).
 */
export function formatBreakdownAmount(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const s = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (cents < 0 ? "−$" : "$") + s;
}

/** Pull the unexplained amount (positive cents) from a BalanceProof for display. */
export function unexplainedCents(proof: BalanceProof): number {
  return Math.abs(proof.unexplainedDifference);
}
