/**
 * Phase 2 — duplicate and overlap detection.
 *
 * The rules under test (see lib/import/duplicates.ts):
 *   - automatic set-aside ONLY across files and ONLY on strong evidence
 *     (transaction ID, running balance, or reference + description);
 *   - date + amount + description alone is never enough to set aside;
 *   - repeats inside one file are only flagged;
 *   - nothing is ever removed from the import.
 */
import { describe, it, expect } from "vitest";
import { combineFiles, type ImportFileInput } from "@/lib/import/combine";
import {
  EMPTY_DUPLICATE_STATE,
  activeTxns,
  detectDuplicates,
  dismissGroup,
  fileOverlaps,
  groupStatus,
  importCounts,
  initialDuplicateState,
  restoreRows,
  sanitizeDuplicateState,
  setAsideRows,
} from "@/lib/import/duplicates";
import { reconcile } from "@/lib/recon/engine";
import type { Txn } from "@/lib/recon/types";

const AT = "2026-11-09T12:00:00.000Z";

/** Build an uploaded file. `header` chooses which evidence columns exist. */
const file = (name: string, header: string, rows: string[]): ImportFileInput => ({
  name,
  content: [header, ...rows].join("\n"),
  // undefined → the parser auto-detects date/description/amount/reference.
  map: undefined as unknown as ImportFileInput["map"],
});
const PLAIN = "Date,Description,Amount";
const WITH_ID = "Transaction ID,Date,Description,Amount";
const WITH_BAL = "Date,Description,Amount,Balance";
const WITH_REF = "Date,Description,Amount,Reference";

const load = (side: "bank" | "ledger", ...files: ImportFileInput[]) => combineFiles(side, files).txns;
const byFile = (txns: Txn[], ids: string[]) =>
  ids.map((id) => {
    const t = txns.find((x) => x.id === id)!;
    return `${t.sourceFile}:${t.sourceLine}`;
  });
const codes = (g: { evidence: { code: string }[] }) => g.evidence.map((e) => e.code);

describe("identical rows within one file — flagged, never set aside", () => {
  it("flags a repeated row when the file has nothing to tell the rows apart", () => {
    const txns = load("bank", file("jan.csv", PLAIN, [
      "01/05/2026,COFFEE SUPPLY CO,-45.10",
      "01/05/2026,COFFEE SUPPLY CO,-45.10",
      "01/09/2026,RENT,-900.00",
    ]));
    const groups = detectDuplicates("bank", txns);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("within-file");
    expect(byFile(txns, groups[0].txnIds)).toEqual(["jan.csv:2", "jan.csv:3"]);
    expect(groups[0].autoSetAsideIds).toEqual([]); // NEVER automatic
    expect(codes(groups[0])).toEqual(["same-file-values-only"]);
    // Nothing leaves the reconciliation on import.
    const state = initialDuplicateState(groups, AT);
    expect(state.setAside).toEqual([]);
    expect(activeTxns(txns, state)).toHaveLength(3);
  });

  it("a row repeated with the SAME transaction ID is strong-looking but still only flagged", () => {
    const txns = load("bank", file("jan.csv", WITH_ID, [
      "TX1,01/05/2026,COFFEE SUPPLY CO,-45.10",
      "TX1,01/05/2026,COFFEE SUPPLY CO,-45.10",
    ]));
    const [g] = detectDuplicates("bank", txns);
    expect(codes(g)).toEqual(["same-file-same-id"]);
    expect(g.autoSetAsideIds).toEqual([]);
    expect(g.suggestedSetAsideIds).toEqual([g.txnIds[1]]);
  });
});

