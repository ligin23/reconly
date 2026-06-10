"use client";

import { useState } from "react";
import type {
  ReviewItem,
  ReviewSide,
  AnyReviewItem,
  CompositeReviewItem,
  CompositeComponent,
} from "@/lib/sample-data";
import { money } from "@/lib/sample-data";
import { Icon, type IconName } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Confidence } from "@/components/ui/confidence";
import { Money } from "@/components/ui/money";

export type ReviewDecision = "accept" | "reject" | "manual";
export type ReviewMeta = { pickedCombination?: string[] };

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
          {item.matchType === "fuzzy" && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "3px 8px",
                borderRadius: 4,
                background: "var(--warn-soft)",
                color: "var(--warn-ink)",
                flex: "none",
              }}
            >
              Possible match
            </span>
          )}
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
            {item.matchType === "fuzzy"
              ? "We're not sure about this one — please check"
              : "Does this look like the same payment?"}
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

// ---- Composite review card ------------------------------------------

function ComponentRow({ comp }: { comp: CompositeComponent }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "7px 0",
        borderBottom: "1px solid var(--line-2)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }} className="mono">
          {comp.date}
        </div>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {comp.desc}
        </div>
      </div>
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--ink)",
          flex: "none",
        }}
      >
        <Money cents={comp.amount} type={comp.type} />
      </span>
    </div>
  );
}

function GroupPanel({
  components,
  bankAmount,
  label,
}: {
  components: CompositeComponent[];
  bankAmount: number;
  label: string;
}) {
  const sumCents = components.reduce((s, c) => s + c.amount, 0);
  const matches = sumCents === bankAmount;
  return (
    <div
      style={{
        flex: 1,
        padding: "18px 20px",
        background: "var(--surface-2)",
        borderRadius: "var(--r-md)",
        border: "1px solid var(--line)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 14,
        }}
      >
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
          <Icon name="book" size={14} />
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
      <div style={{ marginBottom: 4 }}>
        {components.map((c) => (
          <ComponentRow key={c.id} comp={c} />
        ))}
      </div>
      {/* Sum line */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          paddingTop: 8,
          marginTop: 2,
        }}
      >
        <span style={{ fontSize: 13, color: "var(--ink-2)", fontWeight: 500 }}>
          Total
        </span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: matches ? "var(--good-ink)" : "var(--warn-ink)",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          {matches && (
            <Icon name="check" size={13} stroke={3} style={{ flex: "none" }} />
          )}
          {money(sumCents)}
        </span>
      </div>
    </div>
  );
}

