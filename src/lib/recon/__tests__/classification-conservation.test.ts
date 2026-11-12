/**
 * RECON-009 — accepting one option of an ambiguous group must consume ONLY
 * that option's ledger rows. The unpicked options' rows stay unmatched, on
 * the results screen, in both exports and in the copilot context alike.
 *
 * Every scenario checks the conservation invariants by stable transaction
 * ID (never by amount):
 *   bank:   matched + awaiting review + unmatched = every included bank row
 *   ledger: distinct matched components + awaiting review + unmatched
 *           = every included ledger row
 * …and that the results screen, the report model (PDF + Excel) and the
 * copilot list exactly the same unmatched rows, with subtotals that explain
 * the net activity difference. The matching engine is used as-is.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reconcile } from "@/lib/recon/engine";
import { parseCsvDetailed } from "@/lib/parser";
import { buildDashboardData } from "@/lib/recon/adapter";
import { classifyTransactions } from "@/lib/recon/classify";
import { decideCompositeOnce, decideMatchOnce, undoCompositeDecision } from "@/lib/recon/decisions";
import { deriveBuckets, type ExportContext } from "@/lib/export/buckets";
import { buildReportModel } from "@/lib/export/report-model";
import { buildReconContext } from "@/lib/copilot/context-builder";
import { netDifference } from "@/lib/review/net-difference";
import type { AnyCompositeMatch, AmbiguousCompositeMatch, Match, Txn, ReconResult } from "@/lib/recon/types";

// ---- fixtures ---------------------------------------------------------

const txn = (id: string, source: "bank" | "ledger", date: string, description: string, amount: number, line: number): Txn => ({
  id, source, date, description, amount, raw: {},
  sourceFile: source === "bank" ? "bank.csv" : "ledger.csv",
  sourceLine: line,
});

/**
 * Independent of the demo files: one ambiguous group (four ways to make
 * $100), one unambiguous grouped match, one cross-month pair, one exact
 * pair, and one genuinely unmatched row on each side.
 */
function synthetic() {
  const bank = [
    txn("b-payout", "bank", "2026-01-10", "STRIPE PAYOUT", 10000, 2),
    txn("b-group", "bank", "2026-01-12", "SQUARE DEPOSIT", 475000, 3),
    txn("b-check", "bank", "2026-02-02", "CHECK 1187 NORTHWIND PRINT", -124000, 4),
    txn("b-rent", "bank", "2026-01-20", "RENT JANUARY", -90000, 5),
    txn("b-fee", "bank", "2026-02-05", "MONTHLY FEE", -1200, 6),
  ];
  const ledger = [
    txn("l-a", "ledger", "2026-01-08", "Invoice A", 6000, 2),
    txn("l-b", "ledger", "2026-01-08", "Invoice B", 4000, 3),
    txn("l-c", "ledger", "2026-01-09", "Invoice C", 6000, 4),
    txn("l-d", "ledger", "2026-01-09", "Invoice D", 4000, 5),
    txn("l-g1", "ledger", "2026-01-11", "Harbor sale", 150000, 6),
    txn("l-g2", "ledger", "2026-01-11", "Quill sale", 200000, 7),
    txn("l-g3", "ledger", "2026-01-12", "Fernwood sale", 125000, 8),
    txn("l-check", "ledger", "2026-01-30", "Check 1187 - Northwind Print Co.", -124000, 9),
    txn("l-rent", "ledger", "2026-01-20", "RENT JANUARY", -90000, 10),
    txn("l-pending", "ledger", "2026-01-25", "Deposit not yet banked", 50000, 11),
  ];
  return { bank, ledger, result: reconcile(bank, ledger) };
}

const readSample = (name: string) => readFileSync(resolve(__dirname, "../../../../public/samples", name), "utf8");
function juneSample() {
  const bank = parseCsvDetailed(readSample("bank-june2026.csv"), "bank").txns;
  const ledger = parseCsvDetailed(readSample("ledger-june2026.csv"), "ledger").txns;
  return { bank, ledger, result: reconcile(bank, ledger) };
}

// ---- state + invariant checker ---------------------------------------

