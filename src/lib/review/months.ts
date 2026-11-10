// ============================================================
// Reconly — month-by-month findings
// Pure TypeScript. No React. Sits BEHIND the matching engine: it reads the
// result of the single full-range reconciliation (plus the user's
// decisions and the duplicate review) and groups it by calendar month.
// It never runs the engine and never matches anything itself — matching
// across the whole uploaded period is what lets a cheque written on
// Jan 30 pair with the bank line that clears on Feb 3.
//
// COUNTING RULES
//  1. A transaction belongs to the month of ITS OWN date. Nothing is moved
//     to another month because of what it matched with.
//  2. Row counts (per side, per month): every imported row is either set
//     aside or in use; every row in use is in exactly one state —
//     matched, awaiting review, unmatched, or handled by the user (bank:
//     "added to my reconciliation"; records: "marked as expected").
//       imported = set aside + in use
//       in use   = matched + awaiting review + unmatched + handled
//     Summed over the months these equal the overall figures.
//  3. Match counts: a match (a one-to-one pair, or a grouped match of one
//     bank row and several record rows) is ONE item and is counted once,
//     in the month of its BANK row. Summed over the months, confirmed and
//     awaiting-review matches equal the overall counts.
//  4. Cross-month matches: a match whose rows fall in more than one month
//     is still counted once (rule 3). Separately, each month it touches
//     shows it under "cross-month" so it can be found from either side.
//     That figure is an "involves" count, shown on its own and never added
//     into totals; no amount is ever counted twice.
//  5. Amounts: a row's amount is counted only in its own month.
//  6. Duplicate groups never span months (their rows share one date), so a
//     group is counted in that date's month.
//
// WHAT THE STATUSES MEAN
//  They describe findings in the uploaded records only. "No unresolved
//  items identified" does not mean a month is complete or balanced:
//  statement opening / closing balances are not checked, and transactions
//  missing from both sides cannot be seen.
// ============================================================

import type { Txn, Match, AnyCompositeMatch } from "@/lib/recon/types";
import type { SourceFileInfo } from "@/lib/data/repository";
import {
  accountOf,
  groupStatus,
  type DuplicateGroup,
  type DuplicateState,
} from "@/lib/import/duplicates";
import {
  monthStatement,
  type MonthStatement,
  type StatementReview,
  type StatementStatus,
} from "./statements";

const NO_STATEMENTS: StatementReview = {
  statements: [],
  overlaps: [],
  counts: {
    verified: 0,
    "running-consistent": 0,
    mismatch: 0,
    "convention-review": 0,
    insufficient: 0,
    conflict: 0,
  },
};

export type MonthStatus =
  | "no-unresolved-items"
  | "review-needed"
  | "duplicates-to-review"
  | "source-unverified";

export const MONTH_STATUS_LABEL: Record<MonthStatus, string> = {
  "no-unresolved-items": "No unresolved items identified",
  "review-needed": "Review needed",
  "duplicates-to-review": "Possible duplicates to review",
  "source-unverified": "Source data incomplete or unverified",
};

export type SideCounts = {
  imported: number;
  setAside: number;
  inUse: number;
  matched: number;
  awaitingReview: number;
  unmatched: number;
  /** Bank: added to the reconciliation by the user. Records: marked as expected. */
  handled: number;
  /** Signed cents: sum of the rows in use dated in this month. */
  net: number;
  /** Signed cents: sum of the unmatched rows dated in this month. */
  unmatchedAmount: number;
};

/** A match seen from the month view. */
export type MonthMatch = {
  id: string;
  kind: "pair" | "group";
  status: "confirmed" | "awaiting-review";
  bank: Txn;
  /** Record rows: the confirmed parts, or every candidate while undecided. */
  ledger: Txn[];
  /** Month of the bank row — where this match is counted. */
  month: string;
  /** Every month the match touches (sorted). More than one = cross-month. */
  months: string[];
};

