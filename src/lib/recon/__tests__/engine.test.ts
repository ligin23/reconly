import { describe, it, expect } from "vitest";
import {
  reconcile,
  DATE_WINDOW,
  NEAR_DESC_THRESHOLD,
  COMPOSITE_DATE_WINDOW,
  COMPOSITE_MAX_GROUP,
  COMPOSITE_MIN_GROUP,
  enrichReasons,
  findCompositeMatches,
} from "../engine";
import { normalize } from "../normalize";
import { descriptionSimilarity } from "../similarity";
import type { Txn } from "../types";

// ---- helpers ---------------------------------------------------------

function bank(
  id: string,
  date: string,
  description: string,
  amount: number,
  reference?: string
): Txn {
  return { id, source: "bank", date, description, amount, reference, raw: {} };
}

function ledger(
  id: string,
  date: string,
  description: string,
  amount: number
): Txn {
  return { id, source: "ledger", date, description, amount, raw: {} };
}

// ======================================================================
// 1. Normalize
// ======================================================================

describe("normalize", () => {
  it("uppercases and strips punctuation", () => {
    // "—" becomes a space, then whitespace is collapsed
    expect(normalize("Figma — annual plan")).toBe("FIGMA ANNUAL PLAN");
  });

  it("collapses whitespace", () => {
    // "   " and "*" both become spaces, all collapsed to one
    expect(normalize("UBER   *EATS")).toBe("UBER EATS");
  });

  it("two identical descriptions normalize to the same string", () => {
    const a = normalize("Google Workspace");
    const b = normalize("GOOGLE WORKSPACE");
    expect(a).toBe(b);
  });
});

// ======================================================================
// 2. Description similarity
// ======================================================================

describe("descriptionSimilarity", () => {
  it("identical strings score 1", () => {
    const n = normalize("SQUARESPACE INC");
    expect(descriptionSimilarity(n, n)).toBe(1);
  });

  it("totally different strings score low", () => {
    const score = descriptionSimilarity(
      normalize("CEDAR BANK FEE"),
      normalize("CLIENT PAYMENT HARBORLINE")
    );
    expect(score).toBeLessThan(0.2);
  });

  it("same brand different wording scores above threshold", () => {
    // "SQUARESPACE INC" vs "SQUARESPACE SUBSCRIPTION"
    const score = descriptionSimilarity(
      normalize("SQUARESPACE INC"),
      normalize("Squarespace subscription")
    );
    expect(score).toBeGreaterThanOrEqual(NEAR_DESC_THRESHOLD);
  });

  it("trigrams help with partial-word overlaps", () => {
    // "ADOBE CREATIVE CLOUD" vs "ADOBE CC" — share "ADOBE" tokens AND trigrams
    const score = descriptionSimilarity(
      normalize("ADOBE CREATIVE CLOUD"),
      normalize("Adobe CC")
    );
    // At minimum they share the "ADOBE" word token and some trigrams
    expect(score).toBeGreaterThan(0);
  });
});

// ======================================================================
// 3. Exact matching
// ======================================================================

describe("reconcile — exact matches", () => {
  const bankTxns: Txn[] = [
    bank("b1", "2026-03-15", "Figma annual plan", -14400),
    bank("b2", "2026-03-20", "Client payment Harborline", 320000),
    bank("b3", "2026-03-25", "Adobe Creative Cloud", -5999),
  ];
  const ledgerTxns: Txn[] = [
    ledger("l1", "2026-03-15", "Figma annual plan", -14400),
    ledger("l2", "2026-03-20", "Client payment Harborline", 320000),
    ledger("l3", "2026-03-25", "Adobe Creative Cloud", -5999),
  ];

  it("produces one match per pair", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    expect(result.matches).toHaveLength(3);
  });

  it("all exact matches have confidence 100 and status accepted", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    for (const m of result.matches) {
      expect(m.type).toBe("exact");
      expect(m.confidence).toBe(100);
      expect(m.status).toBe("accepted");
    }
  });

  it("no missing-from-books or missing-from-bank when all matched", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    expect(result.missingFromBooks).toHaveLength(0);
    expect(result.missingFromBank).toHaveLength(0);
  });

  it("is reconciled when all txns match", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    expect(result.reconciled).toBe(true);
    expect(result.balanceProof.unexplainedDifference).toBe(0);
  });

  it("each match has reasons including an amount reason", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    for (const m of result.matches) {
      expect(m.reasons.length).toBeGreaterThanOrEqual(2);
      expect(m.reasons[0]).toMatch(/amounts match exactly/i);
    }
  });

  it("matches are one-to-one (no txn appears in two matches)", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    const bankIds = result.matches.map((m) => m.bankTxnId);
    const ledgerIds = result.matches.map((m) => m.ledgerTxnId);
    expect(new Set(bankIds).size).toBe(bankIds.length);
    expect(new Set(ledgerIds).size).toBe(ledgerIds.length);
  });
});

