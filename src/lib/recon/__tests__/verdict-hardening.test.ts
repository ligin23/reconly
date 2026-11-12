/**
 * Financial-accuracy hardening (after Phase 4).
 *
 * "Fully reconciled" now also requires that no bank statement's own
 * balances contradict its activity. Three statuses stay separate —
 * transaction matching, duplicate review, statement verification — and
 * the results screen, the PDF, the Excel workbook and the copilot all
 * take their verdict from the same function.
 *
 * The matching engine is used unchanged.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { combineFiles, type ImportFileInput } from "@/lib/import/combine";
import {
  EMPTY_DUPLICATE_STATE,
  activeTxns,
  detectDuplicates,
  dismissGroup,
  initialDuplicateState,
  unresolvedGroupCount,
  type DuplicateState,
} from "@/lib/import/duplicates";
import { reconcile } from "@/lib/recon/engine";
import { deriveVerdict, VERDICT_LABEL, type Verdict } from "@/lib/recon/verdict";
import { deriveStatus } from "@/lib/data/utils";
import { buildMonthReview } from "@/lib/review/months";
import {
  STATEMENT_SUMMARY_LABEL,
  monthStatement,
  summarizeStatements,
  verifyStatements,
  type StatementStatus,
} from "@/lib/review/statements";
import type { SourceFileInfo } from "@/lib/data/repository";
import { reportVerdict, deriveBuckets, type ExportContext } from "@/lib/export/buckets";
import { buildReportModel } from "@/lib/export/report-model";
import { buildExcelWorkbook } from "@/lib/export/excel-worksheet";
import { buildPdfDocument } from "@/lib/export/pdf-report";
import { buildReconContext } from "@/lib/copilot/context-builder";
import { reconContextSchema } from "@/lib/copilot/schema";
import { parseCsv } from "@/lib/parser";
import type { Txn } from "@/lib/recon/types";

const file = (name: string, lines: string[], headerRow = 1): ImportFileInput => ({
  name, content: lines.join("\n"), map: undefined as unknown as ImportFileInput["map"], headerRow,
});
const AMT = "Date,Description,Amount";
const BAL = "Date,Description,Amount,Balance";
const counts = (over: Partial<Record<StatementStatus, number>> = {}): Record<StatementStatus, number> => ({
  verified: 0, "running-consistent": 0, mismatch: 0, "convention-review": 0, insufficient: 0, conflict: 0, ...over,
});

/** Everything the app derives — the same steps as AppShell — for one upload. */
function run(bankFiles: ImportFileInput[], ledgerRows: string[], decide?: (s: DuplicateState, groups: ReturnType<typeof detectDuplicates>) => DuplicateState) {
  const b = combineFiles("bank", bankFiles);
  const l = combineFiles("ledger", [file("ledger.csv", [AMT, ...ledgerRows])]);
  const sourceFiles: SourceFileInfo[] = [...b.files, ...l.files].map((f) => ({
    side: f.side, name: f.name, rows: f.rowCount, headerRow: f.headerRow,
    periodStart: f.coverage?.start ?? null, periodEnd: f.coverage?.end ?? null,
    statementStart: f.diagnostics.statementPeriod?.start ?? null,
    statementEnd: f.diagnostics.statementPeriod?.end ?? null,
    skippedRows: f.diagnostics.issueCount, invalidDateRows: f.diagnostics.invalidDateRows,
    statementOpening: f.diagnostics.statement.opening,
    statementClosing: f.diagnostics.statement.closing,
    statementAmbiguities: f.diagnostics.statement.ambiguities,
    ...(f.diagnostics.statement.owedIndication ? { statementOwedIndication: f.diagnostics.statement.owedIndication } : {}),
  }));
  const groups = [...detectDuplicates("bank", b.txns), ...detectDuplicates("ledger", l.txns)];
  let state = initialDuplicateState(groups, "2026-11-10T09:00:00.000Z");
  if (decide) state = decide(state, groups);
  const bank = activeTxns(b.txns, state);
  const ledger = activeTxns(l.txns, state);
  const r = reconcile(bank, ledger);
  const statements = verifyStatements(b.txns, sourceFiles);
  const months = buildMonthReview({
    imported: { bank: b.txns, ledger: l.txns }, bankTxns: bank, ledgerTxns: ledger,
    matches: r.matches, compositeMatches: r.compositeMatches, addedBankIds: new Set(), acknowledgedLedgerIds: new Set(),
    duplicateGroups: groups, duplicateState: state, sourceFiles, statementReview: statements,
  });
  const openItemCount = months.overview.unmatchedTransactions + months.overview.awaitingReviewMatches;
  const verdict = deriveVerdict({
    unexplainedDifference: r.balanceProof.unexplainedDifference,
    openItemCount,
    unresolvedDuplicateGroups: unresolvedGroupCount(groups, state),
    statements: statements.counts,
  });
  const ctx: ExportContext = {
    accountName: "Harbor Street Bakery", periodStart: "2026-01-01", periodEnd: "2026-01-31",
    openingBalance: null, closingBalance: null,
    reconciled: verdict.reconciled,
    unexplainedDifference: r.balanceProof.unexplainedDifference,
    bankTxns: bank, ledgerTxns: ledger, matches: r.matches, compositeMatches: r.compositeMatches,
    userAddedEntries: [], acknowledgedBankIds: [],
    duplicates: { allBankTxns: b.txns, allLedgerTxns: l.txns, groups, state },
    review: { months, statements },
  };
  const copilot = buildReconContext({
    matches: r.matches, compositeMatches: r.compositeMatches, bankTxns: bank, ledgerTxns: ledger,
    baseMissingFromBooks: r.missingFromBooks, baseMissingFromBank: r.missingFromBank,
    userAddedEntries: [], acknowledgedBankIds: [], balanceProof: r.balanceProof,
    reconciled: verdict.reconciled, periodLabel: "January 2026",
    duplicatesSetAside: state.setAside.length, verdict, duplicateGroupCount: groups.length,
  });
  const saved = deriveStatus(r.balanceProof.unexplainedDifference, r.matches, r.compositeMatches, openItemCount, verdict.unresolvedDuplicateGroups, verdict.statementFilesNeedingReview);
  return { verdict, ctx, copilot, saved, statements, months, engine: r, bank, allBank: b.txns };
}