type State = { matches: Match[]; composites: AnyCompositeMatch[] };
type Scenario = { bank: Txn[]; ledger: Txn[]; result: ReconResult };

const ambiguousOf = (s: State) =>
  s.composites.find((c): c is AmbiguousCompositeMatch => c.ambiguous) ??
  (() => { throw new Error("no ambiguous group"); })();

function acceptAllOtherSuggestions(s: State, keepId: string): State {
  let { matches, composites } = s;
  for (const m of matches) if (m.status === "suggested") matches = decideMatchOnce(matches, m.id, "accept");
  for (const c of composites) {
    if (c.id !== keepId && c.status === "suggested" && !c.ambiguous) composites = decideCompositeOnce(composites, c.id, "accept");
  }
  return { matches, composites };
}

/** Run every invariant; returns the dashboard data for scenario-specific asserts. */
function checkInvariants(sc: Scenario, s: State) {
  const { bank, ledger, result } = sc;
  const c = classifyTransactions(s.matches, s.composites, bank, ledger);
  const dash = buildDashboardData(s.matches, s.composites, bank, ledger, result.missingFromBooks, result.missingFromBank);

  // -- Conservation by ID, each row in exactly one state --
  const bankIds = bank.map((t) => t.id);
  const unmatchedBank = new Set(dash.missingFromBooks.map((m) => m.txnId));
  for (const id of bankIds) {
    const states = [c.matchedBankIds.has(id), c.pendingBankIds.has(id), unmatchedBank.has(id)].filter(Boolean);
    expect(states, `bank ${id} in exactly one state`).toHaveLength(1);
  }
  expect(c.matchedBankIds.size + c.pendingBankIds.size + unmatchedBank.size).toBe(bank.length);

  const ledgerIds = ledger.map((t) => t.id);
  const unmatchedLedger = new Set(dash.missingFromBank.map((m) => m.txnId));
  // Distinct matched ledger COMPONENTS — never the number of match groups.
  const matchedComponents = new Set([
    ...c.acceptedPairs.map((p) => p.ledgerTxn.id),
    ...c.acceptedGroups.flatMap((g) => g.ledgerTxns.map((t) => t.id)),
  ]);
  expect(matchedComponents).toEqual(c.matchedLedgerIds);
  for (const id of ledgerIds) {
    const states = [matchedComponents.has(id), c.pendingLedgerIds.has(id), unmatchedLedger.has(id)].filter(Boolean);
    expect(states, `ledger ${id} in exactly one state`).toHaveLength(1);
  }
  expect(matchedComponents.size + c.pendingLedgerIds.size + unmatchedLedger.size).toBe(ledger.length);

  // -- Results screen === shared classification (no row silently dropped) --
  expect([...unmatchedBank].sort()).toEqual(c.unmatchedBank.map((t) => t.id).sort());
  expect([...unmatchedLedger].sort()).toEqual(c.unmatchedLedger.map((t) => t.id).sort());
  expect(dash.counts.missingFromBooks).toBe(dash.missingFromBooks.length);
  expect(dash.counts.missingFromBank).toBe(dash.missingFromBank.length);

  // -- Exports (PDF + Excel share the report model) agree --
  const ctx: ExportContext = {
    accountName: "Test", periodStart: "2026-01-01", periodEnd: "2026-06-30",
    openingBalance: null, closingBalance: null, reconciled: false,
    unexplainedDifference: result.balanceProof.unexplainedDifference,
    bankTxns: bank, ledgerTxns: ledger, matches: s.matches, compositeMatches: s.composites,
    userAddedEntries: [], acknowledgedBankIds: [],
  };
  const buckets = deriveBuckets(ctx);
  expect(buckets.missingFromBank.map((t) => t.id).sort()).toEqual([...unmatchedLedger].sort());
  expect(buckets.missingFromBooks.map((t) => t.id).sort()).toEqual([...unmatchedBank].sort());
  const model = buildReportModel(ctx);
  const key = (x: { description: string; amountCents: number; source: string }) => `${x.description}|${x.amountCents}|${x.source}`;
  const rowKey = (t: Txn) => key({ description: t.description, amountCents: t.amount, source: `${t.sourceFile} · row ${t.sourceLine}` });
  if (bank[0].sourceFile) {
    expect(model.missingFromBank.map(key).sort()).toEqual(c.unmatchedLedger.map(rowKey).sort());
    expect(model.missingFromBooks.map(key).sort()).toEqual(c.unmatchedBank.map(rowKey).sort());
  }
  expect(model.missingFromBank.length).toBe(dash.missingFromBank.length);
  expect(model.missingFromBank.reduce((s2, l) => s2 + l.amountCents, 0)).toBe(c.unmatchedLedger.reduce((s2, t) => s2 + t.amount, 0));
  expect(model.matchedCount).toBe(dash.counts.matched);

  // -- Copilot context sees the same rows --
  const copilot = buildReconContext({
    matches: s.matches, compositeMatches: s.composites, bankTxns: bank, ledgerTxns: ledger,
    baseMissingFromBooks: result.missingFromBooks, baseMissingFromBank: result.missingFromBank,
    userAddedEntries: [], acknowledgedBankIds: [], balanceProof: result.balanceProof,
    reconciled: false, periodLabel: "test",
  });
  expect(copilot.summary.counts.missingFromBank).toBe(dash.missingFromBank.length);
  expect(copilot.summary.counts.missingFromBooks).toBe(dash.missingFromBooks.length);

  // -- Displayed subtotals explain the authoritative difference --
  const signed = (m: { amount: number; type: "in" | "out" }) => ({ amount: m.type === "in" ? m.amount : -m.amount });
  const net = netDifference({
    bankNet: result.balanceProof.bankNetChange,
    ledgerNet: result.balanceProof.ledgerNetChange,
    bankOnly: dash.missingFromBooks.map(signed),
    ledgerOnly: dash.missingFromBank.map(signed),
  });
  expect(net.ledgerOnly.net).toBe(c.unmatchedLedger.reduce((s2, t) => s2 + t.amount, 0));
  expect(net.bankOnly.net).toBe(c.unmatchedBank.reduce((s2, t) => s2 + t.amount, 0));
  expect(net.difference).toBe(model.net.difference);
  if (c.pendingBankIds.size === 0 && c.pendingLedgerIds.size === 0) expect(net.tiesOut).toBe(true);

  return { c, dash, model, net };
}

