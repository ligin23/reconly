/**
 * Advanced demo — the synthetic Cedar & Co. files, run through the REAL
 * pipeline (parser → combine → duplicate detection → engine → statement
 * checks → month review → report). Every expectation below is a property of
 * the fixture files; nothing in the app hard-codes these results.
 */
import { describe, it, expect } from "vitest";
import { readdirSync } from "fs";
import { inspectCsv } from "@/lib/parser";
import { activeTxns, groupStatus, restoreRows, setAsideRows, unresolvedGroupCount } from "@/lib/import/duplicates";
import { reconcile } from "@/lib/recon";
import { deriveVerdict } from "@/lib/recon/verdict";
import type { Txn } from "@/lib/recon/types";
import type { ExportContext } from "@/lib/export/buckets";
import { buildReportModel } from "@/lib/export/report-model";
import { buildExcelWorkbook } from "@/lib/export/excel-worksheet";
import { buildPdfDocument } from "@/lib/export/pdf-report";
import {
  ADVANCED_DEMO_ACCOUNT_LABEL,
  ADVANCED_DEMO_FILES,
  ADVANCED_DEMO_NOTICE,
  ADVANCED_DEMO_TOUR,
} from "../advanced-demo";
import { DEMO_DIR, demoContent, runDemoPipeline } from "./pipeline";

const r = runDemoPipeline();
const all: Txn[] = [...r.imported.bank, ...r.imported.ledger];
const byId = new Map(all.map((t) => [t.id, t]));
const txn = (id: string) => byId.get(id)!;
const find = (side: "bank" | "ledger", file: string, desc: string, date?: string) =>
  r.imported[side].filter(
    (t) => t.sourceFile === file && t.description === desc && (date === undefined || t.date === date)
  );
const one = (side: "bank" | "ledger", file: string, desc: string, date?: string) => {
  const list = find(side, file, desc, date);
  expect(list, `${file}: ${desc} ${date ?? ""}`).toHaveLength(1);
  return list[0];
};

describe("advanced demo — files and import", () => {
  it("ships exactly the seven synthetic files the manifest lists", () => {
    const onDisk = readdirSync(DEMO_DIR).filter((f) => f.endsWith(".csv")).sort();
    expect(onDisk).toEqual(ADVANCED_DEMO_FILES.map((f) => f.name).sort());
    expect(ADVANCED_DEMO_FILES.filter((f) => f.side === "bank").map((f) => f.name)).toEqual([
      "bank-jan-2026.csv",
      "bank-feb-2026.csv",
      "bank-mar-2026.csv",
      "bank-feb-mar-overlap.csv",
    ]);
    expect(ADVANCED_DEMO_FILES.filter((f) => f.side === "ledger").map((f) => f.name)).toEqual([
      "ledger-jan-2026.csv",
      "ledger-feb-2026.csv",
      "ledger-mar-2026.csv",
    ]);
  });

  it("uses exactly the column mapping Reconly's own detection picks, at a real header row", () => {
    for (const f of ADVANCED_DEMO_FILES) {
      const insp = inspectCsv(demoContent(f.name), 3, { headerRow: f.headerRow });
      expect(insp.detected, f.name).toEqual(f.map);
      expect(insp.headerWarning, f.name).toBeNull();
      expect(insp.suggestedHeaderRow, f.name).toBeNull();
    }
  });

  it("reads every row of every file with no skipped rows or warnings", () => {
    const rows = Object.fromEntries(
      [...r.bank.files, ...r.ledger.files].map((f) => [f.name, f.rowCount])
    );
    expect(rows).toEqual({
      "bank-jan-2026.csv": 15,
      "bank-feb-2026.csv": 14,
      "bank-feb-mar-overlap.csv": 9,
      "bank-mar-2026.csv": 16,
      "ledger-jan-2026.csv": 16,
      "ledger-feb-2026.csv": 14,
      "ledger-mar-2026.csv": 14,
    });
    for (const f of [...r.bank.files, ...r.ledger.files]) {
      expect(f.diagnostics.issueCount, f.name).toBe(0);
      expect(f.diagnostics.csvErrors, f.name).toEqual([]);
      expect(f.diagnostics.warnings, f.name).toEqual([]);
      expect(f.diagnostics.dateOrder, f.name).toBe("month-first");
    }
    expect(r.imported.bank).toHaveLength(54);
    expect(r.imported.ledger).toHaveLength(44);
  });

  it("keeps each row's original file name and line number", () => {
    const names = new Set(ADVANCED_DEMO_FILES.map((f) => f.name));
    for (const t of all) {
      expect(names.has(t.sourceFile!)).toBe(true);
      const line = demoContent(t.sourceFile!).split("\n")[t.sourceLine! - 1];
      // The physical line the row claims to come from holds that row.
      expect(line, `${t.sourceFile}:${t.sourceLine}`).toContain(t.description.includes(",") ? t.description.split(",")[0] : t.description);
      expect(line).toContain((Math.abs(t.amount) / 100).toFixed(2));
    }
    // A few fixed points (title lines and balance rows are counted).
    expect(one("bank", "bank-jan-2026.csv", "CLIENT DEPOSIT - LUMEN BAKERY", "2026-01-02").sourceLine).toBe(6);
    expect(one("bank", "bank-feb-2026.csv", "CHECK 1187 NORTHWIND PRINT").sourceLine).toBe(5);
    expect(one("bank", "bank-mar-2026.csv", "INTEREST PAID").sourceLine).toBe(17);
    expect(one("bank", "bank-feb-mar-overlap.csv", "ADOBE CREATIVE CLOUD").sourceLine).toBe(10);
    expect(one("ledger", "ledger-jan-2026.csv", "Check 1187 - Northwind Print Co.").sourceLine).toBe(17);
  });
});