describe("legitimate same-day, same-amount transactions", () => {
  it("are not flagged when transaction IDs show they are different", () => {
    const txns = load("bank", file("jan.csv", WITH_ID, [
      "TX1,01/05/2026,COFFEE SUPPLY CO,-45.10",
      "TX2,01/05/2026,COFFEE SUPPLY CO,-45.10",
    ]));
    expect(detectDuplicates("bank", txns)).toEqual([]);
  });

  it("are not flagged when running balances show they are different", () => {
    const txns = load("bank", file("jan.csv", WITH_BAL, [
      "01/05/2026,COFFEE SUPPLY CO,-45.10,954.90",
      "01/05/2026,COFFEE SUPPLY CO,-45.10,909.80",
    ]));
    expect(detectDuplicates("bank", txns)).toEqual([]);
  });

  it("are not flagged when check numbers differ", () => {
    const txns = load("ledger", file("ledger.csv", WITH_REF, [
      "01/05/2026,LANDLORD,-500.00,1041",
      "01/05/2026,LANDLORD,-500.00,1042",
    ]));
    expect(detectDuplicates("ledger", txns)).toEqual([]);
  });

  it("are not flagged when the descriptions differ", () => {
    const txns = load("bank", file("jan.csv", PLAIN, [
      "01/05/2026,COFFEE SUPPLY CO,-45.10",
      "01/05/2026,HARDWARE STORE,-45.10",
    ]));
    expect(detectDuplicates("bank", txns)).toEqual([]);
  });

  it("with no distinguishing column are flagged for a look — and stay fully in use", () => {
    const txns = load("ledger", file("ledger.csv", PLAIN, [
      "01/05/2026,Parking,-8.00",
      "01/05/2026,Parking,-8.00",
    ]));
    const groups = detectDuplicates("ledger", txns);
    expect(groups).toHaveLength(1);
    const state = initialDuplicateState(groups, AT);
    expect(activeTxns(txns, state)).toEqual(txns);
    expect(groupStatus(groups[0], state)).toBe("needs-review");
    // The user confirms they are separate → resolved without excluding anything.
    const kept = dismissGroup(state, groups[0].id, true);
    expect(groupStatus(groups[0], kept)).toBe("kept-all");
    expect(activeTxns(txns, kept)).toEqual(txns);
  });
});

describe("exact duplicates across two overlapping files", () => {
  const rowsJan = ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/20/2026,CLIENT PAYMENT,1200.00"];

  it("transaction ID match → later copy set aside automatically", () => {
    const txns = load(
      "bank",
      file("jan.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10", "TX2,01/20/2026,CLIENT PAYMENT,1200.00"]),
      file("q1.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10", "TX2,01/20/2026,CLIENT PAYMENT,1200.00", "TX3,02/03/2026,RENT,-900.00"])
    );
    const groups = detectDuplicates("bank", txns);
    expect(groups).toHaveLength(2);
    for (const g of groups) {
      expect(g.kind).toBe("cross-file");
      expect(codes(g)).toEqual(["transaction-id"]);
      expect(g.evidence[0].strong).toBe(true);
      expect(g.autoSetAsideIds).toHaveLength(1);
    }
    const state = initialDuplicateState(groups, AT);
    const active = activeTxns(txns, state);
    expect(active).toHaveLength(3); // 5 imported, 2 set aside
    expect(txns).toHaveLength(5);   // nothing deleted
    expect(state.setAside.every((s) => s.by === "auto")).toBe(true);
    expect(groups.every((g) => groupStatus(g, state) === "resolved")).toBe(true);
  });

  it("running balance match → later copy set aside automatically", () => {
    const txns = load(
      "bank",
      file("jan.csv", WITH_BAL, ["01/05/2026,COFFEE SUPPLY CO,-45.10,954.90", "01/20/2026,CLIENT PAYMENT,1200.00,2154.90"]),
      file("jan-again.csv", WITH_BAL, ["01/05/2026,COFFEE SUPPLY CO,-45.10,$954.90", "01/20/2026,CLIENT PAYMENT,1200.00,\"$2,154.90\""])
    );
    const groups = detectDuplicates("bank", txns);
    expect(groups.map(codes)).toEqual([["running-balance"], ["running-balance"]]);
    expect(activeTxns(txns, initialDuplicateState(groups, AT))).toHaveLength(2);
  });

  it("reference + description match → set aside automatically", () => {
    const txns = load(
      "ledger",
      file("a.csv", WITH_REF, ["01/05/2026,LANDLORD,-500.00,1041"]),
      file("b.csv", WITH_REF, ["01/05/2026,LANDLORD,-500.00,1041"])
    );
    const [g] = detectDuplicates("ledger", txns);
    expect(codes(g)).toEqual(["reference"]);
    expect(g.autoSetAsideIds).toHaveLength(1);
  });

  it("date + amount + description ALONE is never enough: flagged, nothing set aside", () => {
    const txns = load("bank", file("jan.csv", PLAIN, rowsJan), file("q1.csv", PLAIN, [...rowsJan, "02/03/2026,RENT,-900.00"]));
    const groups = detectDuplicates("bank", txns);
    expect(groups).toHaveLength(2);
    for (const g of groups) {
      expect(codes(g)).toEqual(["values-only"]);
      expect(g.evidence[0].strong).toBe(false);
      expect(g.autoSetAsideIds).toEqual([]);
      // …but the user is offered the obvious choice: keep jan.csv's copy.
      expect(byFile(txns, g.suggestedSetAsideIds).every((s) => s.startsWith("q1.csv"))).toBe(true);
    }
    const state = initialDuplicateState(groups, AT);
    expect(state.setAside).toEqual([]);
    expect(activeTxns(txns, state)).toHaveLength(5);
    expect(groups.every((g) => groupStatus(g, state) === "needs-review")).toBe(true);
  });

  it("the row that stays is the one from the earliest file, whatever the upload order", () => {
    const jan = file("jan.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10"]);
    const q1 = file("q1.csv", WITH_ID, ["TX0,01/02/2026,OPENING DEPOSIT,100.00", "TX1,01/05/2026,COFFEE SUPPLY CO,-45.10"]);
    for (const order of [[jan, q1], [q1, jan]]) {
      const txns = load("bank", ...order);
      const [g] = detectDuplicates("bank", txns);
      expect(byFile(txns, g.autoSetAsideIds)).toEqual(["jan.csv:2"]); // q1.csv starts earlier → it is kept
    }
  });
});

