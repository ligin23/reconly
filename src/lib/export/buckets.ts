// ============================================================
// Reconly — shared export derivations (PDF + Excel)
// Pure TypeScript. No React, no jsPDF, no SheetJS — so every figure and
// sentence the two exporters print can be unit-tested directly.
//
// Both exporters previously carried their own copy of this logic; a fix in
// one could silently miss the other. They now share this module.
// ============================================================

import type { Txn, Match, AnyCompositeMatch } from "@/lib/recon/types";
import type { UserAddedEntry } from "@/lib/sample-data";
import type { MonthReview } from "@/lib/review/months";
import type { StatementReview } from "@/lib/review/statements";
import {
  unresolvedGroupCount,
  type DuplicateGroup,
  type DuplicateState,
} from "@/lib/import/duplicates";

/** Month-by-month findings and statement balance checks for the report. */
export type ExportReview = { months: MonthReview; statements: StatementReview };

export type ExportContext = {
  accountName: string;
  periodStart: string; // ISO yyyy-mm-dd
  periodEnd: string;   // ISO yyyy-mm-dd
  openingBalance: number | null; // cents; null when not yet saved
  closingBalance: number | null; // cents; null when not yet saved
  /** The full verdict: false while possible duplicates are unreviewed. */
  reconciled: boolean;
  unexplainedDifference: number; // cents
  bankTxns: Txn[];
  ledgerTxns: Txn[];
  matches: Match[];
  compositeMatches: AnyCompositeMatch[];
  /** Bank txns the user added to the working copy — will be recorded in books. */
  userAddedEntries: UserAddedEntry[];
  /** Ledger txn IDs the user has acknowledged as outstanding (not yet cleared). */
  acknowledgedBankIds: string[];
  /**
   * Duplicate review for this import. Optional: absent for reconciliations
   * saved before duplicate detection existed. `bankTxns` / `ledgerTxns`
   * above are always the rows IN USE; `allBankTxns` / `allLedgerTxns` are
   * every imported row, including those set aside.
   */
  /**
   * Month review + statement verification. Optional: when absent the
   * report is produced exactly as before, without the summary sections.
   */
  review?: ExportReview;
  duplicates?: {
    allBankTxns: Txn[];
    allLedgerTxns: Txn[];
    groups: DuplicateGroup[];
    state: DuplicateState;
  };
};

/** A grouped (many-to-one) match: one bank transaction, several ledger entries. */
export type ExportComposite = {
  bankTxn: Txn;
  /** Confirmed parts (accepted / unambiguous), or every candidate (ambiguous). */
  ledgerTxns: Txn[];
  ambiguous: boolean;
  /** For an ambiguous suggestion: each selectable combination. */
  combinations: Txn[][] | null;
  reasons: string[];
};

export type ExportPair = { bankTxn: Txn; ledgerTxn: Txn; reasons: string[] };

export type ExportBuckets = {
  acceptedPairs: ExportPair[];
  reviewPairs: ExportPair[];
  missingFromBooks: Txn[];
  addedToReconciliation: UserAddedEntry[];
  missingFromBank: Txn[];
  acknowledgedBank: Txn[];
  /** Grouped matches the user confirmed. */
  acceptedComposites: ExportComposite[];
  /** Grouped matches still awaiting a decision. */
  reviewComposites: ExportComposite[];
  /** = reviewComposites.length (kept for existing callers). */
  pendingCompositeCount: number;
};

