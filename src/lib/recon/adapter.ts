// ============================================================
// Engine → UI adapter
// Converts ReconResult + Txn[] into the display shapes the
// existing React components expect (ReviewItem, SimpleTxn, etc.)
// No React imports. Pure conversion functions.
// ============================================================

import { enrichReasons } from "./engine";
import { sourceLabel } from "@/lib/import/provenance";
import type { Match, Txn, BalanceProof, AnyCompositeMatch } from "./types";
import { classifyTransactions } from "./classify";
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
      ? "This transaction is on your bank statement and has no confirmed match in your records."
      : "This entry is in your records and has no confirmed bank match.";
  const from = sourceLabel(txn);
  return { ...base, txnId: txn.id, hint, ...(from ? { source: from } : {}) };
}

/** `{ source }` when the transaction knows its file / row, else nothing. */
function withSource(txn: Txn): { source?: string } {
  const from = sourceLabel(txn);
  return from ? { source: from } : {};
}

/** One line saying where both sides of a match came from. */
function matchDetail(bank: Txn, ledger: Txn[]): string | undefined {
  const b = sourceLabel(bank);
  const l = ledger.map((t) => sourceLabel(t)).filter((x): x is string => Boolean(x));
  if (!b && l.length === 0) return undefined;
  const records =
    ledger.length > 1 ? `${ledger.length} entries (${l.join("; ")})` : l[0] ?? "source not recorded";
  return `Bank: ${b ?? "source not recorded"}  ↔  Records: ${records}`;
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
      ...withSource(bankTxn),
    },
    books: {
      date: formatDisplayDate(ledgerTxn.date),
      desc: ledgerTxn.description,
      sub: `Logged ${formatDisplayDate(ledgerTxn.date)}`,
      ...withSource(ledgerTxn),
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
    ...withSource(txn),
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
    ...(sourceLabel(bankTxn) ? { bankSource: sourceLabel(bankTxn)! } : {}),
    components,
    reasons: enrichReasons(composite.reasons),
    ambiguous: composite.ambiguous,
    allCombinations,
  };
}

// ---- Review decisions the user has made ------------------------------

/**
 * One suggestion the user has already answered — listed on the results
 * screen so a decision can be found again and taken back.
 */
export type DecidedItem = {
  /** Match id (one-to-one) or composite id — what "undo" acts on. */
  id: string;
  kind: "pair" | "group";
  decision: "accepted" | "rejected";
  bankDate: string;
  bankDesc: string;
  bankSource?: string;
  /** The records side: one description, or "3 entries: A; B; C". */
  booksDesc: string;
  booksDate: string;
  booksSource?: string;
  amount: number; // cents, positive
  type: TxnType;
  /** True when the bank row and a records row fall in different months. */
  crossMonth: boolean;
};