describe("overlapping files containing different transactions", () => {
  it("reports the overlap but finds no duplicates", () => {
    const txns = load(
      "bank",
      file("card-a.csv", PLAIN, ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/20/2026,SOFTWARE,-30.00"]),
      file("card-b.csv", PLAIN, ["01/06/2026,FUEL,-60.00", "01/19/2026,PARKING,-8.00"])
    );
    expect(detectDuplicates("bank", txns)).toEqual([]);
    expect(fileOverlaps("bank", txns)).toEqual([
      { side: "bank", fileA: "card-a.csv", fileB: "card-b.csv", start: "2026-01-06", end: "2026-01-19", rowsA: 0, rowsB: 2 },
    ]);
  });

  it("overlap alone never sets anything aside, even for same-date same-amount rows", () => {
    const txns = load(
      "bank",
      file("a.csv", PLAIN, ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/20/2026,X,-1.00"]),
      file("b.csv", PLAIN, ["01/05/2026,HARDWARE STORE,-45.10", "01/20/2026,Y,-1.00"])
    );
    expect(detectDuplicates("bank", txns)).toEqual([]);
  });

  it("different accounts are never duplicates of each other", () => {
    const H = "Account,Date,Description,Amount";
    const txns = load(
      "bank",
      file("checking.csv", H, ["****1111,01/05/2026,TRANSFER,-100.00"]),
      file("savings.csv", H, ["****2222,01/05/2026,TRANSFER,-100.00"])
    );
    expect(detectDuplicates("bank", txns)).toEqual([]);
  });
});

describe("repeated import of the same data under a different filename", () => {
  const rows = ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/20/2026,CLIENT PAYMENT,1200.00", "01/28/2026,PARKING,-8.00"];

  it("with transaction IDs: every row of the second file is set aside", () => {
    const withIds = rows.map((r, i) => `TX${i},${r}`);
    const txns = load("bank", file("export.csv", WITH_ID, withIds), file("export (1).csv", WITH_ID, [...withIds, ""]));
    const groups = detectDuplicates("bank", txns);
    const state = initialDuplicateState(groups, AT);
    expect(importCounts(txns, state)).toEqual({ imported: 6, inUse: 3, setAside: 3 });
    expect(new Set(activeTxns(txns, state).map((t) => t.sourceFile)).size).toBe(1);
  });

  it("without any identifying column: every row is flagged, none is set aside", () => {
    const txns = load("bank", file("export.csv", PLAIN, rows), file("copy.csv", PLAIN, [...rows, ""]));
    const groups = detectDuplicates("bank", txns);
    expect(groups).toHaveLength(3);
    const state = initialDuplicateState(groups, AT);
    expect(importCounts(txns, state)).toEqual({ imported: 6, inUse: 6, setAside: 0 });
    // One user action resolves it: set aside the suggested copies.
    const resolved = setAsideRows(state, groups.flatMap((g) => g.suggestedSetAsideIds), "user", AT);
    expect(importCounts(txns, resolved)).toEqual({ imported: 6, inUse: 3, setAside: 3 });
    expect(resolved.setAside.every((s) => s.by === "user")).toBe(true);
  });
});

describe("ambiguous or missing transaction identifiers", () => {
  it("a blank ID on one side falls back to weaker evidence — flagged, not set aside", () => {
    const txns = load(
      "bank",
      file("a.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10"]),
      file("b.csv", WITH_ID, [",01/05/2026,COFFEE SUPPLY CO,-45.10"])
    );
    const [g] = detectDuplicates("bank", txns);
    expect(codes(g)).toEqual(["values-only"]);
    expect(g.autoSetAsideIds).toEqual([]);
  });

  it("an 'ID' that repeats inside its own file is not trusted as an identifier", () => {
    const txns = load(
      "bank",
      file("a.csv", WITH_ID, ["DEBIT,01/05/2026,COFFEE SUPPLY CO,-45.10", "DEBIT,01/06/2026,FUEL,-60.00"]),
      file("b.csv", WITH_ID, ["DEBIT,01/05/2026,COFFEE SUPPLY CO,-45.10", "DEBIT,01/06/2026,FUEL,-60.00"])
    );
    const groups = detectDuplicates("bank", txns);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.autoSetAsideIds.length === 0)).toBe(true);
  });

  it("one file has IDs, the other doesn't → flagged, not set aside", () => {
    const txns = load(
      "bank",
      file("a.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10"]),
      file("b.csv", PLAIN, ["01/05/2026,COFFEE SUPPLY CO,-45.10"])
    );
    const [g] = detectDuplicates("bank", txns);
    expect(g.autoSetAsideIds).toEqual([]);
    expect(g.suggestedSetAsideIds).toHaveLength(1);
  });

  it("the files disagree on how many times it happened → flagged, no row singled out", () => {
    const txns = load(
      "bank",
      file("a.csv", PLAIN, ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/05/2026,COFFEE SUPPLY CO,-45.10"]),
      file("b.csv", PLAIN, ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/09/2026,OTHER,-1.00"])
    );
    const [g] = detectDuplicates("bank", txns);
    expect(g.txnIds).toHaveLength(3);
    expect(g.autoSetAsideIds).toEqual([]);
    expect(g.suggestedSetAsideIds).toEqual([]);
  });

  it("a bare 'id' column is only trusted like a reference number", () => {
    const H = "ID,Date,Description,Amount";
    // Row counters differ between exports of the same ledger → still flagged.
    const renumbered = load(
      "ledger",
      file("jan.csv", H, ["1,01/05/2026,Coffee,-45.10"]),
      file("q1.csv", H, ["7,01/05/2026,Coffee,-45.10", "8,02/01/2026,Rent,-900.00"])
    );
    const [g] = detectDuplicates("ledger", renumbered);
    expect(codes(g)).toEqual(["reference-differs"]);
    expect(g.autoSetAsideIds).toEqual([]);
  });
});

