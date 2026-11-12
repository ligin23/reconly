// ============================================================
// Reconly — effective transaction classification
// Pure TypeScript. No React. Does NOT touch the matching engine.
//
// The ONE place that decides, from the user's current decisions, which
// included transaction is matched, which is awaiting review and which is
// unmatched. The results screen, both exports and the copilot all read
// this, so they cannot disagree (RECON-009).
//
// Every included transaction lands in exactly one of the three states:
//   matched          — part of an accepted pair or accepted group
//   awaiting review  — part of a still-suggested pair or group
//   unmatched        — everything else (rejected suggestions, rows the
//                      engine never paired, and the options of an
//                      ambiguous group the user did NOT pick)
//
// Unmatched is derived from the full row lists, never from the engine's
// "base missing" lists: those leave out every row the engine OFFERED in a
// suggestion, so a row in an ambiguous group's unpicked option would
// otherwise disappear from every list once the user accepts another option.
// ============================================================

import type { Match, Txn, AnyCompositeMatch } from "./types";

export type ClassifiedPair = { match: Match; bankTxn: Txn; ledgerTxn: Txn };
export type ClassifiedGroup = { composite: AnyCompositeMatch; bankTxn: Txn; ledgerTxns: Txn[] };

export type Classification = {
  acceptedPairs: ClassifiedPair[];
  acceptedGroups: ClassifiedGroup[];
  reviewPairs: ClassifiedPair[];
  /** Pending groups; for an ambiguous one `ledgerTxns` is every candidate. */
  reviewGroups: ClassifiedGroup[];
  matchedBankIds: ReadonlySet<string>;
  matchedLedgerIds: ReadonlySet<string>;
  pendingBankIds: ReadonlySet<string>;
  pendingLedgerIds: ReadonlySet<string>;
  /** Included bank rows neither matched nor awaiting review, in input order. */
  unmatchedBank: Txn[];
  /** Included ledger rows neither matched nor awaiting review, in input order. */
  unmatchedLedger: Txn[];
};

/**
 * Classify every included transaction from the current match decisions.
 * `bankTxns` / `ledgerTxns` are the rows IN USE (set-aside duplicates are
 * already excluded by the caller).
 */
export function classifyTransactions(
  matches: Match[],
  compositeMatches: AnyCompositeMatch[],
  bankTxns: Txn[],
  ledgerTxns: Txn[]
): Classification {
  const bankById = new Map(bankTxns.map((t) => [t.id, t]));
  const ledgerById = new Map(ledgerTxns.map((t) => [t.id, t]));
  const resolve = (ids: string[]) =>
    ids.map((id) => ledgerById.get(id)).filter((t): t is Txn => Boolean(t));

  const matchedBankIds = new Set<string>();
  const matchedLedgerIds = new Set<string>();
  const pendingBankIds = new Set<string>();
  const pendingLedgerIds = new Set<string>();
  const acceptedPairs: ClassifiedPair[] = [];
  const reviewPairs: ClassifiedPair[] = [];
  const acceptedGroups: ClassifiedGroup[] = [];
  const reviewGroups: ClassifiedGroup[] = [];

  for (const m of matches) {
    const bankTxn = bankById.get(m.bankTxnId);
    const ledgerTxn = ledgerById.get(m.ledgerTxnId);
    if (!bankTxn || !ledgerTxn) continue;
    if (m.status === "accepted" || m.status === "manual") {
      matchedBankIds.add(m.bankTxnId);
      matchedLedgerIds.add(m.ledgerTxnId);
      acceptedPairs.push({ match: m, bankTxn, ledgerTxn });
    } else if (m.status === "suggested") {
      pendingBankIds.add(m.bankTxnId);
      pendingLedgerIds.add(m.ledgerTxnId);
      reviewPairs.push({ match: m, bankTxn, ledgerTxn });
    }
    // rejected → both sides fall through to unmatched
  }

  // An accepted group consumes ONLY the ledger rows it lists. For an
  // accepted ambiguous group that is the picked option alone
  // (applyCompositeDecision narrows ledgerTxnIds to it).
  for (const c of compositeMatches) {
    if (c.status !== "accepted") continue;
    const bankTxn = bankById.get(c.bankTxnId);
    if (!bankTxn) continue;
    // Defensive: never count a transaction as matched twice.
    if (matchedBankIds.has(c.bankTxnId) || c.ledgerTxnIds.some((id) => matchedLedgerIds.has(id))) continue;
    matchedBankIds.add(c.bankTxnId);
    for (const id of c.ledgerTxnIds) matchedLedgerIds.add(id);
    acceptedGroups.push({ composite: c, bankTxn, ledgerTxns: resolve(c.ledgerTxnIds) });
  }
  for (const c of compositeMatches) {
    if (c.status !== "suggested") continue;
    const bankTxn = bankById.get(c.bankTxnId);
    if (!bankTxn || matchedBankIds.has(c.bankTxnId)) continue;
    pendingBankIds.add(c.bankTxnId);
    for (const id of c.ledgerTxnIds) pendingLedgerIds.add(id);
    reviewGroups.push({ composite: c, bankTxn, ledgerTxns: resolve(c.ledgerTxnIds) });
  }
  // rejected groups → both sides fall through to unmatched

  return {
    acceptedPairs,
    acceptedGroups,
    reviewPairs,
    reviewGroups,
    matchedBankIds,
    matchedLedgerIds,
    pendingBankIds,
    pendingLedgerIds,
    unmatchedBank: bankTxns.filter((t) => !matchedBankIds.has(t.id) && !pendingBankIds.has(t.id)),
    unmatchedLedger: ledgerTxns.filter((t) => !matchedLedgerIds.has(t.id) && !pendingLedgerIds.has(t.id)),
  };
}