function toDecidedItems(
  matches: Match[],
  composites: AnyCompositeMatch[],
  bankTxns: Txn[],
  ledgerTxns: Txn[]
): DecidedItem[] {
  const bankById = new Map(bankTxns.map((t) => [t.id, t]));
  const ledgerById = new Map(ledgerTxns.map((t) => [t.id, t]));
  const month = (iso: string) => iso.slice(0, 7);
  const out: DecidedItem[] = [];
  for (const m of matches) {
    // Exact matches were confirmed by the engine, not decided by the user.
    if (m.type === "exact" || m.status === "suggested") continue;
    const bank = bankById.get(m.bankTxnId);
    const ledger = ledgerById.get(m.ledgerTxnId);
    if (!bank || !ledger) continue;
    const { amount, type } = signedToDisplay(bank.amount);
    out.push({
      id: m.id,
      kind: "pair",
      decision: m.status === "rejected" ? "rejected" : "accepted",
      bankDate: formatDisplayDate(bank.date),
      bankDesc: bank.description,
      ...(sourceLabel(bank) ? { bankSource: sourceLabel(bank)! } : {}),
      booksDesc: ledger.description,
      booksDate: formatDisplayDate(ledger.date),
      ...(sourceLabel(ledger) ? { booksSource: sourceLabel(ledger)! } : {}),
      amount,
      type,
      crossMonth: month(bank.date) !== month(ledger.date),
    });
  }
  for (const c of composites) {
    if (c.status === "suggested") continue;
    const bank = bankById.get(c.bankTxnId);
    if (!bank) continue;
    const parts = c.ledgerTxnIds.map((id) => ledgerById.get(id)).filter((t): t is Txn => Boolean(t));
    const { amount, type } = signedToDisplay(bank.amount);
    out.push({
      id: c.id,
      kind: "group",
      decision: c.status === "rejected" ? "rejected" : "accepted",
      bankDate: formatDisplayDate(bank.date),
      bankDesc: bank.description,
      ...(sourceLabel(bank) ? { bankSource: sourceLabel(bank)! } : {}),
      booksDesc: `${parts.length} entries: ${parts.map((p) => p.description).join("; ")}`,
      booksDate: parts.length > 0 ? formatDisplayDate(parts[0].date) : "",
      amount,
      type,
      crossMonth: parts.some((p) => month(p.date) !== month(bank.date)),
    });
  }
  return out;
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
  // Kept for callers; no longer read — unmatched rows are classified from
  // the full row lists (see classifyTransactions).
  _baseMissingFromBooks: Txn[],
  _baseMissingFromBank: Txn[],
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
  /** Suggestions the user has answered (accepted or rejected). */
  decided: DecidedItem[];
} {
  const accepted = matches.filter(
    (m) => m.status === "accepted" || m.status === "manual"
  );
  const suggested = matches.filter((m) => m.status === "suggested");

  // Composite match buckets
  const acceptedComposites = compositeMatches.filter(
    (c) => c.status === "accepted"
  );
  const suggestedComposites = compositeMatches.filter(
    (c) => c.status === "suggested"
  );

  // RECON-009: unmatched rows come from the shared classification
  // (lib/recon/classify), the same one both exports use — NOT from the
  // engine's base lists plus rejected rows. The base lists leave out every
  // row the engine offered in a suggestion, so accepting one option of an
  // ambiguous group made the unpicked option's rows vanish from this screen
  // (the exports still listed them).
  const classified = classifyTransactions(matches, compositeMatches, bankTxns, ledgerTxns);
  const allMissingFromBooks: MissingTxn[] = classified.unmatchedBank.map((t) => toMissingTxn(t, "bank"));

  // Split by whether the user has added them to the reconciliation
  const missingFromBooks = allMissingFromBooks.filter(
    (t) => !addedTxnIds.has(t.txnId)
  );
  const addedToReconciliation = allMissingFromBooks.filter((t) =>
    addedTxnIds.has(t.txnId)
  );

  const allMissingFromBank: MissingTxn[] = classified.unmatchedLedger.map((t) => toMissingTxn(t, "ledger"));

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

  // Accepted matches for the matched display list: the bank txn, plus a
  // line saying which file / row each side came from.
  const ledgerOf = (ids: string[]) =>
    ids.map((id) => ledgerTxns.find((t) => t.id === id)).filter((t): t is Txn => Boolean(t));
  const allAccepted = [
    ...accepted.map((m) => ({
      bank: bankTxns.find((t) => t.id === m.bankTxnId)!,
      ledger: ledgerOf([m.ledgerTxnId]),
    })),
    // Accepted composites: show the bank ("one-side") txn
    ...acceptedComposites.map((c) => ({
      bank: bankTxns.find((t) => t.id === c.bankTxnId)!,
      ledger: ledgerOf(c.ledgerTxnIds),
    })),
  ].filter((x) => Boolean(x.bank));

  const matched = allAccepted.slice(0, MATCHED_DISPLAY_LIMIT).map(({ bank, ledger }) => {
    const detail = matchDetail(bank, ledger);
    return { ...toSimpleTxn(bank), ...(detail ? { detail } : {}) };
  });

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
    decided: toDecidedItems(matches, compositeMatches, bankTxns, ledgerTxns),
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