describe("advanced demo — duplicate detection (existing rules)", () => {
  const bankGroups = r.groups.filter((g) => g.side === "bank");

  it("finds 8 repeated-row groups on the bank side and none in the books", () => {
    expect(bankGroups).toHaveLength(8);
    expect(r.groups.filter((g) => g.side === "ledger")).toHaveLength(0);
    expect(bankGroups.every((g) => g.kind === "cross-file")).toBe(true);
  });

  it("sets aside 7 overlap copies automatically, each proven by an identical transaction ID", () => {
    const strong = bankGroups.filter((g) => g.autoSetAsideIds.length > 0);
    expect(strong).toHaveLength(7);
    for (const g of strong) {
      expect(g.evidence.map((e) => e.code)).toEqual(["transaction-id"]);
      expect(g.txnIds).toHaveLength(2);
      const [a, b] = g.txnIds.map(txn);
      expect(a.raw["transaction id"]).toBe(b.raw["transaction id"]);
    }
    expect(r.dupState.setAside.map((s) => s.by)).toEqual(Array(7).fill("auto"));
    // Keep-the-earliest-file rule: Feb copies win over the overlap export,
    // and the overlap export (which starts Feb 24) wins over March.
    const setAsideFrom = r.dupState.setAside.map((s) => txn(s.txnId).sourceFile).sort();
    expect(setAsideFrom).toEqual([
      ...Array(4).fill("bank-feb-mar-overlap.csv"),
      ...Array(3).fill("bank-mar-2026.csv"),
    ]);
  });

  it("leaves the pending Adobe charge (no transaction ID in the overlap export) for the user", () => {
    const amb = bankGroups.filter((g) => g.autoSetAsideIds.length === 0);
    expect(amb).toHaveLength(1);
    const g = amb[0];
    expect(g.evidence.map((e) => e.code)).toEqual(["values-only"]);
    expect(g.txnIds.map((id) => txn(id).description)).toEqual(["ADOBE CREATIVE CLOUD", "ADOBE CREATIVE CLOUD"]);
    expect(g.txnIds.map((id) => txn(id).sourceFile)).toEqual(["bank-feb-mar-overlap.csv", "bank-mar-2026.csv"]);
    expect(groupStatus(g, r.dupState)).toBe("needs-review");
    // Both rows stay in use until the user decides.
    for (const id of g.txnIds) expect(r.bankTxns.some((t) => t.id === id)).toBe(true);
    expect(unresolvedGroupCount(r.groups, r.dupState)).toBe(1);
  });

  it("does not flag two genuine $6.75 coffees on the same day (different transaction IDs)", () => {
    const coffees = find("bank", "bank-mar-2026.csv", "BLUE BOTTLE COFFEE");
    expect(coffees).toHaveLength(2);
    expect(coffees[0].raw["transaction id"]).not.toBe(coffees[1].raw["transaction id"]);
    for (const c of coffees) {
      expect(r.groups.some((g) => g.txnIds.includes(c.id))).toBe(false);
      expect(r.bankTxns.some((t) => t.id === c.id)).toBe(true);
      const m = r.result.matches.find((x) => x.bankTxnId === c.id)!;
      expect(m.type).toBe("exact");
      expect(m.status).toBe("accepted");
    }
  });

  it("setting aside / restoring re-runs the unchanged engine with the same rules", () => {
    const g = r.groups.find((x) => x.autoSetAsideIds.length === 0)!;
    const next = setAsideRows(r.dupState, g.suggestedSetAsideIds, "user", "2026-04-01T00:00:00.000Z");
    expect(groupStatus(g, next)).toBe("resolved");
    const res = reconcile(activeTxns(r.imported.bank, next), activeTxns(r.imported.ledger, next));
    expect(res.missingFromBooks.some((t) => t.description === "ADOBE CREATIVE CLOUD")).toBe(false);
    expect(res.balanceProof.unexplainedDifference).toBe(r.result.balanceProof.unexplainedDifference + 5999);

    const restored = restoreRows(r.dupState, [r.dupState.setAside[0].txnId], "2026-04-01T00:00:00.000Z");
    expect(restored.setAside).toHaveLength(6);
    expect(activeTxns(r.imported.bank, restored)).toHaveLength(48);
  });
});