function ComboPicker({
  combinations,
  selectedIndex,
  onSelect,
  bankAmount,
}: {
  combinations: CompositeComponent[][];
  selectedIndex: number | null;
  onSelect: (i: number) => void;
  bankAmount: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        marginTop: 4,
      }}
    >
      {combinations.map((combo, i) => {
        const selected = selectedIndex === i;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(i)}
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: "var(--r-md)",
              border: `2px solid ${selected ? "var(--accent)" : "var(--line)"}`,
              background: selected ? "var(--accent-soft)" : "var(--surface-2)",
              cursor: "pointer",
              textAlign: "left",
              transition: "border-color .15s, background .15s",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  border: `2px solid ${selected ? "var(--accent)" : "var(--line)"}`,
                  background: selected ? "var(--accent)" : "transparent",
                  flex: "none",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {selected && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#fff",
                    }}
                  />
                )}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: selected ? "var(--accent-ink)" : "var(--ink-2)",
                }}
              >
                Option {i + 1}
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 13,
                  fontWeight: 700,
                  color: selected ? "var(--accent-ink)" : "var(--ink)",
                }}
              >
                {money(combo.reduce((s, c) => s + c.amount, 0))}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "4px 12px",
                paddingLeft: 24,
              }}
            >
              {combo.map((c) => (
                <span
                  key={c.id}
                  style={{ fontSize: 12.5, color: "var(--ink-2)" }}
                >
                  {c.desc} ({money(c.amount)})
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CompositeReviewCard({
  item,
  exiting,
  onDecide,
}: {
  item: CompositeReviewItem;
  exiting: ReviewDecision | null;
  onDecide: (decision: ReviewDecision, meta?: ReviewMeta) => void;
}) {
  const [selectedComboIndex, setSelectedComboIndex] = useState<number | null>(
    null
  );

  const exitStyle =
    exiting === "accept"
      ? { transform: "translateX(34px) rotate(2deg)", opacity: 0 }
      : exiting === "reject"
      ? { transform: "translateX(-34px) rotate(-2deg)", opacity: 0 }
      : { transform: "none", opacity: 1 };

  const displayComponents =
    item.ambiguous && selectedComboIndex !== null
      ? item.allCombinations![selectedComboIndex]
      : item.components;

  const canAccept = !item.ambiguous || selectedComboIndex !== null;

  const handleAccept = () => {
    if (!canAccept) return;
    const meta: ReviewMeta =
      item.ambiguous && selectedComboIndex !== null
        ? { pickedCombination: item.allCombinations![selectedComboIndex].map((c) => c.id) }
        : {};
    onDecide("accept", meta);
  };

  return (
    <div
      className="card"
      style={{
        position: "relative",
        padding: 26,
        background: "var(--surface)",
        boxShadow: "var(--sh-lg)",
        transition: "transform .28s cubic-bezier(.4,0,.2,1), opacity .28s ease",
        ...exitStyle,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              padding: "3px 8px",
              borderRadius: 4,
              background: item.ambiguous
                ? "var(--warn-soft)"
                : "var(--accent-soft)",
              color: item.ambiguous ? "var(--warn-ink)" : "var(--accent-ink)",
              flex: "none",
            }}
          >
            {item.ambiguous ? "Ambiguous group" : "Group match"}
          </span>
          <span
            style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}
          >
            {item.ambiguous
              ? "Multiple groupings possible — choose one"
              : `Do these ${item.components.length} items explain this ${item.bankTxnType === "in" ? "deposit" : "payment"}?`}
          </span>
        </div>
      </div>

      {/* Bank txn (always shown) */}
      <div
        style={{
          padding: "14px 16px",
          background: "var(--surface-2)",
          borderRadius: "var(--r-md)",
          border: "1px solid var(--line)",
          marginBottom: 12,
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
        >
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
            <Icon name="bank" size={14} />
          </span>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--ink-2)",
            }}
          >
            On your bank
          </span>
        </div>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <div>
            <div
              className="mono"
              style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 2 }}
            >
              {item.bankDate}
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
              {item.bankDesc}
            </div>
          </div>
          <span style={{ fontSize: 22, fontWeight: 600 }}>
            <Money cents={item.bankAmount} type={item.bankTxnType} big />
          </span>
        </div>
      </div>

      {item.ambiguous ? (
        /* Ambiguous: show combination picker */
        <>
          <div
            className="eyebrow"
            style={{ marginBottom: 8, marginTop: 4 }}
          >
            Choose the combination that applies
          </div>
          <ComboPicker
            combinations={item.allCombinations!}
            selectedIndex={selectedComboIndex}
            onSelect={setSelectedComboIndex}
            bankAmount={item.bankAmount}
          />
        </>
      ) : (
        /* Unambiguous: show group panel */
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            gap: 12,
            position: "relative",
          }}
        >
          <GroupPanel
            components={displayComponents}
            bankAmount={item.bankAmount}
            label={`${item.components.length} items in your books`}
          />
        </div>
      )}

      {/* Why */}
      <div
        style={{
          marginTop: 14,
          padding: "14px 16px",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-md)",
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          {item.ambiguous ? "Why we need your help" : "Why we grouped them"}
        </div>
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 7,
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
                <Icon name={r.ok ? "check" : "alert"} size={11} stroke={2.5} />
              </span>
              <span style={{ color: "var(--ink)" }}>{r.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <Button
          variant="accept"
          block
          icon="check"
          onClick={handleAccept}
          disabled={!canAccept}
        >
          {item.ambiguous ? "Accept selected" : "Yes, they match"}
        </Button>
        <Button
          variant="reject"
          block
          icon="x"
          onClick={() => onDecide("reject")}
        >
          {item.ambiguous ? "None of these" : "Not a match"}
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
  queue: AnyReviewItem[];
  total: number;
  onDecide: (decision: ReviewDecision, meta?: ReviewMeta) => void;
  onBack: () => void;
};

export function ReviewScreen({ queue, total, onDecide, onBack }: ReviewScreenProps) {
  const [exiting, setExiting] = useState<ReviewDecision | null>(null);
  const decided = total - queue.length;
  const current = queue[0];

  const handleDecide = (decision: ReviewDecision, meta?: ReviewMeta) => {
    if (exiting) return;
    setExiting(decision);
    setTimeout(() => {
      setExiting(null);
      onDecide(decision, meta);
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
          {"matchType" in current && current.matchType === "composite" ? (
            <CompositeReviewCard
              item={current}
              exiting={exiting}
              onDecide={handleDecide}
            />
          ) : (
            <ReviewCard
              item={current as ReviewItem}
              exiting={exiting}
              onDecide={handleDecide}
            />
          )}
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