describe("duplicate rows with different descriptions", () => {
  it("true transaction ID match overrides a description difference → set aside", () => {
    const txns = load(
      "bank",
      file("a.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO #4471,-45.10"]),
      file("b.csv", WITH_ID, ["TX1,01/05/2026,POS PURCHASE COFFEE SUPPLY,-45.10"])
    );
    const [g] = detectDuplicates("bank", txns);
    expect(codes(g)).toEqual(["transaction-id"]);
    expect(g.autoSetAsideIds).toHaveLength(1);
  });

  it("reference match with different descriptions → flagged only", () => {
    const txns = load(
      "bank",
      file("a.csv", WITH_REF, ["01/05/2026,CHECK 1041,-500.00,1041"]),
      file("b.csv", WITH_REF, ["01/05/2026,LANDLORD LLC,-500.00,1041"])
    );
    const [g] = detectDuplicates("bank", txns);
    expect(codes(g)).toEqual(["reference-description-differs"]);
    expect(g.autoSetAsideIds).toEqual([]);
  });

  it("running balance match with different descriptions → flagged only", () => {
    const txns = load(
      "bank",
      file("a.csv", WITH_BAL, ["01/05/2026,CHECK 1041,-500.00,1500.00"]),
      file("b.csv", WITH_BAL, ["01/05/2026,LANDLORD LLC,-500.00,1500.00"])
    );
    const [g] = detectDuplicates("bank", txns);
    expect(codes(g)).toEqual(["balance-description-differs"]);
    expect(g.autoSetAsideIds).toEqual([]);
  });

  it("no identifier and different descriptions → not duplicates at all", () => {
    const txns = load(
      "bank",
      file("a.csv", PLAIN, ["01/05/2026,CHECK 1041,-500.00"]),
      file("b.csv", PLAIN, ["01/05/2026,LANDLORD LLC,-500.00"])
    );
    expect(detectDuplicates("bank", txns)).toEqual([]);
  });
});

