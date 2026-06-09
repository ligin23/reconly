"use client";

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
}: {
  record: ReconciliationRecord;
  onOpen: () => void;
}) {
  const period = formatPeriod(record.periodStart, record.periodEnd);
  const isReconciled = record.status === "reconciled";

  return (
    <div
      className="txn"
      onClick={onOpen}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto auto",
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
    </div>
  );
}

export type HistoryScreenProps = {
  records: ReconciliationRecord[];
  onOpen: (record: ReconciliationRecord) => void;
};

export function HistoryScreen({ records, onOpen }: HistoryScreenProps) {
  if (records.length === 0) {
    return (
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
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
          <HistoryRow key={r.id} record={r} onOpen={() => onOpen(r)} />
        ))}
      </div>
    </div>
  );
}
