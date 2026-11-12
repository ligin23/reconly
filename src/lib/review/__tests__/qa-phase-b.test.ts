/**
 * QA remediation — Phase B (workflow and usability), logic level.
 * RECON-007 upload structure check
 * RECON-008 review decisions can be found and taken back
 * (RECON-006, the tour link, is exercised in tests/qa-remediation.spec.ts.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { checkFileStructure } from "@/lib/import/validate-file";
import { combineFiles } from "@/lib/import/combine";
import { detectColumnMap, inspectCsv } from "@/lib/parser";
import { reconcile } from "@/lib/recon";
import {
  applyCompositeDecision,
  applyMatchDecision,
  reviewProgress,
  undoCompositeDecision,
  undoMatchDecision,
} from "@/lib/recon/decisions";
import { buildDashboardData } from "@/lib/recon/adapter";
import type { Txn } from "@/lib/recon/types";
import { deriveBuckets } from "@/lib/export/buckets";
import { runDemoPipeline } from "@/lib/demo/__tests__/pipeline";

// ───────────────────────── RECON-007 ─────────────────────────
describe("RECON-007 — files that cannot hold transactions are refused with a reason", () => {
  it("empty file", () => {
    expect(checkFileStructure("")?.kind).toBe("empty");
    expect(checkFileStructure("   \n\n \r\n")?.kind).toBe("empty");
    expect(checkFileStructure("﻿")?.kind).toBe("empty");
    expect(checkFileStructure("")!.message).toMatch(/^it is empty/);
  });

  it("header-only CSV", () => {
    const p = checkFileStructure("Date,Description,Amount\n")!;
    expect(p.kind).toBe("no-rows");
    expect(p.message).toBe("it has column titles but no transaction rows beneath them.");
    // …also with title lines above the header.
    expect(checkFileStructure("My Bank\nStatement for January\nDate,Description,Amount\n")?.kind).toBe("no-rows");
  });

  it("arbitrary text", () => {
    const p = checkFileStructure("This is not a CSV.")!;
    expect(p.kind).toBe("no-columns");
    expect(p.message).toMatch(/doesn't contain a table of transactions/);
    expect(checkFileStructure("Dear customer\nPlease find your statement attached\nRegards")?.kind).toBe("no-columns");
    // Prose that merely contains commas is not a table of transactions either.
    expect(checkFileStructure("Hello, world\nfoo, bar\nbaz, qux")?.kind).toBe("no-columns");
  });

  it("a delimiter Reconly cannot read", () => {
    const p = checkFileStructure("Date~Description~Amount\n01/05/2026~COFFEE~-4.50\n01/06/2026~RENT~-900.00\n")!;
    expect(p.kind).toBe("no-columns");
    expect(p.message).toMatch(/separated by commas, semicolons, tabs or \|/);
  });

  it("delimiters the parser does read are accepted", () => {
    for (const d of [",", ";", "\t", "|"]) {
      const csv = ["Date", "Description", "Amount"].join(d) + "\n" + ["01/05/2026", "COFFEE", "-4.50"].join(d) + "\n";
      expect(checkFileStructure(csv), JSON.stringify(d)).toBeNull();
    }
  });

  it("malformed dates are NOT a structure problem — they reach mapping and are reported row by row", () => {
    const csv = "Date,Description,Amount\nnot-a-date,COFFEE,-4.50\n32/13/2026,RENT,-900.00\n";
    expect(checkFileStructure(csv)).toBeNull();
    const imp = combineFiles("bank", [{ name: "bad-dates.csv", content: csv, map: detectColumnMap(["date", "description", "amount"]) }]);
    expect(imp.files[0].rowCount).toBe(0);
    expect(imp.files[0].diagnostics.issueCount).toBe(2);
    expect(imp.files[0].diagnostics.issues[0].reason).toMatch(/unrecognized date "not-a-date"/);
  });

  it("a valid statement with title lines above the header is accepted, and still maps", () => {
    const csv = [
      "Harbor Point Bank - Business Checking",
      "Statement period: 01/01/2026 - 01/31/2026",
      '"Opening balance: $1,000.00"',
      "Date,Description,Amount",
      "01/05/2026,COFFEE,-4.50",
    ].join("\n");
    expect(checkFileStructure(csv)).toBeNull();
    expect(inspectCsv(csv).suggestedHeaderRow).toBe(4);
  });

  it("a file whose first row is data, not a header, is not rejected here", () => {
    expect(checkFileStructure("01/05/2026,COFFEE,-4.50\n01/06/2026,RENT,-900.00\n")).toBeNull();
  });

  it("every CSV this repo ships or tests with is accepted (no valid file is turned away)", () => {
    const root = resolve(__dirname, "../../../..");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith(".csv") ? [p] : [];
      });
    const files = [...walk(join(root, "tests/fixtures")), ...walk(join(root, "public/samples")), ...walk(join(root, "test-data"))];
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(checkFileStructure(readFileSync(f, "utf8")), f).toBeNull();
  });
});

// ───────────────────────── RECON-008 ─────────────────────────
describe("RECON-008 — review decisions can be found and reversed", () => {
  const demo = runDemoPipeline();
  const byId = new Map<string, Txn>([...demo.bankTxns, ...demo.ledgerTxns].map((t) => [t.id, t]));
  const suggestion = (bankDesc: string) =>
    demo.result.matches.find((m) => m.status === "suggested" && byId.get(m.bankTxnId)!.description === bankDesc)!;
  const blueBottle = suggestion("SQ *BLUE BOTTLE COFFEE");
  const google = suggestion("GOOGLE WORKSPACE GSUITE");
  const northwind = suggestion("CHECK 1187 NORTHWIND PRINT"); // cross-month: Jan 30 ↔ Feb 2
  const stripe = demo.result.compositeMatches[0];

  const dash = (matches = demo.result.matches, composites = demo.result.compositeMatches) =>
    buildDashboardData(matches, composites, demo.bankTxns, demo.ledgerTxns, demo.result.missingFromBooks, demo.result.missingFromBank);
  const net = (matches: typeof demo.result.matches, composites: typeof demo.result.compositeMatches) => {
    const b = deriveBuckets({
      accountName: "x", periodStart: "", periodEnd: "", openingBalance: null, closingBalance: null, reconciled: false,
      unexplainedDifference: demo.result.balanceProof.unexplainedDifference,
      bankTxns: demo.bankTxns, ledgerTxns: demo.ledgerTxns, matches, compositeMatches: composites,
      userAddedEntries: [], acknowledgedBankIds: [],
    });
    return {
      matched: b.acceptedPairs.length + b.acceptedComposites.length,
      review: b.reviewPairs.length + b.reviewComposites.length,
      bankOnly: b.missingFromBooks.length,
      ledgerOnly: b.missingFromBank.length,
    };
  };

  it("before any decision nothing is listed as decided", () => {
    expect(dash().decided).toEqual([]);
    expect(net(demo.result.matches, demo.result.compositeMatches)).toEqual({ matched: 32, review: 6, bankOnly: 9, ledgerOnly: 4 });
  });

  it("accepted and rejected decisions are listed — ordinary, cross-month and grouped — and exact matches never are", () => {
    let m = applyMatchDecision(demo.result.matches, blueBottle.id, "accept");
    m = applyMatchDecision(m, google.id, "reject");
    m = applyMatchDecision(m, northwind.id, "accept");
    const c = applyCompositeDecision(demo.result.compositeMatches, stripe.id, "accept");
    const decided = dash(m, c).decided;
    expect(decided.map((d) => [d.bankDesc, d.kind, d.decision, d.crossMonth])).toEqual([
      ["SQ *BLUE BOTTLE COFFEE", "pair", "accepted", false],
      ["GOOGLE WORKSPACE GSUITE", "pair", "rejected", false],
      ["CHECK 1187 NORTHWIND PRINT", "pair", "accepted", true],
      ["STRIPE PAYOUT", "group", "accepted", false],
    ]);
    expect(decided[3].booksDesc).toMatch(/^3 entries: Invoice 1041/);
    expect(decided[2]).toMatchObject({ bankDate: "Feb 2", booksDate: "Jan 30", bankSource: "bank-feb-2026.csv · row 5" });
    expect(net(m, c)).toEqual({ matched: 35, review: 2, bankOnly: 10, ledgerOnly: 5 });
  });

  it("undoing an accepted pair, a rejected pair and a cross-month pair returns each to the review queue and restores every count", () => {
    let m = applyMatchDecision(demo.result.matches, blueBottle.id, "accept");
    m = applyMatchDecision(m, google.id, "reject");
    m = applyMatchDecision(m, northwind.id, "accept");
    const c = demo.result.compositeMatches;

    m = undoMatchDecision(m, google.id); // the rejected one
    expect(m.find((x) => x.id === google.id)!.status).toBe("suggested");
    expect(net(m, c)).toEqual({ matched: 34, review: 4, bankOnly: 9, ledgerOnly: 4 });

    m = undoMatchDecision(m, blueBottle.id); // an accepted one
    m = undoMatchDecision(m, northwind.id); // the cross-month one
    expect(m).toEqual(demo.result.matches); // exactly the original state
    expect(dash(m, c).decided).toEqual([]);
    expect(dash(m, c).reviewItems).toHaveLength(6);
    expect(net(m, c)).toEqual({ matched: 32, review: 6, bankOnly: 9, ledgerOnly: 4 });
    expect(reviewProgress(m, c)).toEqual({ total: 6, decided: 0, pending: 6 });
  });

  it("undo never touches an exact match or an undecided suggestion", () => {
    const exact = demo.result.matches.find((x) => x.type === "exact")!;
    expect(undoMatchDecision(demo.result.matches, exact.id)).toEqual(demo.result.matches);
    expect(undoMatchDecision(demo.result.matches, google.id)).toEqual(demo.result.matches);
    expect(undoMatchDecision(demo.result.matches, "no-such-id")).toEqual(demo.result.matches);
  });

  it("undoing a grouped match (accepted or rejected) restores the engine's original suggestion", () => {
    const fresh = reconcile(demo.bankTxns, demo.ledgerTxns).compositeMatches;
    for (const decision of ["accept", "reject"] as const) {
      const decided = applyCompositeDecision(demo.result.compositeMatches, stripe.id, decision);
      expect(decided[0].status).not.toBe("suggested");
      const undone = undoCompositeDecision(decided, stripe.id, fresh);
      expect(undone).toEqual(demo.result.compositeMatches);
      expect(net(demo.result.matches, undone)).toEqual({ matched: 32, review: 6, bankOnly: 9, ledgerOnly: 4 });
    }
    // Rejecting it puts the payout and its three invoices in the unmatched lists; undo takes them back out.
    const rejected = applyCompositeDecision(demo.result.compositeMatches, stripe.id, "reject");
    expect(net(demo.result.matches, rejected)).toEqual({ matched: 32, review: 5, bankOnly: 10, ledgerOnly: 7 });
  });

  it("undoing an ambiguous group gives the user every option back, not just the one they picked", () => {
    const t = (id: string, source: "bank" | "ledger", date: string, description: string, amount: number): Txn => ({
      id, source, date, description, amount, raw: {},
    });
    const bank = [t("b0", "bank", "2026-01-10", "STRIPE PAYOUT", 10000)];
    const ledger = [
      t("l0", "ledger", "2026-01-08", "Invoice A", 6000),
      t("l1", "ledger", "2026-01-08", "Invoice B", 4000),
      t("l2", "ledger", "2026-01-09", "Invoice C", 6000),
      t("l3", "ledger", "2026-01-09", "Invoice D", 4000),
    ];
    const first = reconcile(bank, ledger).compositeMatches;
    expect(first[0].ambiguous).toBe(true);
    const options = first[0].allCombinations!;
    expect(options.length).toBeGreaterThan(1);

    const accepted = applyCompositeDecision(first, first[0].id, "accept", options[0]);
    expect(accepted[0]).toMatchObject({ status: "accepted", ambiguous: false, allCombinations: null });

    const undone = undoCompositeDecision(accepted, first[0].id, reconcile(bank, ledger).compositeMatches);
    expect(undone).toEqual(first);
    // …and a different option can now be chosen.
    const again = applyCompositeDecision(undone, first[0].id, "accept", options[1]);
    expect(again[0].ledgerTxnIds).toEqual(options[1]);
  });
});
