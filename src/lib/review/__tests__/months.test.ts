/**
 * Phase 3 — month-by-month findings.
 * The engine runs ONCE over the full range (unchanged); these tests check
 * the grouping that happens afterwards and the counting rules documented
 * at the top of lib/review/months.ts.
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
  importCounts,
  initialDuplicateState,
  restoreRows,
  setAsideRows,
  type DuplicateState,
} from "@/lib/import/duplicates";
import { reconcile } from "@/lib/recon/engine";
import { applyCompositeDecision, applyMatchDecision, restoreComposites, restoreMatches } from "@/lib/recon/decisions";
import { buildDashboardData } from "@/lib/recon/adapter";
import { parseCsv, parseCsvDetailed } from "@/lib/parser";
import type { SourceFileInfo } from "@/lib/data/repository";
import type { AnyCompositeMatch, Match, Txn } from "@/lib/recon/types";
import { MONTH_STATUS_LABEL, buildMonthReview, type MonthReview } from "@/lib/review/months";

const AT = "2026-11-09T12:00:00.000Z";
const PLAIN = "Date,Description,Amount";
const IDS = "Transaction ID,Date,Description,Amount";
const file = (name: string, header: string, rows: string[], titles: string[] = []): ImportFileInput => ({
  name,
  content: [...titles, header, ...rows].join("\n"),
  map: undefined as unknown as ImportFileInput["map"],
  headerRow: titles.length + 1,
});

type Session = {
  allBank: Txn[];
  allLedger: Txn[];
  sourceFiles: SourceFileInfo[];
  groups: ReturnType<typeof detectDuplicates>;
  state: DuplicateState;
  bank: Txn[];
  ledger: Txn[];
  matches: Match[];
  composites: AnyCompositeMatch[];
  added: Set<string>;
  acknowledged: Set<string>;
};

/** Same pipeline as the app: import → duplicate review → ONE engine run. */
function start(bankFiles: ImportFileInput[], ledgerFiles: ImportFileInput[]): Session {
  const b = combineFiles("bank", bankFiles);
  const l = combineFiles("ledger", ledgerFiles);
  const sourceFiles: SourceFileInfo[] = [...b.files, ...l.files].map((f) => ({
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
  }));
  const groups = [...detectDuplicates("bank", b.txns), ...detectDuplicates("ledger", l.txns)];
  return rerun({
    allBank: b.txns, allLedger: l.txns, sourceFiles, groups,
    state: initialDuplicateState(groups, AT),
    bank: [], ledger: [], matches: [], composites: [], added: new Set(), acknowledged: new Set(),
  });
}

/** Re-run the engine on the rows in use, keeping earlier decisions (as the app does). */
function rerun(s: Session, state: DuplicateState = s.state): Session {
  const bank = activeTxns(s.allBank, state);
  const ledger = activeTxns(s.allLedger, state);
  const r = reconcile(bank, ledger);
  return {
    ...s, state, bank, ledger,
    matches: restoreMatches(r.matches, s.matches),
    composites: restoreComposites(r.compositeMatches, s.composites),
  };
}

const review = (s: Session): MonthReview =>
  buildMonthReview({
    imported: { bank: s.allBank, ledger: s.allLedger },
    bankTxns: s.bank,
    ledgerTxns: s.ledger,
    matches: s.matches,
    compositeMatches: s.composites,
    addedBankIds: s.added,
    acknowledgedLedgerIds: s.acknowledged,
    duplicateGroups: s.groups,
    duplicateState: s.state,
    sourceFiles: s.sourceFiles,
  });

const month = (r: MonthReview, key: string) => r.months.find((m) => m.month === key)!;
const sum = (r: MonthReview, pick: (m: MonthReview["months"][number]) => number) =>
  r.months.reduce((a, m) => a + pick(m), 0);

