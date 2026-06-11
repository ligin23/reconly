import { describe, it, expect } from "vitest";
import { reconcile } from "../engine";
import type { Txn, ReconResult } from "../types";

// ---- helpers ---------------------------------------------------------

function bank(id: string, date: string, description: string, amount: number): Txn {
  return { id, source: "bank", date, description, amount, raw: {} };
}

function ledger(id: string, date: string, description: string, amount: number): Txn {
  return { id, source: "ledger", date, description, amount, raw: {} };
}

/**
 * A pair verified in fuzzy-similarity.test.ts: raw similarity below the near
 * threshold, fuzzy similarity above the floor. Dates 3 days apart so the
 * tight ≤1-day near bypass doesn't fire.
 */
const NOISY_BANK_DESC =
  "POS DEBIT 9921 STARBUCKS RESERVE 04412 SEATTLE WA REF 2200391";
const CLEAN_LEDGER_DESC = "Starbucks coffee";

function fuzzyMatches(result: ReconResult) {
  return result.matches.filter((m) => m.type === "fuzzy");
}

// ======================================================================
// 1. The fuzzy tier produces suggestions
// ======================================================================

describe("reconcile — fuzzy tier", () => {
  const bankTxns = [bank("b1", "2026-03-10", NOISY_BANK_DESC, -1850)];
  const ledgerTxns = [ledger("l1", "2026-03-13", CLEAN_LEDGER_DESC, -1850)];

  it("rescues a noisy pair the near tier misses", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    const fuzzy = fuzzyMatches(result);
    expect(fuzzy).toHaveLength(1);
    expect(fuzzy[0].bankTxnId).toBe("b1");
    expect(fuzzy[0].ledgerTxnId).toBe("l1");
    expect(result.missingFromBooks).toHaveLength(0);
    expect(result.missingFromBank).toHaveLength(0);
  });

  it("confidence sits strictly inside the fuzzy band, below near", () => {
    const [m] = fuzzyMatches(reconcile(bankTxns, ledgerTxns));
    expect(m.confidence).toBeGreaterThanOrEqual(50);
    expect(m.confidence).toBeLessThanOrEqual(69);
  });

  it("carries plain-English reasons built from the facts", () => {
    const [m] = fuzzyMatches(reconcile(bankTxns, ledgerTxns));
    expect(m.reasons.some((r) => r.startsWith("Amounts match exactly"))).toBe(
      true
    );
    expect(m.reasons.some((r) => r.includes("Dates differ by 3 days"))).toBe(
      true
    );
    expect(
      m.reasons.some((r) => r.includes("store and bank codes"))
    ).toBe(true);
  });

  it("respects the date window — outside it, no fuzzy suggestion", () => {
    const result = reconcile(bankTxns, [
      ledger("l1", "2026-03-20", CLEAN_LEDGER_DESC, -1850), // 10 days away
    ]);
    expect(fuzzyMatches(result)).toHaveLength(0);
    expect(result.missingFromBooks).toHaveLength(1);
    expect(result.missingFromBank).toHaveLength(1);
  });

  it("below the floor, no suggestion — unrelated vendors stay missing", () => {
    const result = reconcile(
      [bank("b1", "2026-03-10", "CEDAR BANK FEE", -1850)],
      [ledger("l1", "2026-03-13", "HARBORLINE CONSULTING", -1850)]
    );
    expect(result.matches).toHaveLength(0);
    expect(result.missingFromBooks).toHaveLength(1);
    expect(result.missingFromBank).toHaveLength(1);
  });
});

// ======================================================================
// 2. Hard gate (a): amount gating holds — similarity never overrides it
// ======================================================================

