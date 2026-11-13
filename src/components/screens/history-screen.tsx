"use client";

import { useEffect, useRef, useState } from "react";
import type { ReconciliationRecord } from "@/lib/data/repository";
import { formatPeriod } from "@/lib/data/utils";
import { money } from "@/lib/sample-data";
import { StatusPill } from "@/components/ui/status-pill";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";

function formatSavedDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusPillKind(status: ReconciliationRecord["status"]) {
  if (status === "reconciled") return "matched" as const;
  if (status === "in_progress") return "review" as const;
  return "problem" as const;
}

function statusLabel(status: ReconciliationRecord["status"]): string {
  if (status === "reconciled") return "Reconciled";
  if (status === "in_progress") return "In progress";
  return "Not reconciled";
}

function HistoryRow({
  record,
  onOpen,
  onRequestDelete,
}: {
  record: ReconciliationRecord;
  onOpen: () => void;
  onRequestDelete: () => void;
}) {
  const period = formatPeriod(record.periodStart, record.periodEnd);
  const isReconciled = record.status === "reconciled";

  return (
    <div
      className="txn m-history"
      data-testid="history-row"
      onClick={onOpen}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto auto auto",
        alignItems: "center",
        gap: 20,
        padding: "14px 22px",
        borderTop: "1px solid var(--line-2)",
        cursor: "pointer",
      }}
    >
      <div>
        <div
          style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}
        >
          {record.accountName}
          {record.sampleData && (
            <span
              data-testid="history-sample-badge"
              style={{
                marginLeft: 8,
                fontSize: 11,
                fontWeight: 600,
                color: "var(--accent-ink)",
                background: "var(--accent-soft)",
                borderRadius: 999,
                padding: "2px 8px",
                verticalAlign: "middle",
              }}
            >
              Sample data
            </span>
          )}
        </div>
        <div
          className="mono"
          style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}
        >
          {period}
        </div>
      </div>

      <div className="tnum" style={{ textAlign: "right", fontSize: 13.5, fontWeight: 600 }}>
        {isReconciled ? (
          <span style={{ color: "var(--good-ink)" }}>$0.00</span>
        ) : record.unexplainedDifference !== 0 ? (
          <span style={{ color: "var(--warn-ink)" }}>
            {money(Math.abs(record.unexplainedDifference))} diff
          </span>
        ) : (
          <span style={{ color: "var(--good-ink)" }}>$0.00</span>
        )}
      </div>

      <StatusPill kind={statusPillKind(record.status)}>
        {statusLabel(record.status)}
      </StatusPill>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--ink-3)", whiteSpace: "nowrap" }}>
          {formatSavedDate(record.updatedAt)}
        </span>
        <Icon name="chevR" size={15} style={{ color: "var(--ink-3)", flex: "none" }} />
      </div>

      <button
        type="button"
        className="history-delete"
        data-testid="history-delete"
        aria-label={`Delete saved reconciliation ${record.accountName}, ${period}`}
        title="Delete this saved reconciliation"
        onClick={(e) => {
          e.stopPropagation(); // never also open the record
          onRequestDelete();
        }}
      >
        <Icon name="trash" size={15} />
        <span>Delete</span>
      </button>
    </div>
  );
}

/** Confirmation before a saved reconciliation is removed from this browser. */
function DeleteDialog({
  record,
  isOpenNow,
  onConfirm,
  onCancel,
}: {
  record: ReconciliationRecord;
  /** This record is the one currently open in the app. */
  isOpenNow: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const period = formatPeriod(record.periodStart, record.periodEnd);

  // Safe default: focus Cancel, and Escape cancels (unless a delete is running).
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, pending]);

  const confirm = async () => {
    if (pending) return; // one deletion per confirmation, however many clicks
    setPending(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch {
      setFailed(true);
      setPending(false);
    }
  };

  return (
    <div
      className="history-dialog-backdrop"
      onClick={() => !pending && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-body"
        className="card history-dialog"
        data-testid="delete-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="delete-dialog-title" className="serif" style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.02em" }}>
          Delete this saved reconciliation?
        </h2>
        <div id="delete-dialog-body" style={{ marginTop: 12, fontSize: 14, lineHeight: 1.55, color: "var(--ink-2)" }}>
          <p data-testid="delete-dialog-target" style={{ fontWeight: 600, color: "var(--ink)" }}>
            {record.accountName}
            <span style={{ fontWeight: 500, color: "var(--ink-2)" }}>
              {" "}· {period} · saved {formatSavedDate(record.updatedAt)}
            </span>
          </p>
          <p style={{ marginTop: 10 }}>
            This removes it from Reconly&apos;s storage in this browser. It can&apos;t be undone. Your original files and any
            reports you downloaded are not affected, and other saved reconciliations are kept.
          </p>
          {isOpenNow && (
            <p data-testid="delete-dialog-open-note" style={{ marginTop: 10 }}>
              This reconciliation is open right now. It stays on screen until you start over, but it will no longer be saved.
            </p>
          )}
          {failed && (
            <p role="alert" data-testid="delete-error" style={{ marginTop: 10, color: "var(--bad-ink)", fontWeight: 600 }}>
              It couldn&apos;t be deleted — nothing was removed. Please try again.
            </p>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
          <button ref={cancelRef} type="button" className="btn btn--secondary" onClick={onCancel} disabled={pending} data-testid="delete-cancel">
            Cancel
          </button>
          <button type="button" className="btn history-delete-confirm" onClick={confirm} disabled={pending} data-testid="delete-confirm">
            {pending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

export type HistoryScreenProps = {
  records: ReconciliationRecord[];
  onOpen: (record: ReconciliationRecord) => void;
  /** Remove one saved record from storage. Rejects if nothing was removed. */
  onDelete: (record: ReconciliationRecord) => Promise<void>;
  /** The saved record currently open in the app, if any. */
  currentRecordId: string | null;
};

export function HistoryScreen({ records, onOpen, onDelete, currentRecordId }: HistoryScreenProps) {
  const [toDelete, setToDelete] = useState<ReconciliationRecord | null>(null);
  const [deletedName, setDeletedName] = useState<string | null>(null);

  const dialog = toDelete && (
    <DeleteDialog
      key={toDelete.id}
      record={toDelete}
      isOpenNow={toDelete.id === currentRecordId}
      onCancel={() => setToDelete(null)}
      onConfirm={async () => {
        await onDelete(toDelete);
        setDeletedName(toDelete.accountName);
        setToDelete(null);
      }}
    />
  );

  const deletedNote = deletedName && (
    <p role="status" data-testid="delete-status" style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "0 0 12px" }}>
      Deleted “{deletedName}” from this browser.
    </p>
  );

  if (records.length === 0) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        {deletedNote}
        <EmptyState
          icon="history"
          tone="muted"
          title="No saved reconciliations yet"
          body="Run a reconciliation and save it — it will appear here so you can come back to it later."
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      {deletedNote}
      <div className="card" style={{ overflow: "hidden" }}>
        <div
          style={{
            padding: "18px 22px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2
            className="serif"
            style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}
          >
            Past reconciliations
          </h2>
          <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
            {records.length} saved
          </span>
        </div>

        {records.map((r) => (
          <HistoryRow
            key={r.id}
            record={r}
            onOpen={() => onOpen(r)}
            onRequestDelete={() => {
              setDeletedName(null);
              setToDelete(r);
            }}
          />
        ))}
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 10, lineHeight: 1.5 }}>
        Saved reconciliations are stored only in this browser on this device.
      </p>
      {dialog}
    </div>
  );
}