describe("two genuinely separate identical transactions, each exported twice", () => {
  it("with IDs: each copy is paired with its own original; nothing left to review", () => {
    const rows = ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10", "TX2,01/05/2026,COFFEE SUPPLY CO,-45.10"];
    const txns = load("bank", file("a.csv", WITH_ID, rows), file("b.csv", WITH_ID, [...rows, "TX3,01/09/2026,Z,-1.00"]));
    const groups = detectDuplicates("bank", txns);
    expect(groups).toHaveLength(2);
    const state = initialDuplicateState(groups, AT);
    expect(activeTxns(txns, state).filter((t) => t.description === "COFFEE SUPPLY CO")).toHaveLength(2);
    expect(groups.every((g) => groupStatus(g, state) === "resolved")).toBe(true);
  });

  it("without IDs: one group of four; the suggestion keeps the first file's two", () => {
    const rows = ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/05/2026,COFFEE SUPPLY CO,-45.10"];
    const txns = load("bank", file("a.csv", PLAIN, rows), file("b.csv", PLAIN, [...rows, "01/09/2026,Z,-1.00"]));
    const [g, ...rest] = detectDuplicates("bank", txns);
    expect(rest).toEqual([]);
    expect(g.txnIds).toHaveLength(4);
    expect(g.autoSetAsideIds).toEqual([]);
    expect(byFile(txns, g.suggestedSetAsideIds)).toEqual(["b.csv:2", "b.csv:3"]);
  });
});

describe("transactions crossing month boundaries", () => {
  it("only rows in the overlapping dates are affected; neighbours on either side are untouched", () => {
    const txns = load(
      "bank",
      file("jan.csv", WITH_ID, ["TX1,01/30/2026,CHECK 1042,-310.00", "TX2,01/31/2026,ACME DEPOSIT,2500.00"]),
      file("jan31-feb.csv", WITH_ID, ["TX2,01/31/2026,ACME DEPOSIT,2500.00", "TX3,02/01/2026,ACME DEPOSIT,2500.00", "TX4,02/03/2026,RENT,-900.00"])
    );
    const groups = detectDuplicates("bank", txns);
    expect(groups).toHaveLength(1);
    const active = activeTxns(txns, initialDuplicateState(groups, AT));
    expect(active.map((t) => [t.date, t.amount])).toEqual([
      ["2026-01-30", -31000],
      ["2026-01-31", 250000],
      ["2026-02-01", 250000], // same amount a day later is a different transaction
      ["2026-02-03", -90000],
    ]);
    expect(fileOverlaps("bank", txns)).toEqual([
      { side: "bank", fileA: "jan.csv", fileB: "jan31-feb.csv", start: "2026-01-31", end: "2026-01-31", rowsA: 1, rowsB: 1 },
    ]);
  });

  it("the same amount and description on DIFFERENT dates is never a duplicate", () => {
    const txns = load(
      "bank",
      file("jan.csv", PLAIN, ["01/31/2026,MONTHLY FEE,-12.00"]),
      file("feb.csv", PLAIN, ["02/28/2026,MONTHLY FEE,-12.00"])
    );
    expect(detectDuplicates("bank", txns)).toEqual([]);
  });
});

