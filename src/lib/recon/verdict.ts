// ============================================================
// Reconly — reconciliation verdict
// Pure TypeScript. A presentation-layer adapter over the engine's output
// and the user's decisions; the matching engine is not involved.
//
// Two separate questions are answered here and kept separate:
//
//   FINANCIAL  — do the bank and the books agree, with nothing left open?
//                (zero unexplained difference AND no unmatched / undecided
//                items — unchanged from before.)
//   DATA QUALITY — are there possible duplicate rows the user hasn't
//                ruled on yet?
//
// "Fully reconciled" needs both. A flagged duplicate never changes a
// total and never touches a confirmed match — it only withholds the
// final all-clear until the user has either set the repeat aside or
// confirmed the rows are separate transactions.
// ============================================================

export type FinancialStatus = "agrees" | "differs";
export type DataQualityStatus = "clear" | "duplicate-review-needed";

export type VerdictStatus =
  /** Totals agree, nothing open, no unresolved duplicate groups. */
  | "reconciled"
  /** Totals agree and nothing is open, but duplicate groups await a decision. */
  | "totals-agree-duplicate-review"
  /** A difference, unmatched items, or undecided suggestions remain. */
  | "not-reconciled";

export type Verdict = {
  status: VerdictStatus;
  financial: FinancialStatus;
  dataQuality: DataQualityStatus;
  /** Duplicate groups still needing a decision (0 when clear). */
  unresolvedDuplicateGroups: number;
  /** True only for status "reconciled". */
  reconciled: boolean;
};

export const VERDICT_LABEL: Record<VerdictStatus, string> = {
  reconciled: "Fully reconciled",
  "totals-agree-duplicate-review": "Totals agree — duplicate review needed",
  "not-reconciled": "Not reconciled",
};

export function deriveVerdict(input: {
  /** Signed cents; the live, decision-adjusted figure. */
  unexplainedDifference: number;
  /** Unmatched items on either side plus suggestions awaiting a yes/no. */
  openItemCount: number;
  /** Duplicate groups with two or more rows still in use and no decision. */
  unresolvedDuplicateGroups?: number;
}): Verdict {
  const unresolved = Math.max(0, input.unresolvedDuplicateGroups ?? 0);
  const financial: FinancialStatus =
    input.unexplainedDifference === 0 && input.openItemCount === 0 ? "agrees" : "differs";
  const dataQuality: DataQualityStatus = unresolved > 0 ? "duplicate-review-needed" : "clear";
  const status: VerdictStatus =
    financial === "differs"
      ? "not-reconciled"
      : dataQuality === "clear"
        ? "reconciled"
        : "totals-agree-duplicate-review";
  return {
    status,
    financial,
    dataQuality,
    unresolvedDuplicateGroups: unresolved,
    reconciled: status === "reconciled",
  };
}