export type MonthSummary = {
  /** "2026-01" */
  month: string;
  /** "January 2026" */
  label: string;
  bank: SideCounts;
  ledger: SideCounts;
  /** Matches counted in this month (rule 3). */
  confirmedMatches: number;
  awaitingReviewMatches: number;
  /** Matches touching this month AND another one (rule 4; not additive). */
  crossMonthMatches: number;
  duplicateGroupsToReview: number;
  duplicateGroupsKeptSeparate: number;
  /** The most pressing status, then every status that applies. */
  status: MonthStatus;
  flags: MonthStatus[];
  /** Plain-language notes about the source data for this month. */
  notes: string[];
  /**
   * Statement balance verification for this month — reported on its own,
   * separately from matching (status / flags above) and duplicate review.
   */
  statement: MonthStatement;
  details: {
    unmatchedBank: Txn[];
    unmatchedLedger: Txn[];
    handledBank: Txn[];
    handledLedger: Txn[];
    awaitingReview: MonthMatch[];
    crossMonth: MonthMatch[];
    duplicateGroups: DuplicateGroup[];
    setAside: Txn[];
    files: { side: "bank" | "ledger"; name: string; rows: number }[];
  };
};

export type CoverageFinding = {
  kind:
    | "balances-not-provided"
    | "statement-balances"
    | "statement-overlap"
    | "statement-gap"
    | "statement-period-mismatch"
    | "skipped-rows"
    | "account-mismatch"
    | "one-sided-month"
    | "month-without-rows";
  side?: "bank" | "ledger";
  month?: string;
  text: string;
};

export type MonthReview = {
  months: MonthSummary[];
  /** "January to June 2026" / "November 2025 to February 2026" / "March 2026". */
  rangeLabel: string;
  overview: {
    monthsAnalyzed: number;
    monthsWithFindings: number;
    unmatchedTransactions: number;
    awaitingReviewMatches: number;
    duplicateGroupsToReview: number;
    confirmedMatches: number;
    /** Distinct matches spanning more than one month. */
    crossMonthMatches: number;
    /** Bank files by statement-balance result. */
    statements: Record<StatementStatus, number>;
  };
  coverage: {
    /** Always false today: nothing in the uploaded files can prove that
     *  every transaction for the period is present. */
    verified: false;
    label: "Coverage not verified";
    findings: CoverageFinding[];
  };
};

export type MonthReviewInput = {
  /** Every imported row, including rows set aside. */
  imported: { bank: Txn[]; ledger: Txn[] };
  /** Rows in use — exactly what the engine reconciled. */
  bankTxns: Txn[];
  ledgerTxns: Txn[];
  /** Live matches, with the user's decisions applied. */
  matches: Match[];
  compositeMatches: AnyCompositeMatch[];
  /** Bank rows the user added to the reconciliation. */
  addedBankIds: ReadonlySet<string>;
  /** Record rows the user marked as expected. */
  acknowledgedLedgerIds: ReadonlySet<string>;
  duplicateGroups: DuplicateGroup[];
  duplicateState: DuplicateState;
  /** File-level facts; absent for older saved reconciliations. */
  sourceFiles?: SourceFileInfo[];
  /** Result of lib/review/statements; absent → no statement evidence. */
  statementReview?: StatementReview;
};

const monthOf = (isoDate: string) => isoDate.slice(0, 7);

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function rangeLabel(months: string[]): string {
  if (months.length === 0) return "";
  const first = months[0];
  const last = months[months.length - 1];
  if (first === last) return monthLabel(first);
  if (first.slice(0, 4) === last.slice(0, 4)) {
    const [y, m] = first.split("-").map(Number);
    const firstName = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
    return `${firstName} to ${monthLabel(last)}`;
  }
  return `${monthLabel(first)} to ${monthLabel(last)}`;
}

function niceDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

const emptySide = (): SideCounts => ({
  imported: 0, setAside: 0, inUse: 0, matched: 0, awaitingReview: 0,
  unmatched: 0, handled: 0, net: 0, unmatchedAmount: 0,
});

const SIDE_NAME = { bank: "bank", ledger: "records" } as const;

