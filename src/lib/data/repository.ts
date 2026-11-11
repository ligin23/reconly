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

import type { Txn, Match, AnyCompositeMatch } from "@/lib/recon/types";
import type { UserAddedEntry } from "@/lib/sample-data";
import type { DuplicateState } from "@/lib/import/duplicates";
import type { StatementBalance } from "@/lib/parser";

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
  /** Composite match decisions. Optional for backward-compat. Defaults to [] on load. */
  compositeMatches?: AnyCompositeMatch[];
  /** Bank transactions the user explicitly added to the working copy. Optional for backward-compat. */
  userAddedEntries?: UserAddedEntry[];
  /** Engine Txn IDs the user has marked as "expected/outstanding" in the bank. Optional for backward-compat. */
  acknowledgedBankIds?: string[];
  /**
   * The files this reconciliation was built from. Optional for
   * backward-compat: records saved before multi-file import have none.
   * (Each Txn also carries its own sourceFile / sourceLine.)
   * Adding an optional field needs no IndexedDB version bump.
   */
  sourceFiles?: SourceFileInfo[];
  /**
   * Duplicate review: which imported rows are set aside as repeated, which
   * groups the user confirmed are separate, and the audit trail.
   *
   * When present, `bankTxns` / `ledgerTxns` above hold EVERY imported row
   * and the rows listed in `duplicateState.setAside` are left out of the
   * reconciliation. Optional for backward-compat: older records have none,
   * and then every stored row is in use. No IndexedDB version bump needed.
   */
  duplicateState?: DuplicateState;
  /**
   * True when this record was saved from the advanced demo (fictional
   * sample data). Optional; absent means real data. No IndexedDB version
   * bump needed.
   */
  sampleData?: boolean;
}

/** One uploaded file that fed a reconciliation. */
export interface SourceFileInfo {
  side: "bank" | "ledger";
  name: string;
  /** Transactions read from the file. */
  rows: number;
  /** 1-based line the column titles were on. */
  headerRow: number;
  /** Earliest / latest transaction date in the file; null if it had none. */
  periodStart: string | null;
  periodEnd: string | null;
  /** Statement period stated in the file's own title lines, if any.
   *  Optional: absent on records saved before it was captured. */
  statementStart?: string | null;
  statementEnd?: string | null;
  /** Rows the parser skipped (not in any month), and how many of those
   *  were skipped for a missing or unreadable date. Optional as above. */
  skippedRows?: number;
  invalidDateRows?: number;
  /**
   * Opening / closing balances the file states explicitly (never
   * calculated), with the line they were read from, and anything unclear
   * about them. Optional: absent on records saved before balances were
   * captured — those simply have no statement evidence.
   */
  statementOpening?: StatementBalance | null;
  statementClosing?: StatementBalance | null;
  statementAmbiguities?: string[];
  /** Where the file itself says its balances are amounts owed, if it does. */
  statementOwedIndication?: { line: number; text: string };
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
