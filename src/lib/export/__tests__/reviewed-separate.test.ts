/**
 * Duplicate groups the user confirmed as separate, legitimate transactions
 * must appear in the PDF and Excel reports — labelled as reviewed and
 * retained, with file, row and the reason — and the reports must state the
 * financial status and the duplicate-review status separately.
 */
import { describe, it, expect } from "vitest";
import { combineFiles, type ImportFileInput } from "@/lib/import/combine";
import {
  activeTxns,
  detectDuplicates,
  dismissGroup,
  initialDuplicateState,
  unresolvedGroupCount,
  type DuplicateState,
} from "@/lib/import/duplicates";
import { reconcile } from "@/lib/recon/engine";
import { deriveVerdict } from "@/lib/recon/verdict";
import type { ExportContext } from "@/lib/export/buckets";
import { buildReportModel } from "@/lib/export/report-model";
import { buildExcelWorkbook } from "@/lib/export/excel-worksheet";
import { buildPdfDocument } from "@/lib/export/pdf-report";

const file = (name: string, rows: string[]): ImportFileInput => ({
  name, content: ["Date,Description,Amount", ...rows].join("\n"), map: undefined as unknown as ImportFileInput["map"],
});
const rows = ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/28/2026,PARKING GARAGE,-8.00", "01/28/2026,PARKING GARAGE,-8.00"];
const allBank = combineFiles("bank", [file("bank-jan.csv", rows)]).txns;
const allLedger = combineFiles("ledger", [file("ledger-jan.csv", rows)]).txns;
const groups = [...detectDuplicates("bank", allBank), ...detectDuplicates("ledger", allLedger)];

function ctxFor(state: DuplicateState): ExportContext {
  const bank = activeTxns(allBank, state);
  const ledger = activeTxns(allLedger, state);
  const r = reconcile(bank, ledger);
  const verdict = deriveVerdict({
    unexplainedDifference: r.balanceProof.unexplainedDifference,
    openItemCount: r.missingFromBooks.length + r.missingFromBank.length,
    unresolvedDuplicateGroups: unresolvedGroupCount(groups, state),
  });
  return {
    accountName: "Business Checking", periodStart: "2026-01-05", periodEnd: "2026-01-28",
    openingBalance: null, closingBalance: null,
    reconciled: verdict.reconciled,
    unexplainedDifference: r.balanceProof.unexplainedDifference,
    bankTxns: bank, ledgerTxns: ledger, matches: r.matches, compositeMatches: r.compositeMatches,
    userAddedEntries: [], acknowledgedBankIds: [],
    duplicates: { allBankTxns: allBank, allLedgerTxns: allLedger, groups, state },
  };
}

const unreviewed = initialDuplicateState(groups, "2026-11-09T12:00:00.000Z");
const bankOnly = dismissGroup(unreviewed, groups[0].id, true, "2026-11-09T15:30:00.000Z");
const allKept = dismissGroup(bankOnly, groups[1].id, true, "2026-11-10T09:00:00.000Z");

async function sheetText(ctx: ExportContext) {
  const wb = await buildExcelWorkbook(ctx);
  const ws = wb.Sheets[wb.SheetNames[0]] as Record<string, { v: string; t: string }>;
  const cells = Object.entries(ws).filter(([k]) => !k.startsWith("!"));
  const byRow = new Map<number, string[]>();
  for (const [addr, c] of cells) {
    const m = /^([A-Z]+)(\d+)$/.exec(addr)!;
    const list = byRow.get(Number(m[2])) ?? [];
    list[m[1].charCodeAt(0) - 65] = String(c.v);
    byRow.set(Number(m[2]), list);
  }
  const lines = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => Array.from(r, (v) => v ?? ""));
  // Text is text; the only numbers are amounts and counts Reconly computed; nothing is a formula.
  const safe = cells.every(
    ([, c]) =>
      (c as { f?: string }).f === undefined &&
      (c.t === "s" || (c.t === "n" && typeof (c.v as unknown) === "number"))
  );
  return { lines, text: lines.map((l) => l.join(" | ")).join("\n"), safe };
}

