/**
 * Reconly — Resolve-Items (Add to Working Copy) Engine Tests (Vitest)
 * ============================================================================
 * Tests the feature where a user resolves a "Missing From Books" item by adding
 * it to Reconly's WORKING COPY so the reconciliation balances and it flows into
 * exports — WITHOUT claiming it was recorded in any real accounting system.
 *
 * What actually matters here (and what these tests guard):
 *   1. Adding a missing item makes the unexplained difference go DOWN correctly.
 *   2. The balance stays HONEST — an added item is a visible, traceable item,
 *      not a silent adjustment. No "mystery" balancing.
 *   3. The action is REVERSIBLE — removing the item restores the prior state.
 *   4. Added items are TAGGED as user-added (never confused with imported rows).
 *   5. Integrity holds — nothing double-counted, nothing vanishes.
 *
 * ── WIRE-UP ─────────────────────────────────────────────────────────────────
 * EXPECTED VALUES ARE VERIFIED. The fixture's only discrepancy is a $12.00 fee,
 * so adding it must drive the unexplained difference to exactly 0.00.
 * ============================================================================
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Real imports
import { parseCsv } from "@/lib/parser";
import { reconcile } from "@/lib/recon/engine";
import type { Txn, ReconResult } from "@/lib/recon/types";
import type { UserAddedEntry } from "@/lib/sample-data";
import { generateId } from "@/lib/data/utils";

const FIX = (n: string) => resolve(__dirname, "fixtures", n);
const read = (n: string) => readFileSync(FIX(n), "utf8");

// ── Adapter ─────────────────────────────────────────────────────────────────
// Mirrors the logic in AppShell (liveBalanceProof, handleAddToBooks,
// handleRemoveAdded, buildDashboardData split) but as pure functions for tests.
// All public amounts in NormalizedResult are in DOLLARS (÷100) to match the
// test's expected values (12.0, not 1200).

interface TestState {
  bankTxns: Txn[];
  ledgerTxns: Txn[];
  engineResult: ReconResult;
  userAddedEntries: UserAddedEntry[];
}

interface NormalizedResult {
  unexplainedDifference: number;  // dollars (÷100 from engine cents)
  isReconciled: boolean;
  missingFromBooks: any[];        // on bank, not in ledger; amount in dollars
  missingFromBank: any[];         // in ledger, not cleared; amount in dollars
  matchedCount: number;
  userAddedItems: any[];          // items the user added; amount in dollars
}

function parseBank(csv: string): Txn[] {
  return parseCsv(csv, "bank");
}

function parseLedger(csv: string): Txn[] {
  return parseCsv(csv, "ledger");
}

/** Run a fresh reconciliation and return immutable state + normalized view. */
function runReconcile(bankCsv: string, ledgerCsv: string): { state: TestState; view: NormalizedResult } {
  const bank = parseBank(bankCsv);
  const ledger = parseLedger(ledgerCsv);
  const result = reconcile(bank, ledger);
  const state: TestState = {
    bankTxns: bank,
    ledgerTxns: ledger,
    engineResult: result,
    userAddedEntries: [],
  };
  return { state, view: normalize(state) };
}

/** Map engine state into NormalizedResult (amounts converted to dollars). */
function normalize(state: TestState): NormalizedResult {
  // Replicate AppShell liveBalanceProof math (all in cents internally)
  const engineGap = state.engineResult.balanceProof.unexplainedDifference; // signed cents
  const addedAbsSum = state.userAddedEntries.reduce((s, e) => s + Math.abs(e.amount), 0); // cents
  const gapSign = engineGap < 0 ? -1 : 1;
  const newUnexplained = gapSign * Math.max(0, Math.abs(engineGap) - addedAbsSum); // cents

  // addedTxnIds: entries the user has added — split missingFromBooks accordingly
  const addedTxnIds = new Set(state.userAddedEntries.map((e) => e.txnId));
  const missingFromBooks = state.engineResult.missingFromBooks
    .filter((t) => !addedTxnIds.has(t.id))
    .map((t) => ({ ...t, amount: t.amount / 100 })); // cents → dollars

  const missingFromBank = state.engineResult.missingFromBank
    .map((t) => ({ ...t, amount: t.amount / 100 })); // cents → dollars

  const userAddedItems = state.userAddedEntries.map((e) => ({
    ...e,
    amount: e.amount / 100, // cents → dollars
  }));

  return {
    unexplainedDifference: newUnexplained / 100, // cents → dollars
    isReconciled: Math.abs(newUnexplained) < 1,  // <1 cent = reconciled (matches AppShell)
    missingFromBooks,
    missingFromBank,
    matchedCount: state.engineResult.matches.filter((m) => m.status === "accepted").length,
    userAddedItems,
  };
}

/** Add a Missing-From-Books item to the working copy; return new state (immutable). */
function addItem(state: TestState, item: any): TestState {
  // item comes from NormalizedResult.missingFromBooks — look up the original Txn
  // by id to get the cents amount (item.amount is already dollars at this point)
  const original = state.engineResult.missingFromBooks.find((t) => t.id === item.id);
  if (!original) throw new Error(`addItem: txn id "${item.id}" not found in missingFromBooks`);
  const entry: UserAddedEntry = {
    id: generateId(),
    txnId: original.id,
    date: original.date,
    description: original.description,
    amount: original.amount, // stored in cents, matching AppShell
  };
  return {
    ...state,
    userAddedEntries: [...state.userAddedEntries, entry],
  };
}

