/**
 * RECON-003 — Excel amounts and counts are real numbers.
 *
 * Every check here is made on a workbook that was WRITTEN to .xlsx bytes
 * and READ back, inspecting each cell's stored type (t), value (v), number
 * format (z) and formula (f). A cell that merely looks like currency does
 * not pass: the type must be "n".
 */
import { describe, it, expect } from "vitest";
import XLSX from "xlsx-js-style";
import { reconcile } from "@/lib/recon";
import { applyCompositeDecision, applyMatchDecision } from "@/lib/recon/decisions";
import type { Txn } from "@/lib/recon/types";
import { verifyStatements } from "@/lib/review/statements";
import { buildMonthReview } from "@/lib/review/months";
import { EMPTY_DUPLICATE_STATE } from "@/lib/import/duplicates";
import type { ExportContext } from "@/lib/export/buckets";
import { buildExcelWorkbook, MONEY_FORMAT } from "@/lib/export/excel-worksheet";
import { runDemoPipeline } from "@/lib/demo/__tests__/pipeline";

type Cell = { t: string; v: string | number; z?: string; f?: string; w?: string };
type Sheet = { rows: Cell[][]; cells: Cell[] };

/** Build → write real .xlsx bytes → read them back. */
async function roundTrip(ctx: ExportContext): Promise<Record<string, Sheet>> {
  const wb = await buildExcelWorkbook(ctx);
  const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const back = XLSX.read(bytes, { cellNF: true, cellFormula: true });
  const out: Record<string, Sheet> = {};
  for (const name of back.SheetNames) {
    const ws = back.Sheets[name];
    const range = XLSX.utils.decode_range(ws["!ref"]!);
    const rows: Cell[][] = [];
    const cells: Cell[] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: Cell[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as Cell | undefined;
        row.push(cell ?? { t: "z", v: "" });
        if (cell) cells.push(cell);
      }
      rows.push(row);
    }
    out[name] = { rows, cells };
  }
  return out;
}

const text = (c: Cell | undefined) => (c && c.t === "s" ? String(c.v) : "");
const cents = (c: Cell) => Math.round((c.v as number) * 100);
/** Rows between the row whose first cell starts with `from` and the next blank row. */
function section(sheet: Sheet, from: string): Cell[][] {
  const start = sheet.rows.findIndex((r) => text(r[0]).startsWith(from));
  expect(start, `section "${from}"`).toBeGreaterThanOrEqual(0);
  const out: Cell[][] = [];
  for (let i = start + 1; i < sheet.rows.length; i++) {
    if (sheet.rows[i].every((c) => c.t === "z" || c.v === "")) break;
    out.push(sheet.rows[i]);
  }
  return out;
}
const numbersIn = (rows: Cell[][], col: number) => rows.map((r) => r[col]).filter((c) => c && c.t === "n");
const sumCents = (cs: Cell[]) => cs.reduce((s, c) => s + cents(c), 0);

// ---- The advanced demo, with every suggestion accepted ----------------
const demo = runDemoPipeline();
function demoCtx(): ExportContext {
  let matches = demo.result.matches;
  let composites = demo.result.compositeMatches;
  for (const m of matches.filter((x) => x.status === "suggested")) matches = applyMatchDecision(matches, m.id, "accept");
  for (const c of composites) composites = applyCompositeDecision(composites, c.id, "accept");
  const months = buildMonthReview({
    statementReview: demo.statements,
    imported: demo.imported,
    bankTxns: demo.bankTxns,
    ledgerTxns: demo.ledgerTxns,
    matches,
    compositeMatches: composites,
    addedBankIds: new Set(),
    acknowledgedLedgerIds: new Set(),
    duplicateGroups: demo.groups,
    duplicateState: demo.dupState,
    sourceFiles: demo.sourceFiles,
  });
  return {
    accountName: "Sample data — Cedar & Co. Creative Studio (fictional)",
    periodStart: "2026-01-02",
    periodEnd: "2026-03-31",
    openingBalance: null,
    closingBalance: null,
    reconciled: false,
    unexplainedDifference: demo.result.balanceProof.unexplainedDifference,
    bankTxns: demo.bankTxns,
    ledgerTxns: demo.ledgerTxns,
    matches,
    compositeMatches: composites,
    userAddedEntries: [],
    acknowledgedBankIds: [],
    review: { months, statements: demo.statements },
    duplicates: { allBankTxns: demo.imported.bank, allLedgerTxns: demo.imported.ledger, groups: demo.groups, state: demo.dupState },
  };
}