describe("report model — groups confirmed as separate", () => {
  it("before review: listed as still included, none as retained, and the verdict says review is needed", () => {
    const m = buildReportModel(ctxFor(unreviewed));
    expect(m.reviewedSeparateLines).toEqual([]);
    expect(m.possibleDuplicateLines).toHaveLength(4);
    expect(m.verdict).toMatch(/^Totals agree — duplicate review needed: 2 possible duplicate groups/);
    expect(m.statusSummary).toEqual([
      ["Financial reconciliation", "Totals agree and nothing is left open"],
      ["Duplicate review", "Needed — 2 possible duplicate groups not yet reviewed"],
      ["Possible duplicates reviewed and retained as separate", "0"],
    ]);
  });

  it("after confirming one group: its rows move to 'reviewed and retained' with source and reason", () => {
    const m = buildReportModel(ctxFor(bankOnly));
    expect(m.reviewedSeparateLines.map((l) => [l.side, l.description, l.amount, l.source, l.status])).toEqual([
      ["Bank", "PARKING GARAGE", "($8.00)", "bank-jan.csv · row 3", "Reviewed and retained"],
      ["Bank", "PARKING GARAGE", "($8.00)", "bank-jan.csv · row 4", "Reviewed and retained"],
    ]);
    const reason = m.reviewedSeparateLines[0].reason;
    expect(reason).toContain("Confirmed by you on Nov 9, 2026 as separate transactions");
    expect(reason).toContain("every row is kept and counted");
    expect(reason).toContain("Why it was flagged: The same date, amount and description appear more than once");
    // The other side is still open.
    expect(m.possibleDuplicateLines.map((l) => l.source)).toEqual(["ledger-jan.csv · row 3", "ledger-jan.csv · row 4"]);
    expect(m.verdict).toMatch(/1 possible duplicate group has not been reviewed/);
  });

  it("after confirming all: fully reconciled, review complete, all four rows retained and counted", () => {
    const ctx = ctxFor(allKept);
    const m = buildReportModel(ctx);
    expect(ctx.reconciled).toBe(true);
    expect(m.verdict).toBe("Your records match your bank for this period.");
    expect(m.possibleDuplicateLines).toEqual([]);
    expect(m.setAsideLines).toEqual([]);
    expect(m.reviewedSeparateLines).toHaveLength(4);
    expect(m.statusSummary).toEqual([
      ["Financial reconciliation", "Totals agree and nothing is left open"],
      ["Duplicate review", "Complete — every possible duplicate was set aside or confirmed as separate"],
      ["Possible duplicates reviewed and retained as separate", "4"],
    ]);
    // Retained rows are still in the reconciliation itself.
    expect(m.matchedCount).toBe(3);
    expect(m.importSummary).toContainEqual(["Bank rows used in this reconciliation", "3"]);
  });

  it("a confirmation recorded without a timestamp (older state) still reports, without a date", () => {
    const noDate: DuplicateState = { ...allKept, dismissedAt: undefined };
    const m = buildReportModel(ctxFor(noDate));
    expect(m.reviewedSeparateLines[0].decision).toMatch(/^Confirmed by you as separate transactions/);
  });
});

describe("Excel workbook — confirmed-separate groups", () => {
  it("has a labelled section with file, row and reason; text is text and amounts are numbers", async () => {
    const { lines, text, safe } = await sheetText(ctxFor(allKept));
    expect(text).toContain("Reviewed and retained — confirmed as separate  (4) — counted above");
    expect(text).toContain("Financial reconciliation | Totals agree and nothing is left open");
    expect(text).toContain("Duplicate review | Complete");
    const row = lines.find((l) => l[4] === "ledger-jan.csv · row 4")!;
    expect(row.slice(0, 4)).toEqual(["Jan 28, 2026", "PARKING GARAGE", "-8", "Books"]); // −8.00 as a number
    expect(row[5]).toBe("Reviewed and retained");
    expect(row[6]).toMatch(/^The same date, amount and description appear more than once/); // detection
    expect(row[7]).toMatch(/^No row was set aside automatically/); // automatic step
    expect(row[8]).toMatch(/^Confirmed by you on Nov 10, 2026 as separate transactions/); // decision
    expect(row[9]).toBe("This row is included in the reconciliation totals."); // current status
    expect(safe).toBe(true);
  });

  it("while unreviewed, says review is needed and has no retained section", async () => {
    const { text } = await sheetText(ctxFor(unreviewed));
    expect(text).toContain("Totals agree — duplicate review needed");
    expect(text).toContain("Duplicate review | Needed — 2 possible duplicate groups not yet reviewed");
    expect(text).toContain("Possible duplicates still included  (4)");
    expect(text).not.toContain("Reviewed and retained —");
  });
});

describe("PDF report — confirmed-separate groups", () => {
  it("contains the retained section, the reason and both statuses", async () => {
    const out = (await buildPdfDocument(ctxFor(allKept))).output();
    expect(out).toContain("Reviewed and retained");
    expect(out).toContain("Financial reconciliation");
    expect(out).toContain("Duplicate review");
    expect(out).toContain("ledger-jan.csv");
    // The reason wraps across lines in the PDF's narrow column, so look for
    // its opening words (the full sentence is asserted on the model above).
    expect(out).toContain("Confirmed by you");
  });

  it("while unreviewed, carries the review-needed verdict", async () => {
    const out = (await buildPdfDocument(ctxFor(unreviewed))).output();
    expect(out).toContain("duplicate review needed");
    expect(out).not.toContain("Reviewed and retained");
  });
});
