// ============================================================
// Reconly — report model (shared by the PDF and Excel exporters)
// Pure TypeScript: turns the export context into the exact lines of text
// both reports print, so what the reports say can be unit-tested without
// rendering a PDF or a workbook, and so the two formats cannot drift apart.
//
// FRAMING RULE (unchanged): findings only — never instructions to record,
// categorize or file anything.
// ============================================================

import { sourceLabel } from "@/lib/import/provenance";
import { groupStatus, importCounts, unresolvedGroupCount } from "@/lib/import/duplicates";
import type { Txn } from "@/lib/recon/types";
import { formatPeriod } from "@/lib/data/utils";
import { MONTH_STATUS_LABEL } from "@/lib/review/months";
import {
  STATEMENT_STATUS_LABEL,
  STATEMENT_SUMMARY_LABEL,
  type StatementCheck,
  type StatementStatus,
} from "@/lib/review/statements";
import { VERDICT_LABEL } from "@/lib/recon/verdict";
import {
  deriveBuckets,
  openItemCount,
  reportVerdict,
  verdictText,
  type ExportBuckets,
  type ExportComposite,
  type ExportContext,
} from "./buckets";

export function dollars(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const s = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cents < 0 ? `($${s})` : `$${s}`;
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** One transaction on one side. `source` is "" when provenance is unknown. */
export type SideLine = { date: string; description: string; amount: string; source: string };

/**
 * One row of a two-sided table (bank on the left, books on the right).
 * `kind` lets a renderer style grouped matches: "group" is the bank
 * transaction of a grouped match, "part" is one ledger entry inside it.
 */
export type PairLine = {
  kind: "pair" | "group" | "part";
  bankDate: string;
  bankDescription: string;
  bankAmount: string;
  bankSource: string;
  booksDate: string;
  booksDescription: string;
  booksAmount: string;
  booksSource: string;
  note: string;
};

export type DuplicateLine = SideLine & {
  side: "Bank" | "Books";
  /** "Set aside automatically" / "Set aside by you" / "Still included". */
  status: string;
  reason: string;
};

/** How sure the report is about each statement it makes. */
export type EvidenceCategory =
  | "Verified facts"
  | "Potential discrepancies"
  | "Missing or insufficient evidence"
  | "Your decisions";

export type MonthRow = {
  month: string;
  bankRows: string;
  recordsRows: string;
  setAside: string;
  unmatched: string;
  toReview: string;
  duplicateQuestions: string;
  crossMonth: string;
  findings: string;
  statementBalance: string;
  notes: string;
};

export type StatementRow = {
  file: string;
  period: string;
  opening: string;
  netActivity: string;
  closing: string;
  difference: string;
  status: string;
  explanation: string;
};

export type ExceptionRow = { type: string; date: string; description: string; amount: string; source: string };

export type ReportSummary = {
  executive: [string, string][];
  evidence: { category: EvidenceCategory; text: string }[];
  months: MonthRow[];
  statements: StatementRow[];
  exceptions: ExceptionRow[];
  coverage: string[];
};

export type ReportModel = {
  verdict: string;
  /** True when at least one listed transaction knows its file / row. */
  hasProvenance: boolean;
  /** Matched one-to-one pairs + grouped matches (each group counts once). */
  matchedCount: number;
  matchedLines: PairLine[];
  /** Suggested pairs + suggested grouped matches awaiting a decision. */
  reviewCount: number;
  reviewLines: PairLine[];
  missingFromBooks: SideLine[];
  added: SideLine[];
  missingFromBank: SideLine[];
  acknowledged: SideLine[];
  /** Imported / in use / set aside. Empty when there is nothing to report. */
  importSummary: [string, string][];
  setAsideLines: DuplicateLine[];
  possibleDuplicateLines: DuplicateLine[];
  /** Rows in groups the user reviewed and confirmed as separate transactions. */
  reviewedSeparateLines: DuplicateLine[];
  /**
   * The two statuses, stated separately: whether the money agrees, and
   * whether the duplicate review is finished. Empty when the import had
   * no repeated rows at all (nothing to review).
   */
  statusSummary: [string, string][];
  /**
   * Executive summary, month table, statement checks, exceptions and
   * coverage notes — all null/empty when the context carries no review
   * (older callers), so those reports are unchanged.
   */
  summary: ReportSummary | null;
  buckets: ExportBuckets;
};

const src = (t: Pick<Txn, "sourceFile" | "sourceLine">) => sourceLabel(t) ?? "";
const side = (t: Txn): SideLine => ({
  date: shortDate(t.date),
  description: t.description,
  amount: dollars(t.amount),
  source: src(t),
});

const EMPTY_BANK = { bankDate: "", bankDescription: "", bankAmount: "", bankSource: "" };

function partLines(parts: Txn[], label: (i: number, n: number) => string): PairLine[] {
  return parts.map((p, i) => ({
    kind: "part" as const,
    ...EMPTY_BANK,
    bankDescription: label(i + 1, parts.length),
    booksDate: shortDate(p.date),
    booksDescription: p.description,
    booksAmount: dollars(p.amount),
    booksSource: src(p),
    note: "",
  }));
}

function groupLine(c: ExportComposite, booksDescription: string, note: string, total: number | null): PairLine {
  return {
    kind: "group",
    bankDate: shortDate(c.bankTxn.date),
    bankDescription: c.bankTxn.description,
    bankAmount: dollars(c.bankTxn.amount),
    bankSource: src(c.bankTxn),
    booksDate: "",
    booksDescription,
    booksAmount: total === null ? "" : dollars(total),
    booksSource: "",
    note,
  };
}

const sum = (ts: Txn[]) => ts.reduce((s, t) => s + t.amount, 0);

/** Accepted grouped match: the bank transaction, then each ledger entry. */
function acceptedCompositeLines(c: ExportComposite): PairLine[] {
  const n = c.ledgerTxns.length;
  return [
    groupLine(c, `Grouped match — ${n} entries in your records add up to this amount`, "", sum(c.ledgerTxns)),
    ...partLines(c.ledgerTxns, (i, total) => `   entry ${i} of ${total}`),
  ];
}

/** Suggested grouped match (not confirmed). Ambiguous ones list every option. */
function reviewCompositeLines(c: ExportComposite): PairLine[] {
  const note = c.reasons.join("; ");
  if (c.ambiguous && c.combinations) {
    const k = c.combinations.length;
    return [
      groupLine(
        c,
        `Possible grouped match — ${k} different combinations of entries add up to this amount; none has been chosen`,
        note,
        null
      ),
      ...c.combinations.flatMap((combo, o) =>
        partLines(combo, (i, total) => `   option ${o + 1} of ${k} · entry ${i} of ${total}`)
      ),
    ];
  }
  const n = c.ledgerTxns.length;
  return [
    groupLine(
      c,
      `Possible grouped match — ${n} entries in your records add up to this amount (not confirmed)`,
      note,
      sum(c.ledgerTxns)
    ),
    ...partLines(c.ledgerTxns, (i, total) => `   entry ${i} of ${total}`),
  ];
}

function duplicateSections(ctx: ExportContext): Pick<
  ReportModel,
  "importSummary" | "setAsideLines" | "possibleDuplicateLines" | "reviewedSeparateLines"
> {
  const d = ctx.duplicates;
  if (!d) {
    return { importSummary: [], setAsideLines: [], possibleDuplicateLines: [], reviewedSeparateLines: [] };
  }

  const all = [...d.allBankTxns, ...d.allLedgerTxns];
  const byId = new Map(all.map((t) => [t.id, t]));
  const groupOf = new Map<string, (typeof d.groups)[number]>();
  for (const g of d.groups) for (const id of g.txnIds) groupOf.set(id, g);
  const setAsideIds = new Set(d.state.setAside.map((s) => s.txnId));
  const label = (t: Txn): "Bank" | "Books" => (t.source === "bank" ? "Bank" : "Books");

  const setAsideLines: DuplicateLine[] = [];
  for (const s of d.state.setAside) {
    const t = byId.get(s.txnId);
    if (!t) continue;
    const g = groupOf.get(t.id);
    const kept = g?.txnIds.map((id) => byId.get(id)).find((x) => x && !setAsideIds.has(x.id));
    const keptRef = kept ? src(kept) : "";
    setAsideLines.push({
      ...side(t),
      side: label(t),
      status: s.by === "auto" ? "Set aside automatically" : "Set aside by you",
      reason:
        (g?.evidence[0]?.text ?? "Set aside as a repeated row.") +
        (keptRef ? ` The copy still in use is ${keptRef}.` : ""),
    });
  }

  const possibleDuplicateLines: DuplicateLine[] = [];
  for (const g of d.groups) {
    if (groupStatus(g, d.state) !== "needs-review") continue;
    for (const id of g.txnIds) {
      const t = byId.get(id);
      if (!t || setAsideIds.has(id)) continue;
      possibleDuplicateLines.push({
        ...side(t),
        side: label(t),
        status: "Still included",
        reason: g.evidence[0]?.text ?? "",
      });
    }
  }

  // Groups the user reviewed and kept: every row stays in use. Listed so
  // the report shows the question was asked and how it was answered.
  const reviewedSeparateLines: DuplicateLine[] = [];
  for (const g of d.groups) {
    if (groupStatus(g, d.state) !== "kept-all") continue;
    const when = d.state.dismissedAt?.[g.id];
    const decided = when ? ` on ${shortDate(when.slice(0, 10))}` : "";
    for (const id of g.txnIds) {
      const t = byId.get(id);
      if (!t || setAsideIds.has(id)) continue;
      reviewedSeparateLines.push({
        ...side(t),
        side: label(t),
        status: "Reviewed and retained",
        reason:
          `Confirmed by you${decided} as separate transactions, so every row is kept and counted. ` +
          `Why it was flagged: ${g.evidence[0]?.text ?? "the rows looked alike."}`,
      });
    }
  }

  const bank = importCounts(d.allBankTxns, d.state);
  const ledger = importCounts(d.allLedgerTxns, d.state);
  const nothingToSay =
    setAsideLines.length === 0 && possibleDuplicateLines.length === 0 && d.groups.length === 0;
  const importSummary: [string, string][] = nothingToSay
    ? []
    : [
        ["Bank rows imported", String(bank.imported)],
        ["Bank rows set aside as repeated", String(bank.setAside)],
        ["Bank rows used in this reconciliation", String(bank.inUse)],
        ["Records rows imported", String(ledger.imported)],
        ["Records rows set aside as repeated", String(ledger.setAside)],
        ["Records rows used in this reconciliation", String(ledger.inUse)],
        ["Possible duplicates still included (not confirmed)", String(possibleDuplicateLines.length)],
      ];

  return { importSummary, setAsideLines, possibleDuplicateLines, reviewedSeparateLines };
}

export function buildReportModel(ctx: ExportContext): ReportModel {
  const buckets = deriveBuckets(ctx);

  const pair = (p: { bankTxn: Txn; ledgerTxn: Txn; reasons: string[] }, withNote: boolean): PairLine => ({
    kind: "pair",
    bankDate: shortDate(p.bankTxn.date),
    bankDescription: p.bankTxn.description,
    bankAmount: dollars(p.bankTxn.amount),
    bankSource: src(p.bankTxn),
    booksDate: shortDate(p.ledgerTxn.date),
    booksDescription: p.ledgerTxn.description,
    booksAmount: dollars(p.ledgerTxn.amount),
    booksSource: src(p.ledgerTxn),
    note: withNote ? p.reasons.join("; ") || "Amounts similar, dates differ" : "",
  });

  const matchedLines = [
    ...buckets.acceptedPairs.map((p) => pair(p, false)),
    ...buckets.acceptedComposites.flatMap(acceptedCompositeLines),
  ];
  const reviewLines = [
    ...buckets.reviewPairs.map((p) => pair(p, true)),
    ...buckets.reviewComposites.flatMap(reviewCompositeLines),
  ];

  const dup = duplicateSections(ctx);
  const everyLine: { source?: string; bankSource?: string; booksSource?: string }[] = [
    ...matchedLines,
    ...reviewLines,
    ...dup.setAsideLines,
    ...dup.possibleDuplicateLines,
    ...dup.reviewedSeparateLines,
  ];
  const missingFromBooks = buckets.missingFromBooks.map(side);
  const missingFromBank = buckets.missingFromBank.map(side);
  const acknowledged = buckets.acknowledgedBank.map(side);
  // A user-added entry is a bank transaction; show where that row came from.
  const bankById = new Map(ctx.bankTxns.map((t) => [t.id, t]));
  const added = buckets.addedToReconciliation.map((e) => ({
    date: shortDate(e.date),
    description: e.description,
    amount: dollars(e.amount),
    source: bankById.has(e.txnId) ? src(bankById.get(e.txnId)!) : "",
  }));
  everyLine.push(...missingFromBooks, ...missingFromBank, ...acknowledged, ...added);

  const open = openItemCount(buckets);
  const unresolved = ctx.duplicates
    ? unresolvedGroupCount(ctx.duplicates.groups, ctx.duplicates.state)
    : 0;
  const statusSummary: [string, string][] =
    dup.importSummary.length === 0
      ? []
      : [
          [
            "Financial reconciliation",
            ctx.unexplainedDifference === 0 && open === 0
              ? "Totals agree and nothing is left open"
              : "Not reconciled — a difference or open items remain",
          ],
          [
            "Duplicate review",
            unresolved > 0
              ? `Needed — ${unresolved} possible duplicate group${unresolved === 1 ? "" : "s"} not yet reviewed`
              : "Complete — every possible duplicate was set aside or confirmed as separate",
          ],
          ["Possible duplicates reviewed and retained as separate", String(dup.reviewedSeparateLines.length)],
        ];

  const model = {
    statusSummary,
    verdict: verdictText(ctx, buckets),
    hasProvenance: everyLine.some((l) => l.source || l.bankSource || l.booksSource),
    matchedCount: buckets.acceptedPairs.length + buckets.acceptedComposites.length,
    matchedLines,
    reviewCount: buckets.reviewPairs.length + buckets.reviewComposites.length,
    reviewLines,
    missingFromBooks,
    added,
    missingFromBank,
    acknowledged,
    ...dup,
    buckets,
  };
  return { ...model, summary: buildSummary(ctx, model, unresolved) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function balanceText(v: StatementCheck["opening"]): string {
  if (!v) return "Not stated";
  const note =
    v.source === "calculated"
      ? " (calculated — not stated in the file)"
      : v.source === "running"
        ? " (last running balance in the file)"
        : v.line
          ? ` (stated, line ${v.line})`
          : " (stated)";
  return dollars(v.cents) + note;
}

/**
 * Executive summary and supporting tables. Every figure is taken from the
 * month review, the statement verification, or the buckets above — the
 * same deterministic results the screen shows. Nothing is recalculated
 * from text and nothing comes from the AI copilot.
 */
function buildSummary(
  ctx: ExportContext,
  model: Omit<ReportModel, "summary">,
  unresolvedDuplicateGroups: number
): ReportSummary | null {
  const review = ctx.review;
  if (!review) return null;
  const { months, statements } = review;
  const b = model.buckets;
  const side = (pick: (m: (typeof months.months)[number]) => { imported: number; inUse: number; setAside: number }) => {
    const t = months.months.reduce(
      (a, m) => {
        const c = pick(m);
        return { imported: a.imported + c.imported, inUse: a.inUse + c.inUse, setAside: a.setAside + c.setAside };
      },
      { imported: 0, inUse: 0, setAside: 0 }
    );
    return `${t.imported} imported · ${t.inUse} in use · ${t.setAside} set aside`;
  };
  const unmatchedBank = months.months.reduce((a, m) => a + m.bank.unmatched, 0);
  const unmatchedLedger = months.months.reduce((a, m) => a + m.ledger.unmatched, 0);
  const financialAgrees = ctx.unexplainedDifference === 0 && openItemCount(b) === 0;
  const anyDuplicates = (ctx.duplicates?.groups.length ?? 0) > 0 || (ctx.duplicates?.state.setAside.length ?? 0) > 0;
  const sc = statements.counts;
  const bankFiles = statements.statements.length;
  // The same verdict the results screen shows, from the same function.
  const verdict = reportVerdict(ctx, b);
  const countsText = (c: Record<StatementStatus, number>) =>
    [
      c.verified > 0 ? `${c.verified} verified` : "",
      c["running-consistent"] > 0 ? `${c["running-consistent"]} running balance consistent only` : "",
      c.mismatch > 0 ? `${c.mismatch} mismatch` : "",
      c.conflict > 0 ? `${c.conflict} conflicting` : "",
      c["convention-review"] > 0 ? `${c["convention-review"]} sign convention needs review` : "",
      c.insufficient > 0 ? `${c.insufficient} not verified` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  const coverage = months.coverage.findings.map((f) => f.text);

  const executive: [string, string][] = [
    ["Account", ctx.accountName],
    ["Review period", formatPeriod(ctx.periodStart, ctx.periodEnd)],
    ["Months analyzed", `${months.overview.monthsAnalyzed} (${months.rangeLabel})`],
    ["Overall status", VERDICT_LABEL[verdict.status]],
    ["Bank rows", side((m) => m.bank)],
    ["Records rows", side((m) => m.ledger)],
    [
      "Financial reconciliation",
      financialAgrees
        ? "Totals agree and nothing is left open"
        : "Not reconciled — a difference or open items remain",
    ],
    [
      "Duplicate review",
      unresolvedDuplicateGroups > 0
        ? `Needed — ${plural(unresolvedDuplicateGroups, "possible duplicate group")} not yet reviewed`
        : anyDuplicates
          ? "Complete — every possible duplicate was set aside or confirmed as separate"
          : "No repeated rows were found in the uploaded files",
    ],
    ["Unexplained difference", dollars(Math.abs(ctx.unexplainedDifference))],
    ["Confirmed matches", `${months.overview.confirmedMatches} (${months.overview.crossMonthMatches} of all matches cross a month boundary)`],
    ["Unmatched transactions", `${unmatchedBank} on the bank statement · ${unmatchedLedger} in your records`],
    ["Suggested matches awaiting review", String(months.overview.awaitingReviewMatches)],
    [
      "Statement verification",
      bankFiles === 0
        ? "Not verified — no statement information available"
        : `${STATEMENT_SUMMARY_LABEL[verdict.statement]} — ${countsText(sc)} (of ${plural(bankFiles, "bank file")})`,
    ],
    ["Source coverage", `${months.coverage.label} — ${plural(coverage.length, "note")} below`],
  ];

  // ---- What is known, what is doubtful, what is missing, what was decided
  const evidence: ReportSummary["evidence"] = [];
  const add = (category: EvidenceCategory, text: string) => evidence.push({ category, text });

  const exact = ctx.matches.filter((m) => m.type === "exact" && m.status === "accepted").length;
  if (exact > 0) add("Verified facts", `${plural(exact, "transaction")} matched exactly on date, amount and description.`);
  if (financialAgrees) add("Verified facts", "The totals of the bank rows and records rows in use agree, and no item is left open.");
  for (const s of statements.statements.filter((x) => x.status === "verified")) {
    add("Verified facts", `"${s.file}" — statement balance verified: ${s.reasons[0]}`);
  }
  for (const s of statements.statements.filter((x) => x.status === "running-consistent")) {
    add("Verified facts", `"${s.file}" — running balance consistency only (not a verification of stated balances): ${s.reasons[0]}`);
  }
  const auto = ctx.duplicates?.state.setAside.filter((x) => x.by === "auto").length ?? 0;
  if (auto > 0) add("Verified facts", `${plural(auto, "repeated row")} proven by the files to be ${auto === 1 ? "a copy" : "copies"} (set aside automatically, not counted).`);

  if (ctx.unexplainedDifference !== 0) {
    add("Potential discrepancies", `The bank rows and records rows in use differ by ${dollars(Math.abs(ctx.unexplainedDifference))}.`);
  }
  if (unmatchedBank > 0) add("Potential discrepancies", `${plural(unmatchedBank, "bank transaction")} with no match in your records.`);
  if (unmatchedLedger > 0) add("Potential discrepancies", `${plural(unmatchedLedger, "records entry", "records entries")} with no match on the bank statement.`);
  if (model.reviewCount > 0) add("Potential discrepancies", `${plural(model.reviewCount, "suggested match", "suggested matches")} not yet confirmed or rejected.`);
  if (unresolvedDuplicateGroups > 0) add("Potential discrepancies", `${plural(unresolvedDuplicateGroups, "possible duplicate group")} still counted and not yet reviewed.`);
  for (const s of statements.statements.filter(
    (x) => x.status === "mismatch" || x.status === "conflict" || x.status === "convention-review"
  )) {
    add("Potential discrepancies", `"${s.file}" — ${STATEMENT_STATUS_LABEL[s.status]}: ${s.reasons[0]}`);
  }

  for (const s of statements.statements.filter((x) => x.status === "insufficient")) {
    add("Missing or insufficient evidence", `"${s.file}" — not verified: ${s.reasons[0]}`);
  }
  for (const text of coverage) add("Missing or insufficient evidence", text);

  const confirmedByUser =
    ctx.matches.filter((m) => m.type !== "exact" && (m.status === "accepted" || m.status === "manual")).length +
    b.acceptedComposites.length;
  const rejected =
    ctx.matches.filter((m) => m.status === "rejected").length +
    ctx.compositeMatches.filter((c) => c.status === "rejected").length;
  if (confirmedByUser > 0) add("Your decisions", `${plural(confirmedByUser, "suggested match", "suggested matches")} confirmed by you.`);
  if (rejected > 0) add("Your decisions", `${plural(rejected, "suggested match", "suggested matches")} rejected by you.`);
  if (model.added.length > 0) add("Your decisions", `${plural(model.added.length, "bank transaction")} added to the reconciliation by you (to be recorded in your books).`);
  if (model.acknowledged.length > 0) add("Your decisions", `${plural(model.acknowledged.length, "records entry", "records entries")} marked by you as expected (not yet cleared).`);
  const byUser = ctx.duplicates?.state.setAside.filter((x) => x.by === "user").length ?? 0;
  if (byUser > 0) add("Your decisions", `${plural(byUser, "row")} set aside by you as repeated.`);
  if (model.reviewedSeparateLines.length > 0) add("Your decisions", `${plural(model.reviewedSeparateLines.length, "row")} reviewed by you and kept as separate transactions.`);

  const monthRows: MonthRow[] = months.months.map((m) => ({
    month: m.label,
    bankRows: String(m.bank.inUse),
    recordsRows: String(m.ledger.inUse),
    setAside: String(m.bank.setAside + m.ledger.setAside),
    unmatched: String(m.bank.unmatched + m.ledger.unmatched),
    toReview: String(m.awaitingReviewMatches),
    duplicateQuestions: String(m.duplicateGroupsToReview),
    crossMonth: String(m.crossMonthMatches),
    findings: (m.flags.length ? m.flags : [m.status]).map((f) => MONTH_STATUS_LABEL[f]).join("; "),
    statementBalance: m.statement.label,
    notes: [m.statement.detail, ...m.notes].join(" "),
  }));

  const statementRows: StatementRow[] = statements.statements.map((s) => ({
    file: s.file,
    period: s.statedPeriod
      ? `${shortDate(s.statedPeriod.start)} – ${shortDate(s.statedPeriod.end)} (stated)`
      : s.activity
        ? `${shortDate(s.activity.start)} – ${shortDate(s.activity.end)} (first to last row; no period stated)`
        : "No rows",
    opening: balanceText(s.opening),
    netActivity: `${dollars(s.netActivity)} across ${plural(s.rowCount, "row")}`,
    closing: balanceText(s.closing),
    difference: s.difference === null ? "Not computable" : dollars(s.difference),
    status: STATEMENT_STATUS_LABEL[s.status],
    explanation: s.reasons.join(" "),
  }));

  const exceptions: ExceptionRow[] = [
    ...model.missingFromBooks.map((l) => ({ type: "On bank statement, not in your records", ...l })),
    ...model.missingFromBank.map((l) => ({ type: "In your records, not on bank statement", ...l })),
    ...model.reviewLines
      .filter((l) => l.kind !== "part")
      .map((l) => ({
        type: l.kind === "group" ? "Suggested grouped match awaiting review" : "Suggested match awaiting review",
        date: l.bankDate,
        description: l.bankDescription,
        amount: l.bankAmount,
        source: l.bankSource,
      })),
    ...model.possibleDuplicateLines.map((l) => ({
      type: "Possible duplicate still included",
      date: l.date,
      description: l.description,
      amount: l.amount,
      source: l.source,
    })),
    ...statements.statements
      .filter((s) => s.status === "mismatch" || s.status === "conflict" || s.status === "convention-review")
      .map((s) => ({
        type: STATEMENT_STATUS_LABEL[s.status],
        date: s.activity ? shortDate(s.activity.end) : "",
        description: s.reasons[0] ?? "",
        amount: s.difference === null ? "" : dollars(s.difference),
        source: s.file,
      })),
  ];

  return { executive, evidence, months: monthRows, statements: statementRows, exceptions, coverage };
}
