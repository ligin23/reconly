"use client";

// ============================================================
// Financial Review — month-by-month findings.
// A read-only view over lib/review/months (which groups the single
// full-range reconciliation by month). Every number shown comes from that
// module; nothing is calculated here.
// ============================================================

import { useEffect, useState } from "react";
import type { Txn } from "@/lib/recon/types";
import { money } from "@/lib/sample-data";
import { sourceLabel } from "@/lib/import/provenance";
import {
  MONTH_STATUS_LABEL,
  type MonthMatch,
  type MonthReview,
  type MonthStatus,
  type MonthSummary,
  type SideCounts,
} from "@/lib/review/months";
import {
  STATEMENT_STATUS_LABEL,
  statementIssueCount,
  summarizeStatements,
  type MonthStatementStatus,
  type StatementCheck,
  type StatementReview,
  type StatementStatus,
} from "@/lib/review/statements";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

const LIST_LIMIT = 25;

function niceDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatusChip({ status }: { status: MonthStatus }) {
  const tone =
    status === "no-unresolved-items"
      ? { bg: "var(--good-soft)", ink: "var(--good-ink)" }
      : status === "source-unverified"
      ? { bg: "var(--surface-2)", ink: "var(--ink-2)" }
      : { bg: "var(--warn-soft)", ink: "var(--warn-ink)" };
  return (
    <span
      data-testid="month-status"
      data-status={status}
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        background: tone.bg,
        color: tone.ink,
      }}
    >
      {MONTH_STATUS_LABEL[status]}
    </span>
  );
}

const STATEMENT_TONE: Record<MonthStatementStatus | StatementStatus, { bg: string; ink: string }> = {
  verified: { bg: "var(--good-soft)", ink: "var(--good-ink)" },
  "running-consistent": { bg: "var(--surface-2)", ink: "var(--ink-2)" },
  "convention-review": { bg: "var(--warn-soft)", ink: "var(--warn-ink)" },
  "partly-verified": { bg: "var(--surface-2)", ink: "var(--ink-2)" },
  insufficient: { bg: "var(--surface-2)", ink: "var(--ink-2)" },
  mismatch: { bg: "var(--warn-soft)", ink: "var(--warn-ink)" },
  conflict: { bg: "var(--warn-soft)", ink: "var(--warn-ink)" },
};

function StatementChip({ status, label }: { status: MonthStatementStatus | StatementStatus; label: string }) {
  const tone = STATEMENT_TONE[status];
  return (
    <span
      data-testid="statement-status"
      data-status={status}
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        background: tone.bg,
        color: tone.ink,
      }}
    >
      {label}
    </span>
  );
}

const cents = (c: number) => money(c);

/** "1 verified · 1 running balance consistent only · …" — non-zero parts only. */
export function statementCountsText(c: Record<StatementStatus, number>): string {
  const parts = [
    c.verified > 0 ? `${c.verified} verified` : "",
    c["running-consistent"] > 0 ? `${c["running-consistent"]} running balance consistent only` : "",
    c.mismatch > 0 ? `${c.mismatch} with a mismatch` : "",
    c.conflict > 0 ? `${c.conflict} conflicting` : "",
    c["convention-review"] > 0 ? `${c["convention-review"]} sign convention needs review` : "",
    c.insufficient > 0 ? `${c.insufficient} not verified` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "none checked";
}

/** One bank file's balance check: what was stated, what was found. */
export function StatementCheckLine({ s }: { s: StatementCheck }) {
  const value = (v: StatementCheck["opening"]) =>
    v === null
      ? "not stated"
      : `${cents(v.cents)}${v.source === "calculated" ? " (calculated, not stated in the file)" : v.source === "running" ? " (last running balance)" : v.line ? ` (stated, line ${v.line})` : " (stated)"}`;
  return (
    <div
      data-testid="statement-check"
      data-status={s.status}
      style={{ padding: "8px 0", borderTop: "1px solid var(--line-2)", fontSize: 12.5, color: "var(--ink-2)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>{s.file}</span>
        <StatementChip status={s.status} label={STATEMENT_STATUS_LABEL[s.status]} />
        {s.statedPeriod && (
          <span style={{ color: "var(--ink-3)" }}>
            states {niceDate(s.statedPeriod.start)} to {niceDate(s.statedPeriod.end)}
          </span>
        )}
      </div>
      <div data-testid="statement-figures" style={{ marginTop: 4 }}>
        Opening {value(s.opening)} · net activity {cents(s.netActivity)} across {s.rowCount} rows · closing{" "}
        {value(s.closing)}
        {s.difference !== null && s.difference !== 0 ? ` · difference ${cents(s.difference)}` : ""}
      </div>
      {s.reasons.map((r, i) => (
        <div key={i} style={{ marginTop: 3 }}>{r}</div>
      ))}
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-md)",
        background: "var(--surface)",
      }}
    >
      <div className="tnum" data-testid={testId} style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 3 }}>{label}</div>
    </div>
  );
}

