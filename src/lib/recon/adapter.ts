// ============================================================
// Engine → UI adapter
// Converts ReconResult + Txn[] into the display shapes the
// existing React components expect (ReviewItem, SimpleTxn, etc.)
// No React imports. Pure conversion functions.
// ============================================================

import { enrichReasons } from "./engine";
import type { Match, Txn, BalanceProof, AnyCompositeMatch } from "./types";
import type {
  ReviewItem,
  CompositeReviewItem,
  CompositeComponent,
  AnyReviewItem,
  SimpleTxn,
  MissingTxn,
  UserAddedEntry,
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

/** Engine Txn → MissingTxn (SimpleTxn + txnId + hint for the missing-from-* lists). */
export function toMissingTxn(txn: Txn, source: "bank" | "ledger"): MissingTxn {
  const base = toSimpleTxn(txn);
  const hint =
    source === "bank"
      ? "This transaction is on your bank statement but doesn't have a matching entry in your records yet."
      : "This is in your records but your bank hasn't processed it yet — usually just a matter of timing.";
  return { ...base, txnId: txn.id, hint };
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
    matchType: match.type === "fuzzy" ? "fuzzy" : "near",
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

// ---- Composite match conversion ------------------------------------

/** Engine Txn → CompositeComponent (display shape for ledger items in a group). */
function toCompositeComponent(txn: Txn): CompositeComponent {
  const { amount, type } = signedToDisplay(txn.amount);
  return {
    id: txn.id,
    date: formatDisplayDate(txn.date),
    desc: txn.description,
    amount,
    type,
  };
}

/**
 * Convert an engine AnyCompositeMatch to the CompositeReviewItem shape the
 * review UI expects.
 */
export function toCompositeReviewItem(
  composite: AnyCompositeMatch,
  bankTxns: Txn[],
  ledgerTxns: Txn[]
): CompositeReviewItem {
  const bankTxn = bankTxns.find((t) => t.id === composite.bankTxnId)!;
  const { amount: bankAmount, type: bankTxnType } = signedToDisplay(bankTxn.amount);

  const resolveComponent = (id: string): CompositeComponent | null => {
    const t = ledgerTxns.find((l) => l.id === id);
    return t ? toCompositeComponent(t) : null;
  };

  const components = composite.ledgerTxnIds
    .map(resolveComponent)
    .filter((c): c is CompositeComponent => c !== null);

  const allCombinations = composite.ambiguous
    ? composite.allCombinations.map((combo) =>
        combo
          .map(resolveComponent)
          .filter((c): c is CompositeComponent => c !== null)
      )
    : null;

  return {
    id: composite.id,
    matchType: "composite",
    bankDate: formatDisplayDate(bankTxn.date),
    bankDesc: bankTxn.description,
    bankAmount,
    bankTxnType,
    components,
    reasons: enrichReasons(composite.reasons),
    ambiguous: composite.ambiguous,
    allCombinations,
  };
}

// ---- Dashboard display helpers -------------------------------------

const MATCHED_DISPLAY_LIMIT = 12;

/**
 * Build the full set of display-layer values the dashboard needs, given
 * the current (possibly mutated) match lists and the original engine output.
 */
export function buildDashboardData(
  matches: Match[],
  compositeMatches: AnyCompositeMatch[],
  bankTxns: Txn[],
  ledgerTxns: Txn[],
  baseMissingFromBooks: Txn[],
  baseMissingFromBank: Txn[],
  addedTxnIds: ReadonlySet<string> = new Set(),
  acknowledgedBankIds: ReadonlySet<string> = new Set()
): {
  counts: Counts;
  matched: SimpleTxn[];
  matchedExtraCount: number;
  reviewItems: AnyReviewItem[];
  missingFromBooks: MissingTxn[];
  addedToReconciliation: MissingTxn[];
  missingFromBank: MissingTxn[];
  acknowledgedBank: MissingTxn[];
} {
  const accepted = matches.filter(
    (m) => m.status === "accepted" || m.status === "manual"
  );
  const suggested = matches.filter((m) => m.status === "suggested");
  const rejected = matches.filter((m) => m.status === "rejected");

  // Composite match buckets
  const acceptedComposites = compositeMatches.filter(
    (c) => c.status === "accepted"
  );
  const suggestedComposites = compositeMatches.filter(
    (c) => c.status === "suggested"
  );
  const rejectedComposites = compositeMatches.filter(
    (c) => c.status === "rejected"
  );

  // Rejected one-to-one: both sides become unmatched
  const rejectedBankIds = new Set(rejected.map((m) => m.bankTxnId));
  const rejectedLedgerIds = new Set(rejected.map((m) => m.ledgerTxnId));

  // All missing-from-books candidates (engine base + rejected matches/composites)
  const allMissingFromBooks: MissingTxn[] = [
    ...baseMissingFromBooks.map((t) => toMissingTxn(t, "bank")),
    ...bankTxns
      .filter((t) => rejectedBankIds.has(t.id))
      .map((t) => toMissingTxn(t, "bank")),
    ...rejectedComposites.flatMap((c) => {
      const t = bankTxns.find((b) => b.id === c.bankTxnId);
      return t ? [toMissingTxn(t, "bank")] : [];
    }),
  ];

  // Split by whether the user has added them to the reconciliation
  const missingFromBooks = allMissingFromBooks.filter(
    (t) => !addedTxnIds.has(t.txnId)
  );
  const addedToReconciliation = allMissingFromBooks.filter((t) =>
    addedTxnIds.has(t.txnId)
  );

  // All missing-from-bank candidates
  const allMissingFromBank: MissingTxn[] = [
    ...baseMissingFromBank.map((t) => toMissingTxn(t, "ledger")),
    ...ledgerTxns
      .filter((t) => rejectedLedgerIds.has(t.id))
      .map((t) => toMissingTxn(t, "ledger")),
    ...rejectedComposites.flatMap((c) =>
      c.ledgerTxnIds.flatMap((id) => {
        const t = ledgerTxns.find((l) => l.id === id);
        return t ? [toMissingTxn(t, "ledger")] : [];
      })
    ),
  ];

  // Split by whether the user has acknowledged them
  const missingFromBank = allMissingFromBank.filter(
    (t) => !acknowledgedBankIds.has(t.txnId)
  );
  const acknowledgedBank = allMissingFromBank.filter((t) =>
    acknowledgedBankIds.has(t.txnId)
  );

  const counts: Counts = {
    matched: accepted.length + acceptedComposites.length,
    review: suggested.length + suggestedComposites.length,
    // counts reflect only unresolved items
    missingFromBooks: missingFromBooks.length,
    missingFromBank: missingFromBank.length,
  };

  // Accepted one-to-one matches for the matched display list
  const allAccepted = [
    ...accepted.map((m) => bankTxns.find((t) => t.id === m.bankTxnId)!),
    // Accepted composites: show the bank ("one-side") txn
    ...acceptedComposites.map((c) => bankTxns.find((t) => t.id === c.bankTxnId)!),
  ].filter(Boolean);

  const matched = allAccepted
    .slice(0, MATCHED_DISPLAY_LIMIT)
    .map((t) => toSimpleTxn(t));

  const matchedExtraCount = Math.max(0, allAccepted.length - MATCHED_DISPLAY_LIMIT);

  // One-to-one near matches first, then composite matches (composites are more
  // complex and benefit from appearing after the simpler pairings).
  const reviewItems: AnyReviewItem[] = [
    ...suggested.map((m) => toReviewItem(m, bankTxns, ledgerTxns)),
    ...suggestedComposites.map((c) =>
      toCompositeReviewItem(c, bankTxns, ledgerTxns)
    ),
  ];

  return {
    counts,
    matched,
    matchedExtraCount,
    reviewItems,
    missingFromBooks,
    addedToReconciliation,
    missingFromBank,
    acknowledgedBank,
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
