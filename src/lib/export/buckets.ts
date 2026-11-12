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
import { deriveVerdict, type Verdict } from "@/lib/recon/verdict";
import { classifyTransactions } from "@/lib/recon/classify";
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

  // One classification shared with the results screen and the copilot
  // (lib/recon/classify) — each transaction in exactly one place.
  const c = classifyTransactions(matches, compositeMatches, bankTxns, ledgerTxns);
  const acceptedPairs: ExportPair[] = c.acceptedPairs.map((p) => ({
    bankTxn: p.bankTxn, ledgerTxn: p.ledgerTxn, reasons: p.match.reasons,
  }));
  const reviewPairs: ExportPair[] = c.reviewPairs.map((p) => ({
    bankTxn: p.bankTxn, ledgerTxn: p.ledgerTxn, reasons: p.match.reasons,
  }));
  const ledgerById = new Map(ledgerTxns.map((t) => [t.id, t]));
  const resolve = (ids: string[]) =>
    ids.map((id) => ledgerById.get(id)).filter((t): t is Txn => Boolean(t));
  const acceptedComposites: ExportComposite[] = c.acceptedGroups.map((g) => ({
    bankTxn: g.bankTxn,
    ledgerTxns: g.ledgerTxns,
    ambiguous: false,
    combinations: null,
    reasons: g.composite.reasons,
  }));
  const reviewComposites: ExportComposite[] = c.reviewGroups.map((g) => ({
    bankTxn: g.bankTxn,
    ledgerTxns: g.ledgerTxns,
    ambiguous: g.composite.ambiguous,
    combinations: g.composite.ambiguous ? g.composite.allCombinations.map(resolve) : null,
    reasons: g.composite.reasons,
  }));
  const pendingCompositeCount = reviewComposites.length;

  // All unmatched bank txns
  const allMissingFromBooks = c.unmatchedBank;
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
  const allMissingFromBank = c.unmatchedLedger;
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
 * The verdict for a report — derived with the SAME function the results
 * screen uses, from the same inputs, so the two cannot disagree.
 */
export function reportVerdict(ctx: ExportContext, b: ExportBuckets): Verdict {
  return deriveVerdict({
    unexplainedDifference: ctx.unexplainedDifference,
    openItemCount: openItemCount(b),
    unresolvedDuplicateGroups: ctx.duplicates
      ? unresolvedGroupCount(ctx.duplicates.groups, ctx.duplicates.state)
      : 0,
    statements: ctx.review?.statements.counts,
  });
}

/**
 * The headline sentence both reports print.
 *
 * B31: "not reconciled" with a zero difference used to print "differ by
 * $0.00". Totals that agree while items are still open is its own state and
 * must say so — never claim a match, never print a $0.00 difference.
 */
export function verdictText(ctx: ExportContext, b: ExportBuckets): string {
  const verdict = reportVerdict(ctx, b);
  if (ctx.reconciled) {
    // Matching transactions is not the same as verified statement
    // balances: when the review carries statement evidence, say what it
    // shows right next to the all-clear.
    const base = "Your records match your bank for this period.";
    if (!ctx.review || verdict.statement === "verified") return base;
    return (
      base +
      (verdict.statement === "running-balance-only"
        ? " Statement balances: running balance consistent; stated opening and closing balances not independently verified."
        : verdict.statement === "partly-verified"
          ? " Statement balances: verified for some bank files only."
          : " Statement balances: Not verified.")
    );
  }
  if (ctx.unexplainedDifference === 0) {
    const n = openItemCount(b);
    // Transactions agree, but a data-quality review is outstanding: its
    // own state — not a discrepancy, and not an all-clear. Same rules as
    // the results screen (lib/recon/verdict).
    const dup = verdict.unresolvedDuplicateGroups;
    const files = verdict.statementFilesNeedingReview;
    const dupText = `${dup} possible duplicate group${dup === 1 ? " has" : "s have"} not been reviewed`;
    const fileText = `${files} bank file${files === 1 ? "'s own balances need" : "s' own balances need"} review`;
    if (n === 0 && dup > 0 && files > 0) {
      return `Transactions match — duplicate and statement review needed: ${dupText}, and ${fileText}.`;
    }
    if (n === 0 && files > 0) {
      return `Transactions match — statement review needed: ${fileText}.`;
    }
    if (n === 0 && dup > 0) {
      return `Totals agree — duplicate review needed: ${dupText}.`;
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