describe("bank and ledger sides are checked independently", () => {
  const bankFiles = [
    file("bank-a.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10"]),
    file("bank-b.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10"]),
  ];
  const ledgerFiles = [file("ledger.csv", PLAIN, ["01/05/2026,COFFEE SUPPLY CO,-45.10"])];

  it("a bank row is never treated as a duplicate of the ledger row it should match", () => {
    const bank = load("bank", ...bankFiles);
    const ledger = load("ledger", ...ledgerFiles);
    const bankGroups = detectDuplicates("bank", bank);
    const ledgerGroups = detectDuplicates("ledger", ledger);
    expect(bankGroups).toHaveLength(1);
    expect(bankGroups[0].txnIds.every((id) => id.startsWith("bank-"))).toBe(true);
    expect(ledgerGroups).toEqual([]);
    expect(bankGroups[0].side).toBe("bank");
  });

  it("each side gets its own groups and ids", () => {
    const ledger = load(
      "ledger",
      file("l1.csv", PLAIN, ["01/05/2026,Coffee,-45.10", "01/05/2026,Coffee,-45.10"])
    );
    const [g] = detectDuplicates("ledger", ledger);
    expect(g.id.startsWith("dup:ledger:")).toBe(true);
  });
});

describe("automatic set-aside, restoration, and reconciliation totals", () => {
  const bank = load(
    "bank",
    file("jan.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10", "TX2,01/20/2026,CLIENT PAYMENT,1200.00"]),
    file("jan-again.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10", "TX2,01/20/2026,CLIENT PAYMENT,1200.00", "TX9,01/29/2026,LATE ITEM,-5.00"])
  );
  const ledger = load("ledger", file("ledger.csv", PLAIN, [
    "01/05/2026,COFFEE SUPPLY CO,-45.10",
    "01/20/2026,CLIENT PAYMENT,1200.00",
    "01/29/2026,LATE ITEM,-5.00",
  ]));
  const groups = detectDuplicates("bank", bank);
  const initial = initialDuplicateState(groups, AT);

  it("before set-aside the repeated rows inflate the bank total; after, the books reconcile", () => {
    const withDuplicates = reconcile(bank, ledger);
    expect(withDuplicates.balanceProof.unexplainedDifference).toBe(-4510 + 120000);
    expect(withDuplicates.reconciled).toBe(false);

    const result = reconcile(activeTxns(bank, initial), ledger);
    expect(result.balanceProof.unexplainedDifference).toBe(0);
    expect(result.missingFromBooks).toEqual([]);
    expect(result.reconciled).toBe(true);
    // Matching only ever saw active rows.
    const setAsideIds = new Set(initial.setAside.map((s) => s.txnId));
    expect(result.matches.some((m) => setAsideIds.has(m.bankTxnId))).toBe(false);
  });

  it("restoring a row puts it back, in its original position, and totals follow", () => {
    const id = initial.setAside[0].txnId;
    const restored = restoreRows(initial, [id], "2026-11-09T13:00:00.000Z");
    expect(restored.setAside.map((s) => s.txnId)).not.toContain(id);
    const active = activeTxns(bank, restored);
    expect(active).toHaveLength(4);
    expect(active.map((t) => t.id)).toEqual(bank.map((t) => t.id).filter((x) => x !== initial.setAside[1].txnId));
    const result = reconcile(active, ledger);
    expect(result.balanceProof.unexplainedDifference).not.toBe(0);
    // Restoring makes the group need a decision again.
    const group = groups.find((g) => g.txnIds.includes(id))!;
    expect(groupStatus(group, restored)).toBe("needs-review");
  });

  it("set aside → restore → set aside again round-trips exactly, with a full audit trail", () => {
    const ids = initial.setAside.map((s) => s.txnId);
    const restored = restoreRows(initial, ids, "t1");
    expect(activeTxns(bank, restored)).toEqual(bank);
    const again = setAsideRows(restored, ids, "user", "t2");
    expect(activeTxns(bank, again)).toEqual(activeTxns(bank, initial));
    expect(again.history.map((h) => `${h.action}:${h.by}`)).toEqual([
      "set-aside:auto", "set-aside:auto", "restore:user", "restore:user", "set-aside:user", "set-aside:user",
    ]);
  });

  it("state helpers are idempotent and never mutate their input", () => {
    const frozen = JSON.stringify(initial);
    expect(setAsideRows(initial, [initial.setAside[0].txnId], "user", AT)).toBe(initial);
    expect(restoreRows(initial, ["nope"], AT)).toBe(initial);
    expect(dismissGroup(initial, "x", false)).toBe(initial);
    expect(JSON.stringify(initial)).toBe(frozen);
  });

  it("imported = in use + set aside, always", () => {
    for (const s of [EMPTY_DUPLICATE_STATE, initial, restoreRows(initial, [initial.setAside[0].txnId], AT)]) {
      const c = importCounts(bank, s);
      expect(c.inUse + c.setAside).toBe(c.imported);
      expect(activeTxns(bank, s)).toHaveLength(c.inUse);
    }
  });
});