/** A tiny hand-made context (no review / duplicates). */
function tinyCtx(bank: [string, string, number][], ledger: [string, string, number][], extra: Partial<ExportContext> = {}): ExportContext {
  const mk = (source: "bank" | "ledger") => ([date, description, amount]: [string, string, number], i: number): Txn => ({
    id: `${source}-${i}`, source, date, description, amount, raw: {}, sourceFile: `${source}.csv`, sourceLine: i + 2,
  });
  const b = bank.map(mk("bank"));
  const l = ledger.map(mk("ledger"));
  const r = reconcile(b, l);
  return {
    accountName: "Test",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    openingBalance: null,
    closingBalance: null,
    reconciled: r.reconciled,
    unexplainedDifference: r.balanceProof.unexplainedDifference,
    bankTxns: b,
    ledgerTxns: l,
    matches: r.matches,
    compositeMatches: r.compositeMatches,
    userAddedEntries: [],
    acknowledgedBankIds: [],
    ...extra,
  };
}

describe("RECON-003 — Reconciliation sheet", () => {
  it("transaction amounts are numeric cells with a currency format, signs and cents intact", async () => {
    const { Reconciliation: sheet } = await roundTrip(demoCtx());
    const find = (desc: string, col = 1) => sheet.rows.filter((r) => text(r[col]) === desc);

    // The three amounts the QA report quoted as text: ($59.99), ($129.99), $4,750.00.
    const adobe = section(sheet, "On your bank statement but not in your records").find((r) => text(r[1]) === "ADOBE CREATIVE CLOUD")!;
    expect(adobe[2]).toMatchObject({ t: "n", v: -59.99, z: MONEY_FORMAT });
    const comcast = section(sheet, "On your bank statement but not in your records").find((r) => text(r[1]) === "COMCAST BUSINESS")!;
    expect(comcast[2]).toMatchObject({ t: "n", v: -129.99 });
    const stripe = find("STRIPE PAYOUT")[0];
    expect(stripe[2]).toMatchObject({ t: "n", v: 4750, z: MONEY_FORMAT });

    // Displayed with parentheses for negatives — formatting only; the value keeps its sign.
    expect(adobe[2].w).toBe("($59.99)");
    expect(stripe[2].w).toBe("$4,750.00");
    expect(MONEY_FORMAT).toBe('"$"#,##0.00;("$"#,##0.00)');

    // Small cents survive: the $1.84 and $2.11 interest lines, the −$3.50 ATM fee.
    const bankOnly = section(sheet, "On your bank statement but not in your records");
    expect(numbersIn(bankOnly, 2).map(cents)).toEqual([-1500, 184, -11243, -1500, -5999, -12999, -350, -1500, 211]);
  });

  it("SUM over each amount column reproduces Reconly's own totals", async () => {
    const ctx = demoCtx();
    const { Reconciliation: sheet } = await roundTrip(ctx);
    const matched = section(sheet, "Matched transactions");
    const bankOnly = section(sheet, "On your bank statement but not in your records");
    const recordsOnly = section(sheet, "In your records only");

    const matchedBank = sumCents(numbersIn(matched, 2));
    const matchedBooks = sumCents(numbersIn(matched, 5));
    const bankOnlySum = sumCents(numbersIn(bankOnly, 2));
    const recordsOnlySum = sumCents(numbersIn(recordsOnly, 2));

    const net = (ts: Txn[]) => ts.reduce((s, t) => s + t.amount, 0);
    expect(bankOnlySum).toBe(-34696);
    expect(recordsOnlySum).toBe(96258);
    // Every bank row in use is either matched or bank-only; same for the ledger.
    expect(matchedBank + bankOnlySum).toBe(net(ctx.bankTxns)); // −$2,977.56
    expect(matchedBooks + recordsOnlySum).toBe(net(ctx.ledgerTxns)); // −$1,668.02
    expect(net(ctx.bankTxns)).toBe(-297756);
    expect(net(ctx.ledgerTxns)).toBe(-166802);
    // …so the difference can be rebuilt from the cells alone.
    expect(matchedBank + bankOnlySum - (matchedBooks + recordsOnlySum)).toBe(-130954);
  });

  it("the Stripe group cannot be double-counted: $1,500 + $2,000 + $1,250 appear once, the $4,750 subtotal is text", async () => {
    const { Reconciliation: sheet } = await roundTrip(demoCtx());
    const matched = section(sheet, "Matched transactions");
    const i = matched.findIndex((r) => text(r[1]) === "STRIPE PAYOUT");
    const group = matched[i];
    const parts = matched.slice(i + 1, i + 4);

    expect(group[2]).toMatchObject({ t: "n", v: 4750 }); // bank amount, once
    expect(group[5].t).not.toBe("n"); // no numeric subtotal in the books-amount column
    expect(text(group[4])).toContain("group total $4,750.00 (subtotal of the entries below, not an extra amount)");
    expect(parts.map((r) => r[5])).toEqual([
      expect.objectContaining({ t: "n", v: 1500 }),
      expect.objectContaining({ t: "n", v: 2000 }),
      expect.objectContaining({ t: "n", v: 1250 }),
    ]);
    expect(parts.every((r) => r[2].t !== "n")).toBe(true); // entries carry no bank amount

    // In the whole matched table, 4750 is a number exactly once (the bank side),
    // and both amount columns add up to the same total.
    const all = [...numbersIn(matched, 2), ...numbersIn(matched, 5)];
    expect(all.filter((c) => c.v === 4750)).toHaveLength(1);
    expect(sumCents(numbersIn(matched, 2))).toBe(sumCents(numbersIn(matched, 5)));
    expect(sheet.rows.some((r) => text(r[0]).startsWith("Grouped matches: the bank amount appears once"))).toBe(true);
  });

  it("net activity and counts in the header block are numbers", async () => {
    const { Reconciliation: sheet } = await roundTrip(demoCtx());
    const kv = (label: string) => sheet.rows.find((r) => text(r[0]) === label)![1];
    expect(kv("Bank net activity")).toMatchObject({ t: "n", v: -2977.56, z: MONEY_FORMAT });
    expect(kv("Ledger net activity")).toMatchObject({ t: "n", v: -1668.02 });
    expect(kv("Net activity difference (bank minus ledger)")).toMatchObject({ t: "n", v: -1309.54 });
    expect(kv("Bank rows imported")).toMatchObject({ t: "n", v: 54, z: "0" });
    expect(kv("Bank rows set aside as repeated")).toMatchObject({ t: "n", v: 7 });
    expect(kv("Records rows used in this reconciliation")).toMatchObject({ t: "n", v: 44 });
    // Words stay words.
    expect(kv("Financial reconciliation").t).toBe("s");
    expect(sheet.rows.some((r) => /unexplained/i.test(text(r[0])))).toBe(false);
  });

  it("set-aside rows carry numeric amounts and keep their source", async () => {
    const { Reconciliation: sheet } = await roundTrip(demoCtx());
    const rows = section(sheet, "Rows set aside as repeated").filter((r) => r[2].t === "n");
    expect(rows).toHaveLength(7);
    expect(sumCents(rows.map((r) => r[2]))).toBe(-6148 + 220000 - 100000 - 1500 + 260000 - 210000 - 4320); // $1,580.32
    expect(text(rows[0][4])).toBe("bank-feb-mar-overlap.csv · row 2");
    expect(text(rows[0][5])).toBe("Set aside automatically");
  });

  it("zero and sub-dollar values are exact numbers", async () => {
    const reconciled = tinyCtx([["2026-01-05", "COFFEE", -5]], [["2026-01-05", "COFFEE", -5]]);
    const { Reconciliation: sheet } = await roundTrip(reconciled);
    const kv = (label: string) => sheet.rows.find((r) => text(r[0]) === label)![1];
    expect(kv("Net activity difference (bank minus ledger)")).toMatchObject({ t: "n", v: 0 });
    expect(kv("Net activity difference (bank minus ledger)").w).toBe("$0.00");
    const coffee = section(sheet, "Matched transactions").find((r) => text(r[1]) === "COFFEE")!;
    expect(coffee[2]).toMatchObject({ t: "n", v: -0.05 });
    expect(coffee[5]).toMatchObject({ t: "n", v: -0.05 });
  });

  it("an undecided ambiguous group lists its options as text, so no entry is summable twice", async () => {
    // $100 deposit; ledger has 60 + 40 twice over → several valid combinations.
    const ctx = tinyCtx(
      [["2026-01-10", "STRIPE PAYOUT", 10000]],
      [
        ["2026-01-08", "Invoice A", 6000],
        ["2026-01-08", "Invoice B", 4000],
        ["2026-01-09", "Invoice C", 6000],
        ["2026-01-09", "Invoice D", 4000],
      ]
    );
    expect(ctx.compositeMatches[0].ambiguous).toBe(true);
    const { Reconciliation: sheet } = await roundTrip(ctx);
    const review = section(sheet, "Possible matches");
    const options = review.filter((r) => /option \d+ of \d+/.test(text(r[1])));
    expect(options.length).toBeGreaterThan(4); // entries repeat across options
    expect(options.every((r) => r[5].t !== "n")).toBe(true);
    expect(options.every((r) => /one of several options, not counted/.test(text(r[8])))).toBe(true); // note sits after the two source columns
    // The bank amount is numeric once.
    expect(numbersIn(review, 2).map((c) => c.v)).toEqual([100]);
  });
});

