/**
 * Phase 4 — the enhanced reports. One shared deterministic model feeds the
 * PDF and the Excel workbook; these tests pin what that model says (the
 * executive summary, month table, statement checks, exceptions, coverage)
 * and check the real files built from it.
 */
import { describe, it, expect } from "vitest";
import { combineFiles, type ImportFileInput } from "@/lib/import/combine";
import { activeTxns, detectDuplicates, dismissGroup, initialDuplicateState } from "@/lib/import/duplicates";
import { reconcile } from "@/lib/recon/engine";
import { applyCompositeDecision, applyMatchDecision } from "@/lib/recon/decisions";
import { deriveVerdict } from "@/lib/recon/verdict";
import { unresolvedGroupCount } from "@/lib/import/duplicates";
import { buildMonthReview } from "@/lib/review/months";
import { verifyStatements } from "@/lib/review/statements";
import type { SourceFileInfo } from "@/lib/data/repository";
import type { ExportContext } from "@/lib/export/buckets";
import { buildReportModel } from "@/lib/export/report-model";
import { buildExcelWorkbook } from "@/lib/export/excel-worksheet";
import { buildPdfDocument } from "@/lib/export/pdf-report";

const file = (name: string, lines: string[], headerRow = 1): ImportFileInput => ({
  name, content: lines.join("\n"), map: undefined as unknown as ImportFileInput["map"], headerRow,
});
const H = "Transaction ID,Date,Description,Amount";

/**
 * Jan–Feb review:
 *  - bank-jan.csv: states its period and balances (verified);
 *  - bank-feb.csv: states balances that don't add up (mismatch), repeats one
 *    January row with the same transaction ID (set aside automatically),
 *    and carries a fee the books don't have and a formula-looking payee;
 *  - a cheque written Jan 30 that clears Feb 3 (cross-month suggestion);
 *  - a February deposit made of two January invoices (cross-month group);
 *  - two identical parking entries in the ledger (possible duplicate).
 */
function scenario(decide = true): ExportContext {
  const bankFiles = [
    file("bank-jan.csv", [
      "Statement period: 01/01/2026 - 01/31/2026", H,
      ",01/01/2026,Opening Balance,1000.00",
      "TX1,01/05/2026,COFFEE SUPPLY CO,-45.10",
      "TX2,01/20/2026,CLIENT PAYMENT,1200.00",
      ",01/31/2026,Closing Balance,2154.90",
    ], 2),
    file("bank-feb.csv", [
      "Statement period: 02/01/2026 - 02/28/2026", H,
      ",02/01/2026,Opening Balance,2154.90",
      "TX2,01/20/2026,CLIENT PAYMENT,1200.00",
      "TX3,02/02/2026,STRIPE PAYOUT,100.00",
      "TX4,02/03/2026,CHECK 1042 LANDLORD,-310.00",
      'TX5,02/27/2026,"=HYPERLINK(""http://evil"")",-12.00',
      ",02/28/2026,Closing Balance,9999.00",
    ], 2),
  ];
  const ledgerFiles = [file("ledger.csv", [
    "Date,Description,Amount",
    "01/05/2026,COFFEE SUPPLY CO,-45.10",
    "01/20/2026,CLIENT PAYMENT,1200.00",
    "01/22/2026,Parking,-8.00",
    "01/22/2026,Parking,-8.00",
    "01/30/2026,CHECK 1042 LANDLORD,-310.00",
    "01/30/2026,Invoice 101 Acme,60.00",
    "01/31/2026,Invoice 102 Birch,40.00",
  ])];
  const b = combineFiles("bank", bankFiles);
  const l = combineFiles("ledger", ledgerFiles);
  const sourceFiles: SourceFileInfo[] = [...b.files, ...l.files].map((f) => ({
    side: f.side, name: f.name, rows: f.rowCount, headerRow: f.headerRow,
    periodStart: f.coverage?.start ?? null, periodEnd: f.coverage?.end ?? null,
    statementStart: f.diagnostics.statementPeriod?.start ?? null,
    statementEnd: f.diagnostics.statementPeriod?.end ?? null,
    skippedRows: f.diagnostics.issueCount, invalidDateRows: f.diagnostics.invalidDateRows,
    statementOpening: f.diagnostics.statement.opening,
    statementClosing: f.diagnostics.statement.closing,
    statementAmbiguities: f.diagnostics.statement.ambiguities,
  }));
  const groups = [...detectDuplicates("bank", b.txns), ...detectDuplicates("ledger", l.txns)];
  let state = initialDuplicateState(groups, "2026-11-10T09:00:00.000Z");
  const bank = activeTxns(b.txns, state);
  const ledger = activeTxns(l.txns, state);
  const r = reconcile(bank, ledger);
  let matches = r.matches;
  let composites = r.compositeMatches;
  if (decide) {
    // The user confirms the cheque and the grouped deposit, and says the parking entries are separate.
    for (const m of matches.filter((x) => x.status === "suggested")) matches = applyMatchDecision(matches, m.id, "accept");
    for (const c of composites) composites = applyCompositeDecision(composites, c.id, "accept");
    state = dismissGroup(state, groups.find((g) => g.side === "ledger")!.id, true, "2026-11-10T10:00:00.000Z");
  }
  const statements = verifyStatements(b.txns, sourceFiles);
  const months = buildMonthReview({
    imported: { bank: b.txns, ledger: l.txns }, bankTxns: bank, ledgerTxns: ledger,
    matches, compositeMatches: composites, addedBankIds: new Set(), acknowledgedLedgerIds: new Set(),
    duplicateGroups: groups, duplicateState: state, sourceFiles, statementReview: statements,
  });
  const open =
    months.overview.unmatchedTransactions + months.overview.awaitingReviewMatches;
  const verdict = deriveVerdict({
    unexplainedDifference: r.balanceProof.unexplainedDifference,
    openItemCount: open,
    unresolvedDuplicateGroups: unresolvedGroupCount(groups, state),
  });
  return {
    accountName: "Harbor Street Bakery — Checking",
    periodStart: "2026-01-05", periodEnd: "2026-02-27",
    openingBalance: null, closingBalance: null,
    reconciled: verdict.reconciled,
    unexplainedDifference: r.balanceProof.unexplainedDifference,
    bankTxns: bank, ledgerTxns: ledger, matches, compositeMatches: composites,
    userAddedEntries: [], acknowledgedBankIds: [],
    duplicates: { allBankTxns: b.txns, allLedgerTxns: l.txns, groups, state },
    review: { months, statements },
  };
}