describe("saved and reopened duplicate decisions", () => {
  it("survive a JSON round-trip (what IndexedDB stores) and give the same active rows", () => {
    const bank = load(
      "bank",
      file("a.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10", "TX5,01/06/2026,P,-8.00", "TX6,01/06/2026,P,-8.00"]),
      file("b.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10"])
    );
    const groups = detectDuplicates("bank", bank);
    let state = initialDuplicateState(groups, AT);
    state = restoreRows(state, [state.setAside[0].txnId], AT);        // user disagrees with the auto set-aside…
    state = dismissGroup(state, groups[0].id, true);                    // …and says "keep both"
    const saved = JSON.parse(JSON.stringify({ bankTxns: bank, duplicateState: state }));

    const reopenedGroups = detectDuplicates("bank", saved.bankTxns);
    expect(reopenedGroups).toEqual(groups); // detection is deterministic
    const reopened = sanitizeDuplicateState(saved.duplicateState, new Set(saved.bankTxns.map((t: Txn) => t.id)));
    expect(reopened).toEqual(state);
    // The restored row is NOT set aside again just because the evidence is strong.
    expect(activeTxns(saved.bankTxns, reopened)).toHaveLength(bank.length);
    expect(groupStatus(reopenedGroups[0], reopened)).toBe("kept-all");
  });

  it("a record saved before duplicate detection existed opens with nothing set aside", () => {
    const bank = load(
      "bank",
      file("a.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10"]),
      file("b.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10"])
    );
    const state = sanitizeDuplicateState(undefined, new Set(bank.map((t) => t.id)));
    expect(state).toEqual(EMPTY_DUPLICATE_STATE);
    expect(activeTxns(bank, state)).toBe(bank); // saved totals are not changed on open
    // The duplicate is still SHOWN (as needing review) so the user can act on it.
    expect(groupStatus(detectDuplicates("bank", bank)[0], state)).toBe("needs-review");
  });

  it("decisions about rows that no longer exist are dropped, not applied to other rows", () => {
    const state = sanitizeDuplicateState(
      { setAside: [{ txnId: "bank-f9-0", by: "auto" }], dismissedGroupIds: [], history: [] },
      new Set(["bank-0"])
    );
    expect(state.setAside).toEqual([]);
  });

  it("legacy transactions (no file, no row, no raw columns) are handled without error", () => {
    const legacy: Txn[] = [
      { id: "bank-0", source: "bank", date: "2026-01-05", description: "COFFEE", amount: -4510, raw: {} },
      { id: "bank-1", source: "bank", date: "2026-01-05", description: "COFFEE", amount: -4510, raw: {} },
      { id: "bank-2", source: "bank", date: "2026-01-06", description: "RENT", amount: -90000 } as unknown as Txn,
    ];
    const groups = detectDuplicates("bank", legacy);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("within-file");
    expect(groups[0].autoSetAsideIds).toEqual([]);
    expect(fileOverlaps("bank", legacy)).toEqual([]);
  });
});