describe("advanced demo — matching (existing engine)", () => {
  const suggested = r.result.matches.filter((m) => m.status === "suggested");

  it("auto-matches 32 pairs and proposes 5 one-to-one suggestions and 1 grouped match", () => {
    expect(r.result.matches.filter((m) => m.status === "accepted")).toHaveLength(32);
    expect(r.result.matches.filter((m) => m.status === "accepted").every((m) => m.type === "exact")).toBe(true);
    expect(suggested).toHaveLength(5);
    expect(r.result.compositeMatches).toHaveLength(1);
  });

  it("suggests the differently-worded Google Workspace and Blue Bottle pairs", () => {
    const pair = (bankDesc: string, ledgerDesc: string) =>
      suggested.find((m) => txn(m.bankTxnId).description === bankDesc && txn(m.ledgerTxnId).description === ledgerDesc);
    const google = pair("GOOGLE WORKSPACE GSUITE", "Google Workspace subscription")!;
    expect(google).toBeDefined();
    expect(txn(google.bankTxnId).date).toBe("2026-01-05");
    expect(pair("SQ *BLUE BOTTLE COFFEE", "Blue Bottle - client coffee")).toBeDefined();
    expect(pair("CLIENT DEPOSIT - MAPLEWOOD ARCHITECTS", "Invoice 1038 - Maplewood Architects")).toBeDefined();
  });

  it("pairs transactions across months (one full-range run, grouped by month afterwards)", () => {
    const cross = suggested.filter((m) => txn(m.bankTxnId).date.slice(0, 7) !== txn(m.ledgerTxnId).date.slice(0, 7));
    const desc = cross.map((m) => [txn(m.ledgerTxnId).date, txn(m.bankTxnId).date, txn(m.bankTxnId).amount]);
    expect(desc).toEqual(
      expect.arrayContaining([
        ["2026-01-30", "2026-02-02", -124000],
        ["2026-02-27", "2026-03-02", 260000],
      ])
    );
    expect(cross).toHaveLength(2);
    // Counted once, in the bank row's month; shown as cross-month in both.
    const m = Object.fromEntries(r.months.months.map((x) => [x.month, x]));
    expect(m["2026-01"].crossMonthMatches).toBe(1);
    expect(m["2026-02"].crossMonthMatches).toBe(2);
    expect(m["2026-03"].crossMonthMatches).toBe(1);
    expect(r.months.overview.crossMonthMatches).toBe(2);
  });

  it("groups three Stripe invoices into the $4,750 payout", () => {
    const c = r.result.compositeMatches[0];
    expect(c.ambiguous).toBe(false);
    expect(c.status).toBe("suggested");
    expect(txn(c.bankTxnId).description).toBe("STRIPE PAYOUT");
    expect(txn(c.bankTxnId).amount).toBe(475000);
    expect(c.ledgerTxnIds.map((id) => txn(id).reference)).toEqual(["INV-1041", "INV-1042", "INV-1043"]);
    expect(c.ledgerTxnIds.map((id) => txn(id).amount)).toEqual([150000, 200000, 125000]);
  });

  it("leaves the intended items unmatched on each side", () => {
    const books = r.result.missingFromBooks.map((t) => `${t.date} ${t.description} ${t.amount}`);
    expect(books).toEqual([
      "2026-01-30 MONTHLY SERVICE FEE -1500",
      "2026-01-31 INTEREST PAID 184",
      "2026-02-18 AMZN MKTP US*2K4LP9 -11243",
      "2026-02-27 MONTHLY SERVICE FEE -1500",
      "2026-03-05 ADOBE CREATIVE CLOUD -5999",
      "2026-03-17 COMCAST BUSINESS -12999",
      "2026-03-27 ATM FEE - OUT OF NETWORK -350",
      "2026-03-30 MONTHLY SERVICE FEE -1500",
      "2026-03-31 INTEREST PAID 211",
    ]);
    const bank = r.result.missingFromBank.map((t) => `${t.date} ${t.description} ${t.amount}`);
    expect(bank).toEqual([
      "2026-02-15 Amazon - studio supplies -11243",
      "2026-03-17 COMCAST BUSINESS -13999",
      "2026-03-29 Check 1203 - Alder Studio Supply -38500",
      "2026-03-31 Invoice 1061 - Maplewood Architects (deposit in transit) 160000",
    ]);
  });

  it("financial totals match the fixture expectations", () => {
    expect(r.result.balanceProof).toMatchObject({
      bankNetChange: -297756,
      ledgerNetChange: -166802,
      unexplainedDifference: -130954,
    });
    const net = (list: Txn[]) => list.reduce((s, t) => s + t.amount, 0);
    // The unexplained difference is exactly the unmatched items.
    expect(net(r.result.missingFromBooks) - net(r.result.missingFromBank)).toBe(-130954);
    const m = Object.fromEntries(r.months.months.map((x) => [x.month, x]));
    expect([m["2026-01"].bank.net, m["2026-02"].bank.net, m["2026-03"].bank.net]).toEqual([278589, -437559, -138786]);
    expect([m["2026-01"].ledger.net, m["2026-02"].ledger.net, m["2026-03"].ledger.net]).toEqual([155905, -52059, -270648]);
    const verdict = deriveVerdict({
      unexplainedDifference: r.result.balanceProof.unexplainedDifference,
      openItemCount: r.result.missingFromBooks.length + r.result.missingFromBank.length + 6,
      unresolvedDuplicateGroups: unresolvedGroupCount(r.groups, r.dupState),
      statements: r.statements.counts,
    });
    expect(verdict.reconciled).toBe(false);
    expect(verdict.statement).toBe("review-needed");
  });
});

