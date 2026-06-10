// ============================================================
// Context builder tests — the privacy contract, enforced.
//
// The important invariants:
//   1. Masking: 8+ digit runs → last-4; control chars stripped;
//      lengths capped. (This is what makes the transparency
//      notice true.)
//   2. Whitelist: builder output validates against the strict
//      Zod schema — any extra field is a test failure.
//   3. Money: formatted strings only, schema-regex compatible.
//   4. Size cap: drops are counted, never silent.
//   5. Buckets mirror what the user sees in the UI.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  maskAccountNumbers,
  maskDescription,
  formatMoney,
  buildReconContext,
  type ReconContextInput,
} from "../context-builder";
import { reconContextSchema, MAX_ITEMS } from "../schema";
import { reconcile } from "../../recon/engine";
import type { Txn, BalanceProof } from "../../recon/types";

// ---- Helpers ----------------------------------------------------------

let nextId = 0;
function txn(source: "bank" | "ledger", date: string, description: string, amount: number): Txn {
  return { id: `${source}-${nextId++}`, source, date, description, amount, raw: {} };
}

const zeroProof: BalanceProof = {
  bankNetChange: 0,
  ledgerNetChange: 0,
  clearedSum: 0,
  unexplainedDifference: 0,
};

function minimalInput(overrides: Partial<ReconContextInput> = {}): ReconContextInput {
  return {
    matches: [],
    compositeMatches: [],
    bankTxns: [],
    ledgerTxns: [],
    baseMissingFromBooks: [],
    baseMissingFromBank: [],
    userAddedEntries: [],
    acknowledgedBankIds: [],
    balanceProof: zeroProof,
    reconciled: true,
    periodLabel: "March 2026",
    ...overrides,
  };
}

// ---- Masking ----------------------------------------------------------

describe("maskAccountNumbers", () => {
  it("redacts a contiguous 12-digit account number to last-4", () => {
    expect(maskAccountNumbers("ACH TRANSFER ACCT 123456789012 RECEIVED")).toBe(
      "ACH TRANSFER ACCT ****9012 RECEIVED"
    );
  });

  it("redacts an 8-digit run (the minimum)", () => {
    expect(maskAccountNumbers("REF 12345678")).toBe("REF ****5678");
  });

  it("leaves 7 digits untouched (store numbers, refs)", () => {
    expect(maskAccountNumbers("STORE 1234567")).toBe("STORE 1234567");
  });

  it("redacts card numbers broken up by dashes", () => {
    expect(maskAccountNumbers("CARD 4111-1111-1111-1234 PURCHASE")).toBe(
      "CARD ****1234 PURCHASE"
    );
  });

  it("redacts card numbers broken up by spaces", () => {
    expect(maskAccountNumbers("4111 1111 1111 1234")).toBe("****1234");
  });

  it("leaves dates and short numbers alone", () => {
    expect(maskAccountNumbers("INV 2026-03-12 #4471")).toBe("INV 2026-03-12 #4471");
  });

  it("redacts multiple runs independently", () => {
    expect(maskAccountNumbers("FROM 11112222 TO 33334444")).toBe(
      "FROM ****2222 TO ****4444"
    );
  });
});

describe("maskDescription", () => {
  it("strips control characters", () => {
    expect(maskDescription("COFFEE\u0007CART \u001b[31m")).toBe("COFFEE CART [31m");
  });

  it("collapses whitespace", () => {
    expect(maskDescription("A   B\t\tC")).toBe("A B C");
  });

  it("caps length at 120 with an ellipsis", () => {
    const long = "X".repeat(300);
    const out = maskDescription(long);
    expect(out.length).toBe(120);
    expect(out.endsWith("…")).toBe(true);
  });

  it("applies account masking", () => {
    expect(maskDescription("WIRE FROM 987654321098")).toBe("WIRE FROM ****1098");
  });
});

// ---- Money ------------------------------------------------------------

