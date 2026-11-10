/**
 * Phase 2, step 1 & 3 — what the PDF and Excel reports actually say.
 *
 *  - Grouped (composite) matches were claimed by the old export logic but
 *    never listed: accepted ones were missing from "Matched", pending ones
 *    from the review section. These tests pin the fix.
 *  - Provenance (file · row) and the duplicate sections appear in both
 *    formats, and reports for older saved data are unchanged in shape.
 *
 * The engine is used as-is to produce the composite suggestions.
 */
import { describe, it, expect } from "vitest";
import { reconcile } from "@/lib/recon/engine";
import { applyCompositeDecision } from "@/lib/recon/decisions";
import { combineFiles, type ImportFileInput } from "@/lib/import/combine";
import {
  activeTxns,
  detectDuplicates,
  initialDuplicateState,
} from "@/lib/import/duplicates";
import { openItemCount, type ExportContext } from "@/lib/export/buckets";
import { buildReportModel, type PairLine } from "@/lib/export/report-model";
import { buildExcelWorkbook } from "@/lib/export/excel-worksheet";
import { buildPdfDocument } from "@/lib/export/pdf-report";
import type { AnyCompositeMatch, Txn } from "@/lib/recon/types";

const txn = (id: string, source: "bank" | "ledger", date: string, description: string, amount: number, extra: Partial<Txn> = {}): Txn => ({
  id, source, date, description, amount, raw: {}, ...extra,
});

const baseCtx = (over: Partial<ExportContext>): ExportContext => ({
  accountName: "Business Checking",
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  openingBalance: null,
  closingBalance: null,
  reconciled: false,
  unexplainedDifference: 0,
  bankTxns: [],
  ledgerTxns: [],
  matches: [],
  compositeMatches: [],
  userAddedEntries: [],
  acknowledgedBankIds: [],
  ...over,
});

/** One $100 deposit explained by exactly one pair of invoices, plus an ordinary matched pair. */
function unambiguous() {
  const bank = [
    txn("bank-0", "bank", "2026-03-10", "STRIPE PAYOUT", 10000, { sourceFile: "bank-mar.csv", sourceLine: 2 }),
    txn("bank-1", "bank", "2026-03-11", "OFFICE RENT", -90000, { sourceFile: "bank-mar.csv", sourceLine: 3 }),
  ];
  const ledger = [
    txn("ledger-0", "ledger", "2026-03-08", "Invoice 101 Acme", 6000, { sourceFile: "ledger.csv", sourceLine: 2 }),
    txn("ledger-1", "ledger", "2026-03-09", "Invoice 102 Birch", 4000, { sourceFile: "ledger.csv", sourceLine: 3 }),
    txn("ledger-2", "ledger", "2026-03-11", "OFFICE RENT", -90000, { sourceFile: "ledger.csv", sourceLine: 4 }),
  ];
  const result = reconcile(bank, ledger);
  return { bank, ledger, result };
}

/** A deposit two OVERLAPPING combinations explain: both use Invoice 101. */
function overlappingOptions() {
  const bank = [txn("bank-0", "bank", "2026-03-10", "STRIPE PAYOUT", 10000)];
  const ledger = [
    txn("ledger-0", "ledger", "2026-03-08", "Invoice 101 Acme", 6000),
    txn("ledger-1", "ledger", "2026-03-09", "Invoice 102 Birch", 4000),
    txn("ledger-2", "ledger", "2026-03-09", "Invoice 103 Cedar", 4000),
  ];
  const result = reconcile(bank, ledger);
  return { bank, ledger, result };
}

const ctxFor = (s: { bank: Txn[]; ledger: Txn[]; result: ReturnType<typeof reconcile> }, composites: AnyCompositeMatch[], over: Partial<ExportContext> = {}) =>
  baseCtx({
    bankTxns: s.bank,
    ledgerTxns: s.ledger,
    matches: s.result.matches,
    compositeMatches: composites,
    unexplainedDifference: s.result.balanceProof.unexplainedDifference,
    ...over,
  });

const text = (lines: PairLine[]) =>
  lines.map((l) => [l.kind, l.bankDescription.trim(), l.bankAmount, l.booksDescription, l.booksAmount].join(" | "));