const LEDGER = ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/20/2026,CLIENT PAYMENT,1200.00"];
const stated = (open: string, close: string, extra: string[] = []) =>
  file("bank.csv", ["Statement period: 01/01/2026 - 01/31/2026", AMT, `01/01/2026,Opening Balance,${open}`, "01/05/2026,COFFEE SUPPLY CO,-45.10", "01/20/2026,CLIENT PAYMENT,1200.00", ...extra, `01/31/2026,Closing Balance,${close}`], 2);

async function excelText(ctx: ExportContext) {
  const wb = await buildExcelWorkbook(ctx);
  return wb.SheetNames.map((n) =>
    Object.entries(wb.Sheets[n] as Record<string, { v: string }>)
      .filter(([k]) => !k.startsWith("!"))
      .map(([, c]) => String(c.v))
      .join("\n")
  ).join("\n");
}

describe("the rule itself", () => {
  it("a statement mismatch, conflict or unsettled sign convention blocks 'Fully reconciled'", () => {
    for (const issue of ["mismatch", "conflict", "convention-review"] as const) {
      const v = deriveVerdict({ unexplainedDifference: 0, openItemCount: 0, statements: counts({ [issue]: 1 }) });
      expect(v.status).toBe("transactions-match-statement-review");
      expect(v.reconciled).toBe(false);
      expect(v.financial).toBe("agrees"); // the transactions still match
      expect(v.statement).toBe("review-needed");
      expect(v.statementFilesNeedingReview).toBe(1);
    }
    expect(VERDICT_LABEL["transactions-match-statement-review"]).toBe("Transactions match — statement review needed");
  });

  it("missing statement evidence alone does not block — it is labelled 'Not verified'", () => {
    for (const c of [undefined, counts(), counts({ insufficient: 2 })]) {
      const v = deriveVerdict({ unexplainedDifference: 0, openItemCount: 0, statements: c });
      expect(v.status).toBe("reconciled");
      expect(v.statement).toBe("not-verified");
      expect(STATEMENT_SUMMARY_LABEL[v.statement]).toBe("Not verified");
    }
  });

  it("running-balance consistency alone neither blocks nor counts as verified", () => {
    const v = deriveVerdict({ unexplainedDifference: 0, openItemCount: 0, statements: counts({ "running-consistent": 1 }) });
    expect(v.status).toBe("reconciled");
    expect(v.statement).toBe("running-balance-only");
    expect(summarizeStatements(counts({ verified: 1, "running-consistent": 1 }))).toBe("partly-verified");
    expect(summarizeStatements(counts({ verified: 2 }))).toBe("verified");
  });

  it("actual transaction differences take precedence over every data-quality warning", () => {
    const v = deriveVerdict({ unexplainedDifference: -1200, openItemCount: 1, unresolvedDuplicateGroups: 2, statements: counts({ mismatch: 1, conflict: 1 }) });
    expect(v.status).toBe("not-reconciled");
    // …while the other two statuses are still reported, separately.
    expect(v).toMatchObject({ financial: "differs", dataQuality: "duplicate-review-needed", statement: "review-needed" });
  });

  it("unresolved duplicates still block; together with a statement problem both are named", () => {
    expect(deriveVerdict({ unexplainedDifference: 0, openItemCount: 0, unresolvedDuplicateGroups: 1 }).status).toBe("totals-agree-duplicate-review");
    const both = deriveVerdict({ unexplainedDifference: 0, openItemCount: 0, unresolvedDuplicateGroups: 1, statements: counts({ mismatch: 1 }) });
    expect(both.status).toBe("transactions-match-duplicate-and-statement-review");
    expect(VERDICT_LABEL[both.status]).toBe("Transactions match — duplicate and statement review needed");
  });

  it("the saved (History) status follows the same rule", () => {
    expect(deriveStatus(0, [], [], 0, 0, 1)).toBe("in_progress");
    expect(deriveStatus(0, [], [], 0, 0, 0)).toBe("reconciled");
    expect(deriveStatus(-500, [], [], 1, 0, 1)).toBe("not_reconciled");
  });
});