describe("RECON-003 — Financial Summary sheet", () => {
  it("statement balances, differences and row counts are numbers; their notes are separate text", async () => {
    const { "Financial Summary": sheet } = await roundTrip(demoCtx());
    const head = sheet.rows.find((r) => text(r[0]) === "Bank file")!.map(text);
    expect(head).toEqual([
      "Bank file", "Period", "Opening balance", "Opening balance source", "Net activity", "Rows",
      "Closing balance", "Closing balance source", "Difference", "Result", "Explanation",
    ]);
    const stmt = (file: string) => sheet.rows.find((r) => text(r[0]) === file && text(r[9]) !== "")!;

    const jan = stmt("bank-jan-2026.csv");
    expect(jan[2]).toMatchObject({ t: "n", v: 18420, z: MONEY_FORMAT });
    expect(text(jan[3])).toBe("stated, line 3");
    expect(jan[4]).toMatchObject({ t: "n", v: 2785.89 });
    expect(jan[5]).toMatchObject({ t: "n", v: 15 });
    expect(jan[6]).toMatchObject({ t: "n", v: 21205.89 });
    expect(jan[8]).toMatchObject({ t: "n", v: 0 });
    expect(cents(jan[2]) + cents(jan[4])).toBe(cents(jan[6])); // opening + activity = closing

    const feb = stmt("bank-feb-2026.csv");
    expect(feb[4]).toMatchObject({ t: "n", v: -5725.59 });
    expect(feb[8]).toMatchObject({ t: "n", v: -1350 });
    expect(text(feb[9])).toBe("Statement balance mismatch");
    expect(cents(feb[2]) + cents(feb[4]) - cents(feb[6])).toBe(-135000);

    const mar = stmt("bank-mar-2026.csv");
    expect(mar[2]).toMatchObject({ t: "n", v: 16830.3 });
    expect(text(mar[3])).toBe("calculated — not stated in the file");
    expect(text(mar[7])).toBe("last running balance in the file");

    const overlap = stmt("bank-feb-mar-overlap.csv");
    expect(overlap[2].t).not.toBe("n"); // nothing stated → no number invented
    expect(text(overlap[3])).toBe("Not stated");
    expect(text(overlap[8])).toBe("Not computable");
  });

  it("month counts, overall figures and exception amounts are numbers", async () => {
    const { "Financial Summary": sheet } = await roundTrip(demoCtx());
    const feb = sheet.rows.find((r) => text(r[0]) === "February 2026")!;
    expect(feb.slice(1, 8).map((c) => [c.t, c.v])).toEqual([
      ["n", 15], ["n", 14], ["n", 4], ["n", 3], ["n", 0], ["n", 0], ["n", 2],
    ]);
    const kv = (label: string) => sheet.rows.find((r) => text(r[0]) === label)![1];
    expect(kv("Net activity difference (bank minus ledger)")).toMatchObject({ t: "n", v: -1309.54 });
    expect(kv("Bank net activity")).toMatchObject({ t: "n", v: -2977.56 });
    expect(kv("Suggested matches awaiting review")).toMatchObject({ t: "n", v: 0 });

    const ex = section(sheet, "Unresolved exceptions").slice(1);
    const amounts = ex.map((r) => r[3]).filter((c) => c.t === "n");
    expect(amounts.length).toBe(ex.length); // every exception here has an amount
    const comcast = ex.filter((r) => text(r[2]) === "COMCAST BUSINESS").map((r) => r[3].v);
    expect(comcast).toEqual([-129.99, -139.99]);
    expect(ex.some((r) => text(r[0]) === "In your records only — no confirmed bank match")).toBe(true);
    expect(ex.some((r) => text(r[0]) === "Statement balance mismatch" && r[3].v === -1350)).toBe(true);
  });
});