describe("formatMoney", () => {
  it("formats negative cents with ASCII minus and grouping", () => {
    expect(formatMoney(-123456)).toBe("-$1,234.56");
  });

  it("formats positive cents", () => {
    expect(formatMoney(4200)).toBe("$42.00");
  });

  it("formats zero", () => {
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("pads single-digit cents", () => {
    expect(formatMoney(-5)).toBe("-$0.05");
  });

  it("groups large amounts", () => {
    expect(formatMoney(1234567890)).toBe("$12,345,678.90");
  });
});

// ---- Builder: schema round-trip (the whitelist, enforced) -------------

describe("buildReconContext", () => {
  it("produces output that validates against the strict request schema", () => {
    const bank = [
      txn("bank", "2026-03-12", "SQ *COFFEE CART", -3456),
      txn("bank", "2026-03-15", "ACH ACCT 123456789012 TRANSFER", -50000),
    ];
    const ledger = [txn("ledger", "2026-03-12", "Coffee cart", -3456)];
    const result = reconcile(bank, ledger);

    const context = buildReconContext(
      minimalInput({
        matches: result.matches,
        compositeMatches: result.compositeMatches,
        bankTxns: bank,
        ledgerTxns: ledger,
        baseMissingFromBooks: result.missingFromBooks,
        baseMissingFromBank: result.missingFromBank,
        balanceProof: result.balanceProof,
        reconciled: result.reconciled,
      })
    );

    // strict() schemas reject ANY field outside the whitelist
    expect(() => reconContextSchema.parse(context)).not.toThrow();
  });

  it("never includes raw CSV rows, txn ids, or reference fields", () => {
    const bank = [
      { ...txn("bank", "2026-03-12", "PAYMENT", -1000), reference: "SECRET-REF", raw: { acct: "999" } },
    ];
    const context = buildReconContext(
      minimalInput({ bankTxns: bank, baseMissingFromBooks: bank, reconciled: false })
    );
    const json = JSON.stringify(context);
    expect(json).not.toContain("SECRET-REF");
    expect(json).not.toContain("999");
    expect(json).not.toContain("bank-"); // no engine txn ids
  });

  it("masks account numbers in descriptions end to end", () => {
    const bank = [txn("bank", "2026-03-15", "ACH ACCT 123456789012 TRANSFER", -50000)];
    const context = buildReconContext(
      minimalInput({ bankTxns: bank, baseMissingFromBooks: bank, reconciled: false })
    );
    expect(context.items[0].description).toBe("ACH ACCT ****9012 TRANSFER");
    expect(JSON.stringify(context)).not.toContain("123456789012");
  });

  it("formats all money fields as dollar strings", () => {
    const proof: BalanceProof = {
      bankNetChange: -123456,
      ledgerNetChange: -120000,
      clearedSum: -100000,
      unexplainedDifference: -3456,
    };
    const context = buildReconContext(minimalInput({ balanceProof: proof, reconciled: false }));
    expect(context.summary.bankNetChange).toBe("-$1,234.56");
    expect(context.summary.ledgerNetChange).toBe("-$1,200.00");
    expect(context.summary.unexplainedDifference).toBe("-$34.56");
  });

  it("puts suggested matches first and carries the engine's reasons", () => {
    const bank = [txn("bank", "2026-03-25", "TST* HMSTD CAFE 0042 OAKLAND CA", -4200)];
    const ledger = [txn("ledger", "2026-03-23", "Homestead Cafe", -4200)];
    const result = reconcile(bank, ledger);
    expect(result.matches.length).toBe(1); // sanity: engine suggests the fuzzy pair

    const context = buildReconContext(
      minimalInput({
        matches: result.matches,
        bankTxns: bank,
        ledgerTxns: ledger,
        balanceProof: result.balanceProof,
        reconciled: result.reconciled,
      })
    );

    const item = context.items[0];
    expect(item.bucket).toBe("suggested-match");
    // First reason names the ledger counterpart; the rest are the engine's own
    expect(item.reasons[0]).toContain("Homestead Cafe");
    expect(item.reasons.length).toBeGreaterThan(1);
    expect(item.reasons.slice(1)).toEqual(
      result.matches[0].reasons.map((r) => r.replace(/\s+/g, " ").trim()).slice(0, 9)
    );
  });

  it("buckets unmatched items on both sides", () => {
    const bankOnly = [txn("bank", "2026-03-01", "MYSTERY FEE", -500)];
    const ledgerOnly = [txn("ledger", "2026-03-02", "Uncashed check", -10000)];
    const context = buildReconContext(
      minimalInput({
        bankTxns: bankOnly,
        ledgerTxns: ledgerOnly,
        baseMissingFromBooks: bankOnly,
        baseMissingFromBank: ledgerOnly,
        reconciled: false,
      })
    );
    expect(context.items.map((i) => i.bucket)).toEqual([
      "missing-from-books",
      "missing-from-bank",
    ]);
    expect(context.summary.counts.missingFromBooks).toBe(1);
    expect(context.summary.counts.missingFromBank).toBe(1);
  });

  it("moves user-added entries out of missing-from-books into user-added", () => {
    const bank = [txn("bank", "2026-03-01", "BANK FEE", -500)];
    const context = buildReconContext(
      minimalInput({
        bankTxns: bank,
        baseMissingFromBooks: bank,
        userAddedEntries: [
          { txnId: bank[0].id, date: "2026-03-01", description: "BANK FEE", amount: -500 },
        ],
        reconciled: false,
      })
    );
    expect(context.items.map((i) => i.bucket)).toEqual(["user-added"]);
    expect(context.summary.counts.missingFromBooks).toBe(0);
    expect(context.summary.counts.userAdded).toBe(1);
  });

  it("excludes acknowledged missing-from-bank items", () => {
    const ledger = [txn("ledger", "2026-03-02", "Uncashed check", -10000)];
    const context = buildReconContext(
      minimalInput({
        ledgerTxns: ledger,
        baseMissingFromBank: ledger,
        acknowledgedBankIds: [ledger[0].id],
        reconciled: false,
      })
    );
    expect(context.items).toEqual([]);
    expect(context.summary.counts.missingFromBank).toBe(0);
  });

  it("caps items at MAX_ITEMS and reports the overflow — never silently", () => {
    const many = Array.from({ length: MAX_ITEMS + 30 }, (_, i) =>
      txn("bank", "2026-03-01", `FEE ${i}`, -100)
    );
    const context = buildReconContext(
      minimalInput({ bankTxns: many, baseMissingFromBooks: many, reconciled: false })
    );
    expect(context.items.length).toBe(MAX_ITEMS);
    expect(context.omittedItemCount).toBe(30);
    expect(() => reconContextSchema.parse(context)).not.toThrow();
  });

  it("is deterministic — same input, byte-identical output", () => {
    const bank = [txn("bank", "2026-03-12", "SQ *COFFEE 12345678", -3456)];
    const input = minimalInput({
      bankTxns: bank,
      baseMissingFromBooks: bank,
      reconciled: false,
    });
    expect(JSON.stringify(buildReconContext(input))).toBe(
      JSON.stringify(buildReconContext(input))
    );
  });
});