/** The invariant behind every screen: months add up to the overall result. */
function expectConservation(s: Session) {
  const r = review(s);
  const engine = reconcile(s.bank, s.ledger);
  const view = buildDashboardData(
    s.matches, s.composites, s.bank, s.ledger,
    engine.missingFromBooks, engine.missingFromBank, s.added, s.acknowledged
  );
  const bankImport = importCounts(s.allBank, s.state);
  const ledgerImport = importCounts(s.allLedger, s.state);

  // Rule 2 — rows.
  expect(sum(r, (m) => m.bank.imported)).toBe(bankImport.imported);
  expect(sum(r, (m) => m.bank.setAside)).toBe(bankImport.setAside);
  expect(sum(r, (m) => m.bank.inUse)).toBe(bankImport.inUse);
  expect(sum(r, (m) => m.ledger.imported)).toBe(ledgerImport.imported);
  expect(sum(r, (m) => m.ledger.setAside)).toBe(ledgerImport.setAside);
  expect(sum(r, (m) => m.ledger.inUse)).toBe(ledgerImport.inUse);
  for (const m of r.months) {
    for (const c of [m.bank, m.ledger]) {
      expect(c.imported).toBe(c.setAside + c.inUse);
      expect(c.inUse).toBe(c.matched + c.awaitingReview + c.unmatched + c.handled);
    }
  }
  // Rule 3 — matches counted once; equal to what the dashboard shows.
  expect(sum(r, (m) => m.confirmedMatches)).toBe(view.counts.matched);
  expect(sum(r, (m) => m.awaitingReviewMatches)).toBe(view.counts.review);
  expect(sum(r, (m) => m.bank.unmatched)).toBe(view.counts.missingFromBooks);
  expect(sum(r, (m) => m.ledger.unmatched)).toBe(view.counts.missingFromBank);
  expect(r.overview.confirmedMatches).toBe(view.counts.matched);
  expect(r.overview.unmatchedTransactions).toBe(view.counts.missingFromBooks + view.counts.missingFromBank);
  // Rule 5 — amounts counted once, in their own month.
  expect(sum(r, (m) => m.bank.net)).toBe(engine.balanceProof.bankNetChange);
  expect(sum(r, (m) => m.ledger.net)).toBe(engine.balanceProof.ledgerNetChange);
  expect(sum(r, (m) => m.bank.net) - sum(r, (m) => m.ledger.net)).toBe(engine.balanceProof.unexplainedDifference);
  return r;
}

// ---- Scenarios ----------------------------------------------------------

