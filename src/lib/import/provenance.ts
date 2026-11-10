// ============================================================
// Reconly — transaction provenance label
// Pure, dependency-free (safe to import from display adapters).
// ============================================================

/** "march.csv · row 42" — where a transaction came from, or null if unknown
 *  (reconciliations saved before provenance was recorded). */
export function sourceLabel(txn: { sourceFile?: string; sourceLine?: number }): string | null {
  if (txn.sourceFile && txn.sourceLine) return `${txn.sourceFile} · row ${txn.sourceLine}`;
  if (txn.sourceFile) return txn.sourceFile;
  if (txn.sourceLine) return `row ${txn.sourceLine}`;
  return null;
}
