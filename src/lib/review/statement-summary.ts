// ============================================================
// Reconly — statement outcome summary (wording only)
// Pure TypeScript. Reads the counts produced by statement verification
// (statements.ts) and says, in a few words, how many bank files landed in
// each outcome. It performs no verification and changes no status.
//
// Every outcome is named separately: a mismatch, a file that could not be
// verified, and a running-balance-only check are different things, and
// "could not be verified" is never worded as a success.
// ============================================================

import type { StatementStatus } from "./statements";

export type StatementOutcomePart = { status: StatementStatus; count: number; text: string };

/** Non-zero outcomes, problems first, successes last. */
export function statementOutcomeParts(c: Record<StatementStatus, number>): StatementOutcomePart[] {
  const part = (status: StatementStatus, one: string, many: string): StatementOutcomePart | null => {
    const count = c[status];
    return count > 0 ? { status, count, text: `${count} ${count === 1 ? one : many}` } : null;
  };
  return [
    part("mismatch", "mismatch", "mismatches"),
    part("conflict", "file with conflicting evidence", "files with conflicting evidence"),
    part("convention-review", "file with an unclear sign convention", "files with an unclear sign convention"),
    part("insufficient", "file could not be verified", "files could not be verified"),
    part("running-consistent", "running-balance check only", "running-balance checks only"),
    part("verified", "verified", "verified"),
  ].filter((p): p is StatementOutcomePart => p !== null);
}

/** "1 mismatch · 1 file could not be verified · 1 running-balance check only · 1 verified" */
export function statementOutcomeText(c: Record<StatementStatus, number>): string {
  const parts = statementOutcomeParts(c);
  return parts.length > 0 ? parts.map((p) => p.text).join(" · ") : "No bank file carried statement information.";
}