// ---- synthetic scenario ----------------------------------------------

describe("RECON-009 — synthetic ambiguous group with composite and cross-month matches", () => {
  const sc = synthetic();
  const start: State = { matches: sc.result.matches, composites: sc.result.compositeMatches };
  const amb = ambiguousOf(start);
  const ready = acceptAllOtherSuggestions(start, amb.id);

  it("the scenario has the shapes under test", () => {
    expect(amb.allCombinations.length).toBeGreaterThan(1);
    expect(start.composites.some((c) => !c.ambiguous)).toBe(true);
    expect(start.matches.some((m) => m.bankTxnId === "b-check" && m.ledgerTxnId === "l-check")).toBe(true);
    checkInvariants(sc, start); // undecided: all candidates awaiting review
  });

  it.each([0, 1])("A/B — accepting option %i matches only that option; the others stay unmatched", (i) => {
    const pick = amb.allCombinations[i];
    const s = { ...ready, composites: decideCompositeOnce(ready.composites, amb.id, "accept", pick) };
    const { c, dash } = checkInvariants(sc, s);
    for (const id of pick) expect(c.matchedLedgerIds.has(id)).toBe(true);
    const unpicked = amb.ledgerTxnIds.filter((id) => !pick.includes(id));
    expect(unpicked.length).toBeGreaterThan(0);
    for (const id of unpicked) expect(dash.missingFromBank.map((m) => m.txnId)).toContain(id);
    // The grouped match and the cross-month pair are unaffected.
    for (const id of ["l-g1", "l-g2", "l-g3", "l-check"]) expect(c.matchedLedgerIds.has(id)).toBe(true);
  });

  it("C — rejecting the group leaves every candidate unmatched", () => {
    const s = { ...ready, composites: decideCompositeOnce(ready.composites, amb.id, "reject") };
    const { dash } = checkInvariants(sc, s);
    for (const id of amb.ledgerTxnIds) expect(dash.missingFromBank.map((m) => m.txnId)).toContain(id);
    expect(dash.missingFromBooks.map((m) => m.txnId)).toContain("b-payout");
  });

  it("D/I — accept, Undo, then pick a different option", () => {
    const [first, second] = amb.allCombinations;
    let s: State = { ...ready, composites: decideCompositeOnce(ready.composites, amb.id, "accept", first) };
    checkInvariants(sc, s);
    s = { ...s, composites: undoCompositeDecision(s.composites, amb.id, reconcile(sc.bank, sc.ledger).compositeMatches) };
    const afterUndo = checkInvariants(sc, s);
    for (const id of amb.ledgerTxnIds) expect(afterUndo.c.pendingLedgerIds.has(id)).toBe(true);
    s = { ...s, composites: decideCompositeOnce(s.composites, amb.id, "accept", second) };
    const switched = checkInvariants(sc, s);
    expect([...switched.c.matchedLedgerIds].filter((id) => amb.ledgerTxnIds.includes(id)).sort()).toEqual([...second].sort());
  });

  it("J — repeated accepts (same or different option) never consume extra rows", () => {
    const [first, second] = amb.allCombinations;
    let composites = decideCompositeOnce(ready.composites, amb.id, "accept", first);
    composites = decideCompositeOnce(composites, amb.id, "accept", first);
    composites = decideCompositeOnce(composites, amb.id, "accept", second);
    composites = decideCompositeOnce(composites, amb.id, "reject");
    const { c } = checkInvariants(sc, { ...ready, composites });
    expect([...c.matchedLedgerIds].filter((id) => amb.ledgerTxnIds.includes(id)).sort()).toEqual([...first].sort());
  });
});

