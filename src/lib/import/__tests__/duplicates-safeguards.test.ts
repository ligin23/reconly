/**
 * Safeguards on AUTOMATIC set-aside (post-Phase 2 adjustments).
 *  - a trusted transaction ID may override a different description only
 *    when account, date, amount and side agree;
 *  - a reference number must be reliable and unambiguous to prove anything;
 *  - running balances count only when read from the uploaded file;
 *  - when in doubt: flag, never exclude.
 */
import { describe, it, expect } from "vitest";
import { combineFiles, type ImportFileInput } from "@/lib/import/combine";
import { activeTxns, detectDuplicates, initialDuplicateState } from "@/lib/import/duplicates";
import type { Txn } from "@/lib/recon/types";

const file = (name: string, header: string, rows: string[]): ImportFileInput => ({
  name, content: [header, ...rows].join("\n"), map: undefined as unknown as ImportFileInput["map"],
});
const load = (...files: ImportFileInput[]) => combineFiles("bank", files).txns;
const detect = (txns: Txn[]) => detectDuplicates("bank", txns);
const codes = (g: { evidence: { code: string }[] }) => g.evidence.map((e) => e.code);
const AT = "2026-11-09T12:00:00.000Z";

const ID = "Transaction ID,Date,Description,Amount";
const ID_ACCT = "Account,Transaction ID,Date,Description,Amount";

describe("trusted transaction IDs with differing descriptions", () => {
  const a = "TX1,01/05/2026,COFFEE SUPPLY CO #4471,-45.10";
  const b = "TX1,01/05/2026,POS PURCHASE COFFEE SUPPLY,-45.10";

  it("no account column in either file (one account by construction) → set aside", () => {
    const [g] = detect(load(file("a.csv", ID, [a]), file("b.csv", ID, [b])));
    expect(codes(g)).toEqual(["transaction-id"]);
    expect(g.autoSetAsideIds).toHaveLength(1);
  });

  it("the same account named in both files → set aside", () => {
    const [g] = detect(load(file("a.csv", ID_ACCT, [`****4821,${a}`]), file("b.csv", ID_ACCT, [`****4821,${b}`])));
    expect(codes(g)).toEqual(["transaction-id"]);
    expect(g.autoSetAsideIds).toHaveLength(1);
  });

  it("account named in only ONE file → cannot confirm it agrees → flagged, not set aside", () => {
    const txns = load(file("a.csv", ID_ACCT, [`****4821,${a}`]), file("b.csv", ID, [b]));
    const [g] = detect(txns);
    expect(codes(g)).toEqual(["transaction-id-account-unconfirmed"]);
    expect(g.evidence[0].strong).toBe(false);
    expect(g.autoSetAsideIds).toEqual([]);
    expect(activeTxns(txns, initialDuplicateState([g], AT))).toHaveLength(2);
  });

  it("different accounts → not duplicates at all, whatever the ID says", () => {
    expect(detect(load(file("a.csv", ID_ACCT, [`****4821,${a}`]), file("b.csv", ID_ACCT, [`****9999,${b}`])))).toEqual([]);
  });

  it("different amount or date with the same ID → never compared, never set aside", () => {
    expect(detect(load(file("a.csv", ID, [a]), file("b.csv", ID, ["TX1,01/05/2026,POS PURCHASE COFFEE SUPPLY,-45.11"])))).toEqual([]);
    expect(detect(load(file("a.csv", ID, [a]), file("b.csv", ID, ["TX1,01/06/2026,POS PURCHASE COFFEE SUPPLY,-45.10"])))).toEqual([]);
  });

  it("the other side is never consulted: the same ID on the ledger side proves nothing about the bank", () => {
    const bank = combineFiles("bank", [file("a.csv", ID, [a])]).txns;
    const ledger = combineFiles("ledger", [file("l.csv", ID, [b])]).txns;
    expect(detectDuplicates("bank", bank)).toEqual([]);
    expect(detectDuplicates("ledger", ledger)).toEqual([]);
  });

  it("same description, account named in only one file → still proven by the ID", () => {
    const row = "TX1,01/05/2026,COFFEE SUPPLY CO,-45.10";
    const [g] = detect(load(file("a.csv", ID_ACCT, [`****4821,${row}`]), file("b.csv", ID, [row])));
    expect(codes(g)).toEqual(["transaction-id"]);
  });
});

