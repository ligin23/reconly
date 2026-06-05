import type { ReactNode } from "react";

export type StatusPillKind = "matched" | "review" | "missingBooks" | "missingBank" | "problem";

export const PILL_LABEL: Record<StatusPillKind, string> = {
  matched: "Matched",
  review: "Needs review",
  missingBooks: "Add to books",
  missingBank: "Not cleared yet",
  problem: "Problem",
};

export function StatusPill({ kind, children }: { kind: StatusPillKind; children?: ReactNode }) {
  const cls =
    kind === "matched"
      ? "pill--matched"
      : kind === "review"
      ? "pill--review"
      : kind === "problem"
      ? "pill--problem"
      : "pill--missing";
  return (
    <span className={`pill ${cls}`}>
      <span className="dot" />
      {children ?? PILL_LABEL[kind]}
    </span>
  );
}
