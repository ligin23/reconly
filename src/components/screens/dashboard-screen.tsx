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
import { formatBreakdownAmount } from "@/lib/recon/adapter";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { KpiCard } from "@/components/ui/kpi-card";
import { TxnRow } from "@/components/ui/txn-row";
import { MissingItemRow } from "@/components/ui/missing-item-row";
import { InsightCard } from "@/components/ui/insight-card";
import { EmptyState } from "@/components/ui/empty-state";

// ---- Breakdown (right side of status hero) --------------------------

function Breakdown({
  reconciled,
  balanceProof,
  unexplained,
}: {
  reconciled: boolean;
  balanceProof?: BalanceProof;
  unexplained: number;
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
        padding: "9px 0",
      }}
    >
      <span
        style={{
          fontSize: 13.5,
          color: strong ? "var(--ink)" : "var(--ink-2)",
          fontWeight: strong ? 600 : 500,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        className="tnum"
        style={{
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
      style={{
        padding: "24px 26px",
        borderLeft: "1px solid var(--line)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <Row label="Your bank says" value={bankDisplay} />
      <div style={{ height: 1, background: "var(--line-2)" }} />
      <Row label="Your books say" value={booksDisplay} />
      <div style={{ height: 1, background: "var(--line)" }} />
      <Row
        label={reconciled ? "Difference" : "Still unexplained"}
        value={reconciled ? "$0.00" : money(unexplained)}
        strong
        tone={reconciled ? "good" : "warn"}
      />
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
}: {
  reconciled: boolean;
  unexplained: number;
  balanceProof?: BalanceProof;
  onReview: () => void;
  /** Suggested pairs still awaiting a yes/no — blocks "Fully reconciled". */
  reviewLeft?: number;
}) {
  if (reconciled) {
    return (
      <div
        className="card"
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
            </div>
          </div>
        </div>
        <Breakdown reconciled balanceProof={balanceProof} unexplained={0} />
      </div>
    );
  }

  return (
    <div
      className="card"
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
                  <span style={{ color: "var(--warn-ink)" }}>unexplained</span>
                </>
              )}
            </div>
            <div style={{ fontSize: 14.5, color: "var(--ink-2)", marginTop: 5 }}>
              {unexplained === 0 && reviewLeft > 0
                ? `The totals line up — ${reviewLeft} suggested ${reviewLeft === 1 ? "pair needs" : "pairs need"} your confirmation.`
                : "A gap this size usually means one missing entry."}
            </div>
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
      />
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
}: {
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
    { key: "missingBank", label: "Not cleared yet", count: counts.missingFromBank },
  ] as const;

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div
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
            data-testid={t.key === "missingBooks" ? "tab-missing-books" : undefined}
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
              <TxnRow key={i} tx={tx} pill={<StatusPill kind="matched" />} />
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

      {tab === "review" &&
        (reviewItems.length === 0 ? (
          <EmptyState
            icon="checkCircle"
            title="All caught up"
            body="You've reviewed every pair we weren't sure about. Nice work."
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
          <ListNote text="These are in your records but haven't cleared your bank yet — this is normal and usually just a matter of timing." />
          {missingBank.length === 0 && acknowledgedBank.length === 0 ? (
            <EmptyState icon="checkCircle" title="Nothing here" body="Everything in your records has cleared the bank." />
          ) : (
            <>
              {missingBank.map((tx) => (
                <MissingItemRow
                  key={tx.txnId}
                  tx={tx}
                  hint={tx.hint}
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
                      label="Marked as expected"
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
}: DashboardScreenProps) {
  const reviewLeft = counts.review;

  // Dynamic insights derived from live counts/amounts
  const insights = reconciled
    ? [
        "Every transaction on your bank statement now has a match in your records.",
        `${counts.matched} transaction${counts.matched === 1 ? "" : "s"} were matched automatically.`,
        "Your reconciliation is complete.",
      ]
    : [
        missingFromBank.length > 0
          ? `${missingFromBank.length} ${missingFromBank.length === 1 ? "item hasn't" : "items haven't"} cleared your bank yet — that's normal, no action needed.`
          : "No outstanding items waiting to clear.",
        missingFromBooks.length > 0
          ? missingFromBooks.length === 1
            ? `One item (${money(missingFromBooks[0].amount)}) is on your bank statement but not in your records yet. Adding it to your reconciliation would help close the gap.`
            : `${missingFromBooks.length} items are on your bank statement but not in your records yet.`
          : "All bank transactions have matching entries in your records.",
        reviewLeft > 0
          ? `${reviewLeft} ${reviewLeft === 1 ? "pair looks" : "pairs look"} like a match but need a quick yes or no from you.`
          : "All pairs have been reviewed.",
      ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <StatusHero
        reconciled={reconciled}
        unexplained={unexplained}
        balanceProof={balanceProof}
        onReview={onOpenReview}
        reviewLeft={reviewLeft}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
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
          label="Not cleared yet"
          value={counts.missingFromBank}
          kind="missing"
          hint="In your books, not the bank"
        />
      </div>

      <InsightCard insights={insights} />

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
      />
    </div>
  );
}