describe("fixture sanity", () => {
  it("the engine proposes one unambiguous and one ambiguous-with-overlap composite", () => {
    const u = unambiguous().result.compositeMatches;
    expect(u).toHaveLength(1);
    expect(u[0].ambiguous).toBe(false);
    const o = overlappingOptions().result.compositeMatches;
    expect(o).toHaveLength(1);
    expect(o[0].ambiguous).toBe(true);
    expect(o[0].allCombinations).toHaveLength(2);
    // The two options share Invoice 101.
    expect(o[0].allCombinations![0].filter((id) => o[0].allCombinations![1].includes(id))).toEqual(["ledger-0"]);
  });
});

describe("pending composite → listed in the review section, nowhere else", () => {
  const s = unambiguous();
  const model = buildReportModel(ctxFor(s, s.result.compositeMatches));

  it("appears with the bank transaction and every ledger entry", () => {
    expect(text(model.reviewLines)).toEqual([
      "group | STRIPE PAYOUT | $100.00 | Possible grouped match — 2 entries in your records add up to this amount (not confirmed) | $100.00",
      "part | entry 1 of 2 |  | Invoice 101 Acme | $60.00",
      "part | entry 2 of 2 |  | Invoice 102 Birch | $40.00",
    ]);
    expect(model.reviewCount).toBe(1);
  });

  it("is not listed as matched or as unmatched", () => {
    expect(model.matchedCount).toBe(1); // only the rent pair
    expect(model.matchedLines.map((l) => l.bankDescription)).toEqual(["OFFICE RENT"]);
    expect(model.missingFromBooks).toEqual([]);
    expect(model.missingFromBank).toEqual([]);
  });

  it("keeps the verdict honest: it still counts as one open item", () => {
    expect(openItemCount(model.buckets)).toBe(1);
    expect(model.verdict).toContain("1 item still needs attention");
  });
});

describe("accepted composite → listed under matched, once", () => {
  const s = unambiguous();
  const accepted = applyCompositeDecision(s.result.compositeMatches, s.result.compositeMatches[0].id, "accept");
  const model = buildReportModel(ctxFor(s, accepted, { reconciled: true }));

  it("appears in matched with clear references to the bank row and each ledger row", () => {
    expect(text(model.matchedLines)).toEqual([
      "pair | OFFICE RENT | ($900.00) | OFFICE RENT | ($900.00)",
      "group | STRIPE PAYOUT | $100.00 | Grouped match — 2 entries in your records add up to this amount | $100.00",
      "part | entry 1 of 2 |  | Invoice 101 Acme | $60.00",
      "part | entry 2 of 2 |  | Invoice 102 Birch | $40.00",
    ]);
    const group = model.matchedLines[1];
    const parts = model.matchedLines.slice(2);
    expect(group.bankSource).toBe("bank-mar.csv · row 2");
    expect(parts.map((p) => p.booksSource)).toEqual(["ledger.csv · row 2", "ledger.csv · row 3"]);
  });

  it("counts the group once and leaves nothing in review or unmatched", () => {
    expect(model.matchedCount).toBe(2); // 1 pair + 1 group (not 4 rows)
    expect(model.reviewLines).toEqual([]);
    expect(model.reviewCount).toBe(0);
    expect(model.missingFromBooks).toEqual([]);
    expect(model.missingFromBank).toEqual([]);
    expect(model.verdict).toBe("Your records match your bank for this period.");
  });

  it("the parts add up to the bank amount shown", () => {
    const partsTotal = model.buckets.acceptedComposites[0].ledgerTxns.reduce((a, t) => a + t.amount, 0);
    expect(partsTotal).toBe(model.buckets.acceptedComposites[0].bankTxn.amount);
  });
});

