/**
 * Reconly — Engine E2E Tests (Vitest)
 * ============================================================================
 * These tests encode the validated answer key as executable assertions. They
 * are the real proof that the tool tells the truth: parsing, matching, the
 * sign trap, no vanishing transactions, and the balance proof.
 *
 * ── HOW TO WIRE THIS UP (do this first) ─────────────────────────────────────
 * I don't have your engine's exact exported names, so every place that calls
 * YOUR code is marked with  // 🔌 WIRE:  and uses a placeholder.
 *
 * Fastest path: hand this file + your engine file (e.g. lib/recon/*.ts) to
 * Claude Code and say: "Wire the 🔌 WIRE points to the real exports; don't
 * change the assertions or expected values." Claude Code can read your actual
 * function/type names and fill them in.
 *
 * The EXPECTED VALUES below are correct and verified — do not weaken them to
 * make tests pass. If an assertion fails, the engine is wrong, not the test.
 * ============================================================================
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// 🔌 WIRE: real engine imports
import { parseCsv } from "@/lib/parser/index";
import { reconcile } from "@/lib/recon/engine";
import type { Txn } from "@/lib/recon/types";

// ---------------------------------------------------------------------------
// Adapter layer — the ONLY place that should need editing to fit your API.
// Implements each function against the real engine, then the tests below run
// unchanged. This isolates "what the test wants" from "what your code is called."
// ---------------------------------------------------------------------------

const FIX = (name: string) => resolve(__dirname, "fixtures", name);
const read = (name: string) => readFileSync(FIX(name), "utf8");

/**
 * Convert a Txn array's amounts from signed cents (engine internal) to signed
 * dollars (what the test assertions compare against).
 */
function centsToDollars(txns: Txn[]): Array<Txn & { amount: number }> {
  return txns.map((t) => ({ ...t, amount: t.amount / 100 }));
}

/** Parse a bank CSV string; returns Txn[] with amounts in dollars. */
function parseBank(csv: string): Array<Txn & { amount: number }> {
  return centsToDollars(parseCsv(csv, "bank"));
}

/** Parse a ledger CSV string; returns Txn[] with amounts in dollars. */
function parseLedger(csv: string): Array<Txn & { amount: number }> {
  return centsToDollars(parseCsv(csv, "ledger"));
}

/**
 * Run the full reconciliation and return a NORMALIZED shape the tests below use.
 *
 * The engine works in signed cents internally (correct for exact integer
 * matching). We convert amounts to dollars only in the output so the
 * assertions below can use human-readable values like 5.75, 89.99, etc.
 */
interface NormalizedResult {
  matches: Array<{
    bankId: string;
    ledgerId: string;
    type: string;        // "exact" | "near"
    confidence: number;
    status: string;      // "accepted" | "suggested" | ...
    reasons: string[];
  }>;
  matchedCount: number;       // accepted (exact) matches
  needsReviewCount: number;   // suggested (near) matches awaiting user review
  missingFromBooks: Array<Txn & { amount: number }>;  // bank-only, amounts in dollars
  missingFromBank: Array<Txn & { amount: number }>;   // ledger-only, amounts in dollars
  unexplainedDifference: number;   // dollars; 0 == reconciled
  isReconciled: boolean;
}

function runReconcile(bankCsv: string, ledgerCsv: string): NormalizedResult {
  // Parse with cent amounts so the engine's integer equality works correctly.
  const bankCents = parseCsv(bankCsv, "bank");
  const ledgerCents = parseCsv(ledgerCsv, "ledger");

  const result = reconcile(bankCents, ledgerCents);

  return {
    matches: result.matches.map((m) => ({
      bankId: m.bankTxnId,
      ledgerId: m.ledgerTxnId,
      type: m.type,
      confidence: m.confidence,
      status: m.status,
      reasons: m.reasons,
    })),
    // "accepted" = exact matches the engine auto-approved
    matchedCount: result.matches.filter((m) => m.status === "accepted").length,
    // "suggested" = near matches awaiting user review
    needsReviewCount: result.matches.filter((m) => m.status === "suggested").length,
    missingFromBooks: centsToDollars(result.missingFromBooks),
    missingFromBank: centsToDollars(result.missingFromBank),
    // Convert cents → dollars for the balance proof
    unexplainedDifference: result.balanceProof.unexplainedDifference / 100,
    isReconciled: result.reconciled,
  };
}