type Cell = { v: string; t: string; f?: string };
async function sheets(ctx: ExportContext) {
  const wb = await buildExcelWorkbook(ctx);
  const read = (name: string) => {
    const ws = wb.Sheets[name] as Record<string, Cell>;
    const cells = Object.entries(ws).filter(([k]) => !k.startsWith("!"));
    const byRow = new Map<number, string[]>();
    for (const [addr, c] of cells) {
      const m = /^([A-Z]+)(\d+)$/.exec(addr)!;
      const list = byRow.get(Number(m[2])) ?? [];
      list[m[1].charCodeAt(0) - 65] = String(c.v);
      byRow.set(Number(m[2]), list);
    }
    const lines = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => Array.from(r, (v) => v ?? ""));
    return { cells: cells.map(([, c]) => c), lines, text: lines.map((l) => l.join(" | ")).join("\n") };
  };
  return { names: wb.SheetNames, read };
}

describe("fixture sanity", () => {
  const ctx = scenario();
  it("is the mixed situation the summary has to describe", () => {
    expect(ctx.review!.months.months.map((m) => m.month)).toEqual(["2026-01", "2026-02"]);
    expect(ctx.review!.statements.statements.map((s) => s.status)).toEqual(["verified", "mismatch"]);
    expect(ctx.duplicates!.state.setAside).toHaveLength(1);
    expect(ctx.reconciled).toBe(false);
  });
});