describe("transactions match, statement balances mismatch", () => {
  const x = run([stated("1000.00", "9999.00")], LEDGER);

  it("the transactions really do match, and no total or match was changed", () => {
    expect(x.engine.reconciled).toBe(true);
    expect(x.engine.balanceProof.unexplainedDifference).toBe(0);
    expect(x.engine.matches.every((m) => m.status === "accepted")).toBe(true);
    expect(x.statements.statements[0].status).toBe("mismatch");
  });

  it("verdict: 'Transactions match — statement review needed', not 'Fully reconciled'", () => {
    expect(VERDICT_LABEL[x.verdict.status]).toBe("Transactions match — statement review needed");
    expect(x.verdict).toMatchObject({ reconciled: false, financial: "agrees", dataQuality: "clear", statement: "review-needed", statementFilesNeedingReview: 1 });
    expect(x.saved).toBe("in_progress");
  });

  it("dashboard, PDF, Excel and copilot all say the same thing", async () => {
    const model = buildReportModel(x.ctx);
    // Reports derive their verdict with the same function as the screen.
    expect(reportVerdict(x.ctx, deriveBuckets(x.ctx))).toEqual(x.verdict);
    expect(model.verdict).toBe("Transactions match — statement review needed: 1 bank file's own balances need review.");
    const exec = Object.fromEntries(model.summary!.executive);
    expect(exec["Overall status"]).toBe("Transactions match — statement review needed");
    expect(exec["Financial reconciliation"]).toBe("Totals agree and nothing is left open");
    expect(exec["Statement verification"]).toBe("Statement review needed — 1 mismatch (of 1 bank file)");

    const pdf = (await buildPdfDocument(x.ctx)).output();
    expect(pdf).toContain("Transactions match");
    expect(pdf).toContain("statement review needed");
    expect(pdf).not.toContain("Your records match your bank for this period");

    const excel = await excelText(x.ctx);
    expect(excel).toContain("Transactions match — statement review needed: 1 bank file's own balances need review.");
    expect(excel).not.toContain("Your records match your bank for this period");

    expect(x.copilot.summary.reconciled).toBe(false);
    expect(x.copilot.summary.status).toEqual({
      overall: "transactions-match-statement-review",
      financial: "agrees",
      duplicateReview: "not-applicable",
      duplicateGroupsToReview: 0,
      statement: "review-needed",
      statementFilesNeedingReview: 1,
    });
  });
});