function TxnLine({ t }: { t: Txn }) {
  return (
    <div
      data-testid="month-txn"
      style={{
        display: "grid",
        gridTemplateColumns: "92px 1fr auto",
        gap: 12,
        alignItems: "baseline",
        padding: "6px 0",
        borderTop: "1px solid var(--line-2)",
        fontSize: 13,
      }}
    >
      <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
        {niceDate(t.date)}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", color: "var(--ink)" }}>{t.description}</span>
        <span className="mono" data-testid="month-txn-source" style={{ display: "block", fontSize: 11, color: "var(--ink-3)" }}>
          {sourceLabel(t) ? `From ${sourceLabel(t)}` : "Source not recorded"}
        </span>
      </span>
      <span className="tnum" style={{ fontWeight: 600 }}>{money(t.amount)}</span>
    </div>
  );
}

function MatchLine({ m }: { m: MonthMatch }) {
  const side = (label: string, t: Txn) => (
    <div style={{ minWidth: 0 }}>
      <span style={{ color: "var(--ink-3)" }}>{label}: </span>
      <span className="mono" style={{ fontSize: 11.5 }}>{niceDate(t.date)}</span> · {t.description}
      <span className="mono" style={{ display: "block", fontSize: 11, color: "var(--ink-3)" }}>
        {sourceLabel(t) ? `From ${sourceLabel(t)}` : "Source not recorded"}
      </span>
    </div>
  );
  return (
    <div
      data-testid="month-match"
      style={{
        padding: "8px 0",
        borderTop: "1px solid var(--line-2)",
        fontSize: 13,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: m.status === "confirmed" ? "var(--good-ink)" : "var(--warn-ink)" }}>
          {m.status === "confirmed" ? "Confirmed match" : "Awaiting your yes or no"}
          {m.kind === "group" ? ` · one bank row, ${m.ledger.length} record rows` : ""}
        </span>
        <span className="tnum" style={{ fontWeight: 600 }}>{money(m.bank.amount)}</span>
      </div>
      {side("Bank", m.bank)}
      {m.ledger.map((l) => (
        <div key={l.id}>{side("Records", l)}</div>
      ))}
    </div>
  );
}

