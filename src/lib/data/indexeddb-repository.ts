// ============================================================
// Reconly — IndexedDB repository implementation
// Implements ReconlyRepository using the `idb` Promise wrapper.
// Nothing outside this file may import `idb` or touch IndexedDB
// directly — all persistence goes through the exported instance.
// ============================================================

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ReconciliationRecord, ReconlyRepository } from "./repository";

// ---- Schema ----------------------------------------------------------

const DB_NAME = "reconly";
const DB_VERSION = 1;
const STORE = "reconciliations";

interface ReconlyDB extends DBSchema {
  reconciliations: {
    key: string;
    value: ReconciliationRecord;
    indexes: {
      by_period_end: string;
    };
  };
}

// ---- DB singleton ----------------------------------------------------

let _db: IDBPDatabase<ReconlyDB> | null = null;

async function getDb(): Promise<IDBPDatabase<ReconlyDB>> {
  if (_db) return _db;
  _db = await openDB<ReconlyDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("by_period_end", "periodEnd");
    },
  });
  return _db;
}

// ---- Implementation --------------------------------------------------

class IndexedDbRepository implements ReconlyRepository {
  async listReconciliations(): Promise<ReconciliationRecord[]> {
    try {
      const db = await getDb();
      const all = await db.getAllFromIndex(STORE, "by_period_end");
      // Index returns ascending; we want most recent first.
      return all.reverse();
    } catch (err) {
      return Promise.reject(
        new Error(`Reconly: failed to list reconciliations — ${String(err)}`)
      );
    }
  }

  async getReconciliation(id: string): Promise<ReconciliationRecord | null> {
    try {
      const db = await getDb();
      const record = await db.get(STORE, id);
      return record ?? null;
    } catch (err) {
      return Promise.reject(
        new Error(`Reconly: failed to get reconciliation ${id} — ${String(err)}`)
      );
    }
  }

  async saveReconciliation(record: ReconciliationRecord): Promise<void> {
    try {
      const db = await getDb();
      await db.put(STORE, record);
    } catch (err) {
      return Promise.reject(
        new Error(`Reconly: failed to save reconciliation ${record.id} — ${String(err)}`)
      );
    }
  }

  async deleteReconciliation(id: string): Promise<void> {
    try {
      const db = await getDb();
      await db.delete(STORE, id);
    } catch (err) {
      return Promise.reject(
        new Error(`Reconly: failed to delete reconciliation ${id} — ${String(err)}`)
      );
    }
  }
}

// ---- Exported singleton typed as the interface -----------------------
// Callers import `repository` — they see ReconlyRepository, not the class.
// BACKEND_SWAP: replace the right-hand side with an ApiRepository instance.

export const repository: ReconlyRepository = new IndexedDbRepository();
