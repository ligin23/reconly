import { describe, it, expect } from "vitest";
import { reconcile, DATE_WINDOW, NEAR_DESC_THRESHOLD, enrichReasons } from "../engine";
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