describe("RECON-003 — formula-injection protection is unchanged", () => {
  const evil = ['=HYPERLINK("http://evil","x")', "+1+1", "-2+3", "@SUM(A1:A9)", "=1+1", "12345", "1e5"];

  it("descriptions and file names that look like formulas or numbers are stored as text on both sheets", async () => {
    const mk = (source: "bank" | "ledger") => (description: string, i: number): Txn => ({
      id: `${source}-${i}`,
      source,
      date: "2026-01-05",
      description,
      amount: -(100 + i),
      raw: {},
      sourceFile: "=cmd|' /C calc'!A0.csv",
      sourceLine: i + 2,
    });
    const bank = evil.map(mk("bank"));
    const ledger = [mk("ledger")("Something else entirely", 99)];
    const r = reconcile(bank, ledger);
    const sourceFiles = [
      { side: "bank" as const, name: "=cmd|' /C calc'!A0.csv", rows: bank.length, headerRow: 1, periodStart: "2026-01-05", periodEnd: "2026-01-05" },
    ];
    const statements = verifyStatements(bank, sourceFiles);
    const months = buildMonthReview({
      statementReview: statements,
      imported: { bank, ledger },
      bankTxns: bank,
      ledgerTxns: ledger,
      matches: r.matches,
      compositeMatches: r.compositeMatches,
      addedBankIds: new Set(),
      acknowledgedLedgerIds: new Set(),
      duplicateGroups: [],
      duplicateState: EMPTY_DUPLICATE_STATE,
      sourceFiles,
    });
    const sheets = await roundTrip({
      accountName: "=EVIL()",
      periodStart: "2026-01-05",
      periodEnd: "2026-01-05",
      openingBalance: null,
      closingBalance: null,
      reconciled: false,
      unexplainedDifference: r.balanceProof.unexplainedDifference,
      bankTxns: bank,
      ledgerTxns: ledger,
      matches: r.matches,
      compositeMatches: r.compositeMatches,
      userAddedEntries: [],
      acknowledgedBankIds: [],
      review: { months, statements },
    });

    for (const [name, sheet] of Object.entries(sheets)) {
      // No formula anywhere, after a real write + read.
      expect(sheet.cells.every((c) => c.f === undefined), name).toBe(true);
      // Every numeric cell is a finite number Reconly computed.
      for (const c of sheet.cells.filter((x) => x.t === "n")) expect(Number.isFinite(c.v as number)).toBe(true);
      // Each hostile description is present, as a string, exactly as typed.
      for (const d of evil) {
        const hits = sheet.cells.filter((c) => c.v === d);
        expect(hits.length, `${name}: ${d}`).toBeGreaterThan(0);
        expect(hits.every((c) => c.t === "s")).toBe(true);
      }
      expect(sheet.cells.filter((c) => String(c.v).includes("=cmd|")).every((c) => c.t === "s")).toBe(true);
    }
    expect(sheets.Reconciliation.cells.find((c) => c.v === "=EVIL()")!.t).toBe("s");
    // The amounts beside those descriptions are still numbers.
    const row = sheets.Reconciliation.rows.find((r) => r[1].v === "+1+1")!;
    expect(row[2]).toMatchObject({ t: "n", v: -1.01 });
  });
});
