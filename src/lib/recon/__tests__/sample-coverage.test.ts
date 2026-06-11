// ============================================================
// The shipped sample CSVs ("Try with sample data") are designed
// to exercise EVERY engine feature: exact, near, fuzzy, composite
// (unambiguous AND ambiguous), missing items on both sides, a
// duplicate ledger entry, an outstanding check, balance rows,
// split debit/credit columns, MM/DD dates, thousands separators,
// and accounting parentheses. This test pins that coverage so a
// future edit to the samples can't silently lose a demo path.
// ============================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsvDetailed } from "@/lib/parser";
import { reconcile } from "../engine";

const root = resolve(__dirname, "../../../..");
const readSample = (name: string) =>
  readFileSync(resolve(root, "public/samples", name), "utf-8");

describe("sample data exercises every engine feature", () => {
  const bankParsed = parseCsvDetailed(readSample("bank-june2026.csv"), "bank");
  const ledgerParsed = parseCsvDetailed(readSample("ledger-june2026.csv"), "ledger");
  const result = reconcile(bankParsed.txns, ledgerParsed.txns);

  it("parses cleanly — every row read, no warnings, formats handled", () => {
    // Bank: 19 data rows, OPENING BALANCE skipped by design → 18 txns.
    expect(bankParsed.txns).toHaveLength(18);
    expect(bankParsed.diagnostics.skippedBalanceRows).toBe(1);
    expect(bankParsed.diagnostics.issueCount).toBe(0);
    // Ledger: 23 rows incl. "3,500.00" thousands and "(180.00)" parens.
    expect(ledgerParsed.txns).toHaveLength(23);
    expect(ledgerParsed.diagnostics.issueCount).toBe(0);
    const parens = ledgerParsed.txns.find((t) => t.description.includes("Window cleaning"));
    expect(parens?.amount).toBe(-18000);
    const thousands = ledgerParsed.txns.find((t) => t.description.includes("Brightwave"));
    expect(thousands?.amount).toBe(350000);
  });

  it("produces an exact match (auto-accepted)", () => {
    const exact = result.matches.filter((m) => m.type === "exact");
    expect(exact.length).toBeGreaterThanOrEqual(1);
    expect(exact.every((m) => m.status === "accepted")).toBe(true);
  });

  it("produces near matches awaiting review", () => {
    const near = result.matches.filter((m) => m.type === "near");
    expect(near.length).toBeGreaterThanOrEqual(5);
    expect(near.every((m) => m.status === "suggested")).toBe(true);
  });

  it("produces a fuzzy match (noisy bank rail vs clean memo)", () => {
    const fuzzy = result.matches.filter((m) => m.type === "fuzzy");
    expect(fuzzy.length).toBeGreaterThanOrEqual(1);
    expect(fuzzy.every((m) => m.confidence >= 50 && m.confidence <= 69)).toBe(true);
  });

  it("produces one unambiguous composite (Stripe payout = 3 invoices)", () => {
    const unambiguous = result.compositeMatches.filter((c) => !c.ambiguous);
    expect(unambiguous).toHaveLength(1);
    expect(unambiguous[0].ledgerTxnIds).toHaveLength(3);
  });

  it("produces one ambiguous composite (deposit with 2 candidate combos)", () => {
    const ambiguous = result.compositeMatches.filter((c) => c.ambiguous);
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0].allCombinations).toHaveLength(2);
  });

  it("leaves realistic missing items on both sides", () => {
    // Bank-only: wire fee, monthly service fee, interest.
    expect(result.missingFromBooks).toHaveLength(3);
    // Ledger-only: duplicate Figma entry, outstanding check 1043,
    // invoice 1046 (deposit in transit).
    expect(result.missingFromBank).toHaveLength(3);
  });

  it("is honestly not reconciled out of the box", () => {
    expect(result.reconciled).toBe(false);
    expect(result.balanceProof.unexplainedDifference).not.toBe(0);
  });
});