// ======================================================================
// 4. Near matching (date off, partial description)
// ======================================================================

describe("reconcile — near matches", () => {
  // SQUARESPACE: same amount, dates differ by 2 days, brand name matches
  const bankTxns: Txn[] = [
    bank("b1", "2026-03-24", "SQUARESPACE INC", -4800),
  ];
  const ledgerTxns: Txn[] = [
    ledger("l1", "2026-03-22", "Squarespace subscription", -4800),
  ];

  it("produces a near match", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].type).toBe("near");
  });

  it("near match has status suggested", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    expect(result.matches[0].status).toBe("suggested");
  });

  it("confidence is in range [70, 99]", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    const c = result.matches[0].confidence;
    expect(c).toBeGreaterThanOrEqual(70);
    expect(c).toBeLessThanOrEqual(99);
  });

  it("confidence is reproducible from same inputs", () => {
    const r1 = reconcile(bankTxns, ledgerTxns);
    const r2 = reconcile(bankTxns, ledgerTxns);
    expect(r1.matches[0].confidence).toBe(r2.matches[0].confidence);
  });

  it("reasons mention the date difference", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    const dateReason = result.matches[0].reasons.find((r) =>
      /dates differ/i.test(r)
    );
    expect(dateReason).toBeDefined();
    expect(dateReason).toMatch(/2 days/);
  });

  it("txn outside DATE_WINDOW is not matched", () => {
    const farBank: Txn[] = [bank("b1", "2026-03-01", "SQUARESPACE INC", -4800)];
    const nearLedger: Txn[] = [
      ledger("l1", "2026-03-10", "Squarespace subscription", -4800), // 9 days apart
    ];
    const result = reconcile(farBank, nearLedger);
    expect(result.matches).toHaveLength(0);
  });

  it("different amounts are never matched", () => {
    const differentAmounts: Txn[] = [
      bank("b1", "2026-03-24", "SQUARESPACE INC", -4800),
    ];
    const differentLedger: Txn[] = [
      ledger("l1", "2026-03-24", "Squarespace subscription", -4900), // $1 off
    ];
    const result = reconcile(differentAmounts, differentLedger);
    expect(result.matches).toHaveLength(0);
  });
});

// ======================================================================
// 5. Greedy one-to-one assignment
// ======================================================================

describe("reconcile — greedy assignment", () => {
  it("picks the highest-confidence match when candidates compete", () => {
    // b1 could match l1 (same date) or l2 (date off by 1).
    // b1:l1 should win (higher confidence).
    const bankTxns: Txn[] = [
      bank("b1", "2026-03-10", "Dribbble PRO", -5400),
    ];
    const ledgerTxns: Txn[] = [
      ledger("l1", "2026-03-10", "Dribbble PRO", -5400),  // exact
      ledger("l2", "2026-03-09", "Dribbble yearly", -5400), // near
    ];
    const result = reconcile(bankTxns, ledgerTxns);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].type).toBe("exact");
    expect(result.matches[0].ledgerTxnId).toBe("l1");
    // l2 is left unmatched (missing from bank perspective)
    expect(result.missingFromBank).toHaveLength(1);
    expect(result.missingFromBank[0].id).toBe("l2");
  });
});