describe("transactions match, statement evidence conflicts", () => {
  // Two files stating the same period with different balances.
  const a = file("a.csv", ["Statement period: 01/01/2026 - 01/31/2026", "Transaction ID,Date,Description,Amount", ",01/01/2026,Opening Balance,1000.00", "TX1,01/05/2026,COFFEE SUPPLY CO,-45.10", "TX2,01/20/2026,CLIENT PAYMENT,1200.00", ",01/31/2026,Closing Balance,2154.90"], 2);
  const b = { ...a, name: "b.csv", content: a.content.replace("1000.00", "1100.00").replace("2154.90", "2254.90") };
  const x = run([a, b], LEDGER);

  it("the duplicate copies are set aside, the transactions match, and the conflict blocks the all-clear", () => {
    expect(x.engine.balanceProof.unexplainedDifference).toBe(0);
    expect(x.statements.statements.map((s) => s.status)).toEqual(["conflict", "conflict"]);
    expect(x.verdict.status).toBe("transactions-match-statement-review");
    expect(x.verdict.statementFilesNeedingReview).toBe(2);
    expect(buildReportModel(x.ctx).verdict).toBe("Transactions match — statement review needed: 2 bank files' own balances need review.");
    expect(x.copilot.summary.status?.statement).toBe("review-needed");
  });
});

describe("unresolved duplicates and statement mismatch together", () => {
  // The ledger genuinely has two identical parking entries, and so does the bank.
  const bank = stated("1000.00", "9999.00", ["01/22/2026,PARKING,-8.00", "01/22/2026,PARKING,-8.00"]);
  const ledger = [...LEDGER, "01/22/2026,PARKING,-8.00", "01/22/2026,PARKING,-8.00"];

  it("both reviews are named; resolving one leaves the other", () => {
    const x = run([bank], ledger);
    expect(x.verdict.status).toBe("transactions-match-duplicate-and-statement-review");
    expect(x.verdict).toMatchObject({ financial: "agrees", unresolvedDuplicateGroups: 2, statementFilesNeedingReview: 1 });
    expect(buildReportModel(x.ctx).verdict).toBe(
      "Transactions match — duplicate and statement review needed: 2 possible duplicate groups have not been reviewed, and 1 bank file's own balances need review."
    );
    expect(x.copilot.summary.status).toMatchObject({ overall: "transactions-match-duplicate-and-statement-review", duplicateReview: "needed", statement: "review-needed" });

    // Confirm the parking entries as separate → the statement problem remains.
    const y = run([bank], ledger, (s, groups) => groups.reduce((acc, g) => dismissGroup(acc, g.id, true, "t"), s));
    expect(y.verdict.status).toBe("transactions-match-statement-review");
  });
});

describe("missing statement balances, with no evidence of an error", () => {
  const x = run([file("bank.csv", [AMT, "01/05/2026,COFFEE SUPPLY CO,-45.10", "01/20/2026,CLIENT PAYMENT,1200.00"])], LEDGER);

  it("is fully reconciled — and says plainly that statement balances were not verified", async () => {
    expect(x.verdict.status).toBe("reconciled");
    expect(x.verdict.statement).toBe("not-verified");
    expect(x.saved).toBe("reconciled");
    const model = buildReportModel(x.ctx);
    expect(model.verdict).toBe("Your records match your bank for this period. Statement balances: Not verified.");
    expect(Object.fromEntries(model.summary!.executive)["Statement verification"]).toBe("Not verified — 1 file could not be verified (of 1 bank file)");
    expect(x.copilot.summary.status).toMatchObject({ overall: "reconciled", statement: "not-verified", statementFilesNeedingReview: 0 });
    expect(await excelText(x.ctx)).toContain("Statement balances: Not verified.");
  });
});

