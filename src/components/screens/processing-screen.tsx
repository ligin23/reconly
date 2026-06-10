"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";

export type ReconCounts = {
  totalTxns: number;
  autoMatched: number;
  differences: number;
};

const PROC_STEPS = [
  { key: "read", label: "Reading your files" },
  { key: "match", label: "Matching transactions" },
  { key: "diff", label: "Finding what's different" },
  { key: "done", label: "Putting it together" },
] as const;

function stepDoneText(key: string, counts: ReconCounts | null): string {
  switch (key) {
    case "read":
      return counts ? `Read ${counts.totalTxns} transactions` : "Files read";
    case "match":
      return counts ? `${counts.autoMatched} matched automatically` : "Transactions matched";
    case "diff":
      if (!counts) return "Differences found";
      return counts.differences === 1 ? "1 difference found" : `${counts.differences} differences found`;
    case "done":
      return "Ready to review";
  }
  return "Done";
}

export function ProcessingScreen({
  onComplete,
  counts,
}: {
  onComplete: () => void;
  counts: ReconCounts | null;
}) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= PROC_STEPS.length) {
      const t = setTimeout(onComplete, 600);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep((s) => s + 1), step === 0 ? 700 : 850);
    return () => clearTimeout(t);
  }, [step, onComplete]);

  return (
    <div style={{ minHeight: "62vh", display: "grid", placeItems: "center" }}>
      <div style={{ width: 420, maxWidth: "92vw", textAlign: "center" }}>
        <div
          style={{
            position: "relative",
            width: 58,
            height: 58,
            margin: "0 auto 22px",
          }}
        >
          <svg
            width="58"
            height="58"
            viewBox="0 0 58 58"
            style={{ position: "absolute", inset: 0, animation: "rcSpin 1.1s linear infinite" }}
          >
            <circle cx="29" cy="29" r="25" fill="none" stroke="var(--line)" strokeWidth="3" />
            <circle
              cx="29"
              cy="29"
              r="25"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="40 200"
            />
          </svg>
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "var(--accent)",
            }}
          >
            <Icon name="scale" size={24} />
          </span>
        </div>
        <h2
          className="serif"
          style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}
        >
          Looking things over…
        </h2>
        <p style={{ fontSize: 14.5, color: "var(--ink-2)", margin: "8px 0 26px" }}>
          This usually takes a few seconds.
        </p>

        <div className="card" style={{ padding: "10px 8px", textAlign: "left" }}>
          {PROC_STEPS.map((s, i) => {
            const state = i < step ? "done" : i === step ? "active" : "todo";
            return (
              <div
                key={s.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  padding: "12px 14px",
                  opacity: state === "todo" ? 0.5 : 1,
                  transition: "opacity .3s",
                }}
              >
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    flex: "none",
                    display: "grid",
                    placeItems: "center",
                    background:
                      state === "done"
                        ? "var(--good)"
                        : state === "active"
                        ? "var(--accent-soft)"
                        : "var(--surface-2)",
                    color: state === "done" ? "#fff" : "var(--accent)",
                    border: state === "todo" ? "1px solid var(--line)" : "none",
                  }}
                >
                  {state === "done" ? (
                    <Icon name="check" size={14} stroke={3} />
                  ) : state === "active" ? (
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: "50%",
                        background: "var(--accent)",
                        animation: "rcPulse 1s ease-in-out infinite",
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "var(--ink-3)",
                      }}
                    />
                  )}
                </span>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: state === "todo" ? "var(--ink-3)" : "var(--ink)",
                    }}
                  >
                    {s.label}
                  </div>
                  {state === "done" && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--good-ink)",
                        animation: "rcFade .3s ease",
                      }}
                    >
                      {stepDoneText(s.key, counts)}
                    </div>
                  )}
                </div>
                {state === "active" && (
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                    working…
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
