/**
 * Phase 1 — multi-file import. The module under test must never merge,
 * drop or de-duplicate rows; it only concatenates, tags provenance and
 * reports overlapping date ranges.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { combineFiles, sourceLabel, type ImportFileInput } from "@/lib/import/combine";
import { parseCsvDetailed, type CsvColumnMap } from "@/lib/parser";
import { reconcile } from "@/lib/recon/engine";

const fixture = (n: string) =>
  readFileSync(resolve(__dirname, "../../../../tests/fixtures", n), "utf8");

const MAP: CsvColumnMap = { date: "date", description: "description", amount: "amount" };
const file = (name: string, rows: string[], headerRow?: number): ImportFileInput => ({
  name,
  content: ["Date,Description,Amount", ...rows].join("\n"),
  map: MAP,
  headerRow,
});

const JAN = file("bank-jan.csv", [
  "01/05/2026,COFFEE SUPPLY CO,-45.10",
  "01/20/2026,CLIENT PAYMENT,1200.00",
]);
const FEB = file("bank-feb.csv", [
  "02/03/2026,CHECK 1042,-310.00",
  "02/11/2026,OFFICE RENT,-900.00",
]);

describe("single file — unchanged behaviour", () => {
  it.each(["bank_statement.csv", "ledger.csv", "clean_bank.csv"])(
    "%s: identical transactions and ids to the plain parser",
    (name) => {
      const side = name.includes("ledger") ? "ledger" : "bank";
      const content = fixture(name);
      const plain = parseCsvDetailed(content, side).txns;
      const combined = combineFiles(side, [
        { name, content, map: undefined as unknown as CsvColumnMap },
      ]);
      // Same ids, order and values; the only addition is the file name.
      expect(combined.txns.map(({ sourceFile, ...t }) => t)).toEqual(plain);
      expect(new Set(combined.txns.map((t) => t.sourceFile))).toEqual(new Set([name]));
      expect(combined.files).toHaveLength(1);
      expect(combined.overlaps).toEqual([]);
    }
  );

  it("the engine gives the same answer for a single file through either path", () => {
    const bankCsv = fixture("bank_statement.csv");
    const ledgerCsv = fixture("ledger.csv");
    const direct = reconcile(parseCsvDetailed(bankCsv, "bank").txns, parseCsvDetailed(ledgerCsv, "ledger").txns);
    const viaImport = reconcile(
      combineFiles("bank", [{ name: "b.csv", content: bankCsv, map: undefined as unknown as CsvColumnMap }]).txns,
      combineFiles("ledger", [{ name: "l.csv", content: ledgerCsv, map: undefined as unknown as CsvColumnMap }]).txns
    );
    expect(viaImport.matches).toEqual(direct.matches);
    expect(viaImport.compositeMatches).toEqual(direct.compositeMatches);
    expect(viaImport.balanceProof).toEqual(direct.balanceProof);
    expect(viaImport.reconciled).toBe(direct.reconciled);
    expect(viaImport.missingFromBooks.map((t) => t.id)).toEqual(direct.missingFromBooks.map((t) => t.id));
  });
});

describe("several files per side", () => {
  it("keeps every row from every file, with unique ids and provenance", () => {
    const out = combineFiles("bank", [JAN, FEB]);
    expect(out.txns).toHaveLength(4);
    expect(new Set(out.txns.map((t) => t.id)).size).toBe(4);
    expect(out.txns.map((t) => [t.id, t.sourceFile, t.sourceLine])).toEqual([
      ["bank-f1-0", "bank-jan.csv", 2],
      ["bank-f1-1", "bank-jan.csv", 3],
      ["bank-f2-0", "bank-feb.csv", 2],
      ["bank-f2-1", "bank-feb.csv", 3],
    ]);
    expect(out.files.map((f) => [f.name, f.rowCount, f.coverage])).toEqual([
      ["bank-jan.csv", 2, { start: "2026-01-05", end: "2026-01-20" }],
      ["bank-feb.csv", 2, { start: "2026-02-03", end: "2026-02-11" }],
    ]);
    expect(out.overlaps).toEqual([]);
  });

  it("gives the same result whatever order the files were uploaded in", () => {
    expect(combineFiles("bank", [FEB, JAN])).toEqual(combineFiles("bank", [JAN, FEB]));
  });

  it("each file keeps its own column mapping and header row", () => {
    const split: ImportFileInput = {
      name: "bank-mar.csv",
      content: ["Export from Other Bank", "Posted,Memo,Withdrawal,Deposit", "03/02/2026,SOFTWARE,25.00,", "03/09/2026,REFUND,,40.00"].join("\n"),
      map: { date: "posted", description: "memo", debit: "withdrawal", credit: "deposit" },
      headerRow: 2,
    };
    const out = combineFiles("bank", [JAN, split]);
    const mar = out.txns.filter((t) => t.sourceFile === "bank-mar.csv");
    expect(mar.map((t) => [t.date, t.amount, t.sourceLine])).toEqual([
      ["2026-03-02", -2500, 3],
      ["2026-03-09", 4000, 4],
    ]);
    expect(out.files.find((f) => f.name === "bank-mar.csv")!.headerRow).toBe(2);
  });

  it("a file that yields no transactions is still reported (not silently skipped)", () => {
    const empty = file("bank-empty.csv", []);
    const out = combineFiles("bank", [JAN, empty]);
    const f = out.files.find((x) => x.name === "bank-empty.csv")!;
    expect(f.rowCount).toBe(0);
    expect(f.coverage).toBeNull();
    expect(out.txns).toHaveLength(2);
  });

  it("per-file diagnostics survive (skipped rows keep their file and line)", () => {
    const bad = file("bank-bad.csv", ["03/01/2026,OK,-1.00", "03/02/2026,BROKEN,n/a"]);
    const out = combineFiles("bank", [JAN, bad]);
    const f = out.files.find((x) => x.name === "bank-bad.csv")!;
    expect(f.rowCount).toBe(1);
    expect(f.diagnostics.issueCount).toBe(1);
    expect(f.diagnostics.issues[0].line).toBe(3);
  });
});

describe("overlapping files — reported, never de-duplicated", () => {
  const Q1 = file("bank-q1.csv", [
    "01/05/2026,COFFEE SUPPLY CO,-45.10",
    "01/20/2026,CLIENT PAYMENT,1200.00",
    "02/03/2026,CHECK 1042,-310.00",
  ]);

  it("reports the overlapping date range between two files", () => {
    const out = combineFiles("bank", [Q1, JAN]);
    expect(out.overlaps).toEqual([
      { side: "bank", fileA: "bank-jan.csv", fileB: "bank-q1.csv", start: "2026-01-05", end: "2026-01-20" },
    ]);
  });

  it("keeps ALL rows from both files even when rows are identical", () => {
    const out = combineFiles("bank", [Q1, JAN]);
    expect(out.txns).toHaveLength(5); // 3 + 2, nothing removed
    const coffee = out.txns.filter((t) => t.description === "COFFEE SUPPLY CO");
    expect(coffee).toHaveLength(2);
    expect(new Set(coffee.map((t) => t.sourceFile))).toEqual(new Set(["bank-q1.csv", "bank-jan.csv"]));
  });

  it("two byte-identical files are both kept in full and reported as overlapping", () => {
    const copy = { ...JAN, name: "bank-jan (1).csv" };
    const out = combineFiles("bank", [JAN, copy]);
    expect(out.txns).toHaveLength(4);
    expect(out.overlaps).toHaveLength(1);
  });

  it("the double-counting is visible in the engine's balance, not hidden", () => {
    const ledger = combineFiles("ledger", [file("ledger.csv", ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/20/2026,CLIENT PAYMENT,1200.00"])]);
    const copy = { ...JAN, name: "bank-jan-again.csv" };
    const result = reconcile(combineFiles("bank", [JAN, copy]).txns, ledger.txns);
    expect(result.reconciled).toBe(false);
    expect(result.missingFromBooks).toHaveLength(2);
    expect(result.balanceProof.unexplainedDifference).toBe(-4510 + 120000);
  });

  it("back-to-back months do not count as overlapping", () => {
    expect(combineFiles("bank", [JAN, FEB]).overlaps).toEqual([]);
  });

  it("files sharing a single boundary day are reported", () => {
    const a = file("a.csv", ["01/01/2026,A,-1.00", "01/31/2026,B,-2.00"]);
    const b = file("b.csv", ["01/31/2026,C,-3.00", "02/28/2026,D,-4.00"]);
    expect(combineFiles("bank", [a, b]).overlaps).toEqual([
      { side: "bank", fileA: "a.csv", fileB: "b.csv", start: "2026-01-31", end: "2026-01-31" },
    ]);
  });
});

describe("cross-month transactions across files", () => {
  // A cheque written Jan 30 (ledger, January file) that clears Feb 3 (bank,
  // February file), and a deposit recorded Feb 1 that the bank dated Jan 31.
  const bank = [
    file("bank-jan.csv", ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/31/2026,ACME CORP DEPOSIT,2500.00"]),
    file("bank-feb.csv", ["02/03/2026,CHECK 1042 LANDLORD,-310.00", "02/11/2026,OFFICE RENT,-900.00"]),
  ];
  const ledger = [
    file("ledger-jan.csv", ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/30/2026,CHECK 1042 LANDLORD,-310.00"]),
    file("ledger-feb.csv", ["02/01/2026,ACME CORP DEPOSIT,2500.00", "02/11/2026,OFFICE RENT,-900.00"]),
  ];

  it("pairs transactions whose two sides sit in different monthly files", () => {
    const b = combineFiles("bank", bank);
    const l = combineFiles("ledger", ledger);
    const result = reconcile(b.txns, l.txns);
    const byId = new Map([...b.txns, ...l.txns].map((t) => [t.id, t]));

    const pairs = result.matches.map((m) => ({
      bank: byId.get(m.bankTxnId)!,
      ledger: byId.get(m.ledgerTxnId)!,
    }));
    const cheque = pairs.find((p) => p.bank.description.startsWith("CHECK 1042"))!;
    expect(cheque.bank.sourceFile).toBe("bank-feb.csv");
    expect(cheque.ledger.sourceFile).toBe("ledger-jan.csv");
    const deposit = pairs.find((p) => p.bank.description.startsWith("ACME"))!;
    expect(deposit.bank.sourceFile).toBe("bank-jan.csv");
    expect(deposit.ledger.sourceFile).toBe("ledger-feb.csv");

    expect(result.matches).toHaveLength(4);
    expect(result.missingFromBooks).toEqual([]);
    expect(result.missingFromBank).toEqual([]);
    expect(result.balanceProof.unexplainedDifference).toBe(0);
  });

  it("matching per month in isolation would have stranded both — the full range is matched in one pass", () => {
    const janOnly = reconcile(combineFiles("bank", [bank[0]]).txns, combineFiles("ledger", [ledger[0]]).txns);
    expect(janOnly.missingFromBooks.length + janOnly.missingFromBank.length).toBe(2);
  });

  it("splitting one statement into monthly files does not change what the engine pairs", () => {
    const allBankRows = ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/31/2026,ACME CORP DEPOSIT,2500.00", "02/03/2026,CHECK 1042 LANDLORD,-310.00", "02/11/2026,OFFICE RENT,-900.00"];
    const allLedgerRows = ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/30/2026,CHECK 1042 LANDLORD,-310.00", "02/01/2026,ACME CORP DEPOSIT,2500.00", "02/11/2026,OFFICE RENT,-900.00"];
    const one = reconcile(
      combineFiles("bank", [file("bank.csv", allBankRows)]).txns,
      combineFiles("ledger", [file("ledger.csv", allLedgerRows)]).txns
    );
    const split = reconcile(combineFiles("bank", bank).txns, combineFiles("ledger", ledger).txns);
    const shape = (r: typeof one) =>
      r.matches.map((m) => [m.type, m.confidence, m.status, m.reasons]).sort();
    expect(shape(split)).toEqual(shape(one));
    expect(split.balanceProof).toEqual(one.balanceProof);
    expect(split.reconciled).toBe(one.reconciled);
  });
});

describe("sourceLabel", () => {
  it("formats file and row, and degrades gracefully for older saved data", () => {
    expect(sourceLabel({ sourceFile: "march.csv", sourceLine: 42 })).toBe("march.csv · row 42");
    expect(sourceLabel({ sourceLine: 42 })).toBe("row 42");
    expect(sourceLabel({ sourceFile: "march.csv" })).toBe("march.csv");
    expect(sourceLabel({})).toBeNull();
  });
});