describe("three or more files", () => {
  it("keeps one copy and sets aside every other proven copy", () => {
    const row = "TX1,01/05/2026,COFFEE SUPPLY CO,-45.10";
    const txns = load("bank", file("a.csv", WITH_ID, [row]), file("b.csv", WITH_ID, [row]), file("c.csv", WITH_ID, [row]));
    const [g] = detectDuplicates("bank", txns);
    expect(g.txnIds).toHaveLength(3);
    expect(g.autoSetAsideIds).toHaveLength(2);
    expect(activeTxns(txns, initialDuplicateState([g], AT))).toHaveLength(1);
  });

  it("a proven copy plus an unprovable one: the proven copy is set aside, the other is flagged", () => {
    const txns = load(
      "bank",
      file("a.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10"]),
      file("b.csv", WITH_ID, ["TX1,01/05/2026,COFFEE SUPPLY CO,-45.10"]),
      file("c.csv", PLAIN, ["01/05/2026,COFFEE SUPPLY CO,-45.10"])
    );
    const [g] = detectDuplicates("bank", txns);
    expect(g.autoSetAsideIds).toHaveLength(1);
    const state = initialDuplicateState([g], AT);
    expect(activeTxns(txns, state)).toHaveLength(2);
    expect(groupStatus(g, state)).toBe("needs-review");
  });
});

describe("determinism and performance", () => {
  /** 24 monthly files plus 8 quarterly files covering the same two years. */
  function bigImport(withIds: boolean) {
    const header = withIds ? WITH_ID : PLAIN;
    const monthly: ImportFileInput[] = [];
    const quarterly = new Map<string, string[]>();
    let n = 0;
    for (let m = 0; m < 24; m++) {
      const year = 2024 + Math.floor(m / 12);
      const month = String((m % 12) + 1).padStart(2, "0");
      const rows: string[] = [];
      for (let i = 0; i < 300; i++) {
        const day = String(1 + (i % 28)).padStart(2, "0");
        const amount = -(5 + ((i * 37 + m * 11) % 900)) - (i % 100) / 100;
        const body = `${month}/${day}/${year},VENDOR ${(i * 7) % 40},${amount.toFixed(2)}`;
        rows.push(withIds ? `TX${n++},${body}` : body);
      }
      monthly.push(file(`bank-${year}-${month}.csv`, header, rows));
      const q = `bank-${year}-Q${Math.floor((m % 12) / 3) + 1}.csv`;
      quarterly.set(q, [...(quarterly.get(q) ?? []), ...rows]);
    }
    return [...monthly, ...[...quarterly].map(([name, rows]) => file(name, header, rows))];
  }

  it("32 overlapping files / 14,400 rows: import + detection stays fast, and every repeat is caught", () => {
    const files = bigImport(true);
    const t0 = performance.now();
    const txns = load("bank", ...files);
    const groups = detectDuplicates("bank", txns);
    const state = initialDuplicateState(groups, AT);
    const ms = performance.now() - t0;
    console.log(`[benchmark] multi-file import + duplicate detection: ${txns.length} rows from ${files.length} files in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5_000);
    expect(importCounts(txns, state)).toEqual({ imported: 14_400, inUse: 7_200, setAside: 7_200 });
    expect(fileOverlaps("bank", txns)).toHaveLength(24); // each month overlaps its quarter
  });

  it("the same files without IDs: nothing is set aside, every repeat is flagged", () => {
    const txns = load("bank", ...bigImport(false));
    const groups = detectDuplicates("bank", txns);
    const state = initialDuplicateState(groups, AT);
    expect(state.setAside).toEqual([]);
    expect(new Set(groups.flatMap((g) => g.txnIds)).size).toBe(14_400);
  });

  it("gives identical output on repeated runs", () => {
    const txns = load("bank", ...bigImport(true).slice(0, 6));
    expect(detectDuplicates("bank", txns)).toEqual(detectDuplicates("bank", txns));
  });

  it("zero-amount rows are never proven duplicates by running balance", () => {
    const txns = load(
      "bank",
      file("a.csv", WITH_BAL, ["01/05/2026,MEMO,0.00,100.00"]),
      file("b.csv", WITH_BAL, ["01/05/2026,MEMO,0.00,100.00"])
    );
    const [g] = detectDuplicates("bank", txns);
    expect(g.autoSetAsideIds).toEqual([]);
  });
});
