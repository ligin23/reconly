// ============================================================
// Regression tests for the reject-don't-guess parser and the
// engine's blank-description guard. Each case here was a silent-
// corruption path found in the pre-production review: amounts
// that flipped sign or became $0.00, dates that transposed or
// shifted a day, rows that vanished without a trace, and non-
// Latin descriptions that auto-accepted as exact matches.
// ============================================================

import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvDetailed } from "@/lib/parser";
import { reconcile } from "@/lib/recon/engine";
import { normalize } from "@/lib/recon/normalize";
import { descriptionSimilarity } from "@/lib/recon/similarity";

const HEADER = "date,description,amount";
const csvWith = (...rows: string[]) => [HEADER, ...rows].join("\n");

const txn = (
  id: string,
  source: "bank" | "ledger",
  date: string,
  description: string,
  amount: number
) => ({ id, source, date, description, amount, raw: {} });

const amountOf = (csvRow: string): number | undefined =>
  parseCsv(csvWith(csvRow), "bank")[0]?.amount;

describe("toCents — negative amounts are never silently flipped positive", () => {
  it("parses $-450.00 as negative (currency symbol before the sign)", () => {
    expect(amountOf('2026-03-04,Vendor,"$-450.00"')).toBe(-45000);
  });

  it("parses $(1,234.00) accounting format as negative", () => {
    expect(amountOf('2026-03-04,Vendor,"$(1,234.00)"')).toBe(-123400);
  });

  it("parses ($450.00) as negative", () => {
    expect(amountOf('2026-03-04,Vendor,"($450.00)"')).toBe(-45000);
  });

  it("parses trailing-minus 35.00- as negative", () => {
    expect(amountOf("2026-03-04,Vendor,35.00-")).toBe(-3500);
  });

  it("parses unicode minus −450.00 as negative (the app's own money() output)", () => {
    expect(amountOf("2026-03-04,Vendor,−450.00")).toBe(-45000);
  });

  it("parses 35.00 DR as negative and 35.00 CR as positive", () => {
    expect(amountOf("2026-03-04,Vendor,35.00 DR")).toBe(-3500);
    expect(amountOf("2026-03-04,Vendor,35.00 CR")).toBe(3500);
  });

  it("still parses the classic forms", () => {
    expect(amountOf("2026-03-04,Vendor,-35.00")).toBe(-3500);
    expect(amountOf('2026-03-04,Vendor,"3,200.00"')).toBe(320000);
    expect(amountOf("2026-03-04,Vendor,+95.00")).toBe(9500);
    expect(amountOf("2026-03-04,Vendor,£45.00")).toBe(4500);
  });
});

describe("toCents — unparseable amounts REJECT the row (never $0.00)", () => {
  it.each(["N/A", "--", "12.34.56", "abc"])(
    "skips a row with amount %s and reports it",
    (bad) => {
      const { txns, diagnostics } = parseCsvDetailed(
        csvWith(`2026-03-04,Vendor,${bad}`, "2026-03-05,Other,-10.00"),
        "bank"
      );
      expect(txns).toHaveLength(1);
      expect(txns[0].amount).toBe(-1000);
      expect(diagnostics.issueCount).toBe(1);
      expect(diagnostics.issues[0].reason).toContain("amount");
    }
  );
});

describe("toCents — European number formats", () => {
  it('parses a decimal-comma file ("1.234,56") correctly', () => {
    const { txns, diagnostics } = parseCsvDetailed(
      csvWith('2026-03-04,Vendor,"1.234,56"', '2026-03-05,Other,"-15,50"'),
      "bank"
    );
    expect(diagnostics.decimalStyle).toBe("comma");
    expect(txns[0].amount).toBe(123456);
    expect(txns[1].amount).toBe(-1550);
  });

  it("keeps US thousands-comma behavior when dots are the decimal", () => {
    const { txns, diagnostics } = parseCsvDetailed(
      csvWith('2026-03-04,Vendor,"1,234.56"'),
      "bank"
    );
    expect(diagnostics.decimalStyle).toBe("dot");
    expect(txns[0].amount).toBe(123456);
  });
});

