// ============================================================
// Reconly — duplicate group: what was detected vs. what was decided
// Pure TypeScript. Wording only: reads a duplicate group and the current
// set-aside state and describes four separate things, so one can never be
// mistaken for another:
//
//   1. detection  — why the rows were flagged (the detector's evidence,
//                   which never changes after import);
//   2. automatic  — what Reconly did on its own at import;
//   3. decision   — what the user has decided since (current);
//   4. status     — which rows are in or out of the totals right now.
//
// It does not detect, set aside or restore anything.
// ============================================================

import { groupStatus, type DuplicateGroup, type DuplicateState } from "./duplicates";

export type DuplicateDecisionSummary = {
  detection: string;
  automatic: string;
  decision: string;
  status: string;
  /** Rows of this group currently left out of the totals. */
  excluded: number;
  /** Rows of this group currently counted. */
  inUse: number;
};

const copies = (n: number) => `${n} ${n === 1 ? "copy" : "copies"}`;
const rows = (n: number) => `${n} ${n === 1 ? "row" : "rows"}`;

function niceDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function describeDuplicateDecision(group: DuplicateGroup, state: DuplicateState): DuplicateDecisionSummary {
  const inGroup = new Set(group.txnIds);
  const setAside = state.setAside.filter((s) => inGroup.has(s.txnId));
  const setAsideIds = new Set(setAside.map((s) => s.txnId));
  const excluded = setAside.length;
  const inUse = group.txnIds.length - excluded;
  const status = groupStatus(group, state);

  const detection =
    group.evidence.map((e) => e.text).join(" ") || "These rows have the same date and amount.";

  const autoCount = group.autoSetAsideIds.length;
  const automatic =
    autoCount > 0
      ? `Reconly set aside ${copies(autoCount)} automatically at import, because the files prove ${autoCount === 1 ? "it is" : "they are"} the same row exported more than once.`
      : "No row was set aside automatically — the files do not prove these rows are the same transaction.";

  const byUser = setAside.filter((s) => s.by === "user").length;
  const restored = group.autoSetAsideIds.filter((id) => !setAsideIds.has(id)).length;
  const parts: string[] = [];
  if (byUser > 0) parts.push(`You chose to set aside ${copies(byUser)}.`);
  if (restored > 0) parts.push(`You restored ${rows(restored)} that Reconly had set aside.`);
  if (status === "kept-all") {
    const when = state.dismissedAt?.[group.id];
    parts.push(`You confirmed these are separate transactions${when ? ` on ${niceDay(when)}` : ""}.`);
  }
  const decision =
    parts.length > 0
      ? parts.join(" ")
      : status === "needs-review"
        ? "No decision from you yet."
        : "No decision from you — Reconly's automatic set-aside stands.";

  const statusText =
    (excluded === 0
      ? `All ${rows(group.txnIds.length)} are included in the reconciliation totals.`
      : `${rows(excluded)} excluded from the reconciliation totals; ${rows(inUse)} included.`) +
    (status === "needs-review" ? " This group still needs your decision." : "");

  return { detection, automatic, decision, status: statusText, excluded, inUse };
}