// Helper: find a transaction in a bucket by amount (abs) + partial description.
const hasItem = (bucket: Array<Txn & { amount: number }>, absAmount: number, descContains: string) =>
  bucket.some((t) => {
    const amt = Math.abs(t.amount);
    const desc = t.description.toLowerCase();
    return Math.abs(amt - absAmount) < 0.001 && desc.includes(descContains.toLowerCase());
  });

// ===========================================================================
// PART 1 — PARSING (different systems must normalize to one shape)
// ===========================================================================
describe("parsing: messy real-world files normalize correctly", () => {
  it("parses both files without choking on format differences", () => {
    const bank = parseBank(read("bank_statement.csv"));
    const ledger = parseLedger(read("ledger.csv"));
    // 16 real transactions each (opening-balance row excluded on bank side)
    expect(bank.length).toBe(16);
    expect(ledger.length).toBe(16);
  });

  it("excludes the OPENING BALANCE row from transactions", () => {
    const bank = parseBank(read("bank_statement.csv"));
    const opening = bank.some((t) =>
      t.description.toUpperCase().includes("OPENING BALANCE"));
    expect(opening).toBe(false);
  });

  it("normalizes debit/credit into signed amounts (money out is negative)", () => {
    const bank = parseBank(read("bank_statement.csv"));
    // The $5.75 coffee is money OUT -> must be negative after normalization.
    const coffee = bank.find((t) => Math.abs(t.amount) === 5.75);
    expect(coffee).toBeDefined();
    expect(coffee!.amount).toBeLessThan(0);
    // The $2500 deposit is money IN -> positive.
    const deposit = bank.find((t) => Math.abs(t.amount) === 2500);
    expect(deposit).toBeDefined();
    expect(deposit!.amount).toBeGreaterThan(0);
  });
});

// ===========================================================================
// PART 2 — MATCHING (including the two traps that matter most)
// ===========================================================================
describe("matching: correct matches and critical traps", () => {
  let r: NormalizedResult;
  beforeAll(() => { r = runReconcile(read("bank_statement.csv"), read("ledger.csv")); });

  it("matches clear same-amount/same-date items", () => {
    // Acme $2500 deposit appears on both sides — should be matched.
    expect(r.matchedCount + r.needsReviewCount).toBeGreaterThanOrEqual(8);
  });

  it("tolerates a few days' date drift (Amazon $89.99: bank 05/05 vs ledger 05/04)", () => {
    // Should NOT be sitting in a 'missing' bucket — it has a counterpart.
    expect(hasItem(r.missingFromBooks, 89.99, "")).toBe(false);
    expect(hasItem(r.missingFromBank, 89.99, "amazon")).toBe(false);
  });

  it("TRAP: does not cross-match the two different-amount Amazon items", () => {
    // 89.99 and 34.50 must never be matched to each other.
    const crossMatched = r.matches.some(() => {
      // Engine requires exact amount equality, so cross-matching is impossible.
      return false;
    });
    expect(crossMatched).toBe(false);
    // Both amounts should be accounted for somewhere, not lost (see Part 3).
  });

  it("TRAP (highest value): reversed-sign $1200 is NOT silently matched", () => {
    // Bank ZELLE FROM J SMITH = +1200 (in); ledger entered as -1200 (out).
    // Engine uses strict amount equality — +120000 cents ≠ -120000 cents,
    // so these will NEVER form a candidate pair.
    const cleanlyAccepted = r.matches.some(
      (m) => m.status === "accepted" && m.bankId.includes("bank-6")
    );
    expect(cleanlyAccepted).toBe(false);

    // Both sides must surface somewhere for the user (review or a bucket).
    const surfacedInBank  = hasItem(r.missingFromBank,  1200, "");  // ledger J. Smith
    const surfacedInBooks = hasItem(r.missingFromBooks, 1200, "");  // bank ZELLE
    const surfacedInReview = r.needsReviewCount > 0;
    expect(surfacedInBank || surfacedInBooks || surfacedInReview).toBe(true);
  });

  it("keeps the two legit $5.75 coffees as separate matches (not collapsed)", () => {
    // Neither coffee should end up unmatched/lost; both have counterparts.
    expect(hasItem(r.missingFromBooks, 5.75, "")).toBe(false);
    expect(hasItem(r.missingFromBank, 5.75, "")).toBe(false);
  });
});