describe("amount-owed sign convention", () => {
  const rows = ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/20/2026,CLIENT PAYMENT,1200.00"];
  // Opening 2,000.00 owed; +45.10 charge, −1,200.00 payment → 845.10 owed.
  const card = (titles: string[]) =>
    file("card.csv", [...titles, AMT, "01/01/2026,Opening Balance,2000.00", ...rows, "01/31/2026,Closing Balance,845.10"], titles.length + 1);

  it("without sufficient evidence: not verified, sign convention needs review, and it blocks", () => {
    const x = run([card([])], LEDGER);
    expect(x.statements.statements[0].status).toBe("convention-review");
    expect(x.statements.statements[0].convention).toBe("unknown");
    expect(x.verdict.status).toBe("transactions-match-statement-review");
    expect(Object.fromEntries(buildReportModel(x.ctx).summary!.executive)["Statement verification"]).toBe(
      "Statement review needed — 1 file with an unclear sign convention (of 1 bank file)"
    );
  });

  it("with an explicit indication in the source: verified as amounts owed", () => {
    const x = run([card(["Acme Bank — Credit Card Account"])], LEDGER);
    const s = x.statements.statements[0];
    expect(s).toMatchObject({ status: "verified", convention: "owed" });
    expect(s.reasons[0]).toContain('The file says its balances are amounts owed ("Credit Card", line 1)');
    expect(x.verdict).toMatchObject({ status: "reconciled", statement: "verified" });
  });

  it("with running-balance evidence: the convention is established by the rows", () => {
    const x = run([file("card.csv", [BAL, "01/05/2026,COFFEE SUPPLY CO,-45.10,2045.10", "01/20/2026,CLIENT PAYMENT,1200.00,845.10"])], LEDGER);
    expect(x.statements.statements[0]).toMatchObject({ status: "running-consistent", convention: "owed" });
  });
});

describe("running balances", () => {
  it("consistent, without stated balances: 'Running balance consistency verified' — not statement verification", async () => {
    const x = run([file("bank.csv", [BAL, "01/05/2026,COFFEE SUPPLY CO,-45.10,954.90", "01/20/2026,CLIENT PAYMENT,1200.00,2154.90"])], LEDGER);
    const s = x.statements.statements[0];
    expect(s.status).toBe("running-consistent");
    expect(s.opening).toEqual({ cents: 100000, source: "calculated" });        // labelled as calculated
    expect(s.closing).toEqual({ cents: 215490, source: "running", line: 3 });  // source line kept
    expect(x.verdict).toMatchObject({ status: "reconciled", statement: "running-balance-only" });

    const model = buildReportModel(x.ctx);
    expect(model.verdict).toBe(
      "Your records match your bank for this period. Statement balances: running balance consistent; stated opening and closing balances not independently verified."
    );
    const row = model.summary!.statements[0];
    expect(row.status).toBe("Running balance consistency verified");
    expect(row.opening).toBe("$1,000.00 (calculated — not stated in the file)");
    expect(row.closing).toBe("$2,154.90 (last running balance in the file)");
    expect(model.summary!.evidence.some((e) => e.text.includes("running balance consistency only (not a verification of stated balances)"))).toBe(true);
    expect(x.copilot.summary.status?.statement).toBe("running-balance-only");
    // The month view does not call it verified either.
    expect(monthStatement(x.statements, "2026-01").status).toBe("running-consistent");
    expect(monthStatement(x.statements, "2026-01").label).toBe("Running balance consistent — stated balances not verified");
    expect((await buildPdfDocument(x.ctx)).output()).toContain("Running balance consistency verified");
  });

  it("consistent AND both balances stated: 'Statement balance verified'", () => {
    const x = run([file("bank.csv", [BAL, "01/01/2026,Opening Balance,,1000.00", "01/05/2026,COFFEE SUPPLY CO,-45.10,954.90", "01/20/2026,CLIENT PAYMENT,1200.00,2154.90", "01/31/2026,Closing Balance,,2154.90"])], LEDGER);
    expect(x.statements.statements[0]).toMatchObject({ status: "verified", basis: ["stated-balances", "running-balance"] });
    expect(x.statements.statements[0].opening).toEqual({ cents: 100000, source: "stated", line: 2 });
    expect(x.verdict.statement).toBe("verified");
  });

  it("inconsistent: a mismatch, and it blocks 'Fully reconciled' although the transactions match", () => {
    const x = run([file("bank.csv", [BAL, "01/05/2026,COFFEE SUPPLY CO,-45.10,954.90", "01/20/2026,CLIENT PAYMENT,1200.00,3000.00"])], LEDGER);
    expect(x.statements.statements[0].status).toBe("mismatch");
    expect(x.statements.statements[0].difference).toBe(-84510);
    expect(x.engine.reconciled).toBe(true);
    expect(x.verdict.status).toBe("transactions-match-statement-review");
  });
});

