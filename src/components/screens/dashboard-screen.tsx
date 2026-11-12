"use client";

import { useState } from "react";
import {
  money,
  type Counts,
  type MissingTxn,
  type ReviewItem,
  type AnyReviewItem,
  type SimpleTxn,
} from "@/lib/sample-data";
import { type BalanceProof } from "@/lib/recon/types";
import { VERDICT_LABEL, type Verdict } from "@/lib/recon/verdict";
import { formatBreakdownAmount, type DecidedItem } from "@/lib/recon/adapter";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { KpiCard } from "@/components/ui/kpi-card";
import { TxnRow } from "@/components/ui/txn-row";
import { MissingItemRow } from "@/components/ui/missing-item-row";
import { InsightCard } from "@/components/ui/insight-card";
import { EmptyState } from "@/components/ui/empty-state";
import { DuplicatesPanel, type DuplicatesPanelProps } from "@/components/duplicates-panel";
import { MonthReviewPanel, SourceChecksCard } from "@/components/month-review-panel";
import type { MonthReview } from "@/lib/review/months";
import { STATEMENT_SUMMARY_LABEL, type StatementReview } from "@/lib/review/statements";
import { statementOutcomeText } from "@/lib/review/statement-summary";
import {
  NET_LABELS,
  netDifference,
  netDifferenceBreakdown,
  netDifferenceSentence,
  signedDollars,
  type NetDifference,
} from "@/lib/review/net-difference";

// ---- Breakdown (right side of status hero) --------------------------

function Breakdown({
  reconciled,
  balanceProof,
  unexplained,
  net,
}: {
  reconciled: boolean;
  balanceProof?: BalanceProof;
  unexplained: number;
  /** Signed figures and what contributes; absent on non-engine renders. */
  net?: NetDifference;
}) {
  const Row = ({
    label,
    value,
    strong,
    tone,
  }: {
    label: string;
    value: string;
    strong?: boolean;
    tone?: "warn" | "good";
  }) => (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        padding: "9px 0",
      }}
    >
      <span
        style={{
          fontSize: 13.5,
          color: strong ? "var(--ink)" : "var(--ink-2)",
          fontWeight: strong ? 600 : 500,
        }}
      >
        {label}
      </span>
      <span
        className="tnum"
        style={{
          whiteSpace: "nowrap",
          fontSize: strong ? 15 : 14,
          fontWeight: strong ? 700 : 500,
          color:
            tone === "warn"
              ? "var(--warn-ink)"
              : tone === "good"
              ? "var(--good-ink)"
              : "var(--ink)",
        }}
      >
        {value}
      </span>
    </div>
  );

  // Derive display strings from balance proof if available, otherwise use
  // static values kept for visual parity during any non-engine render.
  const bankDisplay = balanceProof
    ? formatBreakdownAmount(balanceProof.bankNetChange)
    : "$8,412.66";
  const booksDisplay = balanceProof
    ? formatBreakdownAmount(balanceProof.ledgerNetChange)
    : reconciled
    ? "$8,412.66"
    : "$8,447.66";

  return (
    <div
      className="m-breakdown"
      style={{
        padding: "24px 26px",
        borderLeft: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <Row label={NET_LABELS.bank} value={bankDisplay} />
      <div style={{ height: 1, background: "var(--line-2)" }} />
      <Row label={NET_LABELS.ledger} value={booksDisplay} />
      {net && net.addedNet !== 0 && (
        <>
          <div style={{ height: 1, background: "var(--line-2)" }} />
          <Row label="Bank items you added to the reconciliation" value={signedDollars(net.addedNet)} />
        </>
      )}
      <div style={{ height: 1, background: "var(--line)" }} />
      <div data-testid="net-difference-row">
        <Row
          label={NET_LABELS.difference}
          value={
            reconciled
              ? "$0.00"
              : // Signed: negative means the bank total is the lower one.
                signedDollars(net ? net.difference : balanceProof?.unexplainedDifference ?? unexplained)
          }
          strong
          tone={reconciled ? "good" : "warn"}
        />
      </div>
      <div data-testid="net-scope-note" style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.4, marginTop: 4 }}>
        {NET_LABELS.scope}
      </div>
    </div>
  );
}