// ======================================================================
// 6. ADVERSARIAL: high match rate but nonzero unexplained difference
//    This is the key invariant: reconciled = (unexplainedDifference === 0),
//    NOT (matchedCount / totalCount is high).
// ======================================================================

describe("reconcile — adversarial balance proof", () => {
  // 3 matched pairs + one bank-only fee with no ledger counterpart.
  // Match rate = 3/3 possible pairs = 100% ... but unexplained = $35.
  const bankTxns: Txn[] = [
    bank("b1", "2026-03-15", "Figma annual plan", -14400),
    bank("b2", "2026-03-20", "Client payment Harborline", 320000),
    bank("b3", "2026-03-25", "Adobe Creative Cloud", -5999),
    // Bank fee — no ledger entry. This is the adversarial item.
    bank("b4", "2026-03-29", "Monthly account fee", -3500),
  ];
  const ledgerTxns: Txn[] = [
    ledger("l1", "2026-03-15", "Figma annual plan", -14400),
    ledger("l2", "2026-03-20", "Client payment Harborline", 320000),
    ledger("l3", "2026-03-25", "Adobe Creative Cloud", -5999),
    // NO matching entry for the $35 bank fee.
  ];

  it("matches the 3 correct pairs", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    expect(result.matches).toHaveLength(3);
  });

  it("the bank fee appears as missingFromBooks", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    expect(result.missingFromBooks).toHaveLength(1);
    expect(result.missingFromBooks[0].id).toBe("b4");
    expect(result.missingFromBooks[0].amount).toBe(-3500);
  });

  it("unexplainedDifference equals the bank fee amount", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    // bankNetChange is $35 lower (more negative) than ledgerNetChange
    expect(result.balanceProof.unexplainedDifference).toBe(-3500);
  });

  it("is NOT reconciled despite 100% pair-match rate", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    expect(result.reconciled).toBe(false);
  });

  it("is reconciled once the fee has a ledger counterpart", () => {
    // Add the $35 entry to the ledger → unexplained drops to 0.
    const correctedLedger = [
      ...ledgerTxns,
      ledger("l4", "2026-03-29", "Monthly account fee", -3500),
    ];
    const result = reconcile(bankTxns, correctedLedger);
    expect(result.reconciled).toBe(true);
    expect(result.balanceProof.unexplainedDifference).toBe(0);
    expect(result.matches).toHaveLength(4);
  });
});

// ======================================================================
// 7. enrichReasons — reasons → {ok, text} for the review UI
// ======================================================================

describe("enrichReasons", () => {
  it("marks amount and date-match reasons as ok:true", () => {
    const rich = enrichReasons([
      "Amounts match exactly ($48.00)",
      "Same day",
      "Names look like the same company",
    ]);
    expect(rich.every((r) => r.ok)).toBe(true);
  });

  it("marks date-diff and wording reasons as ok:false", () => {
    const rich = enrichReasons([
      "Dates differ by 2 days",
      "Wording is quite different",
    ]);
    expect(rich.every((r) => !r.ok)).toBe(true);
  });

  it("preserves the original text strings", () => {
    const reasons = ["Amounts match exactly ($12.00)", "Dates differ by 1 day"];
    const rich = enrichReasons(reasons);
    expect(rich.map((r) => r.text)).toEqual(reasons);
  });
});

// ======================================================================
// 8. Constants are exported and named
// ======================================================================

describe("engine constants", () => {
  it("DATE_WINDOW is 5 days", () => {
    expect(DATE_WINDOW).toBe(5);
  });

  it("NEAR_DESC_THRESHOLD is between 0 and 1", () => {
    expect(NEAR_DESC_THRESHOLD).toBeGreaterThan(0);
    expect(NEAR_DESC_THRESHOLD).toBeLessThan(1);
  });
});

// ======================================================================
// 9. reconcile() with composite matching wired in
// ======================================================================