describe("reconcile — fuzzy hard gate: amounts", () => {
  it("near-identical descriptions with different amounts are NEVER matched", () => {
    const result = reconcile(
      [bank("b1", "2026-03-10", NOISY_BANK_DESC, -1850)],
      [ledger("l1", "2026-03-13", CLEAN_LEDGER_DESC, -1900)]
    );
    expect(result.matches).toHaveLength(0);
    expect(result.missingFromBooks.map((t) => t.id)).toEqual(["b1"]);
    expect(result.missingFromBank.map((t) => t.id)).toEqual(["l1"]);
  });

  it("identical descriptions, identical date, one cent apart — no match", () => {
    const result = reconcile(
      [bank("b1", "2026-03-10", "Starbucks coffee", -1850)],
      [ledger("l1", "2026-03-10", "Starbucks coffee", -1849)]
    );
    expect(result.matches).toHaveLength(0);
  });

  it("same magnitude, opposite sign — no match", () => {
    const result = reconcile(
      [bank("b1", "2026-03-10", NOISY_BANK_DESC, -1850)],
      [ledger("l1", "2026-03-13", CLEAN_LEDGER_DESC, 1850)]
    );
    expect(result.matches).toHaveLength(0);
  });
});

// ======================================================================
// 3. Hard gate (b): no fuzzy match is ever auto-accepted
// ======================================================================

describe("reconcile — fuzzy hard gate: suggestion-only", () => {
  it("every fuzzy match has status 'suggested', even at max fuzzy confidence", () => {
    // "SQ *BLUE BOTTLE COFFEE 0042 9981 X22" vs verbose ledger memo: built to
    // miss near (raw sim diluted) but score high on cleaned similarity.
    // Whatever fuzzy matches exist across these datasets must be suggested.
    const result = reconcile(
      [
        bank("b1", "2026-03-10", NOISY_BANK_DESC, -1850),
        bank("b2", "2026-03-12", "TST* HMSTD CAFE 0042 OAKLAND CA", -4200),
      ],
      [
        ledger("l1", "2026-03-13", CLEAN_LEDGER_DESC, -1850),
        ledger("l2", "2026-03-14", "Homestead Cafe", -4200),
      ]
    );
    const fuzzy = fuzzyMatches(result);
    expect(fuzzy.length).toBeGreaterThan(0);
    for (const m of fuzzy) {
      expect(m.status).toBe("suggested");
    }
  });
});

// ======================================================================
// 4. Tier ordering — fuzzy only runs on leftovers
// ======================================================================

describe("reconcile — fuzzy runs after exact, near, and composite", () => {
  it("a ledger txn claimed by a near match is not fuzzy-matched elsewhere", () => {
    // l1 near-matches b1 (same desc, 2 days). b2 (same amount, noisy desc)
    // must NOT steal l1 via fuzzy — it stays missing.
    const result = reconcile(
      [
        bank("b1", "2026-03-10", "Starbucks coffee", -1850),
        bank("b2", "2026-03-11", NOISY_BANK_DESC, -1850),
      ],
      [ledger("l1", "2026-03-12", "Starbucks coffee", -1850)]
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].type).toBe("near");
    expect(result.matches[0].bankTxnId).toBe("b1");
    expect(result.missingFromBooks.map((t) => t.id)).toEqual(["b2"]);
  });

  it("a ledger txn claimed by a composite is not fuzzy-matched", () => {
    // l1 + l2 sum exactly to b1 → composite claims both. b2 would fuzzy-match
    // l1 (same amount, similar cleaned desc) but must not: composite ran first.
    const result = reconcile(
      [
        bank("b1", "2026-03-10", "Client deposit batch", -3000),
        bank("b2", "2026-03-12", "TST* HMSTD CAFE 0042 OAKLAND CA", -1000),
      ],
      [
        ledger("l1", "2026-03-09", "Homestead Cafe", -1000),
        ledger("l2", "2026-03-09", "Office chairs", -2000),
      ]
    );
    expect(result.compositeMatches).toHaveLength(1);
    expect(result.compositeMatches[0].ledgerTxnIds.sort()).toEqual([
      "l1",
      "l2",
    ]);
    expect(fuzzyMatches(result)).toHaveLength(0);
    expect(result.missingFromBooks.map((t) => t.id)).toEqual(["b2"]);
  });
});

// ======================================================================
// 5. Integrity: nothing vanishes, nothing double-counted
// ======================================================================

