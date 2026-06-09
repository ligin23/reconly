// ============================================================
// Reconly — data layer utilities
// Pure TypeScript. No React. No framework imports.
// ============================================================

import type { Txn, Match } from "@/lib/recon/types";
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

/** Derive persisted status from engine output and current match decisions. */
export function deriveStatus(
  unexplainedDifference: number,
  matches: Pick<Match, "status">[]
): ReconciliationRecord["status"] {
  if (unexplainedDifference === 0) return "reconciled";
  if (matches.some((m) => m.status === "suggested")) return "in_progress";
  return "not_reconciled";
}
