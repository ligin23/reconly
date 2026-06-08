"use client";

import { useState } from "react";
import {
  money,
  type Counts,
  type MissingTxn,
  type ReviewItem,
  type SimpleTxn,
} from "@/lib/sample-data";
import { type BalanceProof } from "@/lib/recon/types";
import { formatBreakdownAmount } from "@/lib/recon/adapter";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { KpiCard } from "@/components/ui/kpi-card";
import { TxnRow } from "@/components/ui/txn-row";
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
}: {
  reconciled: boolean;
  unexplained: number;
  balanceProof?: BalanceProof;
  onReview: () => void;
}) {
  if (reconciled) {
    return (
      <div
        className="card"
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
              {money(unexplained)}{" "}
              <span style={{ color: "var(--warn-ink)" }}>unexplained</span>
            </div>
            <div style={{ fontSize: 14.5, color: "var(--ink-2)", marginTop: 5 }}>
              A gap this size usually means one missing entry.
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

function TxnLists({
  counts,
  missingBooks,
  missingBank,
  reviewItems,
  matched,
  matchedExtra,
  onOpenReview,
}: {
  counts: Counts;
  missingBooks: MissingTxn[];
  missingBank: MissingTxn[];
  reviewItems: ReviewItem[];
  matched: SimpleTxn[];
  matchedExtra: number;
  onOpenReview: () => void;
}) {
  const [tab, setTab] = useState<"matched" | "review" | "missingBooks" | "missingBank">(
    "review"
  );
  const TABS = [
    { key: "matched", label: "Matched", count: counts.matched },
    { key: "review", label: "Needs review", count: counts.review },
    { key: "missingBooks", label: "Add to your books", count: counts.missingFromBooks },
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
            {reviewItems.map((r) => (
              <TxnRow
                key={r.id}
                tx={{ date: r.bank.date, desc: r.bank.desc, amount: r.amount, type: r.type }}
                sub={`Maybe: ${r.books.desc} · ${r.confidence}% sure`}
                pill={<StatusPill kind="review" />}
                onClick={onOpenReview}
              />
            ))}
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
          <ListNote text="These are on your bank statement, but not written in your books yet." />
          {missingBooks.length === 0 ? (
            <EmptyState icon="checkCircle" title="Nothing here" body="Every bank transaction has a match in your books." />
          ) : (
            missingBooks.map((tx, i) => (
              <TxnRow key={i} tx={tx} sub={tx.hint} pill={<StatusPill kind="missingBooks" />} />
            ))
          )}
        </div>
      )}

      {tab === "missingBank" && (
        <div>
          <ListNote text="These are in your books, but your bank hasn't shown them yet — usually just a matter of time." />
          {missingBank.length === 0 ? (
            <EmptyState icon="checkCircle" title="Nothing here" body="Everything in your books has cleared the bank." />
          ) : (
            missingBank.map((tx, i) => (
              <TxnRow key={i} tx={tx} sub={tx.hint} pill={<StatusPill kind="missingBank" />} />
            ))
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
  reviewItems: ReviewItem[];
  matched: SimpleTxn[];
  matchedExtraCount: number;
  missingFromBooks: MissingTxn[];
  missingFromBank: MissingTxn[];
  onOpenReview: () => void;
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
  missingFromBank,
  onOpenReview,
}: DashboardScreenProps) {
  const reviewLeft = counts.review;

  // Dynamic insights derived from live counts/amounts
  const insights = reconciled
    ? [
        "Every transaction on your bank statement now has a match in your books.",
        `${counts.matched} transaction${counts.matched === 1 ? "" : "s"} were matched automatically.`,
        "Your books are fully up to date.",
      ]
    : [
        missingFromBank.length > 0
          ? `${missingFromBank.length} ${missingFromBank.length === 1 ? "item hasn't" : "items haven't"} cleared your bank yet — that's normal, no action needed.`
          : "No outstanding items waiting to clear.",
        missingFromBooks.length > 0
          ? missingFromBooks.length === 1
            ? `One item (${money(missingFromBooks[0].amount)}) is on your bank statement but not in your books yet. Adding it would help close the gap.`
            : `${missingFromBooks.length} items are on your bank statement but not in your books yet.`
          : "All bank transactions are recorded in your books.",
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
          label="Add to your books"
          value={counts.missingFromBooks}
          kind="problem"
          hint="On the bank, not your books"
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
        missingBank={missingFromBank}
        reviewItems={reviewItems}
        matched={matched}
        matchedExtra={matchedExtraCount}
        onOpenReview={onOpenReview}
      />
    </div>
  );
}