function List<T>({
  title,
  empty,
  items,
  render,
  testId,
}: {
  title: string;
  empty?: string;
  items: T[];
  render: (item: T, i: number) => React.ReactNode;
  testId: string;
}) {
  const [all, setAll] = useState(false);
  if (items.length === 0 && !empty) return null;
  const shown = all ? items : items.slice(0, LIST_LIMIT);
  return (
    <div data-testid={testId}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)", margin: "14px 0 4px" }}>
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{empty}</div>
      ) : (
        <>
          {shown.map(render)}
          {items.length > shown.length && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setAll(true)}
              style={{ marginTop: 6 }}
            >
              Show all {items.length}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function sideLine(label: string, c: SideCounts, handledWord: string) {
  return (
    <div data-testid={`month-side-${label === "Bank" ? "bank" : "ledger"}`}>
      <span style={{ fontWeight: 600, color: "var(--ink)" }}>{label}:</span> {c.imported} rows imported ·{" "}
      {c.inUse} in use · {c.setAside} set aside — of those in use: {c.matched} matched, {c.awaitingReview}{" "}
      awaiting review, {c.unmatched} unmatched, {c.handled} {handledWord}
    </div>
  );
}

function MonthDetail({ m, onOpenDuplicates }: { m: MonthSummary; onOpenDuplicates: () => void }) {
  const d = m.details;
  return (
    <div
      data-testid="month-detail"
      style={{
        padding: "14px 16px 16px",
        background: "var(--surface-2)",
        borderTop: "1px solid var(--line)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12.5, color: "var(--ink-2)" }}>
        {sideLine("Bank", m.bank, "added by you")}
        {sideLine("Your records", m.ledger, "marked as expected")}
        <div data-testid="month-match-counts">
          <span style={{ fontWeight: 600, color: "var(--ink)" }}>Matches counted in this month:</span>{" "}
          {m.confirmedMatches} confirmed, {m.awaitingReviewMatches} awaiting review
          {m.crossMonthMatches > 0
            ? ` · ${m.crossMonthMatches} involving another month (listed below; each is counted once, in its bank row's month)`
            : ""}
        </div>
      </div>

      {m.notes.map((n) => (
        <div key={n} style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 8 }}>
          <Icon name="help" size={12} style={{ marginRight: 6, color: "var(--ink-3)" }} />
          {n}
        </div>
      ))}

      <List
        title="On the bank statement, not in your records"
        items={d.unmatchedBank}
        render={(t) => <TxnLine key={t.id} t={t} />}
        testId="month-unmatched-bank"
      />
      <List
        title="In your records, not on the bank statement"
        items={d.unmatchedLedger}
        render={(t) => <TxnLine key={t.id} t={t} />}
        testId="month-unmatched-ledger"
      />
      <List
        title="Suggested matches awaiting your yes or no"
        items={d.awaitingReview}
        render={(x) => <MatchLine key={x.id} m={x} />}
        testId="month-awaiting"
      />
      <List
        title="Matches that cross into another month"
        items={d.crossMonth}
        render={(x) => <MatchLine key={x.id} m={x} />}
        testId="month-cross"
      />

      <div data-testid="month-statement" style={{ marginTop: 14 }}>
        {/* Focusable so "Show statements" can land here for keyboard and
            screen-reader users, not just scroll past it. */}
        <h3
          data-testid="month-statement-heading"
          tabIndex={-1}
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--ink)",
            margin: "0 0 4px",
            scrollMarginTop: 16,
            outlineOffset: 3,
          }}
        >
          Statement balance check — {m.label}
        </h3>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontSize: 12.5, color: "var(--ink-2)" }}>
          <StatementChip status={m.statement.status} label={m.statement.label} />
          <span>{m.statement.detail}</span>
        </div>
        {m.statement.statements.map((s) => (
          <StatementCheckLine key={s.file} s={s} />
        ))}
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
          This checks each bank file against its own stated balances. It is separate from matching and from the
          duplicate review, and it does not by itself mean the month is reconciled.
        </div>
      </div>

      {d.duplicateGroups.length > 0 && (
        <div data-testid="month-duplicates" style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
            Possible duplicates to review ({d.duplicateGroups.length})
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginBottom: 8 }}>
            These rows are still counted. Decide whether each is a repeat in the duplicate review.
          </div>
          <Button variant="secondary" size="sm" onClick={onOpenDuplicates} data-testid="month-open-duplicates">
            Open duplicate review
          </Button>
        </div>
      )}

      <List
        title="Set aside as repeated (not counted)"
        items={d.setAside}
        render={(t) => <TxnLine key={t.id} t={t} />}
        testId="month-set-aside"
      />

      {d.files.length > 0 && (
        <div data-testid="month-files" style={{ marginTop: 14, fontSize: 12.5, color: "var(--ink-2)" }}>
          <span style={{ fontWeight: 600, color: "var(--ink)" }}>Source files with rows in this month: </span>
          {d.files.map((f, i) => (
            <span key={`${f.side}-${f.name}`} className="mono" style={{ fontSize: 11.5 }}>
              {i > 0 ? " · " : ""}
              {f.name} ({f.side === "bank" ? "bank" : "records"}, {f.rows} {f.rows === 1 ? "row" : "rows"})
            </span>
          ))}
        </div>
      )}

      {m.flags.length === 0 && (
        <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 12 }}>
          Nothing unresolved was found among the rows uploaded for this month. That is not proof the month is
          complete or balanced — see “Coverage not verified” above.
        </div>
      )}
    </div>
  );
}