// ---- Status hero ----------------------------------------------------

function StatusHero({
  reconciled,
  unexplained,
  balanceProof,
  onReview,
  reviewLeft = 0,
  verdict,
  net,
}: {
  reconciled: boolean;
  unexplained: number;
  balanceProof?: BalanceProof;
  net?: NetDifference;
  onReview: () => void;
  /** Suggested pairs still awaiting a yes/no — blocks "Fully reconciled". */
  reviewLeft?: number;
  verdict?: Verdict;
}) {
  // Money agrees and nothing is open, but possible duplicates haven't been
  // ruled on. Not a discrepancy and not an all-clear — its own state.
  if (
    verdict &&
    (verdict.status === "totals-agree-duplicate-review" ||
      verdict.status === "transactions-match-statement-review" ||
      verdict.status === "transactions-match-duplicate-and-statement-review")
  ) {
    const n = verdict.unresolvedDuplicateGroups;
    const files = verdict.statementFilesNeedingReview;
    const duplicatesPart =
      n > 0
        ? `${n} possible duplicate ${n === 1 ? "group still needs" : "groups still need"} your decision`
        : "";
    const statementPart =
      files > 0
        ? `${files} bank ${files === 1 ? "file's own balances need" : "files' own balances need"} review (they don't add up, conflict, or their sign convention is unclear)`
        : "";
    const needs = [duplicatesPart, statementPart].filter(Boolean).join(", and ");
    const target = n > 0 ? "duplicates-panel" : "month-review";
    return (
      <div
        className="card m-stack"
        data-testid="recon-status"
        data-verdict={verdict.status}
        style={{
          padding: 0,
          overflow: "hidden",
          borderColor: "oklch(0.88 0.06 60)",
          display: "grid",
          gridTemplateColumns: "1.3fr 1fr",
        }}
      >
        <div
          style={{
            padding: "26px 28px",
            background: "linear-gradient(135deg, var(--warn-soft), var(--surface) 80%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <span className="eyebrow" style={{ color: "var(--warn-ink)" }}>
              Reconciliation status
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
            <span
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "var(--warn)",
                color: "#fff",
                display: "grid",
                placeItems: "center",
                flex: "none",
              }}
            >
              <Icon name="search" size={26} stroke={2.2} />
            </span>
            <div>
              <div
                className="serif"
                style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.1 }}
              >
                {VERDICT_LABEL[verdict.status]}
              </div>
              <div style={{ fontSize: 14.5, color: "var(--ink-2)", marginTop: 5, textWrap: "pretty" }}>
                Your bank and your records agree and nothing is unmatched. {needs} before this
                period can be marked complete.
              </div>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            iconRight="arrowRight"
            data-testid="review-duplicates-btn"
            onClick={() =>
              (
                document.querySelector(`[data-testid="${target}"]`) ??
                document.querySelector('[data-testid="source-checks"]')
              )?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            {n > 0 ? "Review duplicates" : "Review statement checks"}
          </Button>
        </div>
        {/* The financial side is clean — show it that way. */}
        <Breakdown reconciled balanceProof={balanceProof} unexplained={0} net={net} />
      </div>
    );
  }

  if (reconciled) {
    return (
      <div
        className="card m-stack"
        data-testid="recon-status"
        style={{
          padding: 0,
          overflow: "hidden",
          borderColor: "oklch(0.86 0.06 158)",
          display: "grid",
          gridTemplateColumns: "1.3fr 1fr",
        }}
      >
        <div
          style={{
            padding: "26px 28px",
            background:
              "linear-gradient(135deg, var(--good-soft), var(--surface) 80%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <span className="eyebrow" style={{ color: "var(--good-ink)" }}>
              Reconciliation status
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "var(--good)",
                color: "#fff",
                display: "grid",
                placeItems: "center",
                flex: "none",
                boxShadow: "0 6px 18px oklch(0.56 0.11 158 / 0.35)",
              }}
            >
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <div>
              <div
                className="serif"
                style={{
                  fontSize: 30,
                  fontWeight: 600,
                  letterSpacing: "-0.025em",
                  lineHeight: 1.05,
                }}
              >
                Fully reconciled
              </div>
              <div style={{ fontSize: 14.5, color: "var(--ink-2)", marginTop: 3 }}>
                Your books match your bank, down to the penny.
              </div>
              {verdict && verdict.statement !== "verified" && (
                <div data-testid="reconciled-statement-note" style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6, maxWidth: 420 }}>
                  {verdict.statement === "not-verified"
                    ? "Statement balances: Not verified — the uploaded bank files don't carry enough balance information to check."
                    : verdict.statement === "running-balance-only"
                    ? "Statement balances: running balance is consistent, but stated opening and closing balances were not independently verified."
                    : "Statement balances: verified for some bank files only."}
                </div>
              )}
            </div>
          </div>
        </div>
        <Breakdown reconciled balanceProof={balanceProof} unexplained={0} net={net} />
      </div>
    );
  }

  return (
    <div
      className="card m-stack"
      data-testid="recon-status"
      style={{
        padding: 0,
        overflow: "hidden",
        borderColor: "oklch(0.88 0.06 60)",
        display: "grid",
        gridTemplateColumns: "1.3fr 1fr",
      }}
    >
      <div
        style={{
          padding: "26px 28px",
          background:
            "linear-gradient(135deg, var(--warn-soft), var(--surface) 80%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span className="eyebrow" style={{ color: "var(--warn-ink)" }}>
            Reconciliation status
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <span
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "var(--warn)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              flex: "none",
              boxShadow: "0 6px 18px oklch(0.74 0.13 73 / 0.35)",
            }}
          >
            <Icon name="alert" size={28} stroke={2.2} />
          </span>
          <div>
            <div
              className="serif tnum"
              style={{
                fontSize: 32,
                fontWeight: 600,
                letterSpacing: "-0.03em",
                lineHeight: 1,
                color: "var(--ink)",
              }}
            >
              {unexplained === 0 && reviewLeft > 0 ? (
                <span style={{ color: "var(--warn-ink)" }}>Almost there</span>
              ) : (
                <>
                  {money(unexplained)}{" "}
                  <span style={{ color: "var(--warn-ink)" }}>net difference</span>
                </>
              )}
            </div>
            <div style={{ fontSize: 14.5, color: "var(--ink-2)", marginTop: 5 }}>
              {unexplained === 0 && reviewLeft > 0
                ? `The totals line up — ${reviewLeft} suggested ${reviewLeft === 1 ? "pair needs" : "pairs need"} your confirmation.`
                : unexplained === 0
                ? "The net totals are equal, but items are still unmatched — equal totals alone do not mean the period is reconciled."
                : net
                ? netDifferenceSentence(net)
                : "Bank net activity and ledger net activity are different."}
            </div>
            {net && netDifferenceBreakdown(net).length > 0 && (
              <ul
                data-testid="net-breakdown"
                style={{ margin: "8px 0 0", padding: 0, listStyle: "none", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}
              >
                {netDifferenceBreakdown(net).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <Button variant="primary" size="sm" iconRight="arrowRight" onClick={onReview}>
          Let&apos;s clear it up
        </Button>
      </div>
      <Breakdown
        reconciled={false}
        unexplained={unexplained}
        balanceProof={balanceProof}
        net={net}
      />
    </div>
  );
}

// ---- Review decisions already made (find them again; take one back) --

function DecidedList({ items, onUndo }: { items: DecidedItem[]; onUndo?: (id: string) => void }) {
  const accepted = items.filter((i) => i.decision === "accepted").length;
  const rejected = items.length - accepted;
  return (
    <div data-testid="decided-list" style={{ borderBottom: "1px solid var(--line)", background: "var(--surface-2)" }}>
      <div style={{ padding: "12px 18px 8px", fontSize: 13, color: "var(--ink-2)" }}>
        <span style={{ fontWeight: 600, color: "var(--ink)" }}>Your review decisions ({items.length})</span>
        {" "}· {accepted} confirmed · {rejected} rejected. Changed your mind? Undo puts a pair back in the review
        queue.
      </div>
      {items.map((d) => (
        <div
          key={d.id}
          data-testid="decided-item"
          data-decision={d.decision}
          data-kind={d.kind}
          className="m-wrap"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 18px",
            borderTop: "1px solid var(--line-2)",
          }}
        >
          <span style={{ flex: "1 1 260px", minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 500, color: "var(--ink)" }}>
              {d.bankDate} · {d.bankDesc} · {money(d.amount)}
            </span>
            <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)", wordBreak: "break-word" }}>
              {d.decision === "accepted" ? "Matched with" : "Not matched with"} {d.kind === "group" ? d.booksDesc : `${d.booksDate} · ${d.booksDesc}`}
              {d.kind === "group" ? " (grouped match)" : ""}
              {d.crossMonth ? " · crosses a month boundary" : ""}
            </span>
          </span>
          <span
            className="pill"
            style={{
              flex: "none",
              fontSize: 11.5,
              fontWeight: 600,
              padding: "2px 9px",
              borderRadius: 999,
              background: d.decision === "accepted" ? "var(--good-soft)" : "var(--warn-soft)",
              color: d.decision === "accepted" ? "var(--good-ink)" : "var(--warn-ink)",
            }}
          >
            {d.decision === "accepted" ? "Confirmed by you" : "Rejected by you"}
          </span>
          <Button
            variant="secondary"
            size="sm"
            data-testid="undo-decision"
            title={`Put ${d.bankDesc} (${d.bankDate}) back in the review queue`}
            onClick={onUndo ? () => onUndo(d.id) : undefined}
          >
            Undo
          </Button>
        </div>
      ))}
    </div>
  );
}