/** Jan–Feb with a cheque and a deposit that each cross the month end, and a fee the books lack. */
const crossMonth = () =>
  start(
    [
      file("bank-jan.csv", PLAIN, ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/31/2026,ACME CORP DEPOSIT,2500.00"]),
      file("bank-feb.csv", PLAIN, ["02/03/2026,CHECK 1042 LANDLORD,-310.00", "02/11/2026,OFFICE RENT,-900.00", "02/27/2026,MONTHLY SERVICE FEE,-12.00"]),
    ],
    [file("ledger.csv", PLAIN, [
      "01/05/2026,COFFEE SUPPLY CO,-45.10",
      "01/30/2026,CHECK 1042 LANDLORD,-310.00",
      "02/01/2026,ACME CORP DEPOSIT,2500.00",
      "02/11/2026,OFFICE RENT,-900.00",
    ])]
  );

describe("single-month reconciliation", () => {
  const s = start(
    [file("bank.csv", PLAIN, ["03/05/2026,COFFEE,-45.10", "03/20/2026,FEE,-12.00"])],
    [file("ledger.csv", PLAIN, ["03/05/2026,COFFEE,-45.10"])]
  );
  it("produces exactly one month that equals the overall result", () => {
    const r = expectConservation(s);
    expect(r.months.map((m) => m.month)).toEqual(["2026-03"]);
    expect(r.rangeLabel).toBe("March 2026");
    expect(r.overview).toMatchObject({ monthsAnalyzed: 1, monthsWithFindings: 1, unmatchedTransactions: 1, crossMonthMatches: 0 });
    expect(month(r, "2026-03").bank).toMatchObject({ imported: 2, inUse: 2, matched: 1, unmatched: 1, unmatchedAmount: -1200 });
  });
});

describe("multiple months in one upload (one file per side)", () => {
  const s = start(
    [file("bank.csv", PLAIN, ["01/05/2026,COFFEE,-45.10", "02/05/2026,COFFEE,-46.00", "03/05/2026,COFFEE,-47.00", "03/20/2026,FEE,-12.00"])],
    [file("ledger.csv", PLAIN, ["01/05/2026,COFFEE,-45.10", "02/05/2026,COFFEE,-46.00", "03/05/2026,COFFEE,-47.00"])]
  );
  it("groups by each row's own month", () => {
    const r = expectConservation(s);
    expect(r.months.map((m) => [m.month, m.label, m.status])).toEqual([
      ["2026-01", "January 2026", "no-unresolved-items"],
      ["2026-02", "February 2026", "no-unresolved-items"],
      ["2026-03", "March 2026", "review-needed"],
    ]);
    expect(r.rangeLabel).toBe("January to March 2026");
    expect(r.overview).toMatchObject({ monthsAnalyzed: 3, monthsWithFindings: 1, unmatchedTransactions: 1, confirmedMatches: 3 });
    expect(month(r, "2026-03").details.unmatchedBank.map((t) => t.description)).toEqual(["FEE"]);
  });
});

describe("multiple CSV files per side", () => {
  it("each month lists the files that contributed rows, with counts", () => {
    const r = expectConservation(crossMonth());
    expect(month(r, "2026-01").details.files).toEqual([
      { side: "bank", name: "bank-jan.csv", rows: 2 },
      { side: "ledger", name: "ledger.csv", rows: 2 },
    ]);
    expect(month(r, "2026-02").details.files).toEqual([
      { side: "bank", name: "bank-feb.csv", rows: 3 },
      { side: "ledger", name: "ledger.csv", rows: 2 },
    ]);
  });
  it("unmatched rows keep their provenance for the month view", () => {
    const fee = month(review(crossMonth()), "2026-02").details.unmatchedBank[0];
    expect([fee.description, fee.sourceFile, fee.sourceLine]).toEqual(["MONTHLY SERVICE FEE", "bank-feb.csv", 4]);
  });
});

describe("cross-month matches", () => {
  it("a cheque written in January that clears in February is ONE item, counted in the bank row's month", () => {
    const s = crossMonth();
    const r = expectConservation(s);
    const jan = month(r, "2026-01");
    const feb = month(r, "2026-02");
    // Two suggestions cross the boundary: the deposit (bank Jan 31 / books Feb 1)
    // and the cheque (bank Feb 3 / books Jan 30).
    expect(r.overview.awaitingReviewMatches).toBe(2);
    expect(r.overview.crossMonthMatches).toBe(2);
    expect([jan.awaitingReviewMatches, feb.awaitingReviewMatches]).toEqual([1, 1]); // each counted once
    // Each month SHOWS both, because both touch it — an "involves" count.
    expect([jan.crossMonthMatches, feb.crossMonthMatches]).toEqual([2, 2]);
    expect(jan.details.crossMonth.map((m) => m.months)).toEqual([["2026-01", "2026-02"], ["2026-01", "2026-02"]]);
    // Row states follow each row's OWN date.
    expect(jan.ledger).toMatchObject({ inUse: 2, matched: 1, awaitingReview: 1, unmatched: 0 }); // cheque logged Jan 30
    expect(feb.bank).toMatchObject({ inUse: 3, matched: 1, awaitingReview: 1, unmatched: 1 });   // cheque cleared Feb 3 + fee
  });

  it("matching per month would have stranded them; the full-range pass does not", () => {
    const s = crossMonth();
    const janOnly = reconcile(s.bank.filter((t) => t.date < "2026-02"), s.ledger.filter((t) => t.date < "2026-02"));
    expect(janOnly.missingFromBooks.length + janOnly.missingFromBank.length).toBe(2);
    const r = review(s);
    expect(month(r, "2026-01").bank.unmatched + month(r, "2026-01").ledger.unmatched).toBe(0);
  });

  it("after the user confirms them they are confirmed matches, still counted once and still flagged cross-month", () => {
    let s = crossMonth();
    for (const m of s.matches.filter((x) => x.status === "suggested")) {
      s = { ...s, matches: applyMatchDecision(s.matches, m.id, "accept") };
    }
    const r = expectConservation(s);
    expect(r.overview).toMatchObject({ confirmedMatches: 4, awaitingReviewMatches: 0, crossMonthMatches: 2 });
    expect(month(r, "2026-01").confirmedMatches + month(r, "2026-02").confirmedMatches).toBe(4);
    expect(month(r, "2026-01").status).toBe("no-unresolved-items");
    expect(month(r, "2026-02").status).toBe("review-needed"); // the fee
  });

  it("no amount is counted in two months", () => {
    const r = review(crossMonth());
    expect(month(r, "2026-01").bank.net).toBe(-4510 + 250000);
    expect(month(r, "2026-01").ledger.net).toBe(-4510 - 31000);
    expect(month(r, "2026-02").bank.net).toBe(-31000 - 90000 - 1200);
    expect(month(r, "2026-02").ledger.net).toBe(250000 - 90000);
  });
});

describe("composite (grouped) matches spanning months", () => {
  // One February deposit made up of two January invoices.
  const s0 = () =>
    start(
      [file("bank.csv", PLAIN, ["01/10/2026,RENT,-900.00", "02/02/2026,STRIPE PAYOUT,100.00"])],
      [file("ledger.csv", PLAIN, ["01/10/2026,RENT,-900.00", "01/30/2026,Invoice 101 Acme,60.00", "01/31/2026,Invoice 102 Birch,40.00"])]
    );

  it("fixture sanity: the engine proposes one grouped match across the month end", () => {
    const s = s0();
    expect(s.composites).toHaveLength(1);
    expect(s.composites[0].status).toBe("suggested");
  });

  it("pending: one item in February (the bank row's month); its January parts are 'awaiting review', not unmatched", () => {
    const r = expectConservation(s0());
    const jan = month(r, "2026-01");
    const feb = month(r, "2026-02");
    expect([jan.awaitingReviewMatches, feb.awaitingReviewMatches]).toEqual([0, 1]);
    expect(jan.ledger).toMatchObject({ inUse: 3, matched: 1, awaitingReview: 2, unmatched: 0 });
    expect(feb.bank).toMatchObject({ inUse: 1, awaitingReview: 1 });
    expect(feb.ledger.imported).toBe(0);
    expect([jan.crossMonthMatches, feb.crossMonthMatches]).toEqual([1, 1]);
    expect(r.overview.crossMonthMatches).toBe(1); // ONE match, not three rows
    const m = feb.details.awaitingReview[0];
    expect([m.kind, m.ledger.length, m.months]).toEqual(["group", 2, ["2026-01", "2026-02"]]);
  });

  it("accepted: one confirmed match, parts matched in January, nothing double-counted", () => {
    let s = s0();
    s = { ...s, composites: applyCompositeDecision(s.composites, s.composites[0].id, "accept") };
    const r = expectConservation(s);
    expect(r.overview).toMatchObject({ confirmedMatches: 2, awaitingReviewMatches: 0, unmatchedTransactions: 0, crossMonthMatches: 1 });
    expect(month(r, "2026-01").ledger.matched).toBe(3);
    expect(month(r, "2026-02").confirmedMatches).toBe(1);
  });

  it("rejected: the bank row is unmatched in February and the parts are unmatched in January", () => {
    let s = s0();
    s = { ...s, composites: applyCompositeDecision(s.composites, s.composites[0].id, "reject") };
    const r = expectConservation(s);
    expect(month(r, "2026-02").bank.unmatched).toBe(1);
    expect(month(r, "2026-01").ledger.unmatched).toBe(2);
    expect(r.overview.crossMonthMatches).toBe(0);
  });
});

describe("duplicate rows across monthly exports", () => {
  const overlap = (header: string, ids: boolean) => {
    const row = (id: string, body: string) => (ids ? `${id},${body}` : body);
    return start(
      [
        file("bank-jan.csv", header, [row("TX1", "01/05/2026,COFFEE,-45.10"), row("TX2", "01/31/2026,DEPOSIT,2500.00")]),
        file("bank-jan31-feb.csv", header, [row("TX2", "01/31/2026,DEPOSIT,2500.00"), row("TX3", "02/11/2026,RENT,-900.00")]),
      ],
      [file("ledger.csv", PLAIN, ["01/05/2026,COFFEE,-45.10", "01/31/2026,DEPOSIT,2500.00", "02/11/2026,RENT,-900.00"])]
    );
  };

  it("automatic set-aside is counted in the month of the row's date; that month's in-use rows exclude it", () => {
    const r = expectConservation(overlap(IDS, true));
    const jan = month(r, "2026-01");
    expect(jan.bank).toMatchObject({ imported: 3, setAside: 1, inUse: 2, matched: 2, unmatched: 0 });
    expect(jan.details.setAside.map((t) => [t.sourceFile, t.sourceLine])).toEqual([["bank-jan31-feb.csv", 2]]);
    expect(month(r, "2026-02").bank).toMatchObject({ imported: 1, setAside: 0, inUse: 1 });
    expect(r.overview.duplicateGroupsToReview).toBe(0);
    expect(r.months.every((m) => m.status === "no-unresolved-items")).toBe(true);
  });

  it("restoring the row changes that month's counts (and only that month's)", () => {
    const s0 = overlap(IDS, true);
    const before = review(s0);
    const s1 = rerun(s0, restoreRows(s0.state, [s0.state.setAside[0].txnId], AT));
    const r = expectConservation(s1);
    const jan = month(r, "2026-01");
    expect(jan.bank).toMatchObject({ imported: 3, setAside: 0, inUse: 3, matched: 2, unmatched: 1 });
    expect(jan.duplicateGroupsToReview).toBe(1);
    expect(jan.flags).toEqual(["review-needed", "duplicates-to-review"]);
    expect(month(r, "2026-02")).toEqual(month(before, "2026-02"));
    // …and setting it aside again puts January back exactly.
    const s2 = rerun(s1, setAsideRows(s1.state, [s0.state.setAside[0].txnId], "user", AT));
    expect(month(review(s2), "2026-01").bank).toEqual(month(before, "2026-01").bank);
  });

  it("without proof: the group is a 'duplicate question' in its month and the rows stay counted", () => {
    const s = overlap(PLAIN, false);
    const r = expectConservation(s);
    const jan = month(r, "2026-01");
    expect(jan.bank).toMatchObject({ imported: 3, setAside: 0, inUse: 3 });
    expect(jan.duplicateGroupsToReview).toBe(1);
    expect(jan.details.duplicateGroups[0].txnIds).toHaveLength(2);
    expect(jan.flags).toContain("duplicates-to-review");
    expect(month(r, "2026-02").duplicateGroupsToReview).toBe(0);
    expect(r.overview.duplicateGroupsToReview).toBe(1);
  });

  it("confirmed-separate groups stop being a question but stay counted", () => {
    const s0 = overlap(PLAIN, false);
    const s = { ...s0, state: dismissGroup(s0.state, s0.groups[0].id, true, AT) };
    const r = expectConservation(s);
    const jan = month(r, "2026-01");
    expect(jan.duplicateGroupsToReview).toBe(0);
    expect(jan.duplicateGroupsKeptSeparate).toBe(1);
    expect(jan.flags).not.toContain("duplicates-to-review");
    expect(jan.bank.inUse).toBe(3);
  });

  it("a duplicate group never spans months (its rows share one date)", () => {
    const s = overlap(PLAIN, false);
    for (const g of s.groups) {
      const dates = new Set(g.txnIds.map((id) => [...s.allBank, ...s.allLedger].find((t) => t.id === id)!.date.slice(0, 7)));
      expect(dates.size).toBe(1);
    }
  });
});

describe("user decisions on unmatched rows", () => {
  it("'added by you' and 'marked as expected' rows are handled, not unmatched", () => {
    let s = crossMonth();
    const fee = s.bank.find((t) => t.description === "MONTHLY SERVICE FEE")!;
    s = { ...s, added: new Set([fee.id]) };
    const r = expectConservation(s);
    expect(month(r, "2026-02").bank).toMatchObject({ unmatched: 0, handled: 1 });
    expect(month(r, "2026-02").details.handledBank.map((t) => t.id)).toEqual([fee.id]);
  });
});

describe("year-boundary transactions", () => {
  const s = start(
    [file("bank.csv", PLAIN, ["12/15/2025,COFFEE,-45.10", "01/02/2026,CHECK 2001 SUPPLIER,-700.00"])],
    [file("ledger.csv", PLAIN, ["12/15/2025,COFFEE,-45.10", "12/30/2025,CHECK 2001 SUPPLIER,-700.00"])]
  );
  it("orders December before January and labels the range with both years", () => {
    const r = expectConservation(s);
    expect(r.months.map((m) => m.label)).toEqual(["December 2025", "January 2026"]);
    expect(r.rangeLabel).toBe("December 2025 to January 2026");
  });
  it("a cheque written in December that clears in January is one cross-year match", () => {
    const r = review(s);
    expect(r.overview.crossMonthMatches).toBe(1);
    expect(month(r, "2026-01").details.crossMonth[0].months).toEqual(["2025-12", "2026-01"]);
    expect(month(r, "2025-12").ledger.awaitingReview).toBe(1);
    expect(month(r, "2026-01").ledger.imported).toBe(0);
  });
});

describe("months with no transactions on one side", () => {
  const s = start(
    [file("bank.csv", PLAIN, ["01/05/2026,COFFEE,-45.10", "02/05/2026,COFFEE,-46.00", "03/05/2026,SOFTWARE,-30.00"])],
    [file("ledger.csv", PLAIN, ["01/05/2026,COFFEE,-45.10", "02/05/2026,COFFEE,-46.00"])]
  );
  it("is reported as a fact about the upload — not as missing transactions", () => {
    const r = expectConservation(s);
    const mar = month(r, "2026-03");
    expect(mar.flags).toEqual(["review-needed", "source-unverified"]);
    expect(mar.notes).toEqual([
      "March 2026: the uploaded bank files have rows dated in this month, but the records files have none.",
    ]);
    expect(r.coverage.findings.some((f) => f.kind === "one-sided-month" && f.month === "2026-03" && f.side === "ledger")).toBe(true);
    expect(JSON.stringify(r.coverage.findings)).not.toMatch(/missing transaction/i);
  });
  it("a one-sided month with nothing else open reads 'Source data incomplete or unverified'", () => {
    let t = s;
    const software = t.bank.find((x) => x.description === "SOFTWARE")!;
    t = { ...t, added: new Set([software.id]) };
    expect(month(review(t), "2026-03").status).toBe("source-unverified");
  });
});

describe("coverage — only what the evidence supports", () => {
  const titled = (name: string, from: string, to: string, rows: string[]) =>
    file(name, PLAIN, rows, ["First National Bank", `Statement period: ${from} - ${to}`]);
  const ledger = [file("ledger.csv", PLAIN, ["01/05/2026,COFFEE,-45.10", "03/05/2026,COFFEE,-47.00"])];

  it("the parser reads a stated statement period from the title lines, and only from there", () => {
    const f = titled("jan.csv", "01/01/2026", "01/31/2026", ["01/05/2026,COFFEE,-45.10"]);
    expect(parseCsvDetailed(f.content, "bank", undefined, { headerRow: 3 }).diagnostics.statementPeriod).toEqual({
      start: "2026-01-01", end: "2026-01-31",
    });
    // No title lines → nothing stated → null, whatever the transaction dates are.
    expect(parseCsvDetailed("Date,Description,Amount\n01/05/2026,COFFEE,-45.10", "bank").diagnostics.statementPeriod).toBeNull();
    // Two candidate lines → ambiguous → null.
    const two = ["Statement period: 01/01/2026 - 01/31/2026", "Previous period: 12/01/2025 - 12/31/2025", PLAIN, "01/05/2026,X,-1.00"].join("\n");
    expect(parseCsvDetailed(two, "bank", undefined, { headerRow: 3 }).diagnostics.statementPeriod).toBeNull();
  });

  it("reports a gap between statement periods the files themselves state", () => {
    const r = review(start(
      [
        titled("jan.csv", "01/01/2026", "01/31/2026", ["01/05/2026,COFFEE,-45.10"]),
        titled("mar.csv", "03/01/2026", "03/31/2026", ["03/05/2026,COFFEE,-47.00"]),
      ],
      ledger
    ));
    const gap = r.coverage.findings.find((f) => f.kind === "statement-gap")!;
    expect(gap.side).toBe("bank");
    expect(gap.text).toContain("Feb 1, 2026 to Feb 28, 2026");
    expect(gap.text).toContain('"jan.csv"');
    expect(gap.text).toContain("may not have been uploaded");
  });

  it("back-to-back stated periods are not a gap", () => {
    const r = review(start(
      [
        titled("jan.csv", "01/01/2026", "01/31/2026", ["01/05/2026,COFFEE,-45.10"]),
        titled("feb.csv", "02/01/2026", "02/28/2026", ["02/05/2026,COFFEE,-46.00"]),
      ],
      ledger
    ));
    expect(r.coverage.findings.filter((f) => f.kind === "statement-gap")).toEqual([]);
  });

  it("WITHOUT stated periods no gap is invented — an empty month is noted with its uncertainty", () => {
    const r = review(start(
      [file("jan.csv", PLAIN, ["01/05/2026,COFFEE,-45.10"]), file("mar.csv", PLAIN, ["03/05/2026,COFFEE,-47.00"])],
      ledger
    ));
    expect(r.coverage.findings.filter((f) => f.kind === "statement-gap")).toEqual([]);
    expect(r.months.map((m) => m.month)).toEqual(["2026-01", "2026-03"]); // February is not fabricated as a row
    const note = r.coverage.findings.find((f) => f.kind === "month-without-rows")!;
    expect(note.month).toBe("2026-02");
    expect(note.text).toBe("No rows on either side are dated in February 2026. Reconly can't tell whether that month had no activity or wasn't uploaded.");
  });

  it("days without activity inside a month are never treated as missing data", () => {
    const r = review(start([file("bank.csv", PLAIN, ["01/02/2026,A,-1.00", "01/29/2026,B,-2.00"])], [file("l.csv", PLAIN, ["01/02/2026,A,-1.00", "01/29/2026,B,-2.00"])]));
    expect(r.coverage.findings.map((f) => f.kind)).toEqual(["balances-not-provided"]);
  });

  it("rows the file reader skipped (missing or unreadable dates) are reported and are in no month", () => {
    const s = start(
      [file("bank.csv", PLAIN, ["01/05/2026,COFFEE,-45.10", "99/99/2026,BROKEN DATE,-10.00", ",NO DATE,-5.00", "01/09/2026,BAD AMOUNT,abc"])],
      [file("ledger.csv", PLAIN, ["01/05/2026,COFFEE,-45.10"])]
    );
    const r = expectConservation(s);
    expect(sum(r, (m) => m.bank.imported)).toBe(1);
    const f = r.coverage.findings.find((x) => x.kind === "skipped-rows")!;
    expect(f.text).toBe('"bank.csv": 3 rows were skipped when the file was read (2 with a missing or unreadable date). Skipped rows are not in any month below.');
  });

  it("a file whose rows fall outside the period it states is reported", () => {
    const r = review(start(
      [titled("jan.csv", "01/01/2026", "01/31/2026", ["01/05/2026,COFFEE,-45.10", "02/02/2026,LATE,-1.00"])],
      ledger
    ));
    expect(r.coverage.findings.find((f) => f.kind === "statement-period-mismatch")!.text).toContain("but it contains rows dated from Jan 5, 2026 to Feb 2, 2026");
  });

  it("inconsistent account identifiers on one side are reported", () => {
    const H = "Account,Date,Description,Amount";
    const r = review(start(
      [file("a.csv", H, ["****1111,01/05/2026,COFFEE,-45.10"]), file("b.csv", H, ["****2222,02/05/2026,COFFEE,-46.00"])],
      [file("ledger.csv", PLAIN, ["01/05/2026,COFFEE,-45.10", "02/05/2026,COFFEE,-46.00"])]
    ));
    const f = r.coverage.findings.find((x) => x.kind === "account-mismatch")!;
    expect(f.side).toBe("bank");
    expect(f.text).toContain("2 different account identifiers (****1111, ****2222)");
  });

  it("coverage is always 'not verified', and says balances were not checked", () => {
    const r = review(crossMonth());
    expect(r.coverage.verified).toBe(false);
    expect(r.coverage.label).toBe("Coverage not verified");
    expect(r.coverage.findings[0].kind).toBe("balances-not-provided");
    expect(r.coverage.findings[0].text).toMatch(/balances were not checked/);
  });
});

describe("monthly status wording", () => {
  it("never calls a month reconciled, balanced or complete", () => {
    for (const label of Object.values(MONTH_STATUS_LABEL)) {
      expect(label).not.toMatch(/reconciled|balanced|complete\b(?! or)/i);
    }
    expect(MONTH_STATUS_LABEL["no-unresolved-items"]).toBe("No unresolved items identified");
    expect(MONTH_STATUS_LABEL["source-unverified"]).toBe("Source data incomplete or unverified");
  });
  it("status is the most pressing flag; all applicable flags are kept", () => {
    const r = review(crossMonth());
    expect(month(r, "2026-01").flags).toEqual(["review-needed"]);
    expect(month(r, "2026-01").status).toBe("review-needed");
  });
});

describe("legacy saved reconciliations", () => {
  const fixture = (n: string) => readFileSync(resolve(__dirname, "../../../../tests/fixtures", n), "utf8");
  const strip = ({ sourceFile, sourceLine, ...t }: Txn): Txn => t;
  const bank = parseCsv(fixture("bank_statement.csv"), "bank").map(strip);
  const ledger = parseCsv(fixture("ledger.csv"), "ledger").map(strip);
  const result = reconcile(bank, ledger);

  it("build a review with no provenance, no source files and no duplicate state", () => {
    const r = buildMonthReview({
      imported: { bank, ledger },
      bankTxns: bank,
      ledgerTxns: ledger,
      matches: result.matches,
      compositeMatches: result.compositeMatches,
      addedBankIds: new Set(),
      acknowledgedLedgerIds: new Set(),
      duplicateGroups: [],
      duplicateState: EMPTY_DUPLICATE_STATE,
      // sourceFiles omitted — older records have none
    });
    expect(r.months.length).toBeGreaterThan(0);
    expect(r.months.reduce((a, m) => a + m.bank.inUse, 0)).toBe(bank.length);
    expect(r.months.reduce((a, m) => a + m.bank.net, 0)).toBe(result.balanceProof.bankNetChange);
    expect(r.months.every((m) => m.details.files.length === 0)).toBe(true);
    expect(r.coverage.findings.some((f) => f.kind === "statement-gap" || f.kind === "skipped-rows")).toBe(false);
  });
});

describe("architecture and scale", () => {
  it("the month module does not import or run the matching engine", () => {
    const src = readFileSync(resolve(__dirname, "../months.ts"), "utf8");
    expect(src).not.toMatch(/from "@\/lib\/recon\/engine"/);
    expect(src).not.toMatch(/\breconcile\(/);
  });

  it("monthly totals reconcile with overall totals across many months, files and decisions", () => {
    const bankFiles: ImportFileInput[] = [];
    const ledgerRows: string[] = [];
    for (let m = 0; m < 14; m++) {
      const year = 2025 + Math.floor((m + 10) / 12);
      const mm = String(((m + 10) % 12) + 1).padStart(2, "0");
      const rows: string[] = [];
      for (let i = 0; i < 40; i++) {
        const day = String(1 + ((i * 3) % 28)).padStart(2, "0");
        const amount = -(10 + ((i * 17 + m * 7) % 300)) - (i % 10) / 10;
        rows.push(`${mm}/${day}/${year},VENDOR ${i % 9},${amount.toFixed(2)}`);
        if (i % 13 !== 0) ledgerRows.push(`${mm}/${day}/${year},VENDOR ${i % 9},${amount.toFixed(2)}`);
      }
      bankFiles.push(file(`bank-${year}-${mm}.csv`, PLAIN, rows));
      if (m % 5 === 0) bankFiles.push(file(`bank-${year}-${mm}-again.csv`, PLAIN, rows.slice(0, 6)));
    }
    let s = start(bankFiles, [file("ledger.csv", PLAIN, ledgerRows)]);
    let r = expectConservation(s);
    expect(r.months).toHaveLength(14);
    expect(r.months[0].label).toBe("November 2025");
    // Resolve some duplicate questions each way, accept some suggestions — still adds up.
    s = rerun(s, setAsideRows(s.state, s.groups.slice(0, 5).flatMap((g) => g.suggestedSetAsideIds), "user", AT));
    s = { ...s, state: dismissGroup(s.state, s.groups[6].id, true, AT) };
    for (const m of s.matches.filter((x) => x.status === "suggested").slice(0, 3)) {
      s = { ...s, matches: applyMatchDecision(s.matches, m.id, "accept") };
    }
    r = expectConservation(s);
    expect(r.overview.monthsAnalyzed).toBe(14);
  });

  it("24 months / 14,400 imported rows: the month view builds quickly", () => {
    const bankFiles: ImportFileInput[] = [];
    const ledgerRows: string[] = [];
    let n = 0;
    for (let m = 0; m < 24; m++) {
      const year = 2024 + Math.floor(m / 12);
      const mm = String((m % 12) + 1).padStart(2, "0");
      const rows: string[] = [];
      for (let i = 0; i < 300; i++) {
        const day = String(1 + (i % 28)).padStart(2, "0");
        const amount = -(5 + ((i * 37 + m * 11) % 900)) - (i % 100) / 100;
        rows.push(`TX${n++},${mm}/${day}/${year},VENDOR ${(i * 7) % 40},${amount.toFixed(2)}`);
        ledgerRows.push(`${mm}/${day}/${year},VENDOR ${(i * 7) % 40},${amount.toFixed(2)}`);
      }
      bankFiles.push(file(`bank-${year}-${mm}.csv`, IDS, rows));
    }
    const s = start(bankFiles, [file("ledger.csv", PLAIN, ledgerRows)]);
    const t0 = performance.now();
    const r = review(s);
    const ms = performance.now() - t0;
    console.log(`[benchmark] month review: ${s.allBank.length + s.allLedger.length} rows, ${r.months.length} months in ${ms.toFixed(0)} ms`);
    expect(r.months).toHaveLength(24);
    expect(ms).toBeLessThan(1_000);
  });
});