describe("advanced demo — multi-month review and statements", () => {
  it("shows January, February and March, each needing attention for a different reason", () => {
    expect(r.months.months.map((m) => m.label)).toEqual(["January 2026", "February 2026", "March 2026"]);
    expect(r.months.months.map((m) => m.status)).toEqual(["review-needed", "review-needed", "review-needed"]);
    expect(r.months.months[2].flags).toContain("duplicates-to-review");
    expect(r.months.months.map((m) => [m.bank.imported, m.bank.setAside, m.bank.inUse])).toEqual([
      [15, 0, 15],
      [19, 4, 15],
      [20, 3, 17],
    ]);
    expect(r.months.months.map((m) => m.awaitingReviewMatches)).toEqual([3, 2, 1]);
    expect(r.months.overview.awaitingReviewMatches).toBe(6);
  });

  it("verifies January, flags February's mismatch, and can only consistency-check March", () => {
    const s = Object.fromEntries(r.statements.statements.map((x) => [x.file, x]));
    expect(s["bank-jan-2026.csv"].status).toBe("verified");
    expect(s["bank-jan-2026.csv"].opening).toMatchObject({ cents: 1842000, source: "stated" });
    expect(s["bank-jan-2026.csv"].closing).toMatchObject({ cents: 2120589, source: "stated" });

    expect(s["bank-feb-2026.csv"].status).toBe("mismatch");
    expect(s["bank-feb-2026.csv"].opening).toMatchObject({ cents: 2120589, source: "stated" }); // = Jan closing
    expect(s["bank-feb-2026.csv"].closing).toMatchObject({ cents: 1683030, source: "stated" });
    expect(s["bank-feb-2026.csv"].difference).toBe(-135000);
    // The gap is exactly the deposit the Feb export left out — it is in the overlap export.
    const lumen = one("bank", "bank-feb-mar-overlap.csv", "CLIENT DEPOSIT - LUMEN BAKERY");
    expect(lumen.amount).toBe(135000);
    expect(find("bank", "bank-feb-2026.csv", "CLIENT DEPOSIT - LUMEN BAKERY")).toHaveLength(0);

    expect(s["bank-mar-2026.csv"].status).toBe("running-consistent");
    expect(s["bank-mar-2026.csv"].opening).toMatchObject({ cents: 1683030, source: "calculated" }); // = Feb closing
    expect(s["bank-mar-2026.csv"].closing).toMatchObject({ cents: 1550243, source: "running" });

    expect(s["bank-feb-mar-overlap.csv"].status).toBe("insufficient");
    expect(r.statements.counts.conflict).toBe(0);

    expect(r.months.months.map((m) => m.statement.status)).toEqual(["verified", "mismatch", "running-consistent"]);
  });
});