describe("a fully covered month with an additional unverified file", () => {
  const verified = stated("1000.00", "2154.90");
  it("additional file with no balance information → 'verified for part of the month', naming both", () => {
    const x = run([verified, file("extra.csv", [AMT, "01/25/2026,PARKING,-8.00", "01/26/2026,FUEL,-60.00"])], [...LEDGER, "01/25/2026,PARKING,-8.00", "01/26/2026,FUEL,-60.00"]);
    const m = monthStatement(x.statements, "2026-01");
    expect(m.status).toBe("partly-verified");
    expect(m.label).toBe("Statement balance verified for part of the month");
    expect(m.detail).toBe('Verified: "bank.csv". Not checked: "extra.csv" (not enough balance information). So some of this month\'s bank rows are not covered by a verified statement.');
    expect(x.verdict.statement).toBe("partly-verified");
    expect(x.verdict.status).toBe("reconciled"); // missing evidence does not block
  });
  it("additional file with a consistent running balance only → still qualified, and says why", () => {
    const x = run([verified, file("extra.csv", [BAL, "01/25/2026,PARKING,-8.00,492.00", "01/26/2026,FUEL,-60.00,432.00"])], [...LEDGER, "01/25/2026,PARKING,-8.00", "01/26/2026,FUEL,-60.00"]);
    const m = monthStatement(x.statements, "2026-01");
    expect(m.status).toBe("partly-verified");
    expect(m.detail).toContain('Running balance consistent only (stated balances not verified): "extra.csv".');
  });
  it("additional file with conflicting / mismatching evidence → never 'verified'", () => {
    const x = run([verified, file("extra.csv", [BAL, "01/25/2026,PARKING,-8.00,492.00", "01/26/2026,FUEL,-60.00,999.00"])], [...LEDGER, "01/25/2026,PARKING,-8.00", "01/26/2026,FUEL,-60.00"]);
    expect(monthStatement(x.statements, "2026-01").status).toBe("mismatch");
    expect(x.verdict.status).toBe("transactions-match-statement-review");
  });
  it("only when every relevant file is verified is the month 'verified'", () => {
    expect(monthStatement(run([verified], LEDGER).statements, "2026-01").status).toBe("verified");
  });
});