// ---- TxnLists -------------------------------------------------------

function ListNote({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "12px 18px",
        fontSize: 13,
        color: "var(--ink-2)",
        background: "var(--surface-2)",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Icon name="help" size={15} style={{ color: "var(--ink-3)", flex: "none" }} />
      <span style={{ textWrap: "pretty" }}>{text}</span>
    </div>
  );
}

function ResolvedChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
      <span
        className="pill pill--matched"
        style={{ fontSize: 12, gap: 5, whiteSpace: "nowrap" }}
      >
        <Icon name="check" size={11} stroke={2.5} />
        {label}
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={onRemove}
        style={{ fontSize: 12, padding: "0 8px", height: 26 }}
        data-testid="remove-added-btn"
      >
        Undo
      </button>
    </span>
  );
}

function TxnLists({
  counts,
  missingBooks,
  addedToReconciliation,
  missingBank,
  acknowledgedBank,
  reviewItems,
  matched,
  matchedExtra,
  onOpenReview,
  onAddToBooks,
  onRemoveAdded,
  onAcknowledgeMissingBank,
  onUnacknowledgeMissingBank,
  amountHints,
  decided = [],
  onUndoDecision,
}: {
  decided?: DecidedItem[];
  onUndoDecision?: (id: string) => void;
  amountHints?: Record<string, string>;
  counts: Counts;
  missingBooks: MissingTxn[];
  addedToReconciliation: MissingTxn[];
  missingBank: MissingTxn[];
  acknowledgedBank: MissingTxn[];
  reviewItems: AnyReviewItem[];
  matched: SimpleTxn[];
  matchedExtra: number;
  onOpenReview: () => void;
  onAddToBooks?: (tx: MissingTxn) => void;
  onRemoveAdded?: (txnId: string) => void;
  onAcknowledgeMissingBank?: (tx: MissingTxn) => void;
  onUnacknowledgeMissingBank?: (txnId: string) => void;
}) {
  const [tab, setTab] = useState<"matched" | "review" | "missingBooks" | "missingBank">(
    "review"
  );
  const TABS = [
    { key: "matched", label: "Matched", count: counts.matched },
    { key: "review", label: "Needs review", count: counts.review },
    { key: "missingBooks", label: "Not in your records", count: counts.missingFromBooks },
    { key: "missingBank", label: "In your records only", count: counts.missingFromBank },
  ] as const;

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div
        className="m-scroll-x"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 22,
          padding: "0 22px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        {TABS.map((t) => (
          <button
            type="button"
            key={t.key}
            className="tab"
            data-active={tab === t.key ? "" : undefined}
            data-testid={
              t.key === "missingBooks" ? "tab-missing-books" : t.key === "missingBank" ? "tab-missing-bank" : undefined
            }
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className="count">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === "matched" &&
        (counts.matched === 0 ? (
          <EmptyState
            icon="search"
            tone="muted"
            title="Nothing matched yet"
            body="Once we line up transactions, they'll show here."
          />
        ) : (
          <div>
            {matched.map((tx, i) => (
              <TxnRow key={i} tx={tx} sub={tx.detail} pill={<StatusPill kind="matched" />} />
            ))}
            {matchedExtra > 0 && (
              <div
                style={{
                  padding: "14px 18px",
                  borderTop: "1px solid var(--line-2)",
                  fontSize: 13,
                  color: "var(--ink-3)",
                  textAlign: "center",
                  background: "var(--surface-2)",
                }}
              >
                + {matchedExtra} more matched transactions
              </div>
            )}
          </div>
        ))}

      {tab === "review" && decided.length > 0 && (
        <DecidedList items={decided} onUndo={onUndoDecision} />
      )}

      {tab === "review" &&
        (reviewItems.length === 0 ? (
          <EmptyState
            icon="checkCircle"
            title="All caught up"
            body={
              decided.length > 0
                ? "You've answered every pair we weren't sure about. Your decisions are listed above — undo any of them to decide again."
                : "You've reviewed every pair we weren't sure about. Nice work."
            }
          />
        ) : (
          <div>
            {reviewItems.map((r) => {
              const isComposite = "matchType" in r && r.matchType === "composite";
              const tx = isComposite
                ? { date: r.bankDate, desc: r.bankDesc, amount: r.bankAmount, type: r.bankTxnType }
                : { date: (r as ReviewItem).bank.date, desc: (r as ReviewItem).bank.desc, amount: (r as ReviewItem).amount, type: (r as ReviewItem).type };
              const sub = isComposite
                ? `Group (${r.components.length} items) · ${r.ambiguous ? "needs your pick" : money(r.bankAmount)}`
                : `Maybe: ${(r as ReviewItem).books.desc} · ${(r as ReviewItem).confidence}% sure`;
              return (
                <TxnRow
                  key={r.id}
                  tx={tx}
                  sub={sub}
                  pill={<StatusPill kind="review" />}
                  onClick={onOpenReview}
                />
              );
            })}
            <div
              style={{
                padding: "13px 18px",
                borderTop: "1px solid var(--line-2)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "var(--surface-2)",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>
                Work through these one at a time.
              </span>
              <Button
                variant="secondary"
                size="sm"
                iconRight="arrowRight"
                onClick={onOpenReview}
              >
                Open review
              </Button>
            </div>
          </div>
        ))}

      {tab === "missingBooks" && (
        <div>
          <ListNote text="These are on your bank statement but not in your records yet. Add them to your reconciliation so your report is complete — you or your accountant can record them in your books afterwards." />
          {missingBooks.length === 0 && addedToReconciliation.length === 0 ? (
            <EmptyState icon="checkCircle" title="Nothing here" body="Every bank transaction has a matching entry in your records." />
          ) : (
            <>
              {missingBooks.map((tx) => (
                <MissingItemRow
                  key={tx.txnId}
                  tx={tx}
                  hint={tx.hint}
                  flag={amountHints?.[tx.txnId]}
                  actionLabel="Add to my reconciliation"
                  actionIcon="plus"
                  onAction={onAddToBooks ? () => onAddToBooks(tx) : undefined}
                />
              ))}
              {addedToReconciliation.map((tx) => (
                <MissingItemRow
                  key={tx.txnId}
                  tx={tx}
                  hint={tx.hint}
                  actionLabel=""
                  resolvedNode={
                    <ResolvedChip
                      label="Added to reconciliation"
                      onRemove={() => onRemoveAdded?.(tx.txnId)}
                    />
                  }
                />
              ))}
            </>
          )}
        </div>
      )}

      {tab === "missingBank" && (
        <div>
          <ListNote text="These entries have no confirmed bank match. Review them to determine why — for example a payment the bank hasn't processed yet, an amount entered differently, or an entry that doesn't belong. If you know an entry is simply waiting to clear, you can mark it as expected." />
          {missingBank.length === 0 && acknowledgedBank.length === 0 ? (
            <EmptyState icon="checkCircle" title="Nothing here" body="Every entry in your records has a confirmed bank match." />
          ) : (
            <>
              {missingBank.map((tx) => (
                <MissingItemRow
                  key={tx.txnId}
                  tx={tx}
                  hint={tx.hint}
                  flag={amountHints?.[tx.txnId]}
                  actionLabel="Mark as expected"
                  actionIcon="check"
                  onAction={onAcknowledgeMissingBank ? () => onAcknowledgeMissingBank(tx) : undefined}
                />
              ))}
              {acknowledgedBank.map((tx) => (
                <MissingItemRow
                  key={tx.txnId}
                  tx={tx}
                  hint={tx.hint}
                  actionLabel=""
                  resolvedNode={
                    <ResolvedChip
                      label="Marked by you as expected"
                      onRemove={() => onUnacknowledgeMissingBank?.(tx.txnId)}
                    />
                  }
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- DashboardScreen ------------------------------------------------

export type DashboardScreenProps = {
  counts: Counts;
  reconciled: boolean;
  unexplained: number;
  balanceProof?: BalanceProof;
  reviewItems: AnyReviewItem[];
  matched: SimpleTxn[];
  matchedExtraCount: number;
  missingFromBooks: MissingTxn[];
  addedToReconciliation: MissingTxn[];
  missingFromBank: MissingTxn[];
  acknowledgedBank: MissingTxn[];
  onOpenReview: () => void;
  onAddToBooks?: (tx: MissingTxn) => void;
  onRemoveAdded?: (txnId: string) => void;
  onAcknowledgeMissingBank?: (tx: MissingTxn) => void;
  onUnacknowledgeMissingBank?: (txnId: string) => void;
  /** Financial status and duplicate-review status, kept separate. */
  verdict?: Verdict;
  /** Month-by-month findings; shown only when the data spans several months. */
  monthReview?: MonthReview;
  /** Statement balance verification (separate from the verdict). */
  statementReview?: StatementReview;
  /** Duplicate review for this import; the panel hides itself when empty. */
  duplicates?: DuplicatesPanelProps;
  /** txnId → "possible amount difference" note (informational only). */
  amountHints?: Record<string, string>;
  /** Suggestions the user has already answered, and how to take one back. */
  decided?: DecidedItem[];
  onUndoDecision?: (id: string) => void;
};

export function DashboardScreen({
  counts,
  reconciled,
  unexplained,
  balanceProof,
  reviewItems,
  matched,
  matchedExtraCount,
  missingFromBooks,
  addedToReconciliation,
  missingFromBank,
  acknowledgedBank,
  onOpenReview,
  onAddToBooks,
  onRemoveAdded,
  onAcknowledgeMissingBank,
  onUnacknowledgeMissingBank,
  verdict,
  monthReview,
  statementReview,
  duplicates,
  amountHints,
  decided,
  onUndoDecision,
}: DashboardScreenProps) {
  const reviewLeft = counts.review;
  const signed = (t: { amount: number; type: "in" | "out" }) => ({ amount: t.type === "in" ? t.amount : -t.amount });
  // What the difference is made of — arithmetic only, never a cause.
  const net = balanceProof
    ? netDifference({
        bankNet: balanceProof.bankNetChange,
        ledgerNet: balanceProof.ledgerNetChange,
        added: addedToReconciliation.map(signed),
        bankOnly: missingFromBooks.map(signed),
        ledgerOnly: [...missingFromBank, ...acknowledgedBank].map(signed),
      })
    : undefined;

  // Dynamic insights derived from live counts/amounts
  const insights = reconciled
    ? [
        "Every transaction on your bank statement now has a match in your records.",
        `${counts.matched} transaction${counts.matched === 1 ? "" : "s"} were matched automatically.`,
        "Your reconciliation is complete.",
      ]
    : [
        missingFromBank.length > 0
          ? `${missingFromBank.length} ${missingFromBank.length === 1 ? "entry is" : "entries are"} in your records with no confirmed bank match. Review ${missingFromBank.length === 1 ? "it" : "them"} to determine why.`
          : "Every entry in your records has a confirmed bank match or was marked by you as expected.",
        missingFromBooks.length > 0
          ? missingFromBooks.length === 1
            ? `One item (${money(missingFromBooks[0].amount)}) is on your bank statement with no match in your records.`
            : `${missingFromBooks.length} items are on your bank statement with no match in your records.`
          : "All bank transactions have matching entries in your records.",
        reviewLeft > 0
          ? `${reviewLeft} ${reviewLeft === 1 ? "pair looks" : "pairs look"} like a match but need a quick yes or no from you.`
          : "All pairs have been reviewed.",
        ...(verdict && verdict.unresolvedDuplicateGroups > 0
          ? [
              `${verdict.unresolvedDuplicateGroups} possible duplicate ${verdict.unresolvedDuplicateGroups === 1 ? "group needs" : "groups need"} a decision — they are still counted in the totals until you say whether they are repeats.`,
            ]
          : []),
      ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Month-level findings sit above — and stay separate from — the
          overall verdict below. One month of data keeps the original view. */}
      {monthReview && monthReview.months.length > 1 && <MonthReviewPanel review={monthReview} />}

      <StatusHero
        reconciled={reconciled}
        unexplained={unexplained}
        balanceProof={balanceProof}
        onReview={onOpenReview}
        reviewLeft={reviewLeft}
        verdict={verdict}
        net={net}
      />

      {/* Three separate answers, always shown side by side: do the
          transactions match, is the duplicate review finished, and what do
          the bank files' own balances show? */}
      {verdict && (
        <div
          data-testid="status-strip"
          className="m-stack"
          style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, fontSize: 13 }}
        >
          <div className="card" data-testid="status-financial" data-state={verdict.financial} style={{ padding: "12px 16px" }}>
            <div className="eyebrow" style={{ color: "var(--ink-3)", marginBottom: 3 }}>
              Transaction matching
            </div>
            <span style={{ fontWeight: 600, color: verdict.financial === "agrees" ? "var(--good-ink)" : "var(--warn-ink)" }}>
              {verdict.financial === "agrees"
                ? "Totals agree — nothing left open"
                : "Not reconciled — differences or open items remain"}
            </span>
          </div>
          <div className="card" data-testid="status-duplicates" data-state={verdict.dataQuality} style={{ padding: "12px 16px" }}>
            <div className="eyebrow" style={{ color: "var(--ink-3)", marginBottom: 3 }}>
              Duplicate review
            </div>
            <span style={{ fontWeight: 600, color: verdict.dataQuality === "clear" ? "var(--good-ink)" : "var(--warn-ink)" }}>
              {verdict.dataQuality !== "clear"
                ? `${verdict.unresolvedDuplicateGroups} possible duplicate ${verdict.unresolvedDuplicateGroups === 1 ? "group" : "groups"} to review`
                : duplicates && duplicates.groups.length > 0
                ? "Complete — every possible duplicate was set aside or confirmed as separate"
                : "No repeated rows found"}
            </span>
          </div>
          <div className="card" data-testid="status-statements" data-state={verdict.statement} style={{ padding: "12px 16px" }}>
            <div className="eyebrow" style={{ color: "var(--ink-3)", marginBottom: 3 }}>
              Statement verification
            </div>
            <span
              style={{
                fontWeight: 600,
                color:
                  verdict.statement === "verified"
                    ? "var(--good-ink)"
                    : verdict.statement === "review-needed"
                    ? "var(--warn-ink)"
                    : "var(--ink-2)",
              }}
            >
              {STATEMENT_SUMMARY_LABEL[verdict.statement]}
            </span>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
              {verdict.statement === "not-verified"
                ? "The uploaded bank files don't carry enough balance information to check. That is missing evidence, not an error."
                : verdict.statement === "running-balance-only"
                ? "Rows are internally consistent; stated opening and closing balances were not independently verified."
                : verdict.statement === "review-needed"
                ? `${verdict.statementFilesNeedingReview} bank ${verdict.statementFilesNeedingReview === 1 ? "file needs" : "files need"} review.`
                : verdict.statement === "partly-verified"
                ? "Some bank files could not be fully verified."
                : "Stated opening and closing balances agree with each file's activity."}
            </div>
            {/* Every outcome named on its own: a mismatch, a file that
                could not be verified and a running-balance-only check are
                different things. */}
            {statementReview && statementReview.statements.length > 0 && (
              <div data-testid="status-statements-outcomes" style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 4, fontWeight: 500 }}>
                {statementOutcomeText(statementReview.counts)}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="m-grid-2" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <KpiCard
          label="Matched"
          value={counts.matched}
          kind="matched"
          hint="Lined up on both sides"
        />
        <KpiCard
          label="Needs review"
          value={reviewLeft}
          kind="review"
          hint={reviewLeft ? "A quick yes or no" : "All done"}
          onClick={reviewLeft ? onOpenReview : undefined}
        />
        <KpiCard
          label="Not in your records"
          value={counts.missingFromBooks}
          kind="problem"
          hint="On your bank, not in your records"
        />
        <KpiCard
          label="In your records only"
          value={counts.missingFromBank}
          kind="missing"
          hint="No confirmed bank match"
        />
      </div>

      {/* One month of data: the month panel is hidden, so the statement
          balance results and source notes are shown here instead. */}
      {monthReview && statementReview && monthReview.months.length === 1 && (
        <SourceChecksCard review={monthReview} statements={statementReview} />
      )}

      <InsightCard insights={insights} />

      {duplicates && <DuplicatesPanel {...duplicates} />}

      <TxnLists
        counts={counts}
        missingBooks={missingFromBooks}
        addedToReconciliation={addedToReconciliation}
        missingBank={missingFromBank}
        acknowledgedBank={acknowledgedBank}
        reviewItems={reviewItems}
        matched={matched}
        matchedExtra={matchedExtraCount}
        onOpenReview={onOpenReview}
        onAddToBooks={onAddToBooks}
        onRemoveAdded={onRemoveAdded}
        onAcknowledgeMissingBank={onAcknowledgeMissingBank}
        onUnacknowledgeMissingBank={onUnacknowledgeMissingBank}
        amountHints={amountHints}
        decided={decided}
        onUndoDecision={onUndoDecision}
      />
    </div>
  );
}
