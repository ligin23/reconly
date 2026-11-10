/**
 * Verdict adjustments (post-Phase 2): unresolved possible duplicates
 * withhold "Fully reconciled" without touching totals or matches, and the
 * financial status is kept separate from the data-quality status.
 * The engine is used unchanged.
 */
import { describe, it, expect } from "vitest";
import { combineFiles, type ImportFileInput } from "@/lib/import/combine";
import {
  activeTxns,
  detectDuplicates,
  dismissGroup,
  initialDuplicateState,
  restoreRows,
  setAsideRows,
  unresolvedGroupCount,
  type DuplicateGroup,
  type DuplicateState,
} from "@/lib/import/duplicates";
import { reconcile } from "@/lib/recon/engine";
import { deriveVerdict, VERDICT_LABEL } from "@/lib/recon/verdict";
import { deriveStatus } from "@/lib/data/utils";
import { verdictText, deriveBuckets, type ExportContext } from "@/lib/export/buckets";
import type { Txn } from "@/lib/recon/types";

const file = (name: string, header: string, rows: string[]): ImportFileInput => ({
  name, content: [header, ...rows].join("\n"), map: undefined as unknown as ImportFileInput["map"],
});
const PLAIN = "Date,Description,Amount";
const IDS = "Transaction ID,Date,Description,Amount";
const AT = "2026-11-09T12:00:00.000Z";

type World = { allBank: Txn[]; allLedger: Txn[]; groups: DuplicateGroup[] };
const world = (bank: ImportFileInput[], ledger: ImportFileInput[]): World => {
  const allBank = combineFiles("bank", bank).txns;
  const allLedger = combineFiles("ledger", ledger).txns;
  return { allBank, allLedger, groups: [...detectDuplicates("bank", allBank), ...detectDuplicates("ledger", allLedger)] };
};

/** Everything the app derives for one duplicate state — same steps as AppShell. */
function evaluate(w: World, state: DuplicateState) {
  const bank = activeTxns(w.allBank, state);
  const ledger = activeTxns(w.allLedger, state);
  const result = reconcile(bank, ledger);
  const openItemCount =
    result.missingFromBooks.length +
    result.missingFromBank.length +
    result.matches.filter((m) => m.status === "suggested").length +
    result.compositeMatches.filter((c) => c.status === "suggested").length;
  const unresolved = unresolvedGroupCount(w.groups, state);
  const verdict = deriveVerdict({
    unexplainedDifference: result.balanceProof.unexplainedDifference,
    openItemCount,
    unresolvedDuplicateGroups: unresolved,
  });
  const saved = deriveStatus(result.balanceProof.unexplainedDifference, result.matches, result.compositeMatches, openItemCount, unresolved);
  const ctx: ExportContext = {
    accountName: "A", periodStart: "2026-01-01", periodEnd: "2026-01-31",
    openingBalance: null, closingBalance: null,
    reconciled: verdict.reconciled,
    unexplainedDifference: result.balanceProof.unexplainedDifference,
    bankTxns: bank, ledgerTxns: ledger, matches: result.matches, compositeMatches: result.compositeMatches,
    userAddedEntries: [], acknowledgedBankIds: [],
    duplicates: { allBankTxns: w.allBank, allLedgerTxns: w.allLedger, groups: w.groups, state },
  };
  return { result, verdict, saved, reportVerdict: verdictText(ctx, deriveBuckets(ctx)), bank, ledger };
}