describe("reconcile — composite matching wired in", () => {
  // Bank: one $1,000 deposit that's three ledger invoices batched together.
  // Ledger: three invoices plus one unrelated payment that matches one-to-one.
  const bankTxns: Txn[] = [
    bank("b1", "2026-03-15", "Bulk deposit", 100000),   // $1,000 composite target
    bank("b2", "2026-03-20", "Client payment", 50000),  // $500 one-to-one
  ];
  const ledgerTxns: Txn[] = [
    ledger("l1", "2026-03-12", "Invoice #101", 30000),  // $300 — composite component
    ledger("l2", "2026-03-13", "Invoice #102", 30000),  // $300 — composite component
    ledger("l3", "2026-03-14", "Invoice #103", 40000),  // $400 — composite component
    ledger("l4", "2026-03-20", "Client payment", 50000), // $500 — one-to-one match for b2
  ];

  it("returns composite matches alongside one-to-one matches", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    expect(result.compositeMatches).toHaveLength(1);
    expect(result.compositeMatches[0].bankTxnId).toBe("b1");
    expect(result.compositeMatches[0].ledgerTxnIds).toEqual(
      expect.arrayContaining(["l1", "l2", "l3"])
    );
  });

  it("composite bank txn is NOT in missingFromBooks", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    const missingIds = result.missingFromBooks.map((t) => t.id);
    expect(missingIds).not.toContain("b1");
  });

  it("composite ledger txns are NOT in missingFromBank", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    const missingIds = result.missingFromBank.map((t) => t.id);
    expect(missingIds).not.toContain("l1");
    expect(missingIds).not.toContain("l2");
    expect(missingIds).not.toContain("l3");
  });

  it("one-to-one matches still work alongside composites", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].bankTxnId).toBe("b2");
    expect(result.matches[0].ledgerTxnId).toBe("l4");
  });

  it("composite suggestions do NOT contribute to clearedSum (only accepted matches do)", () => {
    const result = reconcile(bankTxns, ledgerTxns);
    // b2:l4 is an exact match → accepted → contributes $500
    // b1 composite is suggested → NOT cleared
    expect(result.balanceProof.clearedSum).toBe(50000);
  });

  it("integrity: every txn is accounted for exactly once", () => {
    const result = reconcile(bankTxns, ledgerTxns);

    const accountedBankIds = new Set<string>([
      ...result.matches.map((m) => m.bankTxnId),
      ...result.compositeMatches.map((c) => c.bankTxnId),
      ...result.missingFromBooks.map((t) => t.id),
    ]);
    const accountedLedgerIds = new Set<string>([
      ...result.matches.map((m) => m.ledgerTxnId),
      ...result.compositeMatches.flatMap((c) => c.ledgerTxnIds),
      ...result.missingFromBank.map((t) => t.id),
    ]);

    expect(accountedBankIds.size).toBe(bankTxns.length);
    expect(accountedLedgerIds.size).toBe(ledgerTxns.length);
    for (const t of bankTxns) expect(accountedBankIds.has(t.id)).toBe(true);
    for (const t of ledgerTxns) expect(accountedLedgerIds.has(t.id)).toBe(true);
  });
});

// ======================================================================
// 10. findCompositeMatches — pure search (Phase 1 tests)
// ======================================================================

