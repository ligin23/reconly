/**
 * Phase 2 — what happens to the reconciliation when a row is set aside or
 * restored. Mirrors AppShell.applyDuplicateState with the same pure
 * functions: the (unchanged) engine is re-run over the rows in use, and
 * the user's existing decisions are carried over where the pairing still
 * exists.
 */
import { describe, it, expect } from "vitest";
import { combineFiles, type ImportFileInput } from "@/lib/import/combine";
import {
  activeTxns,
  detectDuplicates,
  initialDuplicateState,
  restoreRows,
  setAsideRows,
  type DuplicateState,
} from "@/lib/import/duplicates";
import { reconcile } from "@/lib/recon/engine";
import { applyMatchDecision, restoreComposites, restoreMatches } from "@/lib/recon/decisions";
import { buildDashboardData } from "@/lib/recon/adapter";
import type { Match, AnyCompositeMatch, Txn } from "@/lib/recon/types";

const file = (name: string, header: string, rows: string[]): ImportFileInput => ({
  name, content: [header, ...rows].join("\n"), map: undefined as unknown as ImportFileInput["map"],
});
const IDS = "Transaction ID,Date,Description,Amount";

const allBank = combineFiles("bank", [
  file("bank-jan.csv", IDS, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10", "TX2,01/22/2026,CHECK 1042 LANDLORD,-310.00"]),
  file("bank-q1.csv", IDS, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10", "TX2,01/22/2026,CHECK 1042 LANDLORD,-310.00", "TX5,02/27/2026,MONTHLY SERVICE FEE,-12.00"]),
]).txns;
const allLedger = combineFiles("ledger", [
  file("ledger.csv", "Date,Description,Amount", ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/20/2026,CHECK 1042 LANDLORD,-310.00"]),
]).txns;

type Session = { state: DuplicateState; bank: Txn[]; matches: Match[]; composites: AnyCompositeMatch[]; added: string[] };

function start(): Session {
  const state = initialDuplicateState(detectDuplicates("bank", allBank), "t0");
  const bank = activeTxns(allBank, state);
  const r = reconcile(bank, allLedger);
  return { state, bank, matches: r.matches, composites: r.compositeMatches, added: [] };
}

/** Same steps as AppShell.applyDuplicateState. */
function apply(s: Session, next: DuplicateState): Session {
  const bank = activeTxns(allBank, next);
  const r = reconcile(bank, allLedger);
  const ids = new Set(bank.map((t) => t.id));
  return {
    state: next,
    bank,
    matches: restoreMatches(r.matches, s.matches),
    composites: restoreComposites(r.compositeMatches, s.composites),
    added: s.added.filter((id) => ids.has(id)),
  };
}

const unexplained = (s: Session) => reconcile(s.bank, allLedger).balanceProof.unexplainedDifference;

describe("recomputing after set-aside / restore", () => {
  it("starts with the proven copies set aside and only the real gap unexplained", () => {
    const s = start();
    expect(s.bank).toHaveLength(3);
    expect(unexplained(s)).toBe(-1200); // just the $12 fee
  });

  it("restoring a row re-runs matching on the rows in use and the total follows", () => {
    const s0 = start();
    const coffeeCopy = s0.state.setAside.find((x) => allBank.find((t) => t.id === x.txnId)!.description.startsWith("COFFEE"))!;
    const s1 = apply(s0, restoreRows(s0.state, [coffeeCopy.txnId], "t1"));
    expect(s1.bank).toHaveLength(4);
    expect(unexplained(s1)).toBe(-1200 - 4510);
    // The restored copy has no partner in the books → listed as unmatched.
    const r = reconcile(s1.bank, allLedger);
    expect(r.missingFromBooks.map((t) => t.description)).toContain("COFFEE SUPPLY CO");
    // …and setting it aside again returns to exactly the starting point.
    const s2 = apply(s1, setAsideRows(s1.state, [coffeeCopy.txnId], "user", "t2"));
    expect(s2.bank.map((t) => t.id)).toEqual(s0.bank.map((t) => t.id));
    expect(unexplained(s2)).toBe(unexplained(s0));
  });

  it("decisions the user already made survive a recompute", () => {
    let s = start();
    const suggestion = s.matches.find((m) => m.status === "suggested")!; // the cheque (dates differ)
    expect(suggestion).toBeDefined();
    s = { ...s, matches: applyMatchDecision(s.matches, suggestion.id, "accept") };
    const other = s.state.setAside[0].txnId;
    const after = apply(s, restoreRows(s.state, [other], "t1"));
    expect(after.matches.find((m) => m.id === suggestion.id)?.status).toBe("accepted");
  });

  it("an 'added to my reconciliation' entry is dropped if its row is later set aside", () => {
    let s = start();
    const fee = s.bank.find((t) => t.description === "MONTHLY SERVICE FEE")!;
    // Pretend the fee row is a repeat the user decides to set aside.
    s = { ...s, added: [fee.id] };
    const after = apply(s, setAsideRows(s.state, [fee.id], "user", "t1"));
    expect(after.added).toEqual([]);
    expect(after.bank.some((t) => t.id === fee.id)).toBe(false);
    expect(unexplained(after)).toBe(0);
  });

  it("matching only ever sees rows in use — set-aside rows appear in no bucket", () => {
    const s = start();
    const r = reconcile(s.bank, allLedger);
    const view = buildDashboardData(s.matches, s.composites, s.bank, allLedger, r.missingFromBooks, r.missingFromBank);
    const setAside = new Set(s.state.setAside.map((x) => x.txnId));
    expect(view.missingFromBooks.some((t) => setAside.has(t.txnId))).toBe(false);
    expect(s.matches.some((m) => setAside.has(m.bankTxnId))).toBe(false);
    expect(view.counts.matched + view.counts.review + view.counts.missingFromBooks).toBe(s.bank.length);
  });

  it("the matched list and review cards say which file and row each side came from", () => {
    const s = start();
    const r = reconcile(s.bank, allLedger);
    const view = buildDashboardData(s.matches, s.composites, s.bank, allLedger, r.missingFromBooks, r.missingFromBank);
    expect(view.matched[0].detail).toBe("Bank: bank-jan.csv · row 2  ↔  Records: ledger.csv · row 2");
    const card = view.reviewItems[0] as { bank: { source?: string }; books: { source?: string } };
    expect(card.bank.source).toBe("bank-jan.csv · row 3");
    expect(card.books.source).toBe("ledger.csv · row 3");
  });
});
