"use client";

// ============================================================
// Repeated rows — the duplicate investigation view.
// Shows, for the rows the user imported: which files overlap, which rows
// were set aside (and why), and which possible duplicates are still
// counted and need a decision. Every action is reversible; no row is ever
// removed from the import. All numbers come from lib/import/duplicates.
// ============================================================

import { useMemo, useState } from "react";
import type { Txn } from "@/lib/recon/types";
import { money } from "@/lib/sample-data";
import { formatPeriod } from "@/lib/data/utils";
import { sourceLabel } from "@/lib/import/provenance";
import { describeDuplicateDecision } from "@/lib/import/duplicate-decision";
import {
  groupStatus,
  importCounts,
  type DuplicateGroup,
  type DuplicateState,
  type FileOverlap,
} from "@/lib/import/duplicates";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

export type DuplicatesPanelProps = {
  groups: DuplicateGroup[];
  state: DuplicateState;
  /** Every imported row, including rows currently set aside. */
  imported: { bank: Txn[]; ledger: Txn[] };
  overlaps: FileOverlap[];
  onSetAside: (txnIds: string[]) => void;
  onRestore: (txnIds: string[]) => void;
  onDismiss: (groupId: string, dismissed: boolean) => void;
};

const SIDE_LABEL = { bank: "Bank statement", ledger: "Your records" } as const;
const PAGE = 8;

function niceDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function range(start: string, end: string): string {
  return start === end ? niceDate(start) : formatPeriod(start, end);
}

function Chip({ tone, children }: { tone: "warn" | "good" | "muted"; children: React.ReactNode }) {
  const colors = {
    warn: { bg: "var(--warn-soft)", ink: "var(--warn-ink)" },
    good: { bg: "var(--good-soft)", ink: "var(--good-ink)" },
    muted: { bg: "var(--surface-2)", ink: "var(--ink-2)" },
  }[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 9px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
        background: colors.bg,
        color: colors.ink,
      }}
    >
      {children}
    </span>
  );
}

function OriginalRow({ txn }: { txn: Txn }) {
  const entries = Object.entries(txn.raw ?? {});
  if (entries.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--ink-3)", padding: "6px 0 2px" }}>
        The original columns weren&apos;t kept for this row.
      </div>
    );
  }
  return (
    <div
      data-testid="dup-original-row"
      className="mono"
      style={{
        display: "grid",
        gridTemplateColumns: "max-content 1fr",
        columnGap: 12,
        rowGap: 2,
        fontSize: 11.5,
        color: "var(--ink-2)",
        padding: "8px 10px",
        marginTop: 6,
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-sm, 8px)",
      }}
    >
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <span style={{ color: "var(--ink-3)" }}>{k}</span>
          <span style={{ wordBreak: "break-word" }}>{v === "" ? "—" : v}</span>
        </div>
      ))}
    </div>
  );
}

