/**
 * Phase 4 — statement balance capture and verification.
 *   opening balance + net statement activity = closing balance
 * checked per uploaded bank file, from values the file itself states.
 * Separate from the matching engine (which is not used here at all,
 * except to show that set-asides don't change statement evidence).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { combineFiles, type ImportFileInput } from "@/lib/import/combine";
import { activeTxns, detectDuplicates, initialDuplicateState } from "@/lib/import/duplicates";
import { parseCsvDetailed } from "@/lib/parser";
import type { SourceFileInfo } from "@/lib/data/repository";
import type { Txn } from "@/lib/recon/types";
import {
  MONTH_STATEMENT_LABEL,
  STATEMENT_STATUS_LABEL,
  monthStatement,
  verifyStatements,
  type StatementCheck,
} from "@/lib/review/statements";
import { buildMonthReview } from "@/lib/review/months";
import { EMPTY_DUPLICATE_STATE } from "@/lib/import/duplicates";

const file = (name: string, lines: string[], headerRow = 1): ImportFileInput => ({
  name,
  content: lines.join("\n"),
  map: undefined as unknown as ImportFileInput["map"],
  headerRow,
});

function load(...files: ImportFileInput[]) {
  const c = combineFiles("bank", files);
  const sourceFiles: SourceFileInfo[] = c.files.map((f) => ({
    side: f.side,
    name: f.name,
    rows: f.rowCount,
    headerRow: f.headerRow,
    periodStart: f.coverage?.start ?? null,
    periodEnd: f.coverage?.end ?? null,
    statementStart: f.diagnostics.statementPeriod?.start ?? null,
    statementEnd: f.diagnostics.statementPeriod?.end ?? null,
    skippedRows: f.diagnostics.issueCount,
    invalidDateRows: f.diagnostics.invalidDateRows,
    statementOpening: f.diagnostics.statement.opening,
    statementClosing: f.diagnostics.statement.closing,
    statementAmbiguities: f.diagnostics.statement.ambiguities,
  }));
  return { rows: c.txns, sourceFiles, review: verifyStatements(c.txns, sourceFiles) };
}
const one = (...lines: string[]): StatementCheck => load(file("bank.csv", lines)).review.statements[0];

const AMT = "Date,Description,Amount";
const BAL = "Date,Description,Amount,Balance";

describe("capturing explicit opening and closing balances", () => {
  it("reads balance rows, keeps their line numbers, and does not treat them as transactions", () => {
    const { txns, diagnostics } = parseCsvDetailed(
      [AMT, "01/01/2026,Opening Balance,1000.00", "01/05/2026,COFFEE,-45.10", "01/20/2026,CLIENT,1200.00", "01/31/2026,Closing Balance,2154.90"].join("\n"),
      "bank"
    );
    expect(txns.map((t) => t.description)).toEqual(["COFFEE", "CLIENT"]);
    expect(diagnostics.statement.opening).toEqual({ cents: 100000, line: 2, origin: "balance-row" });
    expect(diagnostics.statement.closing).toEqual({ cents: 215490, line: 5, origin: "balance-row" });
    expect(diagnostics.statement.ambiguities).toEqual([]);
    expect(diagnostics.skippedBalanceRows).toBe(2);
  });

  it("reads the balance from the Balance column in a debit / credit layout (the existing fixtures)", () => {
    const csv = readFileSync(resolve(__dirname, "../../../../tests/fixtures/bank_statement.csv"), "utf8");
    const { txns, diagnostics } = parseCsvDetailed(csv, "bank");
    expect(diagnostics.statement.opening).toEqual({ cents: 482015, line: 2, origin: "balance-row" });
    expect(diagnostics.statement.hasBalanceColumn).toBe(true);
    expect(txns[0].runningBalance).toBe(481440); // printed on the row, not computed
  });

  it("reads balances stated in title lines above the header", () => {
    const { diagnostics } = parseCsvDetailed(
      ["First National Bank", "Statement period: 01/01/2026 - 01/31/2026", "Opening balance: $1000.00", "Closing balance,2154.90", AMT, "01/05/2026,COFFEE,-45.10", "01/20/2026,CLIENT,1200.00"].join("\n"),
      "bank",
      undefined,
      { headerRow: 5 }
    );
    expect(diagnostics.statement.opening).toEqual({ cents: 100000, line: 3, origin: "title-line" });
    expect(diagnostics.statement.closing).toEqual({ cents: 215490, line: 4, origin: "title-line" });
    expect(diagnostics.statementPeriod).toEqual({ start: "2026-01-01", end: "2026-01-31" });
  });

  it("never fabricates: no balance information → nothing captured", () => {
    const { diagnostics, txns } = parseCsvDetailed([AMT, "01/05/2026,COFFEE,-45.10"].join("\n"), "bank");
    expect(diagnostics.statement).toEqual({ opening: null, closing: null, hasBalanceColumn: false, unreadableBalanceCells: 0, ambiguities: [] });
    expect(txns[0].runningBalance).toBeUndefined();
  });

  it("an ordinary transaction that merely mentions 'balance' stays a transaction", () => {
    const { txns, diagnostics } = parseCsvDetailed(
      [AMT, "01/05/2026,BALANCE TRANSFER FEE,-15.00", "01/06/2026,Opening balance adjustment refund,20.00", "01/07/2026,Closing costs - balance due,-300.00"].join("\n"),
      "bank"
    );
    expect(txns).toHaveLength(3);
    expect(diagnostics.statement.opening).toBeNull();
    expect(diagnostics.statement.closing).toBeNull();
  });

  it("flags ambiguous balance information instead of picking one", () => {
    const two = parseCsvDetailed([AMT, "01/01/2026,Opening Balance,1000.00", "01/02/2026,Opening Balance,1200.00", "01/05/2026,X,-1.00"].join("\n"), "bank");
    expect(two.diagnostics.statement.ambiguities[0]).toMatch(/two different opening balances \(line 2 and line 3\)/);

    const both = parseCsvDetailed([BAL, "01/01/2026,Opening Balance,50.00,1000.00", "01/05/2026,X,-1.00,999.00"].join("\n"), "bank");
    expect(both.diagnostics.statement.ambiguities[0]).toMatch(/shows both an amount and a different balance/);

    const empty = parseCsvDetailed([AMT, "01/01/2026,Opening Balance,", "01/05/2026,X,-1.00"].join("\n"), "bank");
    expect(empty.diagnostics.statement.ambiguities[0]).toMatch(/has no readable balance/);

    // A thousands comma splits an unquoted title-line amount in two → not used, not guessed.
    const title = parseCsvDetailed(["Opening balance,$1,234.56", AMT, "01/05/2026,X,-1.00"].join("\n"), "bank", undefined, { headerRow: 2 });
    expect(title.diagnostics.statement.opening).toBeNull();
  });

  it("an unreadable running-balance cell is counted, not guessed", () => {
    const { txns, diagnostics } = parseCsvDetailed([BAL, "01/05/2026,X,-1.00,n/a", "01/06/2026,Y,-2.00,97.00"].join("\n"), "bank");
    expect(txns[0].runningBalance).toBeUndefined();
    expect(txns[1].runningBalance).toBe(9700);
    expect(diagnostics.statement.unreadableBalanceCells).toBe(1);
  });
});

describe("explicit opening and closing balances — the equation", () => {
  it("opening + net activity = closing → verified, with the figures it used", () => {
    const s = one(AMT, "01/01/2026,Opening Balance,1000.00", "01/05/2026,COFFEE,-45.10", "01/20/2026,CLIENT,1200.00", "01/31/2026,Closing Balance,2154.90");
    expect(s.status).toBe("verified");
    expect(STATEMENT_STATUS_LABEL[s.status]).toBe("Statement activity verified");
    expect(s).toMatchObject({ netActivity: 115490, difference: 0, convention: "standard", basis: ["stated-balances"], rowCount: 2 });
    expect(s.opening).toEqual({ cents: 100000, source: "stated", line: 2 });
    expect(s.closing).toEqual({ cents: 215490, source: "stated", line: 5 });
    expect(s.reasons[0]).toBe("Opening balance $1,000.00 plus the file's net activity of $1,154.90 equals the closing balance $2,154.90.");
  });

  it("uses whole cents — no floating-point drift", () => {
    const s = one(AMT, "01/01/2026,Opening Balance,0.10", "01/02/2026,A,0.20", "01/03/2026,B,0.70", "01/04/2026,C,-0.30", "01/31/2026,Closing Balance,0.70");
    expect(s.status).toBe("verified");
    expect(s.netActivity).toBe(60);
  });

  it("wrong closing balance → mismatch with the exact difference", () => {
    const s = one(AMT, "01/01/2026,Opening Balance,1000.00", "01/05/2026,COFFEE,-45.10", "01/31/2026,Closing Balance,900.00");
    expect(s.status).toBe("mismatch");
    expect(STATEMENT_STATUS_LABEL[s.status]).toBe("Statement balance mismatch");
    expect(s.difference).toBe(5490); // 954.90 expected − 900.00 stated
    expect(s.reasons[0]).toContain("gives $954.90, but the file states a closing balance of $900.00 — a difference of $54.90");
  });

  it("missing statement transactions show up as a mismatch equal to what is missing", () => {
    const full = [AMT, "01/01/2026,Opening Balance,1000.00", "01/05/2026,COFFEE,-45.10", "01/12/2026,RENT,-900.00", "01/20/2026,CLIENT,1200.00", "01/31/2026,Closing Balance,1254.90"];
    expect(one(...full).status).toBe("verified");
    const withoutRent = full.filter((l) => !l.includes("RENT"));
    const s = one(...withoutRent);
    expect(s.status).toBe("mismatch");
    expect(s.difference).toBe(90000); // exactly the missing $900.00
  });
});

describe("missing balances → insufficient, never invented", () => {
  it("no balances at all", () => {
    const s = one(AMT, "01/05/2026,COFFEE,-45.10", "01/20/2026,CLIENT,1200.00");
    expect(s.status).toBe("insufficient");
    expect(STATEMENT_STATUS_LABEL[s.status]).toBe("Insufficient statement information");
    expect(s.opening).toBeNull();
    expect(s.closing).toBeNull();
    expect(s.difference).toBeNull();
  });
  it("only an opening balance", () => {
    const s = one(AMT, "01/01/2026,Opening Balance,1000.00", "01/05/2026,COFFEE,-45.10");
    expect(s.status).toBe("insufficient");
    expect(s.reasons[0]).toMatch(/only an opening balance/);
    expect(s.closing).toBeNull(); // not calculated and presented as if stated
  });
  it("rows the reader skipped make the activity incomplete", () => {
    const s = one(AMT, "01/01/2026,Opening Balance,1000.00", "01/05/2026,COFFEE,-45.10", "01/09/2026,BROKEN,abc", "01/31/2026,Closing Balance,954.90");
    expect(s.status).toBe("insufficient");
    expect(s.reasons[0]).toMatch(/1 row in this file could not be read/);
  });
});

describe("negative balances", () => {
  it("an overdrawn account verifies like any other", () => {
    const s = one(AMT, "01/01/2026,Opening Balance,-500.00", "01/05/2026,FEE,-35.00", "01/20/2026,DEPOSIT,300.00", "01/31/2026,Closing Balance,(235.00)");
    expect(s.status).toBe("verified");
    expect(s.opening!.cents).toBe(-50000);
    expect(s.closing!.cents).toBe(-23500);
  });
  it("crossing zero in a running balance", () => {
    const s = one(BAL, "01/05/2026,FEE,-60.00,-10.00", "01/20/2026,DEPOSIT,300.00,290.00");
    expect(s.status).toBe("verified");
    expect(s.opening).toEqual({ cents: 5000, source: "calculated" });
  });
});

describe("debit / credit layouts and sign conventions", () => {
  it("debit and credit columns (money out in Debit) verify under the standard convention", () => {
    const s = one("Date,Description,Debit,Credit,Balance", "01/01/2026,OPENING BALANCE,,,1000.00", "01/05/2026,COFFEE,45.10,,954.90", "01/20/2026,CLIENT,,1200.00,2154.90");
    expect(s).toMatchObject({ status: "verified", convention: "standard", netActivity: 115490 });
    expect(s.basis).toEqual(["stated-balances", "running-balance"]);
  });

  it("a credit-card style file — balance is an amount owed — is recognised from its own running balance", () => {
    const s = one(BAL, "01/05/2026,RESTAURANT,-45.10,245.10", "01/12/2026,PAYMENT THANK YOU,100.00,145.10", "01/20/2026,FUEL,-60.00,205.10");
    expect(s).toMatchObject({ status: "verified", convention: "owed" });
    expect(s.opening).toEqual({ cents: 20000, source: "calculated" });
    expect(s.reasons[0]).toMatch(/balance rises when money goes out/);
  });

  it("stated balances only, amount-owed convention: verified and the convention is named", () => {
    const s = one(AMT, "01/01/2026,Opening Balance,200.00", "01/05/2026,RESTAURANT,-45.10", "01/31/2026,Closing Balance,245.10");
    expect(s).toMatchObject({ status: "verified", convention: "owed", difference: 0 });
    expect(s.reasons[0]).toMatch(/less the file's net activity/);
  });

  it("neither convention fits → mismatch (no convention is assumed to force a pass)", () => {
    const s = one(AMT, "01/01/2026,Opening Balance,200.00", "01/05/2026,RESTAURANT,-45.10", "01/31/2026,Closing Balance,300.00");
    expect(s.status).toBe("mismatch");
    expect(s.convention).toBe("unknown");
  });
});

describe("running-balance formats", () => {
  const rows = ["01/05/2026,COFFEE,-45.10,954.90", "01/12/2026,RENT,-900.00,54.90", "01/20/2026,CLIENT,1200.00,1254.90"];

  it("oldest-first", () => {
    const s = one(BAL, ...rows);
    expect(s).toMatchObject({ status: "verified", basis: ["running-balance"], convention: "standard", difference: 0 });
    expect(s.opening).toEqual({ cents: 100000, source: "calculated" }); // labelled as calculated, not stated
    expect(s.closing).toEqual({ cents: 125490, source: "running", line: 4 });
    expect(s.reasons[0]).toMatch(/does not state an opening balance; the one shown is calculated from the first row/);
  });

  it("newest-first (many banks export this way)", () => {
    const s = one(BAL, ...[...rows].reverse());
    expect(s.status).toBe("verified");
    expect(s.opening!.cents).toBe(100000);
    expect(s.closing).toEqual({ cents: 125490, source: "running", line: 2 });
  });

  it("formatted balances ($, thousands separators, parentheses)", () => {
    const s = one(BAL, '01/05/2026,COFFEE,-45.10,"$1,954.90"', '01/12/2026,RENT,"-2,900.00",($945.10)');
    expect(s.status).toBe("verified");
    expect(s.closing!.cents).toBe(-94510);
  });

  it("a row missing from the middle breaks the chain: mismatch, with the row and the gap", () => {
    const s = one(BAL, rows[0], rows[2]);
    expect(s.status).toBe("mismatch");
    expect(s.difference).toBe(90000);
    expect(s.reasons[0]).toContain("row 3");
    expect(s.reasons[0]).toContain("a difference of $900.00");
    expect(s.reasons[0]).toMatch(/A transaction may be missing from the file/);
  });

  it("a stated opening balance that the running balance contradicts → mismatch", () => {
    const s = one(BAL, "01/01/2026,Opening Balance,,1500.00", ...rows);
    expect(s.status).toBe("mismatch");
    expect(s.difference).toBe(50000);
    expect(s.reasons[0]).toMatch(/Transactions at the start of the period may be missing/);
  });

  it("a stated closing balance that the last running balance contradicts → mismatch", () => {
    const s = one(BAL, ...rows, "01/31/2026,Closing Balance,,1300.00");
    expect(s.status).toBe("mismatch");
    expect(s.difference).toBe(-4510);
  });

  it("running balance on only some rows is not used", () => {
    const s = one(BAL, rows[0], "01/12/2026,RENT,-900.00,", rows[2]);
    expect(s.status).toBe("insufficient");
    expect(s.reasons.join(" ")).toMatch(/Only 2 of 3 rows show a running balance/);
  });

  it("a single row cannot be cross-checked", () => {
    expect(one(BAL, rows[0]).status).toBe("insufficient");
  });
});

describe("conflicting statement evidence", () => {
  const jan = (name: string, opening: string, closing: string) =>
    file(name, ["Statement period: 01/01/2026 - 01/31/2026", AMT, `01/01/2026,Opening Balance,${opening}`, "01/05/2026,COFFEE,-45.10", `01/31/2026,Closing Balance,${closing}`], 2);

  it("ambiguous balance information in a file → flagged, not used", () => {
    const s = one(AMT, "01/01/2026,Opening Balance,1000.00", "01/02/2026,Opening Balance,1200.00", "01/05/2026,X,-1.00", "01/31/2026,Closing Balance,999.00");
    expect(s.status).toBe("conflict");
    expect(STATEMENT_STATUS_LABEL[s.status]).toBe("Conflicting statement evidence");
    expect(s.reasons[0]).toMatch(/balance information is unclear, so it was not used/);
  });

  it("two files stating the same period with different balances", () => {
    const { review } = load(jan("a.csv", "1000.00", "954.90"), jan("b.csv", "1100.00", "1054.90"));
    expect(review.statements.map((s) => s.status)).toEqual(["conflict", "conflict"]);
    const reasons = review.statements[0].reasons.join(" ");
    expect(reasons).toContain("state the same period but different opening balances ($1,000.00 and $1,100.00)");
    expect(reasons).toContain("different closing balances ($954.90 and $1,054.90)");
    expect(review.counts.conflict).toBe(2);
  });

  it("back-to-back statements whose closing and opening balances disagree", () => {
    const feb = file("feb.csv", ["Statement period: 02/01/2026 - 02/28/2026", AMT, "02/01/2026,Opening Balance,1000.00", "02/05/2026,COFFEE,-10.00", "02/28/2026,Closing Balance,990.00"], 2);
    const { review } = load(jan("jan.csv", "1000.00", "954.90"), feb);
    expect(review.statements.map((s) => s.status)).toEqual(["conflict", "conflict"]);
    expect(review.statements[1].reasons[0]).toContain('"jan.csv" closes at $954.90 but "feb.csv", which starts the next day, opens at $1,000.00 — a difference of $45.10');
  });

  it("back-to-back statements that carry forward correctly are both verified", () => {
    const feb = file("feb.csv", ["Statement period: 02/01/2026 - 02/28/2026", AMT, "02/01/2026,Opening Balance,954.90", "02/05/2026,COFFEE,-10.00", "02/28/2026,Closing Balance,944.90"], 2);
    const { review } = load(jan("jan.csv", "1000.00", "954.90"), feb);
    expect(review.statements.map((s) => s.status)).toEqual(["verified", "verified"]);
  });

  it("overlapping files that disagree about the balance on the same day", () => {
    const a = file("a.csv", [BAL, "01/05/2026,COFFEE,-45.10,954.90", "01/20/2026,CLIENT,1200.00,2154.90"]);
    const b = file("b.csv", [BAL, "01/20/2026,CLIENT,1200.00,2254.90", "01/25/2026,FUEL,-60.00,2194.90"]);
    const { review } = load(a, b);
    expect(review.statements.map((s) => s.status)).toEqual(["conflict", "conflict"]);
    expect(review.statements[0].reasons[0]).toContain("on Jan 20, 2026 one shows a balance of $2,154.90 and the other $2,254.90");
  });
});

describe("overlapping statement periods", () => {
  it("are reported; each file is still checked against its own balances", () => {
    const a = file("jan.csv", [BAL, "01/05/2026,COFFEE,-45.10,954.90", "01/20/2026,CLIENT,1200.00,2154.90"]);
    const b = file("jan20-feb.csv", [BAL, "01/20/2026,CLIENT,1200.00,2154.90", "02/03/2026,RENT,-900.00,1254.90"]);
    const { review } = load(a, b);
    expect(review.overlaps).toEqual([{ fileA: "jan.csv", fileB: "jan20-feb.csv", start: "2026-01-20", end: "2026-01-20" }]);
    expect(review.statements.map((s) => s.status)).toEqual(["verified", "verified"]);
  });
});

describe("multiple accounts are never combined", () => {
  const H = "Account,Date,Description,Amount,Balance";
  it("a file mixing two accounts is not checked", () => {
    const s = one(H, "****1111,01/05/2026,A,-10.00,90.00", "****2222,01/06/2026,B,-5.00,495.00");
    expect(s.status).toBe("insufficient");
    expect(s.account).toBeNull();
    expect(s.reasons[0]).toMatch(/rows for 2 different accounts/);
  });
  it("files for different accounts are each verified and never compared with each other", () => {
    const a = file("checking.csv", [H, "****1111,01/05/2026,A,-10.00,90.00", "****1111,01/20/2026,B,-5.00,85.00"]);
    const b = file("savings.csv", [H, "****2222,01/05/2026,A,-10.00,4990.00", "****2222,01/20/2026,B,-5.00,4985.00"]);
    const { review } = load(a, b);
    expect(review.statements.map((s) => [s.account, s.status])).toEqual([["****1111", "verified"], ["****2222", "verified"]]);
    expect(review.overlaps).toEqual([]); // same dates, different accounts → not even an overlap
  });
});

describe("partial-month and cross-year statements — the month view never overstates", () => {
  const stated = (name: string, from: string, to: string, rows: string[], open: string, close: string) =>
    file(name, [`Statement period: ${from} - ${to}`, AMT, `${from},Opening Balance,${open}`, ...rows, `${to},Closing Balance,${close}`], 2);

  it("a verified file with NO stated period proves only first-row to last-row", () => {
    const { review } = load(file("bank.csv", [BAL, "01/05/2026,COFFEE,-45.10,954.90", "01/20/2026,CLIENT,1200.00,2154.90"]));
    const m = monthStatement(review, "2026-01");
    expect(m.status).toBe("partly-verified");
    expect(m.label).toBe("Statement activity verified for part of the month");
    expect(m.detail).toContain("Jan 5, 2026 to Jan 20, 2026");
    expect(m.detail).toContain("the file states no period");
  });

  it("a verified statement stating the whole month → the month is verified", () => {
    const { review } = load(stated("jan.csv", "01/01/2026", "01/31/2026", ["01/05/2026,COFFEE,-45.10"], "1000.00", "954.90"));
    expect(monthStatement(review, "2026-01").status).toBe("verified");
    expect(monthStatement(review, "2026-02").status).toBe("insufficient");
  });

  it("a statement running mid-month to mid-month verifies part of each month only", () => {
    const { review } = load(stated("cycle.csv", "01/10/2026", "02/09/2026", ["01/15/2026,COFFEE,-45.10", "02/03/2026,RENT,-900.00"], "1000.00", "54.90"));
    expect(review.statements[0].status).toBe("verified");
    expect(monthStatement(review, "2026-01").status).toBe("partly-verified");
    expect(monthStatement(review, "2026-01").detail).toContain("Jan 10, 2026 to Jan 31, 2026");
    expect(monthStatement(review, "2026-02").status).toBe("partly-verified");
    expect(monthStatement(review, "2026-02").detail).toContain("Feb 1, 2026 to Feb 9, 2026");
  });

  it("two cycles that together cover a month → that month is verified", () => {
    const { review } = load(
      stated("c1.csv", "12/15/2025", "01/14/2026", ["12/20/2025,A,-10.00", "01/05/2026,B,-20.00"], "500.00", "470.00"),
      stated("c2.csv", "01/15/2026", "02/14/2026", ["01/20/2026,C,-30.00"], "470.00", "440.00")
    );
    expect(review.statements.map((s) => s.status)).toEqual(["verified", "verified"]);
    expect(monthStatement(review, "2026-01").status).toBe("verified");
    // December and February are only partly covered.
    expect(monthStatement(review, "2025-12").status).toBe("partly-verified");
    expect(monthStatement(review, "2025-12").detail).toContain("Dec 15, 2025 to Dec 31, 2025");
    expect(monthStatement(review, "2026-02").status).toBe("partly-verified");
  });

  it("a statement crossing the year boundary verifies with the right net activity", () => {
    const { review } = load(stated("c1.csv", "12/15/2025", "01/14/2026", ["12/31/2025,A,-10.00", "01/01/2026,B,-20.00"], "500.00", "470.00"));
    expect(review.statements[0]).toMatchObject({ status: "verified", netActivity: -3000 });
    expect(review.statements[0].statedPeriod).toEqual({ start: "2025-12-15", end: "2026-01-14" });
  });

  it("mismatch and conflict outrank a partial verification for the month", () => {
    const bad = stated("jan.csv", "01/01/2026", "01/31/2026", ["01/05/2026,COFFEE,-45.10"], "1000.00", "900.00");
    expect(monthStatement(load(bad).review, "2026-01").status).toBe("mismatch");
  });

  it("month labels never say reconciled", () => {
    for (const label of [...Object.values(MONTH_STATEMENT_LABEL), ...Object.values(STATEMENT_STATUS_LABEL)]) {
      expect(label).not.toMatch(/reconciled/i);
    }
  });
});

describe("duplicate set-asides do not change statement evidence", () => {
  const H = "Transaction ID,Date,Description,Amount,Balance";
  const jan = file("jan.csv", [H, "TX1,01/05/2026,COFFEE,-45.10,954.90", "TX2,01/20/2026,CLIENT,1200.00,2154.90"]);
  const q1 = file("q1.csv", [H, "TX1,01/05/2026,COFFEE,-45.10,954.90", "TX2,01/20/2026,CLIENT,1200.00,2154.90", "TX3,02/03/2026,RENT,-900.00,1254.90"]);

  it("both files stay verified on ALL their rows although two rows are set aside for the reconciliation", () => {
    const { rows, sourceFiles, review } = load(jan, q1);
    const state = initialDuplicateState(detectDuplicates("bank", rows), "t");
    expect(state.setAside).toHaveLength(2); // transaction counts change…
    expect(activeTxns(rows, state)).toHaveLength(3);
    expect(review.statements.map((s) => [s.file, s.status, s.rowCount])).toEqual([
      ["jan.csv", "verified", 2],
      ["q1.csv", "verified", 3], // …the statement evidence does not
    ]);
    // Had the check used only the rows in use, one statement would have lost its rows.
    const fromActive = verifyStatements(activeTxns(rows, state), sourceFiles);
    expect(fromActive.statements.map((s) => s.rowCount)).not.toEqual([2, 3]);
  });
});

describe("monthly verification summaries", () => {
  it("each month carries a statement result, separate from its matching findings", () => {
    const { rows, sourceFiles, review } = load(
      file("jan.csv", ["Statement period: 01/01/2026 - 01/31/2026", AMT, "01/01/2026,Opening Balance,1000.00", "01/05/2026,COFFEE,-45.10", "01/31/2026,Closing Balance,954.90"], 2),
      file("feb.csv", ["Statement period: 02/01/2026 - 02/28/2026", AMT, "02/01/2026,Opening Balance,954.90", "02/05/2026,RENT,-900.00", "02/28/2026,Closing Balance,100.00"], 2)
    );
    const ledger: Txn[] = [
      { id: "ledger-0", source: "ledger", date: "2026-01-05", description: "COFFEE", amount: -4510, raw: {} },
      { id: "ledger-1", source: "ledger", date: "2026-02-05", description: "RENT", amount: -90000, raw: {} },
    ];
    const months = buildMonthReview({
      imported: { bank: rows, ledger },
      bankTxns: rows,
      ledgerTxns: ledger,
      matches: rows.map((b, i) => ({ id: `${b.id}:ledger-${i}`, bankTxnId: b.id, ledgerTxnId: `ledger-${i}`, type: "exact" as const, confidence: 100, status: "accepted" as const, reasons: [] })),
      compositeMatches: [],
      addedBankIds: new Set(),
      acknowledgedLedgerIds: new Set(),
      duplicateGroups: [],
      duplicateState: EMPTY_DUPLICATE_STATE,
      sourceFiles,
      statementReview: review,
    });
    const [jan, feb] = months.months;
    // Matching found nothing unresolved in either month…
    expect([jan.status, feb.status]).toEqual(["no-unresolved-items", "no-unresolved-items"]);
    // …but the statement check, reported on its own, differs.
    expect(jan.statement.status).toBe("verified");
    expect(feb.statement.status).toBe("mismatch");
    expect(feb.statement.statements[0].difference).toBe(-4510);
    expect(months.overview.statements).toEqual({ verified: 1, mismatch: 1, insufficient: 0, conflict: 0 });
    expect(months.coverage.findings[0].kind).toBe("statement-balances");
    expect(months.coverage.findings[0].text).toContain("1 verified, 1 with a mismatch");
    expect(months.coverage.verified).toBe(false);
  });

  it("single-month data still gets its coverage notes and statement result", () => {
    const { rows, sourceFiles, review } = load(file("bank.csv", [AMT, "03/05/2026,COFFEE,-45.10", "03/09/2026,BROKEN,abc"]));
    const months = buildMonthReview({
      imported: { bank: rows, ledger: [] },
      bankTxns: rows, ledgerTxns: [], matches: [], compositeMatches: [],
      addedBankIds: new Set(), acknowledgedLedgerIds: new Set(),
      duplicateGroups: [], duplicateState: EMPTY_DUPLICATE_STATE,
      sourceFiles, statementReview: review,
    });
    expect(months.months).toHaveLength(1);
    expect(months.months[0].statement.status).toBe("insufficient");
    expect(months.coverage.findings.map((f) => f.kind)).toEqual(["balances-not-provided", "skipped-rows", "one-sided-month"]);
    expect(months.months[0].notes[0]).toBe("March 2026: the uploaded bank files have rows dated in this month, but the records files have none.");
  });
});

describe("legacy saved reconciliations", () => {
  it("no source files and no captured balances → no statements, nothing invented", () => {
    const rows: Txn[] = [{ id: "bank-0", source: "bank", date: "2026-01-05", description: "COFFEE", amount: -4510, raw: {} }];
    const review = verifyStatements(rows, undefined);
    expect(review.statements).toEqual([]);
    expect(review.counts).toEqual({ verified: 0, mismatch: 0, insufficient: 0, conflict: 0 });
    expect(monthStatement(review, "2026-01")).toMatchObject({ status: "insufficient", statements: [] });
  });
  it("a Phase 1–3 record (files known, balances never captured) → insufficient", () => {
    const rows: Txn[] = [{ id: "bank-0", source: "bank", date: "2026-01-05", description: "COFFEE", amount: -4510, raw: {}, sourceFile: "old.csv", sourceLine: 2 }];
    const review = verifyStatements(rows, [{ side: "bank", name: "old.csv", rows: 1, headerRow: 1, periodStart: "2026-01-05", periodEnd: "2026-01-05" }]);
    expect(review.statements[0].status).toBe("insufficient");
  });
});

describe("architecture", () => {
  it("statement verification does not import the matching engine", () => {
    const src = readFileSync(resolve(__dirname, "../statements.ts"), "utf8");
    expect(src).not.toMatch(/recon\/engine/);
    expect(src).not.toMatch(/\breconcile\(/);
    expect(src).not.toMatch(/parseFloat|toFixed/); // integer cents only
  });
});

describe("a month fully covered by a verified statement, plus another bank file that could not be checked", () => {
  it("is 'verified for part of the month' and says exactly which file is verified and which is not", () => {
    const { review } = load(
      file("stmt-jan.csv", ["Statement period: 01/01/2026 - 01/31/2026", AMT, "01/01/2026,Opening Balance,1000.00", "01/05/2026,COFFEE,-45.10", "01/31/2026,Closing Balance,954.90"], 2),
      file("extra-jan.csv", [AMT, "01/20/2026,CLIENT,1200.00", "01/28/2026,PARKING,-8.00"])
    );
    const m = monthStatement(review, "2026-01");
    expect(m.status).toBe("partly-verified");
    expect(m.detail).toBe(
      'Verified: "stmt-jan.csv". Not checked: "extra-jan.csv" (not enough balance information), so some of this month\'s bank rows are not covered by a verified statement.'
    );
  });
});