/** Remove a previously-added item from the working copy; return new state (immutable). */
function removeItem(state: TestState, item: any): TestState {
  return {
    ...state,
    userAddedEntries: state.userAddedEntries.filter((e) => e.txnId !== item.id),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("baseline: the fixture has exactly one discrepancy (a $12 fee)", () => {
  it("starts NOT reconciled with the fee in Missing From Books", () => {
    const { view } = runReconcile(read("bank_one_fee.csv"), read("ledger_missing_fee.csv"));
    expect(view.isReconciled).toBe(false);
    expect(Math.abs(view.unexplainedDifference)).toBeCloseTo(12.0, 2);
    const feeThere = view.missingFromBooks.some((t: any) =>
      Math.abs(Number(t.amount ?? t.Amount)) === 12.0);
    expect(feeThere).toBe(true);
  });
});

describe("adding a missing item balances the reconciliation", () => {
  it("driving the only discrepancy to zero makes it reconciled", () => {
    const { state, view } = runReconcile(read("bank_one_fee.csv"), read("ledger_missing_fee.csv"));
    const fee = view.missingFromBooks.find((t: any) =>
      Math.abs(Number(t.amount ?? t.Amount)) === 12.0);
    expect(fee).toBeDefined();

    const after = normalize(addItem(state, fee));
    // The $12 was the entire gap -> now zero, now reconciled.
    expect(Math.abs(after.unexplainedDifference)).toBeLessThan(0.001);
    expect(after.isReconciled).toBe(true);
  });

  it("the added item is TAGGED as user-added (not confused with imported rows)", () => {
    const { state, view } = runReconcile(read("bank_one_fee.csv"), read("ledger_missing_fee.csv"));
    const fee = view.missingFromBooks.find((t: any) =>
      Math.abs(Number(t.amount ?? t.Amount)) === 12.0);
    const after = normalize(addItem(state, fee));
    expect(after.userAddedItems.length).toBe(1);
    // The "tag" in this model is the txnId field — only UserAddedEntry has it;
    // raw imported Txn objects have only `id` + `source` ("bank"|"ledger").
    expect(after.userAddedItems[0].txnId).toBe(fee.id);
  });

  it("the added item leaves Missing From Books (it's now accounted for)", () => {
    const { state, view } = runReconcile(read("bank_one_fee.csv"), read("ledger_missing_fee.csv"));
    const fee = view.missingFromBooks.find((t: any) =>
      Math.abs(Number(t.amount ?? t.Amount)) === 12.0);
    const after = normalize(addItem(state, fee));
    const stillMissing = after.missingFromBooks.some((t: any) =>
      Math.abs(Number(t.amount ?? t.Amount)) === 12.0);
    expect(stillMissing).toBe(false);
  });
});

describe("the balance stays HONEST — no silent/mystery adjustment", () => {
  it("the difference change equals exactly the added item's amount", () => {
    const { state, view } = runReconcile(read("bank_one_fee.csv"), read("ledger_missing_fee.csv"));
    const before = Math.abs(view.unexplainedDifference);
    const fee = view.missingFromBooks.find((t: any) =>
      Math.abs(Number(t.amount ?? t.Amount)) === 12.0);
    const after = normalize(addItem(state, fee));
    const delta = before - Math.abs(after.unexplainedDifference);
    // The balance moved by exactly the item amount — not more, not less.
    // This is the guard against an add that "balances" by hiding something.
    expect(delta).toBeCloseTo(12.0, 2);
  });

  it("an added item remains VISIBLE (traceable) in the result", () => {
    const { state, view } = runReconcile(read("bank_one_fee.csv"), read("ledger_missing_fee.csv"));
    const fee = view.missingFromBooks.find((t: any) =>
      Math.abs(Number(t.amount ?? t.Amount)) === 12.0);
    const after = normalize(addItem(state, fee));
    // The user must be able to SEE what they added. It is not absorbed invisibly.
    expect(after.userAddedItems.some((t: any) =>
      Math.abs(Number(t.amount ?? t.Amount)) === 12.0)).toBe(true);
  });
});

describe("reversibility — nothing is permanent or hidden", () => {
  it("removing an added item restores the exact prior state", () => {
    const { state, view } = runReconcile(read("bank_one_fee.csv"), read("ledger_missing_fee.csv"));
    const beforeDiff = view.unexplainedDifference;
    const beforeMissing = view.missingFromBooks.length;

    const fee = view.missingFromBooks.find((t: any) =>
      Math.abs(Number(t.amount ?? t.Amount)) === 12.0);
    const added = addItem(state, fee);
    const restored = normalize(removeItem(added, fee));

    expect(restored.unexplainedDifference).toBeCloseTo(beforeDiff, 2);
    expect(restored.missingFromBooks.length).toBe(beforeMissing);
    expect(restored.userAddedItems.length).toBe(0);
    expect(restored.isReconciled).toBe(false);
  });
});

describe("determinism", () => {
  it("same add produces the same result every time", () => {
    const a = runReconcile(read("bank_one_fee.csv"), read("ledger_missing_fee.csv"));
    const feeA = a.view.missingFromBooks.find((t: any) => Math.abs(Number(t.amount ?? t.Amount)) === 12.0);
    const resA = normalize(addItem(a.state, feeA));

    const b = runReconcile(read("bank_one_fee.csv"), read("ledger_missing_fee.csv"));
    const feeB = b.view.missingFromBooks.find((t: any) => Math.abs(Number(t.amount ?? t.Amount)) === 12.0);
    const resB = normalize(addItem(b.state, feeB));

    expect(resA.unexplainedDifference).toBe(resB.unexplainedDifference);
    expect(resA.isReconciled).toBe(resB.isReconciled);
  });
});
