// ============================================================
// Reconly — reconciliation verdict
// Pure TypeScript. A presentation-layer adapter over the engine's output,
// the user's decisions, the duplicate review and the statement checks.
// The matching engine is not involved, and nothing here changes a total
// or a confirmed match.
//
// THREE separate questions are answered and kept separate:
//
//   TRANSACTIONS  — do the bank and the books agree, with nothing left
//                   open? (zero unexplained difference AND no unmatched /
//                   undecided items — unchanged.)
//   DUPLICATES    — are there possible duplicate rows the user hasn't
//                   ruled on yet?
//   STATEMENTS    — what do the bank files' own balances show?
//                   verified / verified for some files / running balance
//                   consistent only / not verified / review needed.
//
// "Fully reconciled" requires: transactions agree, no unresolved
// duplicate groups, and no statement mismatch, conflict or unsettled sign
// convention. Missing statement evidence does NOT block it — it is
// reported as "Not verified" beside the verdict, never hidden.
//
// Precedence: a real transaction difference always comes first. Data-
// quality findings are only the headline when the transactions agree.
// ============================================================

import {
  statementIssueCount,
  summarizeStatements,
  type StatementStatus,
  type StatementSummary,
} from "@/lib/review/statements";

export type FinancialStatus = "agrees" | "differs";
export type DataQualityStatus = "clear" | "duplicate-review-needed";

export type VerdictStatus =
  /** Transactions agree, no unresolved duplicates, no statement problem. */
  | "reconciled"
  /** Transactions agree; duplicate groups await a decision. */
  | "totals-agree-duplicate-review"
  /** Transactions agree; a statement mismatch / conflict / convention needs review. */
  | "transactions-match-statement-review"
  /** Transactions agree; both of the above. */
  | "transactions-match-duplicate-and-statement-review"
  /** A difference, unmatched items, or undecided suggestions remain. */
  | "not-reconciled";

export type Verdict = {
  status: VerdictStatus;
  /** Transaction matching. */
  financial: FinancialStatus;
  /** Duplicate review. */
  dataQuality: DataQualityStatus;
  /** Statement verification, summarised across the bank files. */
  statement: StatementSummary;
  /** Duplicate groups still needing a decision (0 when clear). */
  unresolvedDuplicateGroups: number;
  /** Bank files with a mismatch, a conflict or an unsettled sign convention. */
  statementFilesNeedingReview: number;
  /** True only for status "reconciled". */
  reconciled: boolean;
};

export const VERDICT_LABEL: Record<VerdictStatus, string> = {
  reconciled: "Fully reconciled",
  "totals-agree-duplicate-review": "Totals agree — duplicate review needed",
  "transactions-match-statement-review": "Transactions match — statement review needed",
  "transactions-match-duplicate-and-statement-review":
    "Transactions match — duplicate and statement review needed",
  "not-reconciled": "Not reconciled",
};

export function deriveVerdict(input: {
  /** Signed cents; the live, decision-adjusted figure. */
  unexplainedDifference: number;
  /** Unmatched items on either side plus suggestions awaiting a yes/no. */
  openItemCount: number;
  /** Duplicate groups with two or more rows still in use and no decision. */
  unresolvedDuplicateGroups?: number;
  /** Bank files by statement-check result. Absent → no statement evidence. */
  statements?: Record<StatementStatus, number>;
}): Verdict {
  const unresolved = Math.max(0, input.unresolvedDuplicateGroups ?? 0);
  const statementIssues = input.statements ? statementIssueCount(input.statements) : 0;
  const statement: StatementSummary = input.statements
    ? summarizeStatements(input.statements)
    : "not-verified";

  const financial: FinancialStatus =
    input.unexplainedDifference === 0 && input.openItemCount === 0 ? "agrees" : "differs";
  const dataQuality: DataQualityStatus = unresolved > 0 ? "duplicate-review-needed" : "clear";

  let status: VerdictStatus;
  if (financial === "differs") status = "not-reconciled";
  else if (unresolved > 0 && statementIssues > 0) status = "transactions-match-duplicate-and-statement-review";
  else if (unresolved > 0) status = "totals-agree-duplicate-review";
  else if (statementIssues > 0) status = "transactions-match-statement-review";
  else status = "reconciled";

  return {
    status,
    financial,
    dataQuality,
    statement,
    unresolvedDuplicateGroups: unresolved,
    statementFilesNeedingReview: statementIssues,
    reconciled: status === "reconciled",
  };
}