describe("findCompositeMatches", () => {
  // ------------------------------------------------------------------ //
  // Basic: clean 3-invoice → 1 deposit
  // ------------------------------------------------------------------ //

  it("finds an unambiguous 3-item composite match", () => {
    const bankTxns: Txn[] = [
      bank("b1", "2026-03-15", "Bulk deposit", 100000), // $1,000
    ];
    const ledgerTxns: Txn[] = [
      ledger("l1", "2026-03-12", "Invoice #101", 30000), // $300
      ledger("l2", "2026-03-13", "Invoice #102", 30000), // $300
      ledger("l3", "2026-03-14", "Invoice #103", 40000), // $400
    ];
    const results = findCompositeMatches(bankTxns, ledgerTxns);

    expect(results).toHaveLength(1);
    const m = results[0];
    expect(m.ambiguous).toBe(false);
    expect(m.type).toBe("composite");
    expect(m.status).toBe("suggested");
    expect(m.bankTxnId).toBe("b1");
    expect(m.ledgerTxnIds).toHaveLength(3);
    expect(m.ledgerTxnIds).toEqual(expect.arrayContaining(["l1", "l2", "l3"]));
  });

  it("generates plain-English reasons mentioning count and total", () => {
    const bankTxns: Txn[] = [
      bank("b1", "2026-03-15", "Bulk deposit", 100000),
    ];
    const ledgerTxns: Txn[] = [
      ledger("l1", "2026-03-12", "Invoice #101", 30000),
      ledger("l2", "2026-03-13", "Invoice #102", 30000),
      ledger("l3", "2026-03-14", "Invoice #103", 40000),
    ];
    const [m] = findCompositeMatches(bankTxns, ledgerTxns);
    expect(m.reasons.length).toBeGreaterThan(0);
    expect(m.reasons[0]).toMatch(/3 items/);
    expect(m.reasons[0]).toMatch(/\$1,000\.00/);
  });

  // ------------------------------------------------------------------ //
  // HARD GATE: ambiguous case must NEVER be auto-picked
  // ------------------------------------------------------------------ //

  it("flags as ambiguous when two combinations sum to the same target", () => {
    // Two valid combos: [l1,l2] = 500+500 = 1000  and  [l3,l4] = 300+700 = 1000
    const bankTxns: Txn[] = [
      bank("b1", "2026-03-15", "Bulk deposit", 100000),
    ];
    const ledgerTxns: Txn[] = [
      ledger("l1", "2026-03-12", "Invoice A", 50000), // $500
      ledger("l2", "2026-03-12", "Invoice B", 50000), // $500
      ledger("l3", "2026-03-13", "Invoice C", 30000), // $300
      ledger("l4", "2026-03-13", "Invoice D", 70000), // $700
    ];
    const results = findCompositeMatches(bankTxns, ledgerTxns);

    expect(results).toHaveLength(1);
    const m = results[0];
    expect(m.ambiguous).toBe(true);
  });

  it("NEVER auto-selects a combination when the match is ambiguous", () => {
    // This is the hard gate: if ambiguous, allCombinations must have length > 1
    // and ledgerTxnIds must be the UNION (not one picked set)
    const bankTxns: Txn[] = [
      bank("b1", "2026-03-15", "Bulk deposit", 100000),
    ];
    const ledgerTxns: Txn[] = [
      ledger("l1", "2026-03-12", "Invoice A", 50000),
      ledger("l2", "2026-03-12", "Invoice B", 50000),
      ledger("l3", "2026-03-13", "Invoice C", 30000),
      ledger("l4", "2026-03-13", "Invoice D", 70000),
    ];
    const results = findCompositeMatches(bankTxns, ledgerTxns);
    const m = results[0];

    // Must be flagged ambiguous
    expect(m.ambiguous).toBe(true);

    // allCombinations holds both competing sets
    if (m.ambiguous) {
      expect(m.allCombinations).toHaveLength(2);
      // Both combinations must be present (order-independent)
      const flatCombos = m.allCombinations.map((c) => [...c].sort().join(","));
      expect(flatCombos).toEqual(expect.arrayContaining(["l1,l2", "l3,l4"]));
    }

    // ledgerTxnIds is the UNION, not a pre-selected winner
    expect(m.ledgerTxnIds).toHaveLength(4);
    expect(m.ledgerTxnIds).toEqual(
      expect.arrayContaining(["l1", "l2", "l3", "l4"])
    );
  });

  // ------------------------------------------------------------------ //
  // No match cases
  // ------------------------------------------------------------------ //

  it("returns nothing when no combination sums to the target", () => {
    const bankTxns: Txn[] = [
      bank("b1", "2026-03-15", "Deposit", 100000), // $1,000
    ];
    const ledgerTxns: Txn[] = [
      ledger("l1", "2026-03-12", "Invoice A", 40000), // $400
      ledger("l2", "2026-03-12", "Invoice B", 40000), // $400 — 400+400 ≠ 1000
    ];
    expect(findCompositeMatches(bankTxns, ledgerTxns)).toHaveLength(0);
  });

  // ------------------------------------------------------------------ //
  // Date window constraint
  // ------------------------------------------------------------------ //

  it("excludes items outside COMPOSITE_DATE_WINDOW", () => {
    // l1 is 15 days before the bank txn — outside the 14-day window
    const bankDate = "2026-03-30";
    const outsideDate = "2026-03-14"; // 16 days before
    const insideDate = "2026-03-28"; //  2 days before

    const bankTxns: Txn[] = [bank("b1", bankDate, "Deposit", 100000)];
    const ledgerTxns: Txn[] = [
      ledger("l1", outsideDate, "Invoice A", 60000), // outside window
      ledger("l2", insideDate, "Invoice B", 40000),  // inside window
      // Only l2 is eligible, and 40000 alone < 100000 → no valid combo
    ];
    expect(findCompositeMatches(bankTxns, ledgerTxns)).toHaveLength(0);
  });

  it("COMPOSITE_DATE_WINDOW is wider than DATE_WINDOW", () => {
    expect(COMPOSITE_DATE_WINDOW).toBeGreaterThan(DATE_WINDOW);
  });

  // ------------------------------------------------------------------ //
  // Sign constraint — no mixing inflows and outflows
  // ------------------------------------------------------------------ //

  it("does not mix inflows and outflows in a combination", () => {
    // Mixed-sign combo ($1200 + -$200 = $1000) must be rejected.
    // Only the same-sign combo ($600 + $400 = $1000) should be proposed.
    const bankTxns: Txn[] = [
      bank("b1", "2026-03-15", "Deposit", 100000), // +$1000 inflow
    ];
    const ledgerTxns: Txn[] = [
      ledger("l1", "2026-03-12", "Big credit", 120000),  // +$1200 — inflow
      ledger("l2", "2026-03-12", "Refund out", -20000),  // -$200  — outflow (filtered)
      ledger("l3", "2026-03-12", "Invoice A", 60000),    // +$600  — inflow
      ledger("l4", "2026-03-12", "Invoice B", 40000),    // +$400  — inflow
    ];
    const results = findCompositeMatches(bankTxns, ledgerTxns);

    expect(results).toHaveLength(1);
    const m = results[0];
    expect(m.ambiguous).toBe(false);
    // Must use the same-sign pair [l3, l4], not the mixed-sign pair [l1, l2]
    expect(m.ledgerTxnIds).toEqual(expect.arrayContaining(["l3", "l4"]));
    expect(m.ledgerTxnIds).not.toContain("l1");
    expect(m.ledgerTxnIds).not.toContain("l2");
  });

  // ------------------------------------------------------------------ //
  // Group size constraint
  // ------------------------------------------------------------------ //

  it("does not propose a single-item match (min group is COMPOSITE_MIN_GROUP)", () => {
    // Single item exactly matching the bank amount must NOT become a composite —
    // that is handled by one-to-one matching, not composite matching.
    const bankTxns: Txn[] = [
      bank("b1", "2026-03-15", "Deposit", 100000),
    ];
    const ledgerTxns: Txn[] = [
      ledger("l1", "2026-03-12", "Single invoice", 100000), // exact match, single item
    ];
    expect(findCompositeMatches(bankTxns, ledgerTxns)).toHaveLength(0);
  });

  it("does not search combinations larger than COMPOSITE_MAX_GROUP", () => {
    // Five items each worth $200 summing to $1000 — requires 5 items (> max of 4)
    const bankTxns: Txn[] = [
      bank("b1", "2026-03-15", "Deposit", 100000), // $1,000
    ];
    const ledgerTxns: Txn[] = [
      ledger("l1", "2026-03-12", "Invoice 1", 20000),
      ledger("l2", "2026-03-12", "Invoice 2", 20000),
      ledger("l3", "2026-03-12", "Invoice 3", 20000),
      ledger("l4", "2026-03-12", "Invoice 4", 20000),
      ledger("l5", "2026-03-12", "Invoice 5", 20000),
    ];
    // Only valid combination needs all 5 items — must be rejected
    expect(findCompositeMatches(bankTxns, ledgerTxns)).toHaveLength(0);
  });

  it("COMPOSITE_MIN_GROUP is 2 and COMPOSITE_MAX_GROUP is 4", () => {
    expect(COMPOSITE_MIN_GROUP).toBe(2);
    expect(COMPOSITE_MAX_GROUP).toBe(4);
  });

  // ------------------------------------------------------------------ //
  // Integrity: nothing double-counted across multiple composites
  // ------------------------------------------------------------------ //

  it("does not assign the same ledger txn to two different composites", () => {
    // b1 and b2 both want [l1, l2] — only b1 (earlier date) should win
    const bankTxns: Txn[] = [
      bank("b1", "2026-03-15", "Deposit A", 70000), // $700 — earlier, higher priority
      bank("b2", "2026-03-16", "Deposit B", 70000), // $700 — later, loses the conflict
    ];
    const ledgerTxns: Txn[] = [
      ledger("l1", "2026-03-12", "Invoice 1", 30000), // $300
      ledger("l2", "2026-03-12", "Invoice 2", 40000), // $400
      // 300+400=700 — the only valid combo, wanted by both b1 and b2
    ];
    const results = findCompositeMatches(bankTxns, ledgerTxns);

    // Only one composite is proposed (b1 wins, b2 is dropped)
    expect(results).toHaveLength(1);
    expect(results[0].bankTxnId).toBe("b1");

    // Collect ALL ledger IDs across all composites — must have no duplicates
    const allLedgerIds: string[] = [];
    for (const m of results) allLedgerIds.push(...m.ledgerTxnIds);
    expect(new Set(allLedgerIds).size).toBe(allLedgerIds.length);
  });

  // ------------------------------------------------------------------ //
  // Determinism
  // ------------------------------------------------------------------ //

  it("produces identical output when called twice with the same input", () => {
    const bankTxns: Txn[] = [
      bank("b1", "2026-03-15", "Bulk deposit", 100000),
    ];
    const ledgerTxns: Txn[] = [
      ledger("l1", "2026-03-12", "Invoice #101", 30000),
      ledger("l2", "2026-03-13", "Invoice #102", 30000),
      ledger("l3", "2026-03-14", "Invoice #103", 40000),
    ];
    const r1 = findCompositeMatches(bankTxns, ledgerTxns);
    const r2 = findCompositeMatches(bankTxns, ledgerTxns);
    expect(r1).toEqual(r2);
  });

  // ------------------------------------------------------------------ //
  // Role-parameterized seam: swapping sides searches the reverse direction
  // ------------------------------------------------------------------ //

  it("works in the reverse role (future seam: one-ledger → many-bank)", () => {
    // Swap: one ledger payment split across two bank debits
    // ledger: one $700 payment
    // bank: two debits $300 + $400 summing to $700
    const ledgerTxns: Txn[] = [
      ledger("l1", "2026-03-15", "Single payment", -70000), // -$700
    ];
    const bankTxns: Txn[] = [
      bank("b1", "2026-03-13", "Debit part 1", -30000), // -$300
      bank("b2", "2026-03-14", "Debit part 2", -40000), // -$400
    ];
    // Call with roles reversed: one-side = ledger, many-side = bank
    const results = findCompositeMatches(ledgerTxns, bankTxns);
    expect(results).toHaveLength(1);
    expect(results[0].ambiguous).toBe(false);
    expect(results[0].bankTxnId).toBe("l1"); // "one side" target
    expect(results[0].ledgerTxnIds).toEqual(
      expect.arrayContaining(["b1", "b2"])  // "many side" components
    );
  });
});