/** Both sides genuinely contain two identical parking charges. Books match the bank exactly. */
const twins = () =>
  world(
    [file("bank.csv", PLAIN, ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/28/2026,PARKING GARAGE,-8.00", "01/28/2026,PARKING GARAGE,-8.00"])],
    [file("ledger.csv", PLAIN, ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/28/2026,PARKING GARAGE,-8.00", "01/28/2026,PARKING GARAGE,-8.00"])]
  );

describe("deriveVerdict — the rule itself", () => {
  it("financial and data-quality status are independent", () => {
    expect(deriveVerdict({ unexplainedDifference: 0, openItemCount: 0 })).toMatchObject({
      status: "reconciled", financial: "agrees", dataQuality: "clear", reconciled: true,
    });
    expect(deriveVerdict({ unexplainedDifference: 0, openItemCount: 0, unresolvedDuplicateGroups: 2 })).toMatchObject({
      status: "totals-agree-duplicate-review", financial: "agrees", dataQuality: "duplicate-review-needed", reconciled: false,
    });
    expect(deriveVerdict({ unexplainedDifference: -1200, openItemCount: 1, unresolvedDuplicateGroups: 2 })).toMatchObject({
      status: "not-reconciled", financial: "differs", dataQuality: "duplicate-review-needed", reconciled: false,
    });
    expect(deriveVerdict({ unexplainedDifference: -1200, openItemCount: 1 })).toMatchObject({
      status: "not-reconciled", financial: "differs", dataQuality: "clear",
    });
  });

  it("a zero difference with open items is still not reconciled (unchanged rule)", () => {
    expect(deriveVerdict({ unexplainedDifference: 0, openItemCount: 2 }).status).toBe("not-reconciled");
    expect(deriveVerdict({ unexplainedDifference: 0, openItemCount: 2, unresolvedDuplicateGroups: 1 }).status).toBe("not-reconciled");
  });

  it("uses the agreed wording", () => {
    expect(VERDICT_LABEL["totals-agree-duplicate-review"]).toBe("Totals agree — duplicate review needed");
    expect(VERDICT_LABEL.reconciled).toBe("Fully reconciled");
  });
});

describe("financial totals agree but unresolved duplicates remain", () => {
  const w = twins();
  const state = initialDuplicateState(w.groups, AT);
  const e = evaluate(w, state);

  it("fixture sanity: the books match exactly and one group is flagged on each side", () => {
    expect(e.result.reconciled).toBe(true); // the ENGINE's own verdict is untouched
    expect(w.groups.map((g) => g.side)).toEqual(["bank", "ledger"]);
    expect(state.setAside).toEqual([]);
  });

  it("shows 'Totals agree — duplicate review needed', not 'Fully reconciled'", () => {
    expect(e.verdict.status).toBe("totals-agree-duplicate-review");
    expect(e.verdict.reconciled).toBe(false);
    expect(e.verdict.financial).toBe("agrees");
    expect(e.verdict.unresolvedDuplicateGroups).toBe(2);
    expect(e.saved).toBe("in_progress"); // History never says "reconciled" here
    expect(e.reportVerdict).toBe("Totals agree — duplicate review needed: 2 possible duplicate groups have not been reviewed.");
  });

  it("flagging changes no total and no confirmed match", () => {
    const unflagged = reconcile(w.allBank, w.allLedger);
    expect(e.result.balanceProof).toEqual(unflagged.balanceProof);
    expect(e.result.matches).toEqual(unflagged.matches);
    expect(e.result.matches.every((m) => m.status === "accepted")).toBe(true);
    expect(e.bank).toEqual(w.allBank);
  });
});

describe("financial discrepancies and unresolved duplicates coexist", () => {
  // Same twins, plus a bank fee the books don't have.
  const w = world(
    [file("bank.csv", PLAIN, ["01/28/2026,PARKING GARAGE,-8.00", "01/28/2026,PARKING GARAGE,-8.00", "01/30/2026,MONTHLY FEE,-12.00"])],
    [file("ledger.csv", PLAIN, ["01/28/2026,PARKING GARAGE,-8.00", "01/28/2026,PARKING GARAGE,-8.00"])]
  );
  const e = evaluate(w, initialDuplicateState(w.groups, AT));

  it("stays 'Not reconciled' — the money problem is not hidden behind the duplicate notice", () => {
    expect(e.verdict.status).toBe("not-reconciled");
    expect(e.verdict.financial).toBe("differs");
    expect(e.verdict.dataQuality).toBe("duplicate-review-needed");
    expect(e.saved).toBe("not_reconciled");
    expect(e.reportVerdict).toContain("differ by $12.00");
    expect(e.reportVerdict).not.toContain("Totals agree");
  });

  it("resolving the duplicates alone does not make it reconciled", () => {
    let state = initialDuplicateState(w.groups, AT);
    for (const g of w.groups) state = dismissGroup(state, g.id, true, AT);
    const after = evaluate(w, state);
    expect(after.verdict.dataQuality).toBe("clear");
    expect(after.verdict.status).toBe("not-reconciled");
  });
});

describe("all duplicate groups confirmed as separate", () => {
  it("no longer blocks: 'Fully reconciled', with every row still counted", () => {
    const w = twins();
    let state = initialDuplicateState(w.groups, AT);
    state = dismissGroup(state, w.groups[0].id, true, AT);
    expect(evaluate(w, state).verdict.status).toBe("totals-agree-duplicate-review"); // one left
    state = dismissGroup(state, w.groups[1].id, true, AT);
    const e = evaluate(w, state);
    expect(e.verdict.status).toBe("reconciled");
    expect(e.saved).toBe("reconciled");
    expect(e.reportVerdict).toBe("Your records match your bank for this period.");
    expect(e.bank).toEqual(w.allBank);
    expect(state.setAside).toEqual([]);
    expect(state.dismissedAt).toEqual({ [w.groups[0].id]: AT, [w.groups[1].id]: AT });
  });

  it("undoing a confirmation brings the review back", () => {
    const w = twins();
    let state = initialDuplicateState(w.groups, AT);
    for (const g of w.groups) state = dismissGroup(state, g.id, true, AT);
    state = dismissGroup(state, w.groups[0].id, false);
    expect(evaluate(w, state).verdict.status).toBe("totals-agree-duplicate-review");
    expect(state.dismissedAt).toEqual({ [w.groups[1].id]: AT });
  });
});

describe("all confirmed duplicates set aside", () => {
  // The same bank export uploaded as two overlapping files, no IDs → flagged.
  const rows = ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/20/2026,CLIENT PAYMENT,1200.00"];
  const w = world([file("jan.csv", PLAIN, rows), file("jan-copy.csv", PLAIN, [...rows, ""])], [file("ledger.csv", PLAIN, rows)]);

  it("before: nothing set aside, the repeats inflate the bank side → not reconciled", () => {
    const e = evaluate(w, initialDuplicateState(w.groups, AT));
    expect(e.verdict.status).toBe("not-reconciled");
    expect(e.verdict.unresolvedDuplicateGroups).toBe(2);
  });

  it("after the user sets the repeats aside: fully reconciled, duplicates no longer block", () => {
    const initial = initialDuplicateState(w.groups, AT);
    const state = setAsideRows(initial, w.groups.flatMap((g) => g.suggestedSetAsideIds), "user", AT);
    const e = evaluate(w, state);
    expect(e.verdict).toMatchObject({ status: "reconciled", financial: "agrees", dataQuality: "clear" });
    expect(e.saved).toBe("reconciled");
    expect(w.allBank).toHaveLength(4); // still all imported
  });
});

describe("restoring a row recalculates the verdict", () => {
  const rows = ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10", "TX2,01/20/2026,CLIENT PAYMENT,1200.00"];
  const w = world(
    [file("jan.csv", IDS, rows), file("q1.csv", IDS, [...rows, "TX3,02/03/2026,RENT,-900.00"])],
    [file("ledger.csv", PLAIN, ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/20/2026,CLIENT PAYMENT,1200.00", "02/03/2026,RENT,-900.00"])]
  );
  const initial = initialDuplicateState(w.groups, AT);

  it("proven copies set aside automatically → fully reconciled", () => {
    expect(initial.setAside).toHaveLength(2);
    expect(evaluate(w, initial).verdict.status).toBe("reconciled");
  });

  it("restore → not reconciled (the copy is counted again) and the group needs review", () => {
    const restored = restoreRows(initial, [initial.setAside[0].txnId], AT);
    const e = evaluate(w, restored);
    expect(e.verdict.status).toBe("not-reconciled");
    expect(e.verdict.financial).toBe("differs");
    expect(e.verdict.unresolvedDuplicateGroups).toBe(1);
    expect(e.result.balanceProof.unexplainedDifference).toBe(-4510);
  });

  it("set aside again → fully reconciled again", () => {
    const id = initial.setAside[0].txnId;
    const again = setAsideRows(restoreRows(initial, [id], AT), [id], "user", AT);
    expect(evaluate(w, again).verdict.status).toBe("reconciled");
  });

  it("restore then 'they're separate' → duplicates stop blocking, but the money still differs", () => {
    const id = initial.setAside[0].txnId;
    const group = w.groups.find((g) => g.txnIds.includes(id))!;
    const state = dismissGroup(restoreRows(initial, [id], AT), group.id, true, AT);
    const e = evaluate(w, state);
    expect(e.verdict.dataQuality).toBe("clear");
    expect(e.verdict.status).toBe("not-reconciled");
  });
});

describe("saved status (History)", () => {
  it("pending suggestions still win; duplicates only matter once the money agrees", () => {
    const suggested = [{ status: "suggested" as const }];
    expect(deriveStatus(0, suggested, [], 1, 3)).toBe("in_progress");
    expect(deriveStatus(0, [], [], 0, 3)).toBe("in_progress");
    expect(deriveStatus(0, [], [], 0, 0)).toBe("reconciled");
    expect(deriveStatus(-500, [], [], 1, 3)).toBe("not_reconciled");
    expect(deriveStatus(0, [], [], 0)).toBe("reconciled"); // old callers unaffected
  });
});