describe("copilot context", () => {
  const prompt = readFileSync(resolve(__dirname, "../../copilot/system-prompt.ts"), "utf8");

  it("carries the statement status as fixed labels + one count, and still validates against the strict schema", () => {
    const x = run([stated("1000.00", "9999.00")], LEDGER);
    const status = x.copilot.summary.status!;
    expect(() => reconContextSchema.parse(x.copilot)).not.toThrow();
    // No balances, file names or amounts from the statement check are sent.
    expect(JSON.stringify(status)).not.toMatch(/9999|1000|bank\.csv|\$/);
    expect(JSON.stringify(x.copilot)).not.toContain("Opening Balance");
  });

  it("each of the five situations maps to a distinct, schema-valid status", () => {
    const cases: [string, Verdict][] = [
      ["transaction mismatch", deriveVerdict({ unexplainedDifference: -100, openItemCount: 1, statements: counts({ verified: 1 }) })],
      ["duplicate review required", deriveVerdict({ unexplainedDifference: 0, openItemCount: 0, unresolvedDuplicateGroups: 1, statements: counts({ verified: 1 }) })],
      ["statement mismatch or conflict", deriveVerdict({ unexplainedDifference: 0, openItemCount: 0, statements: counts({ conflict: 1 }) })],
      ["statement evidence unavailable", deriveVerdict({ unexplainedDifference: 0, openItemCount: 0, statements: counts({ insufficient: 1 }) })],
      ["running balance consistency only", deriveVerdict({ unexplainedDifference: 0, openItemCount: 0, statements: counts({ "running-consistent": 1 }) })],
    ];
    const seen = new Set<string>();
    for (const [, verdict] of cases) {
      const ctx = buildReconContext({
        matches: [], compositeMatches: [], bankTxns: [], ledgerTxns: [], baseMissingFromBooks: [], baseMissingFromBank: [],
        userAddedEntries: [], acknowledgedBankIds: [],
        balanceProof: { bankNetChange: 0, ledgerNetChange: 0, clearedSum: 0, unexplainedDifference: verdict.financial === "agrees" ? 0 : -100 },
        reconciled: verdict.reconciled, periodLabel: "January 2026", verdict, duplicateGroupCount: verdict.unresolvedDuplicateGroups,
      });
      expect(reconContextSchema.safeParse(ctx).success).toBe(true);
      const s = ctx.summary.status!;
      seen.add(`${s.financial}|${s.duplicateReview}|${s.statement}`);
    }
    expect(seen.size).toBe(5);
  });

  it("the instructions distinguish all five and forbid 'complete because transactions match'", () => {
    for (const phrase of [
      "(a) a transaction mismatch",
      "(b) duplicate review required",
      "(c) a statement mismatch or conflict",
      "(d) statement evidence unavailable",
      "(e) running-balance consistency only",
      'overall "transactions-match-statement-review"',
      "Matching transactions is not the same as a completed review",
      "Never say or imply that the review is complete, verified, or finished simply because the transactions match",
    ]) {
      expect(prompt).toContain(phrase);
    }
  });
});

describe("legacy saved reconciliations", () => {
  const fx = (n: string) => readFileSync(resolve(__dirname, "../../../../tests/fixtures", n), "utf8");
  const strip = ({ sourceFile, sourceLine, runningBalance, ...t }: Txn): Txn => t;

  it("a record with no source files or balances: never blocked by statement checks, statement 'Not verified'", () => {
    const bank = parseCsv(fx("clean_bank.csv"), "bank").map(strip);
    const ledger = parseCsv(fx("clean_ledger.csv"), "ledger").map(strip);
    const r = reconcile(bank, ledger);
    const statements = verifyStatements(bank, undefined);
    expect(statements.statements).toEqual([]);
    const open = r.missingFromBooks.length + r.missingFromBank.length; // suggestions accepted below
    const verdict = deriveVerdict({ unexplainedDifference: r.balanceProof.unexplainedDifference, openItemCount: open, statements: statements.counts });
    expect(verdict.statementFilesNeedingReview).toBe(0);
    expect(verdict.statement).toBe("not-verified");
    expect(verdict.status).toBe(open === 0 && r.balanceProof.unexplainedDifference === 0 ? "reconciled" : "not-reconciled");
    // The saved status computed by an older call (no statement argument) is unchanged.
    expect(deriveStatus(0, [], [], 0)).toBe("reconciled");
    expect(deriveStatus(0, [], [], 0, 0)).toBe("reconciled");
    // And a month view builds without statement evidence.
    const months = buildMonthReview({
      imported: { bank, ledger }, bankTxns: bank, ledgerTxns: ledger, matches: r.matches, compositeMatches: r.compositeMatches,
      addedBankIds: new Set(), acknowledgedLedgerIds: new Set(), duplicateGroups: [], duplicateState: EMPTY_DUPLICATE_STATE,
      statementReview: statements,
    });
    expect(months.months.every((m) => m.statement.status === "insufficient")).toBe(true);
    expect(months.months[0].statement.label).toBe("Not verified — insufficient statement information");
  });
});
