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

/** Format an ISO date range as "Mar 1 – Mar 31, 2026". */
export function formatPeriod(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const s = new Date(sy, sm - 1, sd);
  const e = new Date(ey, em - 1, ed);
  const startStr = s.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  openItemCount = 0
): ReconciliationRecord["status"] {
  const hasPendingSuggestions =
    matches.some((m) => m.status === "suggested") ||
    compositeMatches.some((c) => c.status === "suggested");
  if (hasPendingSuggestions) return "in_progress";
  if (unexplainedDifference === 0 && openItemCount === 0) return "reconciled";
  return "not_reconciled";
}
