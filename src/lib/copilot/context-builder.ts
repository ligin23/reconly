// ============================================================
// Copilot context builder — runs CLIENT-SIDE.
//
// Builds the compact grounding payload from the current
// reconciliation's actual state. This file decides exactly
// what leaves the browser when the user asks a question, so:
//
//   - FIELD WHITELIST: only date, masked description, amount,
//     bucket, reasons, source. No account identifiers, no file
//     names, no user/device identifiers, no raw CSV rows.
//   - MASKING: digit runs of 8+ (account/card numbers) reduce
//     to last-4 form; control chars stripped; lengths capped.
//   - MONEY AS STRINGS: amounts are pre-formatted dollars, so
//     the model can quote but never recompute them.
//   - SIZE CAP: summary + discrepancy items in full (priority
//     order), matched items as counts; drops are counted in
//     omittedItemCount, never silent.
//
// If the whitelist here changes, the transparency notice in
// the chat UI must change with it — they are one claim.
// ============================================================

import type { Match, Txn, BalanceProof, AnyCompositeMatch } from "../recon/types";
import {
  type ReconContext,
  type ReconContextItem,
  DESCRIPTION_MAX,
  MAX_ITEMS,
} from "./schema";

// ---- Masking & sanitization -----------------------------------------

const REASON_MAX = 200;
const REASONS_PER_ITEM_MAX = 10;

/** Strip C0/C1 control characters (keep nothing — not even tabs/newlines;
 *  these are single-line description fields). */
function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, " ");
}

/**
 * Redact account/card numbers to last-4 form: "123456789012" → "****9012".
 * Two patterns:
 *   - contiguous runs of 8+ digits (account numbers, references)
 *   - card-style groups of 4-4-4-3/4 with one consistent separator
 *     ("4111-1111-1111-1234") — a shape a date can never take
 * Shorter runs (dates like 2026-03-12, store numbers, ZIP codes) pass
 * through: they're context, not identifiers.
 */
export function maskAccountNumbers(s: string): string {
  const last4 = (run: string) => "****" + run.replace(/\D/g, "").slice(-4);
  return s
    .replace(/\d{4}([ \-.])\d{4}\1\d{4}\1\d{3,4}/g, last4)
    .replace(/\d{8,}/g, last4);
}

/** Full sanitization pass for any free-text field leaving the browser. */
export function maskDescription(raw: string): string {
  const masked = maskAccountNumbers(stripControlChars(raw))
    .replace(/\s+/g, " ")
    .trim();
  return masked.length > DESCRIPTION_MAX
    ? masked.slice(0, DESCRIPTION_MAX - 1) + "…"
    : masked;
}

function maskReason(raw: string): string {
  const masked = maskAccountNumbers(stripControlChars(raw)).replace(/\s+/g, " ").trim();
  return masked.length > REASON_MAX ? masked.slice(0, REASON_MAX - 1) + "…" : masked;
}

function maskReasons(reasons: string[]): string[] {
  return reasons.slice(0, REASONS_PER_ITEM_MAX).map(maskReason);
}

// ---- Money formatting -------------------------------------------------

/** Signed cents → "-$1,234.56" (ASCII minus — must match the schema regex). */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const remainder = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}

// ---- Builder ----------------------------------------------------------

export type ReconContextInput = {
  matches: Match[];
  compositeMatches: AnyCompositeMatch[];
  bankTxns: Txn[];
  ledgerTxns: Txn[];
  /** Engine-base unmatched lists (before user decisions). */
  baseMissingFromBooks: Txn[];
  baseMissingFromBank: Txn[];
  /** Bank txn IDs the user added to the reconciliation as real entries. */
  userAddedEntries: Array<{ txnId: string; date: string; description: string; amount: number }>;
  /** Ledger txn IDs the user acknowledged as timing-only (resolved). */
  acknowledgedBankIds: string[];
  /** Live balance proof (reflects accepted matches and user-added items). */
  balanceProof: BalanceProof;
  reconciled: boolean;
  periodLabel: string;
};

/**
 * Build the grounding payload for /api/copilot from real reconciliation
 * state. Pure and deterministic; mirrors the bucket semantics of
 * buildDashboardData so the copilot sees what the user sees.
 */