describe("rejected composite → both sides fall back to unmatched", () => {
  const s = unambiguous();
  const rejected = applyCompositeDecision(s.result.compositeMatches, s.result.compositeMatches[0].id, "reject");
  const model = buildReportModel(ctxFor(s, rejected));

  it("is not shown as a group anywhere", () => {
    expect([...model.matchedLines, ...model.reviewLines].some((l) => l.kind !== "pair")).toBe(false);
  });
  it("its bank transaction and ledger entries are listed as unmatched", () => {
    expect(model.missingFromBooks.map((l) => l.description)).toEqual(["STRIPE PAYOUT"]);
    expect(model.missingFromBank.map((l) => l.description)).toEqual(["Invoice 101 Acme", "Invoice 102 Birch"]);
    expect(openItemCount(model.buckets)).toBe(3);
  });
});

describe("overlapping composite candidates (ambiguous)", () => {
  const s = overlappingOptions();

  it("pending: every option is listed, the shared entry under each, counted as ONE open item", () => {
    const model = buildReportModel(ctxFor(s, s.result.compositeMatches));
    expect(text(model.reviewLines)).toEqual([
      "group | STRIPE PAYOUT | $100.00 | Possible grouped match — 2 different combinations of entries add up to this amount; none has been chosen | ",
      "part | option 1 of 2 · entry 1 of 2 |  | Invoice 101 Acme | $60.00",
      "part | option 1 of 2 · entry 2 of 2 |  | Invoice 102 Birch | $40.00",
      "part | option 2 of 2 · entry 1 of 2 |  | Invoice 101 Acme | $60.00",
      "part | option 2 of 2 · entry 2 of 2 |  | Invoice 103 Cedar | $40.00",
    ]);
    expect(model.reviewCount).toBe(1);
    expect(openItemCount(model.buckets)).toBe(1);
    // Candidates are not ALSO reported as unmatched while the choice is open.
    expect(model.missingFromBank).toEqual([]);
    expect(model.matchedLines).toEqual([]);
  });

  it("accepted with a pick: only the picked entries are matched; the other candidate is unmatched", () => {
    const id = s.result.compositeMatches[0].id;
    const accepted = applyCompositeDecision(s.result.compositeMatches, id, "accept", ["ledger-0", "ledger-2"]);
    const model = buildReportModel(ctxFor(s, accepted));
    expect(model.matchedLines.filter((l) => l.kind === "part").map((l) => l.booksDescription)).toEqual([
      "Invoice 101 Acme",
      "Invoice 103 Cedar",
    ]);
    expect(model.missingFromBank.map((l) => l.description)).toEqual(["Invoice 102 Birch"]);
    expect(model.reviewLines).toEqual([]);
  });
});

describe("no transaction is ever listed twice", () => {
  const placements = (ctx: ExportContext) => {
    const b = buildReportModel(ctx).buckets;
    const bank = [
      ...b.acceptedPairs.map((p) => p.bankTxn.id),
      ...b.acceptedComposites.map((c) => c.bankTxn.id),
      ...b.reviewPairs.map((p) => p.bankTxn.id),
      ...b.reviewComposites.map((c) => c.bankTxn.id),
      ...b.missingFromBooks.map((t) => t.id),
      ...b.addedToReconciliation.map((e) => e.txnId),
    ];
    const ledger = [
      ...b.acceptedPairs.map((p) => p.ledgerTxn.id),
      ...b.acceptedComposites.flatMap((c) => c.ledgerTxns.map((t) => t.id)),
      ...b.reviewPairs.map((p) => p.ledgerTxn.id),
      ...b.reviewComposites.flatMap((c) => c.ledgerTxns.map((t) => t.id)),
      ...b.missingFromBank.map((t) => t.id),
      ...b.acknowledgedBank.map((t) => t.id),
    ];
    return { bank: bank.sort(), ledger: ledger.sort() };
  };

  it.each(["suggested", "accepted", "rejected"] as const)("composite %s: every row appears exactly once", (status) => {
    const s = unambiguous();
    const id = s.result.compositeMatches[0].id;
    const composites =
      status === "suggested"
        ? s.result.compositeMatches
        : applyCompositeDecision(s.result.compositeMatches, id, status === "accepted" ? "accept" : "reject");
    const p = placements(ctxFor(s, composites));
    expect(p.bank).toEqual(s.bank.map((t) => t.id).sort());
    expect(p.ledger).toEqual(s.ledger.map((t) => t.id).sort());
  });

  it("defensive: an accepted composite that collides with an accepted pair is not listed again", () => {
    const s = unambiguous();
    const accepted = applyCompositeDecision(s.result.compositeMatches, s.result.compositeMatches[0].id, "accept");
    const colliding = [
      ...s.result.matches,
      { id: "x", bankTxnId: "bank-0", ledgerTxnId: "ledger-0", type: "near" as const, confidence: 80, status: "accepted" as const, reasons: [] },
    ];
    const model = buildReportModel(ctxFor(s, accepted, { matches: colliding }));
    const bankIds = [
      ...model.buckets.acceptedPairs.map((p) => p.bankTxn.id),
      ...model.buckets.acceptedComposites.map((c) => c.bankTxn.id),
    ];
    expect(bankIds.filter((id) => id === "bank-0")).toHaveLength(1);
  });
});