/** Fired to open and focus the statement balance results. */
export const SHOW_STATEMENTS_EVENT = "reconly:show-statements";

const STATEMENT_ATTENTION: readonly string[] = ["mismatch", "conflict", "convention-review"];

/** Scroll an element fully into view (top of the scroll area) and focus it. */
function revealAndFocus(el: HTMLElement | null) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function MonthReviewPanel({ review }: { review: MonthReview }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);
  // "Show statements" (feature tour, or anything else that fires the
  // event): open the month whose statement most needs attention — a
  // mismatch / conflict first, otherwise the first month — then bring its
  // statement check into view and move focus to its heading.
  const [statementJump, setStatementJump] = useState(0);
  useEffect(() => {
    const onShow = () => {
      const target =
        review.months.find((m) => STATEMENT_ATTENTION.includes(m.statement.status)) ?? review.months[0];
      if (!target) return;
      setSelected(target.month);
      setStatementJump((n) => n + 1);
    };
    window.addEventListener(SHOW_STATEMENTS_EVENT, onShow);
    return () => window.removeEventListener(SHOW_STATEMENTS_EVENT, onShow);
  }, [review]);
  useEffect(() => {
    if (statementJump === 0) return;
    revealAndFocus(document.querySelector<HTMLElement>('[data-testid="month-statement-heading"]'));
  }, [statementJump]);
  const o = review.overview;
  const selectedMonth = review.months.find((m) => m.month === selected) ?? null;
  const openDuplicates = () =>
    document
      .querySelector('[data-testid="duplicates-panel"]')
      ?.scrollIntoView({ behavior: "smooth", block: "start" });

  const th: React.CSSProperties = {
    textAlign: "left",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--ink-3)",
    padding: "8px 10px",
    borderBottom: "1px solid var(--line)",
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = { padding: "10px", fontSize: 13, verticalAlign: "top" };
  const num: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  return (
    <div className="card m-pad" data-testid="month-review" style={{ padding: "20px 22px" }}>
      <span className="eyebrow" style={{ color: "var(--accent-ink)" }}>Financial review</span>
      <h2
        className="serif"
        data-testid="month-review-title"
        style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", margin: "6px 0 4px" }}
      >
        Financial Review — {review.rangeLabel}
      </h2>
      <p style={{ fontSize: 13, color: "var(--ink-2)", margin: 0, maxWidth: 720, textWrap: "pretty" }}>
        What we found in the files you uploaded, month by month. Transactions were matched across the whole
        period first, then grouped by their own date — so a payment recorded in one month and cleared in the
        next still counts as matched.
      </p>

      <div className="m-grid-2" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 16 }}>
        <Stat label="Months analyzed" value={o.monthsAnalyzed} testId="mr-months" />
        <Stat label="Months with unresolved findings" value={o.monthsWithFindings} testId="mr-months-findings" />
        <Stat label="Unmatched transactions" value={o.unmatchedTransactions} testId="mr-unmatched" />
        <Stat label="Possible duplicates to review" value={o.duplicateGroupsToReview} testId="mr-duplicates" />
      </div>
      <div data-testid="mr-statements" style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 8 }}>
        <span style={{ fontWeight: 600, color: "var(--ink)" }}>Statement balances:</span>{" "}
        {statementCountsText(o.statements)}
      </div>
      <div data-testid="mr-secondary" style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 4 }}>
        {o.awaitingReviewMatches} suggested {o.awaitingReviewMatches === 1 ? "match is" : "matches are"} awaiting
        your yes or no · {o.confirmedMatches} confirmed {o.confirmedMatches === 1 ? "match" : "matches"} ·{" "}
        {o.crossMonthMatches} {o.crossMonthMatches === 1 ? "match crosses" : "matches cross"} a month boundary
      </div>

      <div
        data-testid="mr-coverage"
        style={{
          marginTop: 14,
          padding: "10px 12px",
          fontSize: 12.5,
          color: "var(--ink-2)",
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-sm, 8px)",
        }}
      >
        <div className="m-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>
            <span style={{ fontWeight: 600, color: "var(--ink)" }}>{review.coverage.label}.</span> These statuses
            describe the uploaded records only; a month with nothing unresolved is not necessarily complete or
            balanced.
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="mr-coverage-toggle"
            aria-expanded={showCoverage}
            onClick={() => setShowCoverage((s) => !s)}
            style={{ flex: "none" }}
          >
            {showCoverage ? "Hide" : `What we could check (${review.coverage.findings.length})`}
          </button>
        </div>
        {showCoverage && (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
            {review.coverage.findings.map((f, i) => (
              <li key={i} data-testid="mr-coverage-finding" data-kind={f.kind}>
                {f.text}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Scrolls sideways on a narrow window instead of clipping columns. */}
      <div style={{ marginTop: 16, border: "1px solid var(--line)", borderRadius: "var(--r-md)", overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 860, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              <th style={th}>Month</th>
              <th style={{ ...th, textAlign: "right" }} title="Rows in use (rows set aside as repeated are shown separately)">Bank rows</th>
              <th style={{ ...th, textAlign: "right" }} title="Rows in use from your own records">Records rows</th>
              <th style={{ ...th, textAlign: "right" }} title="Rows on either side with no match">Unmatched</th>
              <th style={{ ...th, textAlign: "right" }} title="Suggested matches awaiting your yes or no">To review</th>
              <th style={{ ...th, textAlign: "right" }} title="Possible duplicate groups not yet decided">Duplicate<br />questions</th>
              <th style={th} title="Findings from matching and duplicate review">Findings</th>
              <th style={th} title="Each bank file checked against its own stated balances">Statement balance</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {review.months.map((m) => {
              const open = selected === m.month;
              return (
                  <tr
                    key={m.month}
                    data-testid="month-row"
                    data-month={m.month}
                    style={{
                      borderTop: "1px solid var(--line-2)",
                      background: open ? "var(--surface-2)" : undefined,
                    }}
                  >
                    <td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>
                      {/* The month name opens its details too, so on a narrow
                          screen there is no need to scroll the table sideways
                          to reach the button at the far end. */}
                      <button
                        type="button"
                        data-testid="month-name"
                        aria-expanded={open}
                        onClick={() => setSelected(open ? null : m.month)}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          font: "inherit",
                          fontWeight: 600,
                          color: "var(--ink)",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        {m.label}
                      </button>
                    </td>
                    <td style={num} data-testid="month-bank-rows">
                      {m.bank.inUse}
                      {m.bank.setAside > 0 && (
                        <span style={{ display: "block", fontSize: 11, color: "var(--ink-3)" }}>
                          +{m.bank.setAside} set aside
                        </span>
                      )}
                    </td>
                    <td style={num} data-testid="month-ledger-rows">
                      {m.ledger.inUse}
                      {m.ledger.setAside > 0 && (
                        <span style={{ display: "block", fontSize: 11, color: "var(--ink-3)" }}>
                          +{m.ledger.setAside} set aside
                        </span>
                      )}
                    </td>
                    <td style={num} data-testid="month-unmatched">{m.bank.unmatched + m.ledger.unmatched}</td>
                    <td style={num} data-testid="month-to-review">{m.awaitingReviewMatches}</td>
                    <td style={num} data-testid="month-dup">{m.duplicateGroupsToReview}</td>
                    <td style={td}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {m.flags.length === 0 ? (
                          <StatusChip status="no-unresolved-items" />
                        ) : (
                          m.flags.map((f) => <StatusChip key={f} status={f} />)
                        )}
                      </div>
                      {m.crossMonthMatches > 0 && (
                        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 3 }}>
                          {m.crossMonthMatches} cross-month {m.crossMonthMatches === 1 ? "match" : "matches"}
                        </div>
                      )}
                    </td>
                    <td style={td} data-testid="month-statement-cell">
                      <StatementChip status={m.statement.status} label={m.statement.label} />
                    </td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        data-testid="month-view"
                        aria-expanded={open}
                        onClick={() => setSelected(open ? null : m.month)}
                      >
                        {open ? "Hide details" : "View details"}
                      </button>
                    </td>
                  </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* The selected month's findings, below the table so long lists and
          source references have the full width. */}
      {selectedMonth && (
        <div
          style={{
            marginTop: 12,
            border: "1px solid var(--line)",
            borderRadius: "var(--r-md)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px",
              background: "var(--surface)",
            }}
          >
            <span data-testid="month-detail-title" style={{ fontSize: 14, fontWeight: 600 }}>
              {selectedMonth.label} — findings
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <MonthDetail m={selectedMonth} onOpenDuplicates={openDuplicates} />
        </div>
      )}
    </div>
  );
}

/**
 * Compact "Source checks" card for single-month data, where the month
 * panel is hidden: the statement balance results and the coverage notes
 * still need to be seen.
 */
export function SourceChecksCard({ review, statements }: { review: MonthReview; statements: StatementReview }) {
  const [open, setOpen] = useState(false);
  // Single-month data has no month table: "Show statements" opens this card.
  const [statementJump, setStatementJump] = useState(0);
  useEffect(() => {
    const onShow = () => {
      setOpen(true);
      setStatementJump((n) => n + 1);
    };
    window.addEventListener(SHOW_STATEMENTS_EVENT, onShow);
    return () => window.removeEventListener(SHOW_STATEMENTS_EVENT, onShow);
  }, []);
  useEffect(() => {
    if (statementJump === 0) return;
    revealAndFocus(document.querySelector<HTMLElement>('[data-testid="source-checks-headline"]'));
  }, [statementJump]);
  const c = statements.counts;
  const warnings = review.coverage.findings.filter(
    (f) => f.kind !== "balances-not-provided" && f.kind !== "statement-balances"
  );
  const summary = summarizeStatements(c);
  const headline =
    statements.statements.length === 0
      ? "Statement balances: Not verified — no statement information is available for this reconciliation"
      : summary === "not-verified"
      ? "Statement balances: Not verified — the uploaded bank file does not carry enough balance information to check"
      : `Statement balances: ${statementCountsText(c)}`;
  const problem = statementIssueCount(c) > 0;
  return (
    <div className="card" data-testid="source-checks" style={{ padding: "14px 18px", fontSize: 13 }}>
      <div className="m-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ color: "var(--ink-3)", marginBottom: 3 }}>Source checks</div>
          <span
            data-testid="source-checks-headline"
            tabIndex={-1}
            style={{
              scrollMarginTop: 16, fontWeight: 600, color: problem ? "var(--warn-ink)" : "var(--ink)" }}
          >
            {headline}
          </span>
          <span style={{ color: "var(--ink-2)" }}>
            {" "}· {review.coverage.label}
            {warnings.length > 0 ? ` · ${warnings.length} source ${warnings.length === 1 ? "note" : "notes"}` : ""}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          data-testid="source-checks-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{ flex: "none" }}
        >
          {open ? "Hide" : "Details"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          {statements.statements.map((s) => (
            <StatementCheckLine key={s.file} s={s} />
          ))}
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, color: "var(--ink-2)" }}>
            {review.coverage.findings.map((f, i) => (
              <li key={i} data-testid="source-checks-finding" data-kind={f.kind}>{f.text}</li>
            ))}
          </ul>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>
            A statement check compares a bank file with its own stated balances. It is a separate check from
            transaction matching: a mismatch or conflict withholds “Fully reconciled”, while missing balance
            information is only reported as “Not verified”.
          </div>
        </div>
      )}
    </div>
  );
}