function GroupCard({
  group,
  state,
  byId,
  onSetAside,
  onRestore,
  onDismiss,
}: {
  group: DuplicateGroup;
  state: DuplicateState;
  byId: Map<string, Txn>;
} & Pick<DuplicatesPanelProps, "onSetAside" | "onRestore" | "onDismiss">) {
  const [open, setOpen] = useState<string | null>(null);
  const setAside = new Map(state.setAside.map((s) => [s.txnId, s.by]));
  const status = groupStatus(group, state);
  const rows = group.txnIds.map((id) => byId.get(id)).filter((t): t is Txn => Boolean(t));
  const first = rows[0];
  if (!first) return null;
  const inUse = rows.filter((t) => !setAside.has(t.id));
  const suggested = group.suggestedSetAsideIds.filter((id) => !setAside.has(id));
  const summary = describeDuplicateDecision(group, state);

  return (
    <div
      data-testid="dup-group"
      data-status={status}
      style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--r-md)",
        padding: "14px 16px",
        background: "var(--surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
            {first.description}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 1 }}>
            {SIDE_LABEL[group.side]} · {niceDate(first.date)} · appears {rows.length} times
            {group.kind === "cross-file" ? ` across ${group.files.length} files` : " in one file"}
          </div>
        </div>
        <span className="tnum" style={{ fontSize: 15, fontWeight: 600, flex: "none" }}>
          {money(first.amount)}
        </span>
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink-3)", marginTop: 10 }}>
        Why these rows were flagged
      </div>
      <ul style={{ margin: "4px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
        {group.evidence.map((e) => (
          <li
            key={e.code}
            data-testid="dup-evidence"
            style={{ display: "flex", gap: 8, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.45 }}
          >
            <Icon
              name={e.strong ? "check" : "help"}
              size={13}
              style={{ flex: "none", marginTop: 2, color: e.strong ? "var(--good-ink)" : "var(--warn-ink)" }}
            />
            <span>{e.text}</span>
          </li>
        ))}
      </ul>

      {/* Detection evidence above never changes. What happened since — and
          what counts right now — is stated separately, from live state. */}
      <dl
        data-testid="dup-decision"
        style={{
          margin: "10px 0 0",
          display: "grid",
          gridTemplateColumns: "max-content 1fr",
          columnGap: 10,
          rowGap: 3,
          fontSize: 12.5,
          color: "var(--ink-2)",
          lineHeight: 1.45,
        }}
      >
        <dt style={{ fontWeight: 600, color: "var(--ink)" }}>Automatic step</dt>
        <dd data-testid="dup-decision-automatic" style={{ margin: 0 }}>{summary.automatic}</dd>
        <dt style={{ fontWeight: 600, color: "var(--ink)" }}>Your decision</dt>
        <dd data-testid="dup-decision-user" style={{ margin: 0 }}>{summary.decision}</dd>
        <dt style={{ fontWeight: 600, color: "var(--ink)" }}>Current status</dt>
        <dd data-testid="dup-decision-status" style={{ margin: 0 }}>{summary.status}</dd>
      </dl>

      <div style={{ marginTop: 10, borderTop: "1px solid var(--line-2)" }}>
        {rows.map((t) => {
          const by = setAside.get(t.id);
          return (
            <div key={t.id} data-testid="dup-row" style={{ padding: "8px 0", borderBottom: "1px solid var(--line-2)" }}>
              <div className="m-wrap" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  className="mono"
                  data-testid="dup-row-source"
                  style={{ flex: "1 1 180px", minWidth: 0, fontSize: 12, color: "var(--ink)", wordBreak: "break-word" }}
                >
                  {sourceLabel(t) ?? "source not recorded"}
                </span>
                {by ? (
                  <Chip tone="muted">{by === "auto" ? "Set aside automatically" : "Set aside by you"}</Chip>
                ) : (
                  <Chip tone="good">In use</Chip>
                )}
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setOpen(open === t.id ? null : t.id)}
                  style={{ fontSize: 12, padding: "0 8px", height: 26 }}
                >
                  {open === t.id ? "Hide row" : "Show row"}
                </button>
                {by ? (
                  <Button variant="secondary" size="sm" data-testid="dup-restore" onClick={() => onRestore([t.id])}>
                    Restore
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    data-testid="dup-set-aside"
                    disabled={inUse.length <= 1}
                    title={inUse.length <= 1 ? "At least one copy stays in use" : undefined}
                    onClick={() => onSetAside([t.id])}
                  >
                    Set aside
                  </Button>
                )}
              </div>
              {open === t.id && <OriginalRow txn={t} />}
            </div>
          );
        })}
      </div>

      {status !== "resolved" && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 12 }}>
          {status === "needs-review" ? (
            <>
              {suggested.length > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  data-testid="dup-set-aside-repeats"
                  onClick={() => onSetAside(suggested)}
                >
                  {suggested.length === 1 ? "It's a repeat — set aside the copy" : `They're repeats — set aside ${suggested.length} copies`}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                data-testid="dup-keep-all"
                onClick={() => onDismiss(group.id, true)}
              >
                They&apos;re separate — keep all
              </Button>
            </>
          ) : (
            <>
              <Chip tone="good">You confirmed these are separate transactions</Chip>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => onDismiss(group.id, false)}
                style={{ fontSize: 12, padding: "0 8px", height: 26 }}
              >
                Undo
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  groups,
  testId,
  defaultOpen,
  render,
}: {
  title: string;
  hint: string;
  groups: DuplicateGroup[];
  testId: string;
  defaultOpen: boolean;
  render: (g: DuplicateGroup) => React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [limit, setLimit] = useState(PAGE);
  if (groups.length === 0) return null;
  return (
    <div data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 0",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--ink)",
        }}
      >
        <Icon name="chevR" size={14} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }} />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>
          {title} ({groups.length})
        </span>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{hint}</span>
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 8 }}>
          {groups.slice(0, limit).map(render)}
          {groups.length > limit && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setLimit((n) => n + PAGE * 3)}
              style={{ alignSelf: "center" }}
            >
              Show more ({groups.length - limit} left)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function DuplicatesPanel({
  groups,
  state,
  imported,
  overlaps,
  onSetAside,
  onRestore,
  onDismiss,
}: DuplicatesPanelProps) {
  const byId = useMemo(
    () => new Map([...imported.bank, ...imported.ledger].map((t) => [t.id, t])),
    [imported]
  );

  if (groups.length === 0 && overlaps.length === 0 && state.setAside.length === 0) return null;

  const setAsideIds = new Set(state.setAside.map((s) => s.txnId));
  const toCheck = groups.filter((g) => groupStatus(g, state) === "needs-review");
  const keptAll = groups.filter((g) => groupStatus(g, state) === "kept-all");
  const done = groups.filter(
    (g) => groupStatus(g, state) === "resolved" && g.txnIds.some((id) => setAsideIds.has(id))
  );
  const bank = importCounts(imported.bank, state);
  const ledger = importCounts(imported.ledger, state);
  // One-step resolution for possible duplicates where the files agree on
  // how many copies exist — always the user's decision, never automatic.
  const bulk = toCheck.flatMap((g) => g.suggestedSetAsideIds.filter((id) => !setAsideIds.has(id)));
  const bulkGroups = toCheck.filter((g) => g.suggestedSetAsideIds.some((id) => !setAsideIds.has(id))).length;

  const render = (g: DuplicateGroup) => (
    <GroupCard
      key={g.id}
      group={g}
      state={state}
      byId={byId}
      onSetAside={onSetAside}
      onRestore={onRestore}
      onDismiss={onDismiss}
    />
  );
  const counts = (label: string, c: typeof bank) => (
    <div data-testid={`dup-counts-${label === "Bank statement" ? "bank" : "ledger"}`}>
      <span style={{ fontWeight: 600, color: "var(--ink)" }}>{label}:</span> {c.imported} rows imported ·{" "}
      {c.inUse} in use · {c.setAside} set aside
    </div>
  );

  return (
    <div className="card m-pad" data-testid="duplicates-panel" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Repeated rows in your files</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>
            Nothing is ever deleted. Rows set aside are left out of the totals below and can be restored.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {toCheck.length > 0 && (
            <Chip tone="warn">
              {toCheck.length} possible {toCheck.length === 1 ? "duplicate" : "duplicates"} to check
            </Chip>
          )}
          {state.setAside.length > 0 && (
            <Chip tone="muted">
              {state.setAside.length} {state.setAside.length === 1 ? "row" : "rows"} set aside
            </Chip>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12.5, color: "var(--ink-2)", marginTop: 12 }}>
        {counts("Bank statement", bank)}
        {counts("Your records", ledger)}
      </div>

      {overlaps.length > 0 && (
        <div
          data-testid="dup-overlaps"
          style={{
            marginTop: 12,
            padding: "10px 12px",
            fontSize: 12.5,
            color: "var(--ink-2)",
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-sm, 8px)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--ink)" }}>Files covering the same dates</div>
          {overlaps.map((o) => (
            <div key={`${o.side}-${o.fileA}-${o.fileB}`}>
              {SIDE_LABEL[o.side]}: <span className="mono">{o.fileA}</span> and{" "}
              <span className="mono">{o.fileB}</span> both cover {range(o.start, o.end)} ({o.rowsA} and {o.rowsB}{" "}
              rows in those dates).
            </div>
          ))}
          <div style={{ color: "var(--ink-3)" }}>
            Overlapping dates alone don&apos;t mean rows are repeated — only the rows listed below actually
            appear more than once.
          </div>
        </div>
      )}

      {bulk.length > 0 && bulkGroups > 1 && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            fontSize: 12.5,
            color: "var(--ink-2)",
            background: "var(--warn-soft)",
            border: "1px solid var(--warn, #e7d39a)",
            borderRadius: "var(--r-sm, 8px)",
          }}
        >
          <span style={{ flex: 1, minWidth: 240 }}>
            {bulkGroups} possible duplicates look like the same rows exported more than once, but your files
            don&apos;t carry anything that proves it. If you know these files overlap, you can set the{" "}
            {bulk.length} later copies aside in one step — each can be restored.
          </span>
          <Button variant="secondary" size="sm" data-testid="dup-set-aside-all" onClick={() => onSetAside(bulk)}>
            Set aside all {bulk.length} copies
          </Button>
        </div>
      )}

      <div style={{ marginTop: 10, display: "flex", flexDirection: "column" }}>
        <Section
          title="To check"
          hint="still counted — tell us if these are repeats"
          groups={toCheck}
          testId="dup-section-check"
          defaultOpen
          render={render}
        />
        <Section
          title="Set aside"
          hint="not counted — restore any row"
          groups={done}
          testId="dup-section-set-aside"
          defaultOpen
          render={render}
        />
        <Section
          title="Kept as separate"
          hint="you confirmed these are different transactions"
          groups={keptAll}
          testId="dup-section-kept"
          defaultOpen={false}
          render={render}
        />
      </div>
    </div>
  );
}