/** Derive the report buckets from match state + raw txn lists. */
export function deriveBuckets(ctx: ExportContext): ExportBuckets {
  const {
    matches, compositeMatches, bankTxns, ledgerTxns,
    userAddedEntries, acknowledgedBankIds,
  } = ctx;

  const acceptedBankIds = new Set<string>();
  const acceptedLedgerIds = new Set<string>();
  const suggestedBankIds = new Set<string>();
  const suggestedLedgerIds = new Set<string>();
  const acceptedPairs: ExportPair[] = [];
  const reviewPairs: ExportPair[] = [];

  for (const m of matches) {
    const bank = bankTxns.find((t) => t.id === m.bankTxnId);
    const ledger = ledgerTxns.find((t) => t.id === m.ledgerTxnId);
    if (!bank || !ledger) continue;

    if (m.status === "accepted" || m.status === "manual") {
      acceptedBankIds.add(m.bankTxnId);
      acceptedLedgerIds.add(m.ledgerTxnId);
      acceptedPairs.push({ bankTxn: bank, ledgerTxn: ledger, reasons: m.reasons });
    } else if (m.status === "suggested") {
      suggestedBankIds.add(m.bankTxnId);
      suggestedLedgerIds.add(m.ledgerTxnId);
      reviewPairs.push({ bankTxn: bank, ledgerTxn: ledger, reasons: m.reasons });
    }
    // rejected → falls through to unmatched
  }

  // Grouped (composite) matches. These used to be claimed here but never
  // LISTED anywhere in the reports — an accepted group vanished from
  // "Matched", and a pending one from the review section. They are now
  // carried through, each transaction in exactly one place.
  const bankById = new Map(bankTxns.map((t) => [t.id, t]));
  const ledgerById = new Map(ledgerTxns.map((t) => [t.id, t]));
  const resolve = (ids: string[]) =>
    ids.map((id) => ledgerById.get(id)).filter((t): t is Txn => Boolean(t));

  const acceptedComposites: ExportComposite[] = [];
  const reviewComposites: ExportComposite[] = [];
  for (const c of compositeMatches) {
    if (c.status !== "accepted") continue;
    const bank = bankById.get(c.bankTxnId);
    if (!bank) continue;
    // Defensive: never list a transaction as matched twice.
    if (acceptedBankIds.has(c.bankTxnId) || c.ledgerTxnIds.some((id) => acceptedLedgerIds.has(id))) {
      continue;
    }
    acceptedBankIds.add(c.bankTxnId);
    for (const id of c.ledgerTxnIds) acceptedLedgerIds.add(id);
    acceptedComposites.push({
      bankTxn: bank,
      ledgerTxns: resolve(c.ledgerTxnIds),
      ambiguous: false,
      combinations: null,
      reasons: c.reasons,
    });
  }
  for (const c of compositeMatches) {
    if (c.status !== "suggested") continue;
    const bank = bankById.get(c.bankTxnId);
    if (!bank || acceptedBankIds.has(c.bankTxnId)) continue;
    suggestedBankIds.add(c.bankTxnId);
    for (const id of c.ledgerTxnIds) suggestedLedgerIds.add(id);
    reviewComposites.push({
      bankTxn: bank,
      ledgerTxns: resolve(c.ledgerTxnIds),
      ambiguous: c.ambiguous,
      combinations: c.ambiguous ? c.allCombinations.map(resolve) : null,
      reasons: c.reasons,
    });
  }
  // rejected composites → both sides fall through to unmatched
  const pendingCompositeCount = reviewComposites.length;

  // All unmatched bank txns
  const allMissingFromBooks = bankTxns.filter(
    (t) => !acceptedBankIds.has(t.id) && !suggestedBankIds.has(t.id)
  );
  const unmatchedBankIds = new Set(allMissingFromBooks.map((t) => t.id));

  const addedTxnIds = new Set(userAddedEntries.map((e) => e.txnId));
  const missingFromBooks = allMissingFromBooks.filter((t) => !addedTxnIds.has(t.id));

  // B18: an entry the user added only belongs in "Added — to be recorded in
  // your books" while its bank transaction is still unmatched. If that
  // transaction is now matched (or awaiting review as a suggestion) it is
  // already listed there; listing it again would tell the reader to record
  // it twice. Also guards against the same transaction being added twice.
  const seenAdded = new Set<string>();
  const addedToReconciliation = userAddedEntries.filter((e) => {
    if (!unmatchedBankIds.has(e.txnId) || seenAdded.has(e.txnId)) return false;
    seenAdded.add(e.txnId);
    return true;
  });

  // All unmatched ledger txns
  const allMissingFromBank = ledgerTxns.filter(
    (t) => !acceptedLedgerIds.has(t.id) && !suggestedLedgerIds.has(t.id)
  );
  const acknowledgedSet = new Set(acknowledgedBankIds);
  const missingFromBank = allMissingFromBank.filter((t) => !acknowledgedSet.has(t.id));
  const acknowledgedBank = allMissingFromBank.filter((t) => acknowledgedSet.has(t.id));

  return {
    acceptedPairs,
    reviewPairs,
    missingFromBooks,
    addedToReconciliation,
    missingFromBank,
    acknowledgedBank,
    acceptedComposites,
    reviewComposites,
    pendingCompositeCount,
  };
}

