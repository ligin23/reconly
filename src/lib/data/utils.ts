// ============================================================
// Reconly — data layer utilities
// Pure TypeScript. No React. No framework imports.
// ============================================================

import type { Txn, Match, AnyCompositeMatch } from "@/lib/recon/types";
import type { ReconciliationRecord } from "./repository";

export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Extract the earliest and latest ISO dates from a set of transactions. */
export function inferPeriod(txns: Txn[]): { start: string; end: string } | null {
  const dates = txns.map((t) => t.date).filter(Boolean).sort();
  if (dates.length === 0) return null;
  return { start: dates[0], end: dates[dates.length - 1] };
}

/** Format an ISO date range as "Mar 1 – Mar 31, 2026" (or
 *  "Dec 1, 2025 – Jan 31, 2026" when it spans years). */
export function formatPeriod(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const s = new Date(sy, sm - 1, sd);
  const e = new Date(ey, em - 1, ed);
  // A range that crosses a year boundary must show both years — "Dec 1 –
  // Jan 31, 2026" reads as two months when it may be fourteen.
  const startStr = s.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sy !== ey ? { year: "numeric" as const } : {}),
  });
  const endStr = e.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startStr} – ${endStr}`;
}

/**
 * Derive persisted status from current decisions.
 * "Reconciled" requires a zero difference AND nothing left to resolve —
 * a zero net with open items (offsetting errors) or pending suggestions
 * is in-progress work, not a reconciled period.
 */
export function deriveStatus(
  unexplainedDifference: number,
  matches: Pick<Match, "status">[],
  compositeMatches: Pick<AnyCompositeMatch, "status">[] = [],
  openItemCount = 0,
  /** Duplicate groups still awaiting the user's decision. */
  unresolvedDuplicateGroups = 0,
  /** Bank files with a statement mismatch, conflict or unsettled sign convention. */
  statementFilesNeedingReview = 0
): ReconciliationRecord["status"] {
  const hasPendingSuggestions =
    matches.some((m) => m.status === "suggested") ||
    compositeMatches.some((c) => c.status === "suggested");
  if (hasPendingSuggestions) return "in_progress";
  if (unexplainedDifference === 0 && openItemCount === 0) {
    // Totals agree. Unreviewed possible duplicates, or a statement whose
    // balances don't add up, keep the period open ("in progress") — it is
    // not reconciled, but it is not a transaction discrepancy either.
    return unresolvedDuplicateGroups > 0 || statementFilesNeedingReview > 0 ? "in_progress" : "reconciled";
  }
  return "not_reconciled";
}