describe("ambiguous reference numbers never prove a duplicate", () => {
  const REF = "Date,Description,Amount,Reference";
  const pair = (header: string, rowA: string[], rowB: string[]) =>
    detect(load(file("a.csv", header, rowA), file("b.csv", header, rowB)));

  it("a real check number, unique in files whose references are distinct → set aside", () => {
    const rows = ["01/05/2026,LANDLORD,-500.00,1041", "01/09/2026,PLUMBER,-120.00,1042"];
    const groups = pair(REF, rows, rows);
    expect(groups.map(codes)).toEqual([["reference"], ["reference"]]);
    expect(groups.every((g) => g.autoSetAsideIds.length === 1)).toBe(true);
  });

  it("a bare 'ID' column (may be a row counter) → flagged", () => {
    const [g] = pair("ID,Date,Description,Amount", ["7,01/05/2026,Coffee,-45.10"], ["7,01/05/2026,Coffee,-45.10"]);
    expect(codes(g)).toEqual(["reference-not-reliable"]);
    expect(g.autoSetAsideIds).toEqual([]);
  });

  it("a reference with no digits (a label, not a number) → flagged", () => {
    const [g] = pair(REF, ["01/05/2026,TRANSFER,-100.00,WIRE"], ["01/05/2026,TRANSFER,-100.00,WIRE"]);
    expect(codes(g)).toEqual(["reference-not-reliable"]);
    expect(g.autoSetAsideIds).toEqual([]);
  });

  it("a very short reference → flagged", () => {
    const [g] = pair(REF, ["01/05/2026,TRANSFER,-100.00,7"], ["01/05/2026,TRANSFER,-100.00,7"]);
    expect(codes(g)).toEqual(["reference-not-reliable"]);
  });

  it("a reference column that mostly repeats values is not an identifier → flagged", () => {
    const rows = [
      "01/05/2026,LANDLORD,-500.00,1041",
      "01/06/2026,CARD A,-10.00,POS1",
      "01/07/2026,CARD B,-11.00,POS1",
      "01/08/2026,CARD C,-12.00,POS1",
    ];
    const groups = pair(REF, rows, rows);
    const landlord = groups.find((g) => g.evidence[0].text.includes("1041"))!;
    expect(codes(landlord)).toEqual(["reference-not-reliable"]);
    expect(groups.every((g) => g.autoSetAsideIds.length === 0)).toBe(true);
  });

  it("a reference that repeats inside its own file → falls back to values only → flagged", () => {
    const rows = ["01/05/2026,LANDLORD,-500.00,1041", "01/09/2026,LANDLORD,-500.00,1041"];
    const groups = pair(REF, rows, rows);
    expect(groups.every((g) => g.autoSetAsideIds.length === 0)).toBe(true);
    expect(groups.flatMap(codes)).toEqual(["values-only", "values-only"]);
  });

  it("explains itself in plain words", () => {
    const [g] = pair(REF, ["01/05/2026,TRANSFER,-100.00,WIRE"], ["01/05/2026,TRANSFER,-100.00,WIRE"]);
    expect(g.evidence[0].text).toMatch(/isn't distinctive enough to prove/);
    expect(g.evidence[0].text).toMatch(/no row was set aside automatically/);
  });
});

describe("running balances count only when they come from the uploaded file", () => {
  const rows = ["01/05/2026,COFFEE SUPPLY CO,-45.10", "01/20/2026,CLIENT PAYMENT,1200.00"];

  it("no balance column → no balance evidence, even though a computed running total would agree", () => {
    const txns = load(file("a.csv", "Date,Description,Amount", rows), file("b.csv", "Date,Description,Amount", [...rows, ""]));
    const groups = detect(txns);
    expect(groups.flatMap(codes)).toEqual(["values-only", "values-only"]);
    expect(initialDuplicateState(groups, AT).setAside).toEqual([]);
  });

  it("a balance that is not in the source row is ignored", () => {
    const txns = load(file("a.csv", "Date,Description,Amount", rows), file("b.csv", "Date,Description,Amount", [...rows, ""]))
      // Simulate some later code attaching a derived balance to the object.
      .map((t, i) => ({ ...t, balance: "954.90", runningBalance: 95490 + i }) as Txn);
    expect(detect(txns).every((g) => g.autoSetAsideIds.length === 0)).toBe(true);
  });

  it("balance column in only one of the files → flagged, not set aside", () => {
    const txns = load(
      file("a.csv", "Date,Description,Amount,Balance", ["01/05/2026,COFFEE SUPPLY CO,-45.10,954.90"]),
      file("b.csv", "Date,Description,Amount", ["01/05/2026,COFFEE SUPPLY CO,-45.10"])
    );
    const [g] = detect(txns);
    expect(codes(g)).toEqual(["values-only"]);
    expect(g.autoSetAsideIds).toEqual([]);
  });

  it("an empty balance cell is not evidence", () => {
    const H = "Date,Description,Amount,Balance";
    const [g] = detect(load(file("a.csv", H, ["01/05/2026,COFFEE SUPPLY CO,-45.10,"]), file("b.csv", H, ["01/05/2026,COFFEE SUPPLY CO,-45.10,"])));
    expect(codes(g)).toEqual(["values-only"]);
  });

  it("a balance column in the source that matches → set aside (unchanged)", () => {
    const H = "Date,Description,Amount,Balance";
    const [g] = detect(load(file("a.csv", H, ["01/05/2026,COFFEE SUPPLY CO,-45.10,954.90"]), file("b.csv", H, ["01/05/2026,COFFEE SUPPLY CO,-45.10,954.90"])));
    expect(codes(g)).toEqual(["running-balance"]);
    expect(g.autoSetAsideIds).toHaveLength(1);
  });
});

describe("the invariant behind all of the above", () => {
  it("automatic set-aside happens only with strong evidence — never on date + amount + description alone", () => {
    const scenarios: Txn[][] = [
      load(file("a.csv", "Date,Description,Amount", ["01/05/2026,X,-1.00"]), file("b.csv", "Date,Description,Amount", ["01/05/2026,X,-1.00"])),
      load(file("a.csv", "ID,Date,Description,Amount", ["3,01/05/2026,X,-1.00"]), file("b.csv", "ID,Date,Description,Amount", ["3,01/05/2026,X,-1.00"])),
      load(file("a.csv", "Date,Description,Amount,Reference", ["01/05/2026,X,-1.00,ACH"]), file("b.csv", "Date,Description,Amount,Reference", ["01/05/2026,X,-1.00,ACH"])),
      load(file("a.csv", "Date,Description,Amount", ["01/05/2026,X,-1.00", "01/05/2026,X,-1.00"])),
    ];
    for (const txns of scenarios) {
      for (const g of detect(txns)) {
        expect(g.evidence.some((e) => e.strong)).toBe(false);
        expect(g.autoSetAsideIds).toEqual([]);
      }
    }
  });

  it("every automatic set-aside is backed by strong evidence", () => {
    const row = "TX1,01/05/2026,COFFEE,-45.10";
    for (const g of detect(load(file("a.csv", ID, [row]), file("b.csv", ID, [row])))) {
      expect(g.autoSetAsideIds.length).toBeGreaterThan(0);
      expect(g.evidence[0].strong).toBe(true);
    }
  });
});