describe("executive summary (shared model)", () => {
  const sum = buildReportModel(scenario()).summary!;
  const row = (label: string) => sum.executive.find(([l]) => l === label)![1];

  it("states the account, period and months analyzed", () => {
    expect(row("Account")).toBe("Harbor Street Bakery — Checking");
    expect(row("Review period")).toBe("Jan 5 – Feb 27, 2026");
    expect(row("Months analyzed")).toBe("2 (January to February 2026)");
  });

  it("gives imported, in-use and set-aside counts per side", () => {
    expect(row("Bank rows")).toBe("6 imported · 5 in use · 1 set aside");
    expect(row("Records rows")).toBe("7 imported · 7 in use · 0 set aside");
  });

  it("reports the financial status and the duplicate-review status separately", () => {
    expect(row("Financial reconciliation")).toBe("Not reconciled — a difference or open items remain");
    expect(row("Duplicate review")).toBe("Complete — every possible duplicate was set aside or confirmed as separate");
    expect(row("Unexplained difference")).toBe("$4.00");
  });

  it("gives unmatched, pending and match counts that agree with the month review", () => {
    expect(row("Unmatched transactions")).toBe("1 on the bank statement · 2 in your records");
    expect(row("Suggested matches awaiting review")).toBe("0");
    expect(row("Confirmed matches")).toBe("4 (2 of all matches cross a month boundary)");
  });

  it("summarises statement verification and coverage without overstating", () => {
    expect(row("Statement balance verification")).toBe("1 verified · 1 mismatch · 0 conflicting · 0 insufficient information (of 2 bank files)");
    expect(row("Source coverage")).toMatch(/^Coverage not verified — \d+ notes? below$/);
    expect(JSON.stringify(sum.executive)).not.toMatch(/fully reconciled/i);
  });

  it("before any decisions: pending items and the duplicate question are counted", () => {
    const s = buildReportModel(scenario(false)).summary!;
    const r = (label: string) => s.executive.find(([l]) => l === label)![1];
    expect(r("Suggested matches awaiting review")).toBe("2");
    expect(r("Duplicate review")).toBe("Needed — 1 possible duplicate group not yet reviewed");
    expect(r("Confirmed matches")).toBe("2 (2 of all matches cross a month boundary)");
  });
});

describe("month-by-month table", () => {
  const sum = buildReportModel(scenario()).summary!;
  it("has one row per month with counts, findings and the statement result", () => {
    expect(sum.months.map((m) => [m.month, m.bankRows, m.recordsRows, m.setAside, m.unmatched, m.toReview, m.duplicateQuestions, m.crossMonth])).toEqual([
      ["January 2026", "2", "7", "1", "2", "0", "0", "2"],
      ["February 2026", "3", "0", "0", "1", "0", "0", "2"],
    ]);
    expect(sum.months[0].findings).toBe("Review needed");
    expect(sum.months[0].statementBalance).toBe("Statement activity verified");
    expect(sum.months[1].findings).toBe("Review needed; Source data incomplete or unverified");
    expect(sum.months[1].statementBalance).toBe("Statement balance mismatch");
    expect(sum.months[1].notes).toContain("the uploaded bank files have rows dated in this month, but the records files have none");
  });
  it("row counts add up to the executive summary", () => {
    expect(sum.months.reduce((a, m) => a + Number(m.bankRows), 0)).toBe(5);
    expect(sum.months.reduce((a, m) => a + Number(m.recordsRows), 0)).toBe(7);
    expect(sum.months.reduce((a, m) => a + Number(m.unmatched), 0)).toBe(3);
  });
});

describe("statement verification table", () => {
  const sum = buildReportModel(scenario()).summary!;
  it("shows the stated figures, the difference and the result for each bank file", () => {
    expect(sum.statements.map((s) => [s.file, s.status, s.difference])).toEqual([
      ["bank-jan.csv", "Statement activity verified", "$0.00"],
      ["bank-feb.csv", "Statement balance mismatch", "($6,866.10)"],
    ]);
    expect(sum.statements[0].period).toBe("Jan 1, 2026 – Jan 31, 2026 (stated)");
    expect(sum.statements[0].opening).toBe("$1,000.00 (stated, line 3)");
    expect(sum.statements[0].netActivity).toBe("$1,154.90 across 2 rows");
    expect(sum.statements[0].closing).toBe("$2,154.90 (stated, line 6)");
  });
  it("uses every imported row — the set-aside copy still counts toward its own statement", () => {
    // bank-feb.csv has 4 rows imported, 1 of them set aside for the reconciliation.
    expect(sum.statements[1].netActivity).toBe("$978.00 across 4 rows");
  });
});