function plainDollars(cents: number): string {
  return (
    "$" +
    (Math.abs(cents) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** Items still open: unmatched on either side plus undecided suggestions. */
export function openItemCount(b: ExportBuckets): number {
  return (
    b.missingFromBooks.length +
    b.missingFromBank.length +
    b.reviewPairs.length +
    b.pendingCompositeCount
  );
}

/**
 * The headline sentence both reports print.
 *
 * B31: "not reconciled" with a zero difference used to print "differ by
 * $0.00". Totals that agree while items are still open is its own state and
 * must say so — never claim a match, never print a $0.00 difference.
 */
export function verdictText(ctx: ExportContext, b: ExportBuckets): string {
  if (ctx.reconciled) return "Your records match your bank for this period.";
  if (ctx.unexplainedDifference === 0) {
    const n = openItemCount(b);
    // Financially clean, but possible duplicates haven't been ruled on:
    // its own state — not a discrepancy, and not an all-clear.
    const dup = ctx.duplicates ? unresolvedGroupCount(ctx.duplicates.groups, ctx.duplicates.state) : 0;
    if (n === 0 && dup > 0) {
      return `Totals agree — duplicate review needed: ${dup} possible duplicate group${dup === 1 ? " has" : "s have"} not been reviewed.`;
    }
    return n > 0
      ? `Your totals agree, but ${n} item${n === 1 ? " still needs" : "s still need"} attention — this period is not fully reconciled.`
      : "Your totals agree, but this period has not been confirmed as fully reconciled.";
  }
  return `Your records and your bank differ by ${plainDollars(ctx.unexplainedDifference)} for this period.`;
}

/**
 * Heading for the Excel "Needs your attention" section (B31): the count is
 * open items only, and items the user already handled — which are listed in
 * the same section — are called out separately instead of being left out of
 * the arithmetic.
 */
export function attentionHeading(b: ExportBuckets): string {
  const open = openItemCount(b);
  const handled = b.addedToReconciliation.length + b.acknowledgedBank.length;
  const base = `Needs your attention  (${open} open item${open === 1 ? "" : "s"}`;
  return handled > 0 ? `${base} · ${handled} already handled)` : `${base})`;
}

/**
 * Today's date as ISO yyyy-mm-dd in the user's LOCAL timezone (B32).
 * `new Date().toISOString()` is UTC — in the evening west of UTC that is
 * already tomorrow, so reports were stamped with the wrong day.
 */
export function localIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Download filename (B34). Unicode-aware so non-ASCII account names keep
 * their letters instead of collapsing to "reconly--…" (which made different
 * accounts collide on one filename). Characters that are unsafe in filenames
 * are replaced; an empty result falls back to "account".
 */
export function exportFileName(
  accountName: string,
  periodStart: string,
  periodEnd: string,
  ext: "pdf" | "xlsx"
): string {
  const safe =
    accountName
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "account";
  return `reconly-${safe}-${periodStart}_${periodEnd}.${ext}`;
}