// ---- the original June sample ----------------------------------------

describe("RECON-009 — the June sample's $300 mobile check deposit", () => {
  const sc = juneSample();
  const start: State = { matches: sc.result.matches, composites: sc.result.compositeMatches };
  const amb = ambiguousOf(start);
  const desc = (id: string) => sc.ledger.find((t) => t.id === id)!.description;
  const optionWith = (text: string) => amb.allCombinations.find((combo) => combo.some((id) => desc(id).includes(text)))!;
  const ready = acceptAllOtherSuggestions(start, amb.id);

  it("is the Beacon/Loom vs Workshop/Print group", () => {
    expect(sc.bank.find((t) => t.id === amb.bankTxnId)!.description).toBe("MOBILE CHECK DEPOSIT");
    expect(amb.allCombinations).toHaveLength(2);
    checkInvariants(sc, start);
  });

  it.each([
    ["Beacon Dental", ["Workshop tickets", "Print sale"]],
    ["Workshop tickets", ["Beacon Dental", "Loom Floral"]],
  ])("accepting the %s option leaves %j unmatched: 5 entries totalling 1,025.00, difference −1,060.17", (picked, unpicked) => {
    const s = { ...ready, composites: decideCompositeOnce(ready.composites, amb.id, "accept", optionWith(picked)) };
    const { dash, net, model } = checkInvariants(sc, s);
    const shown = dash.missingFromBank.map((m) => m.desc ?? "");
    for (const u of unpicked) expect(dash.missingFromBank.some((m) => desc(m.txnId).includes(u)), `${u} listed`).toBe(true);
    expect(shown).toHaveLength(5);
    expect(net.bankOnly).toEqual({ count: 3, net: -3517 });
    expect(net.ledgerOnly).toEqual({ count: 5, net: 102500 });
    expect(net.difference).toBe(-106017);
    expect(net.tiesOut).toBe(true);
    expect(model.missingFromBank).toHaveLength(5);
  });

  it("rejecting the group lists all four candidates", () => {
    const s = { ...ready, composites: decideCompositeOnce(ready.composites, amb.id, "reject") };
    const { dash } = checkInvariants(sc, s);
    for (const id of amb.ledgerTxnIds) expect(dash.missingFromBank.map((m) => m.txnId)).toContain(id);
  });
});