export function buildReconContext(input: ReconContextInput): ReconContext {
  const {
    matches,
    compositeMatches,
    bankTxns,
    ledgerTxns,
    baseMissingFromBooks,
    baseMissingFromBank,
    userAddedEntries,
    acknowledgedBankIds,
    balanceProof,
    reconciled,
    periodLabel,
  } = input;

  const bankById = new Map(bankTxns.map((t) => [t.id, t]));
  const ledgerById = new Map(ledgerTxns.map((t) => [t.id, t]));
  const addedIds = new Set(userAddedEntries.map((e) => e.txnId));
  const acknowledgedIds = new Set(acknowledgedBankIds);

  // -- Counts (match tiers count everything not rejected) --
  const live = matches.filter((m) => m.status !== "rejected");
  const counts = {
    exactMatches: live.filter((m) => m.type === "exact").length,
    nearMatches: live.filter((m) => m.type === "near").length,
    fuzzyMatches: live.filter((m) => m.type === "fuzzy").length,
    compositeMatches: compositeMatches.filter((c) => c.status !== "rejected").length,
    missingFromBooks: 0, // filled below after bucket assembly
    missingFromBank: 0,
    userAdded: userAddedEntries.length,
    duplicatesSetAside: 0, // no set-aside-duplicates feature in the engine yet
  };

  // -- Suggested matches (highest priority: these are what users ask about) --
  const suggestedItems: ReconContextItem[] = [];

  for (const match of matches.filter((m) => m.status === "suggested")) {
    const bank = bankById.get(match.bankTxnId);
    const ledger = ledgerById.get(match.ledgerTxnId);
    if (!bank || !ledger) continue;
    suggestedItems.push({
      source: "bank",
      date: bank.date,
      description: maskDescription(bank.description),
      amount: formatMoney(bank.amount),
      bucket: "suggested-match",
      reasons: maskReasons([
        `Suggested pairing with your ledger entry "${maskDescription(ledger.description)}" (${ledger.date}, ${formatMoney(ledger.amount)}) — awaiting your confirmation`,
        ...match.reasons,
      ]),
    });
  }

  for (const composite of compositeMatches.filter((c) => c.status === "suggested")) {
    const bank = bankById.get(composite.bankTxnId);
    if (!bank) continue;
    const partCount = composite.ambiguous
      ? composite.allCombinations[0]?.length ?? composite.ledgerTxnIds.length
      : composite.ledgerTxnIds.length;
    suggestedItems.push({
      source: "bank",
      date: bank.date,
      description: maskDescription(bank.description),
      amount: formatMoney(bank.amount),
      bucket: "suggested-match",
      reasons: maskReasons([
        composite.ambiguous
          ? `Several different combinations of your ledger entries could add up to this bank charge — the user must pick one`
          : `${partCount} smaller entries in your records add up exactly to this one bank charge — awaiting your confirmation`,
        ...composite.reasons,
      ]),
    });
  }

  // -- Missing from books: engine base + both sides of rejected matches --
  const rejectedBankIds = new Set(
    matches.filter((m) => m.status === "rejected").map((m) => m.bankTxnId)
  );
  const rejectedLedgerIds = new Set(
    matches.filter((m) => m.status === "rejected").map((m) => m.ledgerTxnId)
  );
  const rejectedComposites = compositeMatches.filter((c) => c.status === "rejected");

  const missingBooksTxns: Txn[] = [
    ...baseMissingFromBooks,
    ...bankTxns.filter((t) => rejectedBankIds.has(t.id)),
    ...rejectedComposites.flatMap((c) => {
      const t = bankById.get(c.bankTxnId);
      return t ? [t] : [];
    }),
  ].filter((t) => !addedIds.has(t.id));

  const missingBooksItems: ReconContextItem[] = missingBooksTxns.map((t) => ({
    source: "bank",
    date: t.date,
    description: maskDescription(t.description),
    amount: formatMoney(t.amount),
    bucket: "missing-from-books",
    reasons: [
      "On the bank statement, but no matching entry was found in your records",
    ],
  }));

  // -- Missing from bank: engine base + rejected ledger sides, minus acknowledged --
  const missingBankTxns: Txn[] = [
    ...baseMissingFromBank,
    ...ledgerTxns.filter((t) => rejectedLedgerIds.has(t.id)),
    ...rejectedComposites.flatMap((c) =>
      c.ledgerTxnIds.flatMap((id) => {
        const t = ledgerById.get(id);
        return t ? [t] : [];
      })
    ),
  ].filter((t) => !acknowledgedIds.has(t.id));

  const missingBankItems: ReconContextItem[] = missingBankTxns.map((t) => ({
    source: "ledger",
    date: t.date,
    description: maskDescription(t.description),
    amount: formatMoney(t.amount),
    bucket: "missing-from-bank",
    reasons: [
      "In your records, but the bank hasn't processed it yet — often just timing",
    ],
  }));

  counts.missingFromBooks = missingBooksItems.length;
  counts.missingFromBank = missingBankItems.length;

  // -- User-added entries --
  const userAddedItems: ReconContextItem[] = userAddedEntries.map((e) => ({
    source: "user-added",
    date: e.date,
    description: maskDescription(e.description),
    amount: formatMoney(e.amount),
    bucket: "user-added",
    reasons: ["The user added this from the bank statement into the reconciliation"],
  }));

  // -- Size cap, in priority order; count what falls off the end --
  const allItems = [
    ...suggestedItems,
    ...missingBooksItems,
    ...missingBankItems,
    ...userAddedItems,
  ];
  const items = allItems.slice(0, MAX_ITEMS);
  const omittedItemCount = allItems.length - items.length;

  return {
    summary: {
      periodLabel: maskDescription(periodLabel).slice(0, 64),
      reconciled,
      bankNetChange: formatMoney(balanceProof.bankNetChange),
      ledgerNetChange: formatMoney(balanceProof.ledgerNetChange),
      clearedSum: formatMoney(balanceProof.clearedSum),
      unexplainedDifference: formatMoney(balanceProof.unexplainedDifference),
      counts,
    },
    items,
    omittedItemCount,
  };
}
