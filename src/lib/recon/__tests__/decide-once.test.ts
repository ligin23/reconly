/**
 * A review decision is recorded exactly once (Review navigation fix).
 * The Review screen now commits on click; these guards make a second click,
 * a click during the exit animation, or a stale handler a no-op instead of
 * a second — possibly different — decision. Undo is the only way to change one.
 * The matching engine is used as-is.
 */
import { describe, it, expect } from "vitest";
import { reconcile } from "@/lib/recon/engine";
import {
  decideCompositeOnce,
  decideMatchOnce,
  reviewProgress,
  undoMatchDecision,
} from "@/lib/recon/decisions";
import type { Match, Txn } from "@/lib/recon/types";

const txn = (id: string, source: "bank" | "ledger", date: string, description: string, amount: number): Txn => ({
  id, source, date, description, amount, raw: {},
});
const match = (id: string, type: Match["type"], status: Match["status"]): Match => ({
  id, bankTxnId: `b-${id}`, ledgerTxnId: `l-${id}`, type, confidence: 80, status, reasons: [],
});

describe("decideMatchOnce", () => {
  it("records the first decision on a pending pair", () => {
    const ms = [match("a", "near", "suggested")];
    expect(decideMatchOnce(ms, "a", "accept")[0].status).toBe("accepted");
    expect(decideMatchOnce(ms, "a", "reject")[0].status).toBe("rejected");
  });

  it("ignores a second decision (double-click / accept-then-reject)", () => {
    let ms = [match("a", "near", "suggested"), match("b", "fuzzy", "suggested")];
    ms = decideMatchOnce(ms, "a", "accept");
    const again = decideMatchOnce(ms, "a", "reject");
    expect(again).toBe(ms); // unchanged reference — nothing re-rendered or re-counted
    expect(again.map((m) => m.status)).toEqual(["accepted", "suggested"]);
    expect(reviewProgress(again, [])).toEqual({ total: 2, decided: 1, pending: 1 });
  });

  it("never touches an engine-confirmed exact match or an unknown id", () => {
    const ms = [match("x", "exact", "accepted")];
    expect(decideMatchOnce(ms, "x", "reject")).toBe(ms);
    expect(decideMatchOnce(ms, "nope", "accept")).toBe(ms);
  });

  it("after Undo the pair can be decided again", () => {
    let ms = decideMatchOnce([match("a", "near", "suggested")], "a", "accept");
    ms = undoMatchDecision(ms, "a");
    expect(decideMatchOnce(ms, "a", "reject")[0].status).toBe("rejected");
  });
});

describe("decideCompositeOnce", () => {
  const groupScenario = () =>
    reconcile(
      [txn("bank-0", "bank", "2026-01-12", "STRIPE PAYOUT", 475000)],
      [
        txn("ledger-0", "ledger", "2026-01-06", "Invoice 1041 Harbor", 150000),
        txn("ledger-1", "ledger", "2026-01-07", "Invoice 1042 Quill", 200000),
        txn("ledger-2", "ledger", "2026-01-09", "Invoice 1043 Fernwood", 125000),
      ]
    );
  const ambiguousScenario = () =>
    reconcile(
      [txn("bank-0", "bank", "2026-03-10", "STRIPE PAYOUT", 10000)],
      [
        txn("ledger-0", "ledger", "2026-03-08", "Invoice 101 Acme", 6000),
        txn("ledger-1", "ledger", "2026-03-08", "Invoice 102 Birch", 4000),
        txn("ledger-2", "ledger", "2026-03-09", "Invoice 103 Cedar", 7000),
        txn("ledger-3", "ledger", "2026-03-09", "Invoice 104 Dune", 3000),
      ]
    );

  it("a grouped match keeps its first decision", () => {
    const cs = groupScenario().compositeMatches;
    expect(cs).toHaveLength(1);
    const accepted = decideCompositeOnce(cs, cs[0].id, "accept");
    expect(accepted[0].status).toBe("accepted");
    expect(decideCompositeOnce(accepted, cs[0].id, "reject")).toBe(accepted);
  });

  it("an ambiguous group keeps the combination picked first", () => {
    const cs = ambiguousScenario().compositeMatches;
    const c = cs[0];
    expect(c.ambiguous).toBe(true);
    const [first, second] = c.allCombinations!;
    const picked = decideCompositeOnce(cs, c.id, "accept", first);
    expect(picked[0].ledgerTxnIds).toEqual(first);
    // A second click with a different pick, or a reject, changes nothing.
    expect(decideCompositeOnce(picked, c.id, "accept", second)).toBe(picked);
    expect(decideCompositeOnce(picked, c.id, "reject")).toBe(picked);
  });

  it("accepting an ambiguous group without a pick still records nothing", () => {
    const cs = ambiguousScenario().compositeMatches;
    const out = decideCompositeOnce(cs, cs[0].id, "accept");
    expect(out[0].status).toBe("suggested");
  });
});