describe("provenance in the reports", () => {
  it("every listed transaction carries its file and row", () => {
    const s = unambiguous();
    const model = buildReportModel(ctxFor(s, s.result.compositeMatches));
    expect(model.hasProvenance).toBe(true);
    expect(model.matchedLines[0].bankSource).toBe("bank-mar.csv · row 3");
    expect(model.matchedLines[0].booksSource).toBe("ledger.csv · row 4");
  });

  it("unmatched and user-added rows carry it too", () => {
    const bank = [txn("bank-0", "bank", "2026-03-10", "FEE", -1200, { sourceFile: "b.csv", sourceLine: 9 })];
    const ledger = [txn("ledger-0", "ledger", "2026-03-10", "CHECK", -500, { sourceFile: "l.csv", sourceLine: 4 })];
    const m1 = buildReportModel(baseCtx({ bankTxns: bank, ledgerTxns: ledger }));
    expect(m1.missingFromBooks[0].source).toBe("b.csv · row 9");
    expect(m1.missingFromBank[0].source).toBe("l.csv · row 4");
    const m2 = buildReportModel(baseCtx({
      bankTxns: bank, ledgerTxns: ledger,
      userAddedEntries: [{ id: "e", txnId: "bank-0", date: "2026-03-10", description: "FEE", amount: -1200 }],
      acknowledgedBankIds: ["ledger-0"],
    }));
    expect(m2.added[0].source).toBe("b.csv · row 9");
    expect(m2.acknowledged[0].source).toBe("l.csv · row 4");
  });

  it("legacy data (no provenance) reports none and invents nothing", () => {
    const s = overlappingOptions(); // txns built without sourceFile / sourceLine
    const model = buildReportModel(ctxFor(s, s.result.compositeMatches));
    expect(model.hasProvenance).toBe(false);
    expect(model.importSummary).toEqual([]);
    expect(model.setAsideLines).toEqual([]);
  });
});

// ---- Duplicate sections ------------------------------------------------

function duplicateCtx() {
  const file = (name: string, header: string, rows: string[]): ImportFileInput => ({
    name, content: [header, ...rows].join("\n"), map: undefined as unknown as ImportFileInput["map"],
  });
  const allBank = combineFiles("bank", [
    file("bank-jan.csv", "Transaction ID,Date,Description,Amount", [
      "TX1,01/05/2026,COFFEE SUPPLY CO,-45.10",
      "TX2,01/20/2026,CLIENT PAYMENT,1200.00",
    ]),
    file("bank-q1.csv", "Transaction ID,Date,Description,Amount", [
      "TX1,01/05/2026,COFFEE SUPPLY CO,-45.10",
      "TX2,01/20/2026,CLIENT PAYMENT,1200.00",
      "TX3,02/03/2026,=HYPERLINK(\"http://evil\"),-900.00",
    ]),
  ]).txns;
  const allLedger = combineFiles("ledger", [
    file("ledger.csv", "Date,Description,Amount", [
      "01/05/2026,COFFEE SUPPLY CO,-45.10",
      "01/20/2026,CLIENT PAYMENT,1200.00",
      "01/22/2026,Parking,-8.00",
      "01/22/2026,Parking,-8.00",
    ]),
  ]).txns;
  const groups = [...detectDuplicates("bank", allBank), ...detectDuplicates("ledger", allLedger)];
  const state = initialDuplicateState(groups, "2026-11-09T12:00:00.000Z");
  const bank = activeTxns(allBank, state);
  const ledger = activeTxns(allLedger, state);
  const result = reconcile(bank, ledger);
  return baseCtx({
    periodStart: "2026-01-05",
    periodEnd: "2026-02-03",
    bankTxns: bank,
    ledgerTxns: ledger,
    matches: result.matches,
    compositeMatches: result.compositeMatches,
    unexplainedDifference: result.balanceProof.unexplainedDifference,
    duplicates: { allBankTxns: allBank, allLedgerTxns: allLedger, groups, state },
  });
}

