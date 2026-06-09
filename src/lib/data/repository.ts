// ============================================================
// Reconly — repository interface
// This file is the contract. Every persistence operation in the
// app goes through this interface. The implementation (IndexedDB
// today, API client later) lives in a separate module.
//
// BACKEND_SWAP: To move to a real backend, write api-repository.ts
// that implements ReconlyRepository, then swap the export in
// indexeddb-repository.ts for the new implementation. No caller
// changes needed — all callers depend on this type, not the impl.
// ============================================================

import type { Txn, Match } from "@/lib/recon/types";

// ---- Domain record ---------------------------------------------------

/** The full persisted state of one reconciliation session. */
export interface ReconciliationRecord {
  id: string;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601

  accountName: string; // user-visible label, e.g. "Business Checking"

  periodStart: string; // ISO date yyyy-mm-dd (inclusive)
  periodEnd: string;   // ISO date yyyy-mm-dd (inclusive)

  openingBalance: number;  // cents
  closingBalance: number;  // cents

  status: "in_progress" | "reconciled" | "not_reconciled";
  unexplainedDifference: number; // cents; 0 when reconciled

  // Full working state — sufficient to re-open this reconciliation
  // and restore all decisions exactly as left.
  // Types are imported directly from the engine; no transformation needed.
  bankTxns: Txn[];
  ledgerTxns: Txn[];
  matches: Match[];
}

// ---- Repository interface -------------------------------------------

/**
 * All persistence in Reconly goes through this interface.
 * Every method is async so an API implementation drops in without
 * changing any caller.
 */
export interface ReconlyRepository {
  /** Return all saved reconciliations, most recent first. */
  listReconciliations(): Promise<ReconciliationRecord[]>;

  /** Return one record by id, or null if not found. */
  getReconciliation(id: string): Promise<ReconciliationRecord | null>;

  /**
   * Upsert a record. Uses id to determine insert vs update.
   * Generate a fresh id for a new reconciliation; reuse it when updating.
   */
  saveReconciliation(record: ReconciliationRecord): Promise<void>;

  /** Permanently remove a record by id. No-op if id is not found. */
  deleteReconciliation(id: string): Promise<void>;
}