describe("verified facts / potential discrepancies / missing evidence / your decisions", () => {
  const sum = buildReportModel(scenario()).summary!;
  const of = (category: string) => sum.evidence.filter((e) => e.category === category).map((e) => e.text);

  it("verified facts", () => {
    const facts = of("Verified facts");
    expect(facts).toContain("2 transactions matched exactly on date, amount and description.");
    expect(facts.some((t) => t.startsWith('"bank-jan.csv": Opening balance $1,000.00 plus'))).toBe(true);
    expect(facts).toContain("1 repeated row proven by the files to be a copy (set aside automatically, not counted).");
  });
  it("potential discrepancies", () => {
    const d = of("Potential discrepancies");
    expect(d).toContain("The bank rows and records rows in use differ by $4.00.");
    expect(d).toContain("1 bank transaction with no match in your records.");
    expect(d).toContain("2 records entries with no match on the bank statement.");
    expect(d.some((t) => t.startsWith('"bank-feb.csv" — Statement balance mismatch:'))).toBe(true);
  });
  it("missing or insufficient evidence", () => {
    const m = of("Missing or insufficient evidence");
    expect(m.some((t) => /Statement balances were checked/.test(t))).toBe(true);
    expect(m.some((t) => /February 2026: the uploaded bank files have rows/.test(t))).toBe(true);
  });
  it("your decisions", () => {
    const u = of("Your decisions");
    expect(u).toContain("2 suggested matches confirmed by you.");
    expect(u).toContain("2 rows reviewed by you and kept as separate transactions.");
  });
  it("every category that applies appears, in a fixed order", () => {
    expect([...new Set(sum.evidence.map((e) => e.category))]).toEqual([
      "Verified facts", "Potential discrepancies", "Missing or insufficient evidence", "Your decisions",
    ]);
  });
});

describe("unresolved exceptions", () => {
  it("lists each open item once, with its source", () => {
    const ex = buildReportModel(scenario(false)).summary!.exceptions;
    expect(ex.map((e) => e.type)).toEqual([
      "On bank statement, not in your records",
      "In your records, not on bank statement",
      "In your records, not on bank statement",
      "Suggested match awaiting review",
      "Suggested grouped match awaiting review",
      "Possible duplicate still included",
      "Possible duplicate still included",
      "Statement balance mismatch",
    ]);
    expect(ex[0]).toMatchObject({ amount: "($12.00)", source: "bank-feb.csv · row 7" });
    expect(ex[4]).toMatchObject({ description: "STRIPE PAYOUT", source: "bank-feb.csv · row 5" });
    expect(ex[7]).toMatchObject({ source: "bank-feb.csv", amount: "($6,866.10)" });
  });
});

describe("existing detail is intact", () => {
  const model = buildReportModel(scenario());
  it("composite matches, provenance and duplicate decisions are still reported", () => {
    const group = model.matchedLines.find((l) => l.kind === "group")!;
    expect(group.bankDescription).toBe("STRIPE PAYOUT");
    expect(group.bankSource).toBe("bank-feb.csv · row 5");
    expect(model.matchedLines.filter((l) => l.kind === "part").map((l) => l.booksSource)).toEqual(["ledger.csv · row 7", "ledger.csv · row 8"]);
    expect(model.setAsideLines.map((l) => l.source)).toEqual(["bank-feb.csv · row 4"]);
    expect(model.reviewedSeparateLines).toHaveLength(2);
    expect(model.matchedCount).toBe(4);
  });
  it("no transaction is counted in two sections", () => {
    const b = model.buckets;
    const bankIds = [
      ...b.acceptedPairs.map((p) => p.bankTxn.id), ...b.acceptedComposites.map((c) => c.bankTxn.id),
      ...b.reviewPairs.map((p) => p.bankTxn.id), ...b.reviewComposites.map((c) => c.bankTxn.id),
      ...b.missingFromBooks.map((t) => t.id),
    ];
    expect(new Set(bankIds).size).toBe(bankIds.length);
    expect(bankIds).toHaveLength(5); // the rows in use
  });
});