describe("duplicates in the reports: imported vs in use vs set aside", () => {
  const ctx = duplicateCtx();
  const model = buildReportModel(ctx);

  it("states how many rows were imported, set aside and used, per side", () => {
    expect(model.importSummary).toEqual([
      ["Bank rows imported", "5"],
      ["Bank rows set aside as repeated", "2"],
      ["Bank rows used in this reconciliation", "3"],
      ["Records rows imported", "4"],
      ["Records rows set aside as repeated", "0"],
      ["Records rows used in this reconciliation", "4"],
      ["Possible duplicates still included (not confirmed)", "2"],
    ]);
  });

  it("lists every set-aside row with its source, how it was set aside, why, and the copy kept", () => {
    expect(model.setAsideLines.map((l) => [l.side, l.description, l.amount, l.source, l.status])).toEqual([
      ["Bank", "COFFEE SUPPLY CO", "($45.10)", "bank-q1.csv · row 2", "Set aside automatically"],
      ["Bank", "CLIENT PAYMENT", "$1,200.00", "bank-q1.csv · row 3", "Set aside automatically"],
    ]);
    expect(model.setAsideLines[0].reason).toContain("same transaction ID (TX1)");
    expect(model.setAsideLines[0].reason).toContain("The copy still in use is bank-jan.csv · row 2.");
  });

  it("lists possible duplicates that are still counted, separately", () => {
    expect(model.possibleDuplicateLines.map((l) => [l.side, l.description, l.source, l.status])).toEqual([
      ["Books", "Parking", "ledger.csv · row 4", "Still included"],
      ["Books", "Parking", "ledger.csv · row 5", "Still included"],
    ]);
  });

  it("set-aside rows are not in any reconciliation section or total", () => {
    const listed = [
      ...model.matchedLines.map((l) => l.bankSource),
      ...model.reviewLines.map((l) => l.bankSource),
      ...model.missingFromBooks.map((l) => l.source),
    ];
    expect(listed.some((s) => s === "bank-q1.csv · row 2" || s === "bank-q1.csv · row 3")).toBe(false);
    // bank in use: coffee + payment + the Feb item = 3 rows, each listed once.
    expect(model.matchedLines.length + model.missingFromBooks.length).toBe(3);
  });
});

// ---- The real files ----------------------------------------------------

type Cell = { v: string; t: string };
async function sheetOf(ctx: ExportContext) {
  const wb = await buildExcelWorkbook(ctx);
  const ws = wb.Sheets[wb.SheetNames[0]] as Record<string, Cell>;
  const cells = Object.entries(ws).filter(([k]) => !k.startsWith("!")).map(([addr, c]) => ({ addr, ...c }));
  const rows = new Map<number, string[]>();
  for (const c of cells) {
    const m = /^([A-Z]+)(\d+)$/.exec(c.addr)!;
    const col = m[1].charCodeAt(0) - 65;
    const list = rows.get(Number(m[2])) ?? [];
    list[col] = String(c.v);
    rows.set(Number(m[2]), list);
  }
  const lines = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => Array.from(r, (v) => v ?? ""));
  return { cells, lines, text: lines.map((r) => r.join(" | ")).join("\n") };
}

