/**
 * Regression tests for the resolve-workflow bugs fixed in Phase 0
 * (June review: B10, B12, B13). The matching engine is used as-is.
 */
import { describe, it, expect } from "vitest";
import { reconcile } from "@/lib/recon/engine";
import {
  applyCompositeDecision,
  applyMatchDecision,
  restoreComposites,
  restoreMatches,
  reviewProgress,
} from "@/lib/recon/decisions";
import type { Match, Txn, AnyCompositeMatch } from "@/lib/recon/types";

const txn = (
  id: string,
  source: "bank" | "ledger",
  date: string,
  description: string,
  amount: number
): Txn => ({ id, source, date, description, amount, raw: {} });

const match = (id: string, type: Match["type"], status: Match["status"]): Match => ({
  id,
  bankTxnId: `b-${id}`,
  ledgerTxnId: `l-${id}`,
  type,
  confidence: type === "exact" ? 100 : 80,
  status,
  reasons: [],
});

/** One bank charge that two different pairs of ledger entries add up to. */
function ambiguousScenario() {
  const bank = [txn("bank-0", "bank", "2026-03-10", "STRIPE PAYOUT", 10000)];
  const ledger = [
    txn("ledger-0", "ledger", "2026-03-08", "Invoice 101 Acme", 6000),
    txn("ledger-1", "ledger", "2026-03-08", "Invoice 102 Birch", 4000),
    txn("ledger-2", "ledger", "2026-03-09", "Invoice 103 Cedar", 7000),
    txn("ledger-3", "ledger", "2026-03-09", "Invoice 104 Dune", 3000),
  ];
  const result = reconcile(bank, ledger);
  return { bank, ledger, result };
}

describe("B10 — a review decision is only ever accept or reject", () => {
  it("accept confirms the pairing, reject releases it; nothing else changes", () => {
    const ms = [match("a", "near", "suggested"), match("b", "fuzzy", "suggested")];
    const accepted = applyMatchDecision(ms, "a", "accept");
    expect(accepted.map((m) => m.status)).toEqual(["accepted", "suggested"]);
    const rejected = applyMatchDecision(ms, "b", "reject");
    expect(rejected.map((m) => m.status)).toEqual(["suggested", "rejected"]);
    expect(ms.map((m) => m.status)).toEqual(["suggested", "suggested"]); // not mutated
  });

  it("no decision can produce the legacy 'manual' status", () => {
    const ms = [match("a", "near", "suggested")];
    for (const d of ["accept", "reject"] as const) {
      expect(applyMatchDecision(ms, "a", d)[0].status).not.toBe("manual");
    }
  });

  it("a saved legacy 'manual' status is NOT restored as a confirmed match", () => {
    const fresh = [match("a", "near", "suggested"), match("b", "near", "suggested")];
    const saved = [match("a", "near", "manual"), match("b", "near", "accepted")];
    const restored = restoreMatches(fresh, saved);
    expect(restored[0].status).toBe("suggested"); // back to the user for a real yes/no
    expect(restored[1].status).toBe("accepted");  // genuine decisions survive
  });

  it("restore keeps the engine's status for matches with no saved decision", () => {
    const fresh = [match("a", "exact", "accepted"), match("b", "near", "suggested")];
    expect(restoreMatches(fresh, [])).toEqual(fresh);
  });
});

describe("B12 — review progress counter", () => {
  it("the total never shrinks as composites are decided", () => {
    const ms = [match("a", "near", "suggested"), match("b", "fuzzy", "suggested")];
    let cs = [
      { id: "c1", status: "suggested" },
      { id: "c2", status: "suggested" },
    ] as AnyCompositeMatch[];
    expect(reviewProgress(ms, cs)).toEqual({ total: 4, decided: 0, pending: 4 });

    cs = cs.map((c) => ({ ...c, status: "accepted" })) as AnyCompositeMatch[];
    // Old behaviour: "0 of 2". Correct: "2 of 4".
    expect(reviewProgress(ms, cs)).toEqual({ total: 4, decided: 2, pending: 2 });

    const done = ms.map((m) => ({ ...m, status: "rejected" as const }));
    expect(reviewProgress(done, cs)).toEqual({ total: 4, decided: 4, pending: 0 });
  });

  it("exact matches never count as reviewable", () => {
    expect(reviewProgress([match("a", "exact", "accepted")], [])).toEqual({
      total: 0,
      decided: 0,
      pending: 0,
    });
  });
});

describe("B13 — reopening keeps the composite combination the user picked", () => {
  it("fixture sanity: the engine reports an ambiguous composite with 2 options", () => {
    const { result } = ambiguousScenario();
    expect(result.compositeMatches).toHaveLength(1);
    const c = result.compositeMatches[0];
    expect(c.ambiguous).toBe(true);
    expect(c.allCombinations).toHaveLength(2);
  });

  it("accepting an ambiguous composite requires a pick the engine offered", () => {
    const { result } = ambiguousScenario();
    const id = result.compositeMatches[0].id;
    // No pick → unchanged (never auto-selected).
    expect(applyCompositeDecision(result.compositeMatches, id, "accept")).toEqual(
      result.compositeMatches
    );
    // A combination the engine never offered → unchanged.
    expect(
      applyCompositeDecision(result.compositeMatches, id, "accept", ["ledger-0", "ledger-3"])
    ).toEqual(result.compositeMatches);
  });

  it("save → reopen restores the picked combination, not the union of all candidates", () => {
    const { bank, ledger, result } = ambiguousScenario();
    const id = result.compositeMatches[0].id;
    const pick = ["ledger-2", "ledger-3"];

    const decided = applyCompositeDecision(result.compositeMatches, id, "accept", pick);
    expect(decided[0].status).toBe("accepted");
    expect(decided[0].ledgerTxnIds).toEqual(pick);

    // Reopen: the engine runs again and the saved decision is overlaid.
    const fresh = reconcile(bank, ledger).compositeMatches;
    const restored = restoreComposites(fresh, decided);
    expect(restored[0].status).toBe("accepted");
    expect(restored[0].ambiguous).toBe(false);
    expect([...restored[0].ledgerTxnIds].sort()).toEqual(pick);
    // The other two ledger items must NOT be reported as matched.
    expect(restored[0].ledgerTxnIds).not.toContain("ledger-0");
    expect(restored[0].ledgerTxnIds).not.toContain("ledger-1");
  });

  it("a record damaged by the old bug (accepted, pick lost) goes back to review", () => {
    const { bank, ledger, result } = ambiguousScenario();
    // What the old restore wrote back on re-save: accepted + still ambiguous + union.
    const damaged = [{ ...result.compositeMatches[0], status: "accepted" }] as AnyCompositeMatch[];
    const restored = restoreComposites(reconcile(bank, ledger).compositeMatches, damaged);
    expect(restored[0].status).toBe("suggested");
    expect(restored[0].ambiguous).toBe(true);
  });

  it("rejections and unambiguous acceptances restore as before", () => {
    const { bank, ledger, result } = ambiguousScenario();
    const id = result.compositeMatches[0].id;
    const rejected = applyCompositeDecision(result.compositeMatches, id, "reject");
    const restored = restoreComposites(reconcile(bank, ledger).compositeMatches, rejected);
    expect(restored[0].status).toBe("rejected");
  });
});
