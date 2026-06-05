"use client";

import { useState } from "react";
import type { ReviewItem, ReviewSide } from "@/lib/sample-data";
import { Icon, type IconName } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Confidence } from "@/components/ui/confidence";
import { Money } from "@/components/ui/money";

export type ReviewDecision = "accept" | "reject" | "manual";

function ReviewCard({
  item,
  exiting,
  onDecide,
}: {
  item: ReviewItem;
  exiting: ReviewDecision | null;
  onDecide: (decision: ReviewDecision) => void;
}) {
  const exitStyle =
    exiting === "accept"
      ? { transform: "translateX(34px) rotate(2deg)", opacity: 0 }
      : exiting === "reject"
      ? { transform: "translateX(-34px) rotate(-2deg)", opacity: 0 }
      : exiting === "manual"
      ? { transform: "translateY(-22px) scale(0.97)", opacity: 0 }
      : { transform: "none", opacity: 1 };

  const Side = ({
    icon,
    label,
    data,
  }: {
    icon: IconName;
    label: string;
    data: ReviewSide;
  }) => (
    <div
      style={{
        flex: 1,
        padding: "18px 20px",
        background: "var(--surface-2)",
        borderRadius: "var(--r-md)",
        border: "1px solid var(--line)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            color: "var(--ink-2)",
            display: "grid",
            placeItems: "center",
            flex: "none",
          }}
        >
          <Icon name={icon} size={14} />
        </span>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--ink-2)",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>
      <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 6 }}>
        {data.date}
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "var(--ink)",
          lineHeight: 1.3,
          textWrap: "pretty",
          marginBottom: 10,
        }}
      >
        {data.desc}
      </div>
      <div style={{ fontSize: 22 }}>
        <Money cents={item.amount} type={item.type} big />
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>{data.sub}</div>
    </div>
  );

  return (
    <div
      className="card"
      style={{
        position: "relative",
        padding: 26,
        background: "var(--surface)",
        boxShadow: "var(--sh-lg)",
        transition:
          "transform .28s cubic-bezier(.4,0,.2,1), opacity .28s ease",
        ...exitStyle,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
            Does this look like the same payment?
          </span>
        </div>
        <Confidence value={item.confidence} />
      </div>

      <div style={{ display: "flex", alignItems: "stretch", gap: 12, position: "relative" }}>
        <Side icon="bank" label="On your bank" data={item.bank} />
        <div style={{ display: "grid", placeItems: "center", flex: "none", width: 30 }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: "50%",
              background: "var(--accent-soft)",
              color: "var(--accent-ink)",
              display: "grid",
              placeItems: "center",
              border: "2px solid var(--surface)",
              boxShadow: "var(--sh-sm)",
            }}
          >
            <Icon name="link" size={15} />
          </span>
        </div>
        <Side icon="book" label="In your books" data={item.books} />
      </div>

      {/* Why */}
      <div
        style={{
          marginTop: 18,
          padding: "16px 18px",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-md)",
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Why we paired them
        </div>
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 9,
          }}
        >
          {item.reasons.map((r, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                fontSize: 14,
                lineHeight: 1.4,
              }}
            >
              <span
                style={{
                  width: 19,
                  height: 19,
                  borderRadius: "50%",
                  flex: "none",
                  marginTop: 1,
                  display: "grid",
                  placeItems: "center",
                  background: r.ok ? "var(--good-soft)" : "var(--warn-soft)",
                  color: r.ok ? "var(--good-ink)" : "var(--warn-ink)",
                }}
              >
                <Icon name={r.ok ? "check" : "minus"} size={12} stroke={3} />
              </span>
              <span style={{ color: "var(--ink)" }}>{r.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <Button variant="accept" block icon="check" onClick={() => onDecide("accept")}>
          Yes, it&apos;s a match
        </Button>
        <Button variant="reject" block icon="x" onClick={() => onDecide("reject")}>
          Not a match
        </Button>
        <Button
          variant="secondary"
          icon="search"
          onClick={() => onDecide("manual")}
          style={{ flex: "none" }}
        >
          Match manually
        </Button>
      </div>
    </div>
  );
}

function GhostCard({ depth }: { depth: number }) {
  return (
    <div
      className="card"
      style={{
        position: "absolute",
        left: depth * 7,
        right: depth * 7,
        top: -depth * 9,
        height: 120,
        zIndex: -depth,
        background: "var(--surface)",
        boxShadow: "var(--sh-card)",
        opacity: 1 - depth * 0.18,
      }}
    />
  );
}

type ReviewScreenProps = {
  queue: ReviewItem[];
  total: number;
  onDecide: (decision: ReviewDecision) => void;
  onBack: () => void;
};

export function ReviewScreen({ queue, total, onDecide, onBack }: ReviewScreenProps) {
  const [exiting, setExiting] = useState<ReviewDecision | null>(null);
  const decided = total - queue.length;
  const current = queue[0];

  const handleDecide = (decision: ReviewDecision) => {
    if (exiting) return;
    setExiting(decision);
    setTimeout(() => {
      setExiting(null);
      onDecide(decision);
    }, 290);
  };

  if (!current) {
    return (
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div
          className="card"
          style={{
            padding: "48px 40px",
            textAlign: "center",
            borderColor: "oklch(0.86 0.06 158)",
            background: "linear-gradient(180deg, var(--good-soft), var(--surface) 55%)",
          }}
        >
          <span
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "var(--good)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              margin: "0 auto 20px",
              boxShadow: "0 8px 22px oklch(0.56 0.11 158 / 0.35)",
            }}
          >
            <svg
              width="34"
              height="34"
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
          <h2
            className="serif"
            style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.025em" }}
          >
            All reviewed!
          </h2>
          <p
            style={{
              fontSize: 15,
              color: "var(--ink-2)",
              margin: "10px auto 0",
              maxWidth: 380,
              textWrap: "pretty",
            }}
          >
            You went through all {total} pairs we weren&apos;t sure about. Everything&apos;s been
            sorted into your results.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 26 }}>
            <Button variant="primary" icon="arrowLeft" onClick={onBack}>
              Back to results
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 620, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          className="btn btn--ghost btn--sm"
          style={{ paddingLeft: 8 }}
        >
          <Icon name="arrowLeft" size={15} /> Results
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            className="tnum"
            style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 500 }}
          >
            {decided} of {total} reviewed
          </span>
          <div
            style={{
              width: 120,
              height: 6,
              borderRadius: 3,
              background: "var(--surface-2)",
              overflow: "hidden",
              border: "1px solid var(--line)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${(decided / total) * 100}%`,
                background: "var(--good)",
                borderRadius: 3,
                transition: "width .3s ease",
              }}
            />
          </div>
        </div>
      </div>

      <div style={{ position: "relative" }}>
        {queue.slice(1, 4).map((_, i) => (
          <GhostCard key={i} depth={i + 1} />
        ))}
        <div style={{ position: "relative", zIndex: 2 }}>
          <ReviewCard item={current} exiting={exiting} onDecide={handleDecide} />
        </div>
      </div>

      <p
        style={{
          textAlign: "center",
          fontSize: 12.5,
          color: "var(--ink-3)",
          marginTop: 16,
        }}
      >
        {queue.length - 1 > 0
          ? `${queue.length - 1} more after this`
          : "Last one — almost there"}
      </p>
    </div>
  );
}