describe("Excel workbook (built for real)", () => {
  it("accepted composite: the group and its entries are in the Matched section with sources", async () => {
    const s = unambiguous();
    const accepted = applyCompositeDecision(s.result.compositeMatches, s.result.compositeMatches[0].id, "accept");
    const { lines, text } = await sheetOf(ctxFor(s, accepted, { reconciled: true }));
    expect(text).toContain("Matched transactions  (2)");
    const group = lines.find((r) => r[1] === "STRIPE PAYOUT")!;
    expect(group[4]).toBe("Grouped match — 2 entries in your records add up to this amount");
    expect(group[6]).toBe("bank-mar.csv · row 2");
    const entry = lines.find((r) => r[4] === "Invoice 102 Birch")!;
    expect(entry[1].trim()).toBe("entry 2 of 2");
    expect(entry[5]).toBe("$40.00");
    expect(entry[7]).toBe("ledger.csv · row 3");
    expect(lines.find((r) => r[0] === "Bank date")).toHaveLength(8); // + two source columns
  });

  it("pending composite: listed under possible matches, not under matched", async () => {
    const s = unambiguous();
    const { text, lines } = await sheetOf(ctxFor(s, s.result.compositeMatches));
    expect(text).toContain("Matched transactions  (1)");
    expect(text).toContain("Possible matches — not confirmed  (1, including 1 grouped)");
    const head = lines.findIndex((r) => r[0].startsWith("Possible matches"));
    const group = lines.findIndex((r) => r[1] === "STRIPE PAYOUT");
    expect(group).toBeGreaterThan(head);
    expect(text).toContain("Needs your attention  (1 open item)");
  });

  it("duplicates: import counts, set-aside rows and possible duplicates are all written", async () => {
    const { text, lines } = await sheetOf(duplicateCtx());
    expect(text).toContain("Bank rows imported | 5");
    expect(text).toContain("Bank rows set aside as repeated | 2");
    expect(text).toContain("Rows set aside as repeated  (2)");
    expect(text).toContain("Possible duplicates still included  (2)");
    const setAside = lines.find((r) => r[4] === "bank-q1.csv · row 2")!;
    expect(setAside[3]).toBe("Bank");
    expect(setAside[5]).toMatch(/^Set aside automatically\. .*transaction ID \(TX1\)/);
  });

  it("every cell is an explicit string — a formula-looking description stays text", async () => {
    const { cells } = await sheetOf(duplicateCtx());
    expect(cells.length).toBeGreaterThan(50);
    expect(cells.every((c) => c.t === "s")).toBe(true);
    const evil = cells.find((c) => String(c.v).startsWith("=HYPERLINK"))!;
    expect(evil).toBeDefined();
    expect(evil.t).toBe("s");
    expect((evil as unknown as { f?: string }).f).toBeUndefined();
  });

  it("legacy data: the sheet keeps its original six columns and has no duplicate sections", async () => {
    const s = overlappingOptions();
    const { lines, text } = await sheetOf(ctxFor(s, s.result.compositeMatches));
    expect(Math.max(...lines.map((r) => r.length))).toBe(6);
    expect(text).not.toContain("Source");
    expect(text).not.toContain("set aside");
  });
});

describe("PDF report (built for real)", () => {
  const pdfText = async (ctx: ExportContext) => {
    const doc = await buildPdfDocument(ctx);
    return doc.output();
  };

  it("contains the grouped match, its entries and their sources", async () => {
    const s = unambiguous();
    const accepted = applyCompositeDecision(s.result.compositeMatches, s.result.compositeMatches[0].id, "accept");
    const out = await pdfText(ctxFor(s, accepted, { reconciled: true }));
    expect(out).toContain("STRIPE PAYOUT");
    expect(out).toContain("Invoice 102 Birch");
    expect(out).toContain("entry 2 of 2");
    expect(out).toContain("ledger.csv");
  });

  it("contains the duplicate sections", async () => {
    const out = await pdfText(duplicateCtx());
    expect(out).toContain("Rows set aside as repeated");
    expect(out).toContain("Possible duplicates still included");
    expect(out).toContain("Imported rows");
    expect(out).toContain("bank-q1.csv");
  });

  it("legacy data: no source lines and no duplicate sections", async () => {
    const s = overlappingOptions();
    const out = await pdfText(ctxFor(s, s.result.compositeMatches));
    expect(out).toContain("Possible matches");
    expect(out).not.toContain("Rows set aside");
    expect(out).not.toContain("Imported rows");
  });
});
