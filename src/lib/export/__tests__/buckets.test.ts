/**
 * Regression tests for the export bugs fixed in Phase 0
 * (June review: B18, B31, B32, B34). These cover the pure derivations both
 * the PDF and Excel exporters print from.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  attentionHeading,
  deriveBuckets,
  exportFileName,
  localIsoDate,
  openItemCount,
  verdictText,
  type ExportContext,
} from "@/lib/export/buckets";
import type { Match, Txn } from "@/lib/recon/types";

const txn = (id: string, source: "bank" | "ledger", amount: number, description = id): Txn => ({
  id,
  source,
  date: "2026-03-10",
  description,
  amount,
  raw: {},
});

const pair = (b: string, l: string, status: Match["status"]): Match => ({
  id: `${b}:${l}`,
  bankTxnId: b,
  ledgerTxnId: l,
  type: "near",
  confidence: 80,
  status,
  reasons: ["Same amount"],
});

const ctx = (over: Partial<ExportContext>): ExportContext => ({
  accountName: "Business Checking",
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  openingBalance: null,
  closingBalance: null,
  reconciled: false,
  unexplainedDifference: 0,
  bankTxns: [],
  ledgerTxns: [],
  matches: [],
  compositeMatches: [],
  userAddedEntries: [],
  acknowledgedBankIds: [],
  ...over,
});

const added = (txnId: string, amount: number) => ({
  id: `e-${txnId}`,
  txnId,
  date: "2026-03-10",
  description: txnId,
  amount,
});

describe("B18 — user-added entries are never listed twice", () => {
  const bankTxns = [txn("bank-0", "bank", -3500), txn("bank-1", "bank", -1200)];
  const ledgerTxns = [txn("ledger-0", "ledger", -3500)];

  it("an added entry whose bank txn is unmatched appears once, under 'added'", () => {
    const b = deriveBuckets(ctx({ bankTxns, ledgerTxns, userAddedEntries: [added("bank-1", -1200)] }));
    expect(b.addedToReconciliation.map((e) => e.txnId)).toEqual(["bank-1"]);
    expect(b.missingFromBooks.map((t) => t.id)).toEqual(["bank-0"]);
  });

  it("an added entry whose bank txn is ALSO an accepted match is listed only as matched", () => {
    const b = deriveBuckets(
      ctx({
        bankTxns,
        ledgerTxns,
        matches: [pair("bank-0", "ledger-0", "accepted")],
        userAddedEntries: [added("bank-0", -3500)],
      })
    );
    expect(b.acceptedPairs.map((p) => p.bankTxn.id)).toEqual(["bank-0"]);
    expect(b.addedToReconciliation).toEqual([]); // was: listed again → double-recording
  });

  it("an added entry whose bank txn is a pending suggestion is listed only for review", () => {
    const b = deriveBuckets(
      ctx({
        bankTxns,
        ledgerTxns,
        matches: [pair("bank-0", "ledger-0", "suggested")],
        userAddedEntries: [added("bank-0", -3500)],
      })
    );
    expect(b.reviewPairs).toHaveLength(1);
    expect(b.addedToReconciliation).toEqual([]);
  });

  it("the same transaction added twice is listed once", () => {
    const b = deriveBuckets(
      ctx({
        bankTxns,
        ledgerTxns,
        userAddedEntries: [added("bank-1", -1200), { ...added("bank-1", -1200), id: "dup" }],
      })
    );
    expect(b.addedToReconciliation).toHaveLength(1);
  });

  it("every bank transaction lands in exactly one bucket", () => {
    const b = deriveBuckets(
      ctx({
        bankTxns,
        ledgerTxns,
        matches: [pair("bank-0", "ledger-0", "accepted")],
        userAddedEntries: [added("bank-0", -3500), added("bank-1", -1200)],
      })
    );
    const placed = [
      ...b.acceptedPairs.map((p) => p.bankTxn.id),
      ...b.reviewPairs.map((p) => p.bankTxn.id),
      ...b.missingFromBooks.map((t) => t.id),
      ...b.addedToReconciliation.map((e) => e.txnId),
    ].sort();
    expect(placed).toEqual(["bank-0", "bank-1"]);
  });
});

describe("B31 — verdict sentence and attention count", () => {
  it("reconciled → says the records match", () => {
    const c = ctx({ reconciled: true });
    expect(verdictText(c, deriveBuckets(c))).toBe("Your records match your bank for this period.");
  });

  it("a real difference → states the amount", () => {
    const c = ctx({ unexplainedDifference: -124500 });
    expect(verdictText(c, deriveBuckets(c))).toContain("differ by $1,245.00");
  });

  it("zero difference with open items never prints 'differ by $0.00' and never claims a match", () => {
    // Offsetting errors: a missing $50 fee and a missing $50 deposit.
    const c = ctx({
      unexplainedDifference: 0,
      bankTxns: [txn("bank-0", "bank", -5000), txn("bank-1", "bank", 5000)],
    });
    const text = verdictText(c, deriveBuckets(c));
    expect(text).not.toContain("$0.00");
    expect(text).not.toMatch(/records match/i);
    expect(text).toContain("2 items still need attention");
    expect(text).toContain("not fully reconciled");
  });

  it("pending composite suggestions count as open items", () => {
    const c = ctx({
      bankTxns: [txn("bank-0", "bank", 10000)],
      ledgerTxns: [txn("ledger-0", "ledger", 6000), txn("ledger-1", "ledger", 4000)],
      compositeMatches: [
        {
          id: "composite:bank-0",
          bankTxnId: "bank-0",
          ledgerTxnIds: ["ledger-0", "ledger-1"],
          type: "composite",
          confidence: 85,
          status: "suggested",
          reasons: [],
          ambiguous: false,
          allCombinations: null,
        },
      ],
    });
    const b = deriveBuckets(c);
    expect(openItemCount(b)).toBe(1);
    expect(verdictText(c, b)).toContain("1 item still needs attention");
  });

  it("the Excel heading counts open items and names handled ones separately", () => {
    const c = ctx({
      bankTxns: [txn("bank-0", "bank", -5000), txn("bank-1", "bank", -1200)],
      ledgerTxns: [txn("ledger-0", "ledger", -900)],
      userAddedEntries: [added("bank-1", -1200)],
      acknowledgedBankIds: ["ledger-0"],
    });
    expect(attentionHeading(deriveBuckets(c))).toBe(
      "Needs your attention  (1 open item · 2 already handled)"
    );
    const none = ctx({ bankTxns: [txn("bank-0", "bank", -5000)] });
    expect(attentionHeading(deriveBuckets(none))).toBe("Needs your attention  (1 open item)");
  });
});

describe("B32 — generated date uses the local calendar day", () => {
  it("uses local date parts, not the UTC date", () => {
    // Local 11:30pm on Mar 4. In any timezone west of UTC the UTC date is
    // already Mar 5 — the old code stamped the report with that.
    const lateEvening = new Date(2026, 2, 4, 23, 30, 0);
    expect(localIsoDate(lateEvening)).toBe("2026-03-04");
    const earlyMorning = new Date(2026, 2, 4, 0, 15, 0);
    expect(localIsoDate(earlyMorning)).toBe("2026-03-04");
  });

  it("pads single-digit months and days", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});

describe("B34 — export filenames", () => {
  it("is unchanged for plain ASCII account names", () => {
    expect(exportFileName("Business Checking", "2026-03-01", "2026-03-31", "pdf")).toBe(
      "reconly-business-checking-2026-03-01_2026-03-31.pdf"
    );
  });

  it("keeps non-ASCII letters, so different accounts don't collide", () => {
    const a = exportFileName("当座預金", "2026-03-01", "2026-03-31", "xlsx");
    const b = exportFileName("普通預金", "2026-03-01", "2026-03-31", "xlsx");
    expect(a).not.toBe(b);
    expect(a).toContain("当座預金");
    expect(a).not.toContain("reconly--");
  });

  it("strips path and shell-unsafe characters and never yields an empty name", () => {
    const name = exportFileName("../../etc/passwd: <x>", "2026-03-01", "2026-03-31", "pdf");
    expect(name).not.toMatch(/[\/\\:<>]/);
    expect(exportFileName("???", "2026-03-01", "2026-03-31", "pdf")).toBe(
      "reconly-account-2026-03-01_2026-03-31.pdf"
    );
  });
});

describe("exporters use the shared, tested derivations", () => {
  const read = (f: string) => readFileSync(resolve(__dirname, "..", f), "utf8");

  it.each(["pdf-report.ts", "excel-worksheet.ts"])("%s has no private copy of the logic", (f) => {
    const src = read(f);
    expect(src).toContain('from "./buckets"');
    expect(src).not.toMatch(/function deriveBuckets/);
    expect(src).not.toContain("differ by");
    expect(src).not.toContain("toISOString()");
  });

  it("B33: the Excel export no longer sets the ignored (Pro-only) freeze-pane option", () => {
    expect(read("excel-worksheet.ts")).not.toContain("!freeze");
  });

  it("D6: Excel cells are still written as explicit strings (formula-injection guard)", () => {
    const src = read("excel-worksheet.ts");
    expect(src).toMatch(/t:\s*"s"/);
  });
});