describe("toIsoDate — validation and day-first detection", () => {
  it("detects a day-first file (31/12 proves DD/MM) and applies it file-wide", () => {
    const { txns, diagnostics } = parseCsvDetailed(
      csvWith("31/12/2026,Year end,-10.00", "04/03/2026,Spring,-20.00"),
      "bank"
    );
    expect(diagnostics.dateOrder).toBe("day-first");
    expect(txns[0].date).toBe("2026-12-31");
    expect(txns[1].date).toBe("2026-03-04"); // 4 March, not 3 April
  });

  it("defaults to month-first for ambiguous files", () => {
    const { txns, diagnostics } = parseCsvDetailed(
      csvWith("04/03/2026,Ambiguous,-10.00"),
      "bank"
    );
    expect(diagnostics.dateOrder).toBe("month-first");
    expect(txns[0].date).toBe("2026-04-03");
  });

  it("never emits impossible ISO dates (month 31) — rejects instead", () => {
    // A single out-of-range date in an otherwise month-first file: the
    // only valid reading is day-first for that value.
    const { txns } = parseCsvDetailed(csvWith("31/12/2026,X,-10.00"), "bank");
    expect(txns[0].date).toBe("2026-12-31");
    // Truly impossible dates are rejected, not fabricated.
    const bad = parseCsvDetailed(csvWith("13/32/2026,X,-10.00"), "bank");
    expect(bad.txns).toHaveLength(0);
    expect(bad.diagnostics.issueCount).toBe(1);
  });

  it("rejects invalid calendar dates like Feb 30", () => {
    const { txns, diagnostics } = parseCsvDetailed(
      csvWith("02/30/2026,X,-10.00"),
      "bank"
    );
    expect(txns).toHaveLength(0);
    expect(diagnostics.issueCount).toBe(1);
  });

  it("formats free-form date fallback from LOCAL parts (no UTC day shift)", () => {
    const { txns } = parseCsvDetailed(csvWith("Mar 4 2026,X,-10.00"), "bank");
    expect(txns[0]?.date).toBe("2026-03-04");
  });
});

describe("parseCsvDetailed — structural problems are surfaced, not swallowed", () => {
  it("reports rows missing essentials instead of dropping them silently", () => {
    const { txns, diagnostics } = parseCsvDetailed(
      csvWith("2026-03-04,,−10.00", "2026-03-05,Vendor,-20.00"),
      "bank"
    );
    expect(txns).toHaveLength(1);
    expect(diagnostics.issueCount).toBe(1);
    expect(diagnostics.issues[0].reason).toContain("missing");
  });

  it("warns when a mapped column doesn't exist in the file", () => {
    const { txns, diagnostics } = parseCsvDetailed(
      ["posted,memo,amt", "2026-03-04,Vendor,-10.00"].join("\n"),
      "bank"
    );
    // Auto-detection falls back to literal names that aren't in this file:
    // zero rows, and the diagnostics say why.
    expect(txns).toHaveLength(0);
    expect(diagnostics.warnings.some((w) => w.includes("not found"))).toBe(true);
  });

  it("balance rows are skipped by design and counted separately", () => {
    const { txns, diagnostics } = parseCsvDetailed(
      csvWith("2026-03-01,OPENING BALANCE,0.00", "2026-03-05,Vendor,-20.00"),
      "bank"
    );
    expect(txns).toHaveLength(1);
    expect(diagnostics.skippedBalanceRows).toBe(1);
    expect(diagnostics.issueCount).toBe(0);
  });
});

describe("engine — blank/non-Latin descriptions never auto-accept", () => {
  it("normalize keeps non-Latin scripts instead of deleting them", () => {
    expect(normalize("面馆午餐")).toBe("面馆午餐");
    expect(normalize("Café München")).toBe("CAFE MUNCHEN");
    expect(normalize("***")).toBe("");
  });

  it("two different CJK descriptions do NOT exact-match", () => {
    const result = reconcile(
      [txn("b1", "bank", "2026-03-10", "面馆午餐", -1850)],
      [txn("l1", "ledger", "2026-03-10", "出租车", -1850)]
    );
    const exact = result.matches.filter((m) => m.type === "exact");
    expect(exact).toHaveLength(0);
    // Nothing here may be auto-accepted; a suggestion for review is fine.
    expect(result.matches.every((m) => m.status !== "accepted")).toBe(true);
  });

  it("punctuation-only descriptions never auto-accept as exact", () => {
    const result = reconcile(
      [txn("b1", "bank", "2026-03-10", "***", -1850)],
      [txn("l1", "ledger", "2026-03-10", "——", -1850)]
    );
    expect(result.matches.filter((m) => m.type === "exact")).toHaveLength(0);
    expect(result.matches.every((m) => m.status !== "accepted")).toBe(true);
  });

  it("empty-vs-empty similarity is 0, not 1", () => {
    expect(descriptionSimilarity("", "")).toBe(0);
  });

  it("identical CJK descriptions still exact-match", () => {
    const result = reconcile(
      [txn("b1", "bank", "2026-03-10", "面馆午餐", -1850)],
      [txn("l1", "ledger", "2026-03-10", "面馆午餐", -1850)]
    );
    const exact = result.matches.filter((m) => m.type === "exact");
    expect(exact).toHaveLength(1);
    expect(exact[0].status).toBe("accepted");
  });
});