describe("advanced demo — reports and labelling", () => {
  const ctx: ExportContext = {
    accountName: ADVANCED_DEMO_ACCOUNT_LABEL,
    periodStart: "2026-01-02",
    periodEnd: "2026-03-31",
    openingBalance: null,
    closingBalance: null,
    reconciled: false,
    unexplainedDifference: r.result.balanceProof.unexplainedDifference,
    bankTxns: r.bankTxns,
    ledgerTxns: r.ledgerTxns,
    matches: r.result.matches,
    compositeMatches: r.result.compositeMatches,
    userAddedEntries: [],
    acknowledgedBankIds: [],
    review: { months: r.months, statements: r.statements },
    duplicates: { allBankTxns: r.imported.bank, allLedgerTxns: r.imported.ledger, groups: r.groups, state: r.dupState },
  };

  it("the report model carries the demo's actual findings", () => {
    const model = JSON.stringify(buildReportModel(ctx));
    for (const text of [
      "Cedar & Co. Creative Studio",
      "bank-feb-2026.csv",
      "Statement balance mismatch",
      "STRIPE PAYOUT",
      "ATM FEE - OUT OF NETWORK",
      "Check 1203 - Alder Studio Supply",
    ]) {
      expect(model, text).toContain(text);
    }
  });

  it("the Excel workbook and PDF are built from those findings and labelled as sample data", async () => {
    const XLSX = (await import("xlsx-js-style")).default;
    const wb = await buildExcelWorkbook(ctx);
    const text = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n");
    for (const t of ["Sample data", "Cedar & Co. Creative Studio", "Statement balance mismatch", "ADOBE CREATIVE CLOUD", "bank-mar-2026.csv"]) {
      expect(text, t).toContain(t);
    }
    const pdf = (await buildPdfDocument(ctx)).output();
    for (const t of ["Sample data", "Month-by-month findings", "Statement balance mismatch", "January", "February", "STRIPE", "4,750.00", "ATM FEE", "Check 1203"]) {
      expect(pdf, t).toContain(t);
    }
  });

  it("the demo is clearly identified and the tour covers six real sections", () => {
    expect(ADVANCED_DEMO_NOTICE).toBe("Demo workspace — all financial data is fictional.");
    expect(ADVANCED_DEMO_ACCOUNT_LABEL).toMatch(/^Sample data/);
    expect(ADVANCED_DEMO_TOUR.map((s) => s.title)).toEqual([
      "Multi-month Financial Review",
      "Duplicate Detection",
      "Statement Verification",
      "Transaction Review",
      "Source Tracking",
      "Financial Reports",
    ]);
  });
});