describe("reconcile — integrity with fuzzy in play", () => {
  // A mixed dataset exercising all four tiers at once
  const bankTxns = [
    bank("b1", "2026-03-01", "Figma annual plan", -14400), // exact w/ l1
    bank("b2", "2026-03-05", "Adobe Creative Cloud", -5999), // near w/ l2
    bank("b3", "2026-03-10", "Client deposit batch", 300000), // composite l3+l4
    bank("b4", "2026-03-12", NOISY_BANK_DESC, -1850), // fuzzy w/ l5
    bank("b5", "2026-03-15", "Wire transfer out", -99999), // missing
  ];
  const ledgerTxns = [
    ledger("l1", "2026-03-01", "Figma annual plan", -14400),
    ledger("l2", "2026-03-07", "Adobe CC subscription", -5999),
    ledger("l3", "2026-03-08", "Invoice 1041 Harborline", 120000),
    ledger("l4", "2026-03-09", "Invoice 1042 Meridian", 180000),
    ledger("l5", "2026-03-15", CLEAN_LEDGER_DESC, -1850),
    ledger("l6", "2026-03-20", "Equipment lease", -45000), // missing
  ];

  it("exercises all four tiers simultaneously", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    const types = result.matches.map((m) => m.type).sort();
    expect(types).toEqual(["exact", "fuzzy", "near"]);
    expect(result.compositeMatches).toHaveLength(1);
  });

  it("every txn lands in exactly one place — nothing vanishes, nothing doubles", () => {
    const result = reconcile(bankTxns, ledgerTxns);

    const bankSeen = [
      ...result.matches.map((m) => m.bankTxnId),
      ...result.compositeMatches.map((c) => c.bankTxnId),
      ...result.missingFromBooks.map((t) => t.id),
    ];
    const ledgerSeen = [
      ...result.matches.map((m) => m.ledgerTxnId),
      ...result.compositeMatches.flatMap((c) => c.ledgerTxnIds),
      ...result.missingFromBank.map((t) => t.id),
    ];

    expect(bankSeen.sort()).toEqual(bankTxns.map((t) => t.id).sort());
    expect(new Set(bankSeen).size).toBe(bankSeen.length);
    expect(ledgerSeen.sort()).toEqual(ledgerTxns.map((t) => t.id).sort());
    expect(new Set(ledgerSeen).size).toBe(ledgerSeen.length);
  });

  it("is deterministic — two runs produce identical results", () => {
    const a = reconcile(bankTxns, ledgerTxns);
    const b = reconcile(bankTxns, ledgerTxns);
    expect(a).toEqual(b);
  });
});

// ======================================================================
// 6. Balance proof: suggested fuzzy matches do not clear
// ======================================================================

describe("reconcile — balance proof with fuzzy", () => {
  it("a suggested fuzzy match contributes nothing to clearedSum", () => {
    const result = reconcile(
      [bank("b1", "2026-03-10", NOISY_BANK_DESC, -1850)],
      [ledger("l1", "2026-03-13", CLEAN_LEDGER_DESC, -1850)]
    );
    expect(fuzzyMatches(result)).toHaveLength(1);
    expect(result.balanceProof.clearedSum).toBe(0);
  });

  it("reconciled requires a zero difference AND empty missing buckets", () => {
    const result = reconcile(
      [bank("b1", "2026-03-10", NOISY_BANK_DESC, -1850)],
      [ledger("l1", "2026-03-13", CLEAN_LEDGER_DESC, -1850)]
    );
    // Net changes are equal AND both txns are explained by the fuzzy pairing
    // (no missing items), so the first-pass verdict is reconciled. The flag
    // is NOT just the net difference — see the offsetting-errors test below.
    expect(result.balanceProof.unexplainedDifference).toBe(0);
    expect(result.missingFromBooks).toHaveLength(0);
    expect(result.missingFromBank).toHaveLength(0);
    expect(result.reconciled).toBe(true);
  });

  it("offsetting unmatched items (net zero) are NOT reconciled", () => {
    // A bank fee and a bank deposit, both absent from the ledger, with
    // amounts that cancel: the net difference is zero but nothing matches.
    // Reporting "reconciled" here is the classic offsetting-error lie.
    const result = reconcile(
      [
        bank("b1", "2026-03-10", "MONTHLY SERVICE FEE", -5000),
        bank("b2", "2026-03-12", "INTEREST PAYMENT", 5000),
      ],
      []
    );
    expect(result.balanceProof.unexplainedDifference).toBe(0);
    expect(result.missingFromBooks).toHaveLength(2);
    expect(result.reconciled).toBe(false);
  });
});