export function buildMonthReview(input: MonthReviewInput): MonthReview {
  const { imported, bankTxns, ledgerTxns, matches, compositeMatches, duplicateGroups, duplicateState } = input;

  const bankById = new Map(bankTxns.map((t) => [t.id, t]));
  const ledgerById = new Map(ledgerTxns.map((t) => [t.id, t]));
  const setAsideIds = new Set(duplicateState.setAside.map((s) => s.txnId));

  // ---- Months that exist in the data --------------------------------
  const monthSet = new Set<string>();
  for (const t of imported.bank) monthSet.add(monthOf(t.date));
  for (const t of imported.ledger) monthSet.add(monthOf(t.date));
  const monthKeys = [...monthSet].sort();

  type Draft = Omit<MonthSummary, "status" | "flags" | "label" | "statement">;
  const drafts = new Map<string, Draft>();
  for (const month of monthKeys) {
    drafts.set(month, {
      month,
      bank: emptySide(),
      ledger: emptySide(),
      confirmedMatches: 0,
      awaitingReviewMatches: 0,
      crossMonthMatches: 0,
      duplicateGroupsToReview: 0,
      duplicateGroupsKeptSeparate: 0,
      notes: [],
      details: {
        unmatchedBank: [], unmatchedLedger: [], handledBank: [], handledLedger: [],
        awaitingReview: [], crossMonth: [], duplicateGroups: [], setAside: [], files: [],
      },
    });
  }
  const at = (isoDate: string) => drafts.get(monthOf(isoDate))!;

  // ---- Imported / set aside (rule 2) --------------------------------
  const fileRows = new Map<string, number>(); // month|side|file → rows
  for (const side of ["bank", "ledger"] as const) {
    for (const t of imported[side]) {
      const d = at(t.date);
      d[side].imported++;
      if (setAsideIds.has(t.id)) {
        d[side].setAside++;
        d.details.setAside.push(t);
      }
      if (t.sourceFile) {
        const key = `${monthOf(t.date)}\u0000${side}\u0000${t.sourceFile}`;
        fileRows.set(key, (fileRows.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [key, rows] of fileRows) {
    const [month, side, name] = key.split("\u0000");
    drafts.get(month)!.details.files.push({ side: side as "bank" | "ledger", name, rows });
  }

  // ---- Matches (rules 3 and 4) --------------------------------------
  type RowState = "matched" | "awaiting-review";
  const bankState = new Map<string, RowState>();
  const ledgerState = new Map<string, RowState>();
  const allMatches: MonthMatch[] = [];

  const record = (
    id: string,
    kind: MonthMatch["kind"],
    status: MonthMatch["status"],
    bank: Txn | undefined,
    ledger: Txn[]
  ) => {
    if (!bank) return;
    const state: RowState = status === "confirmed" ? "matched" : "awaiting-review";
    // A row already claimed by an earlier match keeps its first state —
    // nothing is ever counted in two places.
    if (bankState.has(bank.id)) return;
    const parts = ledger.filter((l) => !ledgerState.has(l.id));
    bankState.set(bank.id, state);
    for (const l of parts) ledgerState.set(l.id, state);
    const month = monthOf(bank.date);
    const months = [...new Set([month, ...parts.map((l) => monthOf(l.date))])].sort();
    allMatches.push({ id, kind, status, bank, ledger: parts, month, months });
  };
  const ledgerRows = (ids: string[]) =>
    ids.map((id) => ledgerById.get(id)).filter((t): t is Txn => Boolean(t));

  // Confirmed first, so a confirmed match always wins over a suggestion.
  for (const m of matches) {
    if (m.status === "accepted" || m.status === "manual") {
      record(m.id, "pair", "confirmed", bankById.get(m.bankTxnId), ledgerRows([m.ledgerTxnId]));
    }
  }
  for (const c of compositeMatches) {
    if (c.status === "accepted") {
      record(c.id, "group", "confirmed", bankById.get(c.bankTxnId), ledgerRows(c.ledgerTxnIds));
    }
  }
  for (const m of matches) {
    if (m.status === "suggested") {
      record(m.id, "pair", "awaiting-review", bankById.get(m.bankTxnId), ledgerRows([m.ledgerTxnId]));
    }
  }
  for (const c of compositeMatches) {
    if (c.status === "suggested") {
      record(c.id, "group", "awaiting-review", bankById.get(c.bankTxnId), ledgerRows(c.ledgerTxnIds));
    }
  }

  for (const match of allMatches) {
    const home = drafts.get(match.month)!;
    if (match.status === "confirmed") home.confirmedMatches++;
    else {
      home.awaitingReviewMatches++;
      home.details.awaitingReview.push(match);
    }
    if (match.months.length > 1) {
      for (const month of match.months) {
        const d = drafts.get(month)!;
        d.crossMonthMatches++;
        d.details.crossMonth.push(match);
      }
    }
  }

  // ---- Rows in use: one state each (rule 2) -------------------------
  for (const t of bankTxns) {
    const d = at(t.date);
    d.bank.inUse++;
    d.bank.net += t.amount;
    const state = bankState.get(t.id);
    if (state === "matched") d.bank.matched++;
    else if (state === "awaiting-review") d.bank.awaitingReview++;
    else if (input.addedBankIds.has(t.id)) {
      d.bank.handled++;
      d.details.handledBank.push(t);
    } else {
      d.bank.unmatched++;
      d.bank.unmatchedAmount += t.amount;
      d.details.unmatchedBank.push(t);
    }
  }
  for (const t of ledgerTxns) {
    const d = at(t.date);
    d.ledger.inUse++;
    d.ledger.net += t.amount;
    const state = ledgerState.get(t.id);
    if (state === "matched") d.ledger.matched++;
    else if (state === "awaiting-review") d.ledger.awaitingReview++;
    else if (input.acknowledgedLedgerIds.has(t.id)) {
      d.ledger.handled++;
      d.details.handledLedger.push(t);
    } else {
      d.ledger.unmatched++;
      d.ledger.unmatchedAmount += t.amount;
      d.details.unmatchedLedger.push(t);
    }
  }

  // ---- Duplicate groups (rule 6) ------------------------------------
  const importedById = new Map([...imported.bank, ...imported.ledger].map((t) => [t.id, t]));
  for (const g of duplicateGroups) {
    const first = importedById.get(g.txnIds[0]);
    if (!first) continue;
    const d = at(first.date);
    const status = groupStatus(g, duplicateState);
    if (status === "needs-review") {
      d.duplicateGroupsToReview++;
      d.details.duplicateGroups.push(g);
    } else if (status === "kept-all") {
      d.duplicateGroupsKeptSeparate++;
    }
  }

  // ---- Coverage: only what the evidence supports --------------------
  const statementReview = input.statementReview ?? NO_STATEMENTS;
  const sc = statementReview.counts;
  const checkable =
    sc.verified + sc["running-consistent"] + sc.mismatch + sc.conflict + sc["convention-review"];
  const findings: CoverageFinding[] = [
    checkable === 0
      ? {
          kind: "balances-not-provided",
          text:
            "Statement opening and closing balances were not checked, so no month's balance has been independently verified. " +
            "These findings compare the rows in the files you uploaded; they cannot show a transaction that is missing from both sides.",
        }
      : {
          kind: "statement-balances",
          text:
            `Statement balances were checked for the bank files that carry them: ${sc.verified} with stated balances verified, ` +
            `${sc["running-consistent"]} with a consistent running balance only, ${sc.mismatch} with a mismatch, ` +
            `${sc.conflict} with conflicting evidence, ${sc["convention-review"]} whose sign convention needs review, ` +
            `${sc.insufficient} not verified. ` +
            "A verified statement shows that file's stated balances agree with its own transactions; a consistent running balance shows only that the file's rows are internally consistent. Neither can show a transaction that is missing from both the bank file and your records.",
        },
  ];
  for (const o of statementReview.overlaps) {
    findings.push({
      kind: "statement-overlap",
      side: "bank",
      text: `"${o.fileA}" and "${o.fileB}" cover overlapping dates (${niceDate(o.start)} to ${niceDate(o.end)}). Each file is checked against its own balances; rows that appear in both are handled in the duplicate review.`,
    });
  }

  const files = input.sourceFiles ?? [];
  for (const side of ["bank", "ledger"] as const) {
    // Gaps between statement periods the files THEMSELVES state.
    const stated = files
      .filter((f) => f.side === side && f.statementStart && f.statementEnd)
      .sort((a, b) => a.statementStart!.localeCompare(b.statementStart!));
    for (let i = 1; i < stated.length; i++) {
      const prev = stated[i - 1];
      const next = stated[i];
      const expected = addDays(prev.statementEnd!, 1);
      if (next.statementStart! > expected) {
        findings.push({
          kind: "statement-gap",
          side,
          text: `The ${SIDE_NAME[side]} files state their own periods, and none covers ${niceDate(expected)} to ${niceDate(addDays(next.statementStart!, -1))} (between "${prev.name}" and "${next.name}"). A statement for those dates may not have been uploaded.`,
        });
      }
    }
    for (const f of files.filter((x) => x.side === side)) {
      if (f.statementStart && f.statementEnd && f.periodStart && f.periodEnd) {
        if (f.periodStart < f.statementStart || f.periodEnd > f.statementEnd) {
          findings.push({
            kind: "statement-period-mismatch",
            side,
            text: `"${f.name}" says it covers ${niceDate(f.statementStart)} to ${niceDate(f.statementEnd)}, but it contains rows dated from ${niceDate(f.periodStart)} to ${niceDate(f.periodEnd)}.`,
          });
        }
      }
      if (f.skippedRows && f.skippedRows > 0) {
        const bad = f.invalidDateRows ?? 0;
        findings.push({
          kind: "skipped-rows",
          side,
          text:
            `"${f.name}": ${f.skippedRows} row${f.skippedRows === 1 ? " was" : "s were"} skipped when the file was read` +
            (bad > 0 ? ` (${bad} with a missing or unreadable date)` : "") +
            `. Skipped rows are not in any month below.`,
        });
      }
    }
    // Different account identifiers inside one side's rows.
    const accounts = new Set<string>();
    for (const t of imported[side]) {
      const a = accountOf(t);
      if (a) accounts.add(a);
    }
    if (accounts.size > 1) {
      const list = [...accounts].sort().slice(0, 4).join(", ");
      findings.push({
        kind: "account-mismatch",
        side,
        text: `The ${SIDE_NAME[side]} rows carry ${accounts.size} different account identifiers (${list}${accounts.size > 4 ? ", …" : ""}). Check that every file belongs to the account being reviewed.`,
      });
    }
  }

  // Months with rows on only one side — a fact about the upload, not a
  // claim that transactions are missing.
  for (const month of monthKeys) {
    const d = drafts.get(month)!;
    const bankHas = d.bank.imported > 0;
    const ledgerHas = d.ledger.imported > 0;
    if (bankHas !== ledgerHas) {
      const has = bankHas ? "bank" : "ledger";
      const lacks = bankHas ? "ledger" : "bank";
      const text = `${monthLabel(month)}: the uploaded ${SIDE_NAME[has]} files have rows dated in this month, but the ${SIDE_NAME[lacks]} files have none.`;
      d.notes.push(text);
      findings.push({ kind: "one-sided-month", side: lacks, month, text });
    }
  }
  // Calendar months inside the range with no rows on either side. Stated
  // as a fact with its uncertainty — never as a missing statement.
  if (monthKeys.length > 1) {
    for (const month of monthsBetween(monthKeys[0], monthKeys[monthKeys.length - 1])) {
      if (!monthSet.has(month)) {
        findings.push({
          kind: "month-without-rows",
          month,
          text: `No rows on either side are dated in ${monthLabel(month)}. Reconly can't tell whether that month had no activity or wasn't uploaded.`,
        });
      }
    }
  }

  // ---- Status per month ---------------------------------------------
  const months: MonthSummary[] = monthKeys.map((month) => {
    const d = drafts.get(month)!;
    const flags: MonthStatus[] = [];
    if (d.bank.unmatched + d.ledger.unmatched + d.awaitingReviewMatches > 0) flags.push("review-needed");
    if (d.duplicateGroupsToReview > 0) flags.push("duplicates-to-review");
    if (d.notes.length > 0) flags.push("source-unverified");
    d.details.files.sort((a, b) => a.side.localeCompare(b.side) || a.name.localeCompare(b.name));
    return {
      ...d,
      label: monthLabel(month),
      status: flags[0] ?? "no-unresolved-items",
      flags,
      statement: monthStatement(statementReview, month),
    };
  });

  return {
    months,
    rangeLabel: rangeLabel(monthKeys),
    overview: {
      monthsAnalyzed: months.length,
      monthsWithFindings: months.filter((m) => m.flags.length > 0).length,
      unmatchedTransactions: months.reduce((s, m) => s + m.bank.unmatched + m.ledger.unmatched, 0),
      awaitingReviewMatches: months.reduce((s, m) => s + m.awaitingReviewMatches, 0),
      duplicateGroupsToReview: months.reduce((s, m) => s + m.duplicateGroupsToReview, 0),
      confirmedMatches: months.reduce((s, m) => s + m.confirmedMatches, 0),
      crossMonthMatches: allMatches.filter((m) => m.months.length > 1).length,
      statements: { ...statementReview.counts },
    },
    coverage: { verified: false, label: "Coverage not verified", findings },
  };
}
