/**
 * Phase 1 — reconciliations saved BEFORE multi-file import / provenance
 * existed must still open and show the same results. Old records have no
 * `sourceFiles`, and their transactions have no `sourceFile` / `sourceLine`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsv } from "@/lib/parser";
import { reconcile } from "@/lib/recon/engine";
import { buildDashboardData } from "@/lib/recon/adapter";
import { restoreComposites, restoreMatches } from "@/lib/recon/decisions";
import { deriveBuckets } from "@/lib/export/buckets";
import type { ReconciliationRecord } from "@/lib/data/repository";
import type { Txn } from "@/lib/recon/types";

const fixture = (n: string) =>
  readFileSync(resolve(__dirname, "../../../../tests/fixtures", n), "utf8");

/** A transaction exactly as an older version of the app stored it. */
const legacy = ({ sourceFile, sourceLine, ...t }: Txn): Txn => t;

function legacyRecord(): ReconciliationRecord {
  const bankTxns = parseCsv(fixture("bank_statement.csv"), "bank").map(legacy);
  const ledgerTxns = parseCsv(fixture("ledger.csv"), "ledger").map(legacy);
  const result = reconcile(bankTxns, ledgerTxns);
  return {
    id: "legacy-1",
    createdAt: "2026-06-10T12:00:00.000Z",
    updatedAt: "2026-06-10T12:00:00.000Z",
    accountName: "Business Checking",
    periodStart: "2026-03-01",
    periodEnd: "2026-03-31",
    openingBalance: 0,
    closingBalance: result.balanceProof.bankNetChange,
    status: "not_reconciled",
    unexplainedDifference: result.balanceProof.unexplainedDifference,
    bankTxns,
    ledgerTxns,
    // The user had accepted every suggestion before saving.
    matches: result.matches.map((m) => ({ ...m, status: "accepted" as const })),
    // No compositeMatches / userAddedEntries / acknowledgedBankIds / sourceFiles:
    // the oldest records have none of the optional fields.
  };
}

describe("legacy saved reconciliations", () => {
  it("fixture sanity: the record really has no provenance fields", () => {
    const r = legacyRecord();
    expect(r.sourceFiles).toBeUndefined();
    expect(r.bankTxns.every((t) => !("sourceFile" in t) && !("sourceLine" in t))).toBe(true);
    expect(r.bankTxns.every((t) => /^bank-\d+$/.test(t.id))).toBe(true); // historical id scheme
  });

  it("reopens with the same engine result and the saved decisions", () => {
    const r = legacyRecord();
    const fresh = reconcile(r.bankTxns, r.ledgerTxns);
    // Provenance fields play no part in matching.
    const withProvenance = reconcile(
      parseCsv(fixture("bank_statement.csv"), "bank"),
      parseCsv(fixture("ledger.csv"), "ledger")
    );
    expect(fresh.matches).toEqual(withProvenance.matches);
    expect(fresh.balanceProof).toEqual(withProvenance.balanceProof);

    const matches = restoreMatches(fresh.matches, r.matches);
    const composites = restoreComposites(fresh.compositeMatches, r.compositeMatches ?? []);
    expect(matches.every((m) => m.status === "accepted")).toBe(true);

    const view = buildDashboardData(
      matches,
      composites,
      r.bankTxns,
      r.ledgerTxns,
      fresh.missingFromBooks,
      fresh.missingFromBank,
      new Set((r.userAddedEntries ?? []).map((e) => e.txnId)),
      new Set(r.acknowledgedBankIds ?? [])
    );
    expect(view.counts.matched).toBe(matches.length + composites.filter((c) => c.status === "accepted").length);
    expect(view.counts.missingFromBooks).toBe(fresh.missingFromBooks.length);
    // No provenance to show — and nothing invented in its place.
    expect(view.missingFromBooks.every((t) => t.source === undefined)).toBe(true);
  });

  it("exports still derive from a legacy record", () => {
    const r = legacyRecord();
    const b = deriveBuckets({
      accountName: r.accountName,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      openingBalance: r.openingBalance,
      closingBalance: r.closingBalance,
      reconciled: false,
      unexplainedDifference: r.unexplainedDifference,
      bankTxns: r.bankTxns,
      ledgerTxns: r.ledgerTxns,
      matches: r.matches,
      compositeMatches: r.compositeMatches ?? [],
      userAddedEntries: r.userAddedEntries ?? [],
      acknowledgedBankIds: r.acknowledgedBankIds ?? [],
    });
    expect(b.acceptedPairs).toHaveLength(r.matches.length);
  });

  it("new transactions DO carry provenance for display", () => {
    const bank = parseCsv(fixture("bank_one_fee.csv"), "bank");
    const ledger = parseCsv(fixture("ledger_missing_fee.csv"), "ledger");
    const res = reconcile(bank, ledger);
    const view = buildDashboardData(res.matches, res.compositeMatches, bank, ledger, res.missingFromBooks, res.missingFromBank);
    expect(view.missingFromBooks.length).toBeGreaterThan(0);
    expect(view.missingFromBooks[0].source).toMatch(/^row \d+$/);
  });
});