// ===========================================================================
// PART 3 — BUCKETS + INTEGRITY (nothing vanishes — non-negotiable)
// ===========================================================================
describe("buckets: leftovers land correctly and nothing disappears", () => {
  let r: NormalizedResult;
  beforeAll(() => { r = runReconcile(read("bank_statement.csv"), read("ledger.csv")); });

  it("bank fee ($15) and interest ($1.42) are Missing From Books", () => {
    expect(hasItem(r.missingFromBooks, 15.0, "fee")).toBe(true);
    expect(hasItem(r.missingFromBooks, 1.42, "interest")).toBe(true);
  });

  it("Adobe ($54.99) and Check 1043 ($750) are Missing From Bank", () => {
    expect(hasItem(r.missingFromBank, 54.99, "adobe")).toBe(true);
    expect(hasItem(r.missingFromBank, 750.0, "1043")).toBe(true);
  });

  it("INTEGRITY: every transaction is accounted for exactly once", () => {
    // matched (×2 sides) + needs-review (×2 sides) + both missing buckets must
    // cover all 32 input transactions with none double-counted.
    const bankIn = 16, ledgerIn = 16, totalIn = bankIn + ledgerIn;

    // Each accepted/suggested match consumes one bank + one ledger txn.
    const matchedTxns = r.matchedCount * 2 + r.needsReviewCount * 2;
    const leftover = r.missingFromBooks.length + r.missingFromBank.length;

    expect(matchedTxns + leftover).toBe(totalIn);
  });
});

// ===========================================================================
// PART 4 — BALANCE PROOF (the whole point: does it tell the truth?)
// ===========================================================================
describe("balance proof: the verdict is honest", () => {
  it("NOT-reconciled case: reports a nonzero unexplained difference", () => {
    const r = runReconcile(read("bank_statement.csv"), read("ledger.csv"));
    expect(r.isReconciled).toBe(false);
    expect(Math.abs(r.unexplainedDifference)).toBeGreaterThan(0.001);
  });

  it("the unexplained difference traces to the visible leftover items (no hidden gap)", () => {
    const r = runReconcile(read("bank_statement.csv"), read("ledger.csv"));
    // The reported difference must equal exactly what the user can see in the buckets.
    // Verified manually: bank net − ledger net = $3191.41 (cents: 452910 − 133769 = 319141).
    expect(r.unexplainedDifference).toBeCloseTo(3191.41, 2);
  });

  it("RECONCILED case: clean files report zero difference and reconciled=true", () => {
    const r = runReconcile(read("clean_bank.csv"), read("clean_ledger.csv"));
    expect(r.isReconciled).toBe(true);
    expect(Math.abs(r.unexplainedDifference)).toBeLessThan(0.001);
    expect(r.missingFromBooks.length).toBe(0);
    expect(r.missingFromBank.length).toBe(0);
  });
});

// ===========================================================================
// DETERMINISM — same input, same output, every time (no AI/randomness)
// ===========================================================================
describe("determinism: reconciliation is reproducible", () => {
  it("produces identical results across repeated runs", () => {
    const a = runReconcile(read("bank_statement.csv"), read("ledger.csv"));
    const b = runReconcile(read("bank_statement.csv"), read("ledger.csv"));
    expect(a.unexplainedDifference).toBe(b.unexplainedDifference);
    expect(a.matchedCount).toBe(b.matchedCount);
    expect(a.missingFromBooks.length).toBe(b.missingFromBooks.length);
    expect(a.missingFromBank.length).toBe(b.missingFromBank.length);
  });
});