describe("Excel workbook", () => {
  it("adds a Financial Summary sheet and leaves the Reconciliation sheet exactly as it was", async () => {
    const ctx = scenario();
    const withReview = await sheets(ctx);
    const without = await sheets({ ...ctx, review: undefined });
    expect(withReview.names).toEqual(["Reconciliation", "Financial Summary"]);
    expect(without.names).toEqual(["Reconciliation"]);
    expect(withReview.read("Reconciliation").lines).toEqual(without.read("Reconciliation").lines);
  });

  it("Financial Summary carries the overall results, months, statements, exceptions and coverage", async () => {
    const { text, lines } = (await sheets(scenario())).read("Financial Summary");
    expect(text).toContain("Overall results");
    expect(text).toContain("Bank rows | 6 imported · 5 in use · 1 set aside");
    expect(text).toContain("Statement balance verification | 1 verified · 1 mismatch");
    expect(text).toContain("Month-by-month findings");
    const feb = lines.find((l) => l[0] === "February 2026")!;
    expect(feb.slice(1, 8)).toEqual(["3", "0", "0", "1", "0", "0", "2"]);
    expect(feb[9]).toBe("Statement balance mismatch");
    const stmt = lines.find((l) => l[0] === "bank-feb.csv" && l[6] === "Statement balance mismatch")!;
    expect(stmt[5]).toBe("($6,866.10)");
    expect(text).toContain("Unresolved exceptions  (4)");
    expect(text).toContain("Source coverage limitations — Coverage not verified");
    expect(text).toContain("Verified facts | 2 transactions matched exactly");
    expect(text).toContain("Your decisions | 2 suggested matches confirmed by you.");
  });

  it("formula injection: every cell on BOTH sheets is a string, including a formula-looking payee", async () => {
    const s = await sheets(scenario());
    for (const name of s.names) {
      const { cells } = s.read(name);
      expect(cells.length).toBeGreaterThan(40);
      expect(cells.every((c) => c.t === "s" && c.f === undefined)).toBe(true);
    }
    const evil = s.read("Financial Summary").cells.filter((c) => String(c.v).startsWith("=HYPERLINK"));
    expect(evil.length).toBeGreaterThan(0); // it IS in the exceptions list…
    expect(evil.every((c) => c.t === "s")).toBe(true); // …as text
  });
});

describe("PDF report", () => {
  it("contains the executive summary, month table and statement checks, and keeps the existing sections", async () => {
    const out = (await buildPdfDocument(scenario())).output();
    for (const text of [
      "Executive summary", "Months analyzed", "What this review shows", "Month-by-month findings",
      "Statement balance checks", "Source coverage", "February 2026",
      // existing sections still present
      "Summary", "Matched transactions", "STRIPE PAYOUT", "Rows set aside as repeated", "Reviewed and retained", "About this report",
    ]) {
      expect(out).toContain(text);
    }
    expect(out).toContain("not accounting or tax advice");
  });

  it("without a review (older caller) the new sections are absent", async () => {
    const out = (await buildPdfDocument({ ...scenario(), review: undefined })).output();
    expect(out).not.toContain("Executive summary");
    expect(out).not.toContain("Month-by-month findings");
    expect(out).toContain("Matched transactions");
  });
});

describe("legacy saved reconciliations", () => {
  it("no provenance, no source files, no balances → a summary that claims nothing it can't", () => {
    const ctx = scenario();
    const strip = <T extends { sourceFile?: string; sourceLine?: number; runningBalance?: number }>({ sourceFile, sourceLine, runningBalance, ...t }: T) => t;
    const bank = ctx.bankTxns.map(strip) as typeof ctx.bankTxns;
    const ledger = ctx.ledgerTxns.map(strip) as typeof ctx.ledgerTxns;
    const statements = verifyStatements(bank, undefined);
    const months = buildMonthReview({
      imported: { bank, ledger }, bankTxns: bank, ledgerTxns: ledger,
      matches: ctx.matches, compositeMatches: ctx.compositeMatches,
      addedBankIds: new Set(), acknowledgedLedgerIds: new Set(),
      duplicateGroups: [], duplicateState: { setAside: [], dismissedGroupIds: [], history: [] },
      statementReview: statements,
    });
    const sum = buildReportModel({ ...ctx, bankTxns: bank, ledgerTxns: ledger, duplicates: undefined, review: { months, statements } }).summary!;
    const row = (label: string) => sum.executive.find(([l]) => l === label)![1];
    expect(row("Statement balance verification")).toBe("No statement information available");
    expect(row("Duplicate review")).toBe("No repeated rows were found in the uploaded files");
    expect(sum.statements).toEqual([]);
    expect(sum.months.every((m) => m.statementBalance === "Insufficient statement information")).toBe(true);
  });
});
