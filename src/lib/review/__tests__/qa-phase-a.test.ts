/**
 * QA remediation — Phase A (financial accuracy and trust).
 * RECON-001 neutral wording for unmatched ledger entries
 * RECON-002 net activity difference stated without an assumed cause
 * RECON-004 duplicate detection vs. decision vs. current status
 * RECON-005 statement outcomes named separately
 * (RECON-003, numeric Excel cells, is in export/__tests__/excel-numeric.test.ts)
 *
 * Everything runs on the real pipeline over the advanced-demo files; the
 * matching engine, duplicate detector and statement checks are untouched.
 */
import { describe, it, expect } from "vitest";
import { reconcile } from "@/lib/recon";
import { applyCompositeDecision, applyMatchDecision } from "@/lib/recon/decisions";
import { buildDashboardData, toMissingTxn } from "@/lib/recon/adapter";
import { deriveVerdict } from "@/lib/recon/verdict";
import type { Txn } from "@/lib/recon/types";
import {
  activeTxns,
  dismissGroup,
  groupStatus,
  restoreRows,
  setAsideRows,
  unresolvedGroupCount,
  type DuplicateState,
} from "@/lib/import/duplicates";
import { describeDuplicateDecision } from "@/lib/import/duplicate-decision";
import { possibleAmountDifferences } from "@/lib/review/amount-hints";
import {
  NET_LABELS,
  netDifference,
  netDifferenceBreakdown,
  netDifferenceSentence,
  signedDollars,
} from "@/lib/review/net-difference";
import { statementOutcomeText } from "@/lib/review/statement-summary";
import { summarizeStatements, verifyStatements, type StatementStatus } from "@/lib/review/statements";
import { buildMonthReview } from "@/lib/review/months";
import { buildReportModel } from "@/lib/export/report-model";
import { buildPdfDocument } from "@/lib/export/pdf-report";
import { buildExcelWorkbook } from "@/lib/export/excel-worksheet";
import type { ExportContext } from "@/lib/export/buckets";
import { buildReconContext } from "@/lib/copilot/context-builder";
import { readFileSync } from "fs";
import { resolve } from "path";
import { PILL_LABEL } from "@/components/ui/status-pill";
import { runDemoPipeline } from "@/lib/demo/__tests__/pipeline";

const TIMING_WORDS = /not (yet )?cleared|hasn.t (cleared|processed)|haven.t cleared|timing|no action needed|that.s normal|this is normal|outstanding/i;
const CAUSE_WORDS = /usually means|one missing entry|a gap this size/i;

// The prompt module is server-only, so its text is read from the file.
const COPILOT_SYSTEM_PROMPT = readFileSync(resolve(__dirname, "../../copilot/system-prompt.ts"), "utf8");

/** The one place the reports mention timing is to say it is NOT assumed. */
const scrub = (text: string) => text.replaceAll("not assumed to be timing differences", "");

const demo = runDemoPipeline();
const byId = new Map<string, Txn>([...demo.imported.bank, ...demo.imported.ledger].map((t) => [t.id, t]));
const bankBy = (desc: string, date?: string) =>
  demo.bankTxns.find((t) => t.description === desc && (date === undefined || t.date === date))!;
const ledgerBy = (desc: string, date?: string) =>
  demo.ledgerTxns.find((t) => t.description === desc && (date === undefined || t.date === date))!;

/** Export context for a given state of the demo. */
function ctxFor(opts: {
  state?: DuplicateState;
  decide?: "none" | "accept-all";
  acknowledged?: string[];
}): ExportContext & { result: ReturnType<typeof reconcile> } {
  const state = opts.state ?? demo.dupState;
  const bank = activeTxns(demo.imported.bank, state);
  const ledger = activeTxns(demo.imported.ledger, state);
  const result = reconcile(bank, ledger);
  let matches = result.matches;
  let composites = result.compositeMatches;
  if (opts.decide === "accept-all") {
    for (const m of matches.filter((x) => x.status === "suggested")) matches = applyMatchDecision(matches, m.id, "accept");
    for (const c of composites) composites = applyCompositeDecision(composites, c.id, "accept");
  }
  const statements = verifyStatements(demo.imported.bank, demo.sourceFiles);
  const months = buildMonthReview({
    statementReview: statements,
    imported: demo.imported,
    bankTxns: bank,
    ledgerTxns: ledger,
    matches,
    compositeMatches: composites,
    addedBankIds: new Set(),
    acknowledgedLedgerIds: new Set(opts.acknowledged ?? []),
    duplicateGroups: demo.groups,
    duplicateState: state,
    sourceFiles: demo.sourceFiles,
  });
  return {
    accountName: "Sample data — Cedar & Co. Creative Studio (fictional)",
    periodStart: "2026-01-02",
    periodEnd: "2026-03-31",
    openingBalance: null,
    closingBalance: null,
    reconciled: false,
    unexplainedDifference: result.balanceProof.unexplainedDifference,
    bankTxns: bank,
    ledgerTxns: ledger,
    matches,
    compositeMatches: composites,
    userAddedEntries: [],
    acknowledgedBankIds: opts.acknowledged ?? [],
    review: { months, statements },
    duplicates: { allBankTxns: demo.imported.bank, allLedgerTxns: demo.imported.ledger, groups: demo.groups, state },
    result,
  };
}

async function excelText(ctx: ExportContext): Promise<string> {
  const XLSX = (await import("xlsx-js-style")).default;
  const wb = await buildExcelWorkbook(ctx);
  return wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n");
}

// ───────────────────────── RECON-001 ─────────────────────────
describe("RECON-001 — unmatched ledger entries are not called timing differences", () => {
  const bankComcast = bankBy("COMCAST BUSINESS", "2026-03-17");
  const ledgerComcast = ledgerBy("COMCAST BUSINESS", "2026-03-17");

  it("the default category is 'In your records only', with neutral guidance", () => {
    expect(PILL_LABEL.missingBank).toBe("In your records only");
    const hint = toMissingTxn(ledgerComcast, "ledger").hint;
    expect(hint).toBe("This entry is in your records and has no confirmed bank match.");
    expect(hint).not.toMatch(TIMING_WORDS);
    expect(toMissingTxn(bankComcast, "bank").hint).not.toMatch(TIMING_WORDS);
  });

  it("Comcast: −$129.99 (bank) and −$139.99 (ledger) stay unmatched and are flagged as a possible $10.00 amount difference", () => {
    expect(bankComcast.amount).toBe(-12999);
    expect(ledgerComcast.amount).toBe(-13999);
    expect(demo.result.missingFromBooks.some((t) => t.id === bankComcast.id)).toBe(true);
    expect(demo.result.missingFromBank.some((t) => t.id === ledgerComcast.id)).toBe(true);

    const hints = possibleAmountDifferences(demo.result.missingFromBooks, demo.result.missingFromBank);
    expect(hints).toEqual([{ bankTxnId: bankComcast.id, ledgerTxnId: ledgerComcast.id, difference: 1000 }]);
  });

  it("the indicator is informational: it is computed from unmatched rows only and changes nothing", () => {
    const before = JSON.stringify(demo.result);
    possibleAmountDifferences(demo.result.missingFromBooks, demo.result.missingFromBank);
    expect(JSON.stringify(demo.result)).toBe(before);
    // Rows that are matched or pending are never candidates.
    expect(possibleAmountDifferences([], demo.result.missingFromBank)).toEqual([]);
  });

  it("the indicator needs the same date, direction and description, a different amount, and an unambiguous pair", () => {
    const t = (id: string, source: "bank" | "ledger", date: string, description: string, amount: number): Txn => ({
      id, source, date, description, amount, raw: {},
    });
    const b = t("b1", "bank", "2026-03-17", "COMCAST BUSINESS", -12999);
    const hit = (ledger: Txn[], bank: Txn[] = [b]) => possibleAmountDifferences(bank, ledger).length;
    expect(hit([t("l1", "ledger", "2026-03-17", "Comcast Business", -13999)])).toBe(1); // case / punctuation ignored
    expect(hit([t("l1", "ledger", "2026-03-18", "COMCAST BUSINESS", -13999)])).toBe(0); // different date
    expect(hit([t("l1", "ledger", "2026-03-17", "COMCAST BUSINESS", 13999)])).toBe(0); // opposite direction
    expect(hit([t("l1", "ledger", "2026-03-17", "VERIZON", -13999)])).toBe(0); // different vendor
    expect(hit([t("l1", "ledger", "2026-03-17", "COMCAST BUSINESS", -12999)])).toBe(0); // same amount: the engine's job
    expect(
      hit([
        t("l1", "ledger", "2026-03-17", "COMCAST BUSINESS", -13999),
        t("l2", "ledger", "2026-03-17", "COMCAST BUSINESS", -14999),
      ])
    ).toBe(0); // two candidates: ambiguous, so nothing is claimed
    expect(hit([t("l1", "ledger", "2026-03-17", "***", -13999)], [t("b1", "bank", "2026-03-17", "!!!", -12999)])).toBe(0); // no description evidence
  });

  it("a rejected equal-amount match puts both rows back as plain unmatched items — no timing wording, no amount flag", () => {
    const google = demo.result.matches.find(
      (m) => byId.get(m.bankTxnId)!.description === "GOOGLE WORKSPACE GSUITE" && m.status === "suggested"
    )!;
    const matches = applyMatchDecision(demo.result.matches, google.id, "reject");
    const d = buildDashboardData(
      matches,
      demo.result.compositeMatches,
      demo.bankTxns,
      demo.ledgerTxns,
      demo.result.missingFromBooks,
      demo.result.missingFromBank
    );
    const ledgerRow = d.missingFromBank.find((x) => x.txnId === google.ledgerTxnId)!;
    const bankRow = d.missingFromBooks.find((x) => x.txnId === google.bankTxnId)!;
    expect(ledgerRow.hint).not.toMatch(TIMING_WORDS);
    expect(bankRow.hint).not.toMatch(TIMING_WORDS);
    const hints = possibleAmountDifferences(
      d.missingFromBooks.map((x) => byId.get(x.txnId)!),
      d.missingFromBank.map((x) => byId.get(x.txnId)!)
    );
    expect(hints.some((h) => h.bankTxnId === google.bankTxnId)).toBe(false);
  });

  it("a genuine outstanding check gets timing wording only after the user marks it as expected", async () => {
    const check = ledgerBy("Check 1203 - Alder Studio Supply");
    expect(toMissingTxn(check, "ledger").hint).not.toMatch(TIMING_WORDS);

    // Nothing marked: no report text describes any unmatched entry as timing / not cleared.
    const plain = ctxFor({});
    const model = buildReportModel(plain);
    expect(JSON.stringify(model)).toContain("not assumed to be timing differences");
    expect(scrub(JSON.stringify({ ...model, buckets: undefined }))).not.toMatch(TIMING_WORDS);
    expect(scrub(await excelText(plain))).not.toMatch(TIMING_WORDS);
    const pdf = (await buildPdfDocument(plain)).output();
    expect(pdf).not.toMatch(/not yet cleared|normal timing|known timing|no action needed/i);
    expect(pdf).toContain("In your records only");

    // Marked by the user: it is reported as THEIR classification, not as a verified fact.
    const marked = ctxFor({ acknowledged: [check.id] });
    const m2 = buildReportModel(marked);
    expect(m2.acknowledged.map((l) => l.description)).toEqual(["Check 1203 - Alder Studio Supply"]);
    expect(m2.missingFromBank.some((l) => l.description.startsWith("Check 1203"))).toBe(false);
    const xl = await excelText(marked);
    expect(xl).toContain("Marked by you as expected to clear later  (1)");
    expect(xl).toContain("This is your classification; Reconly has not verified it");
    expect(xl).not.toMatch(/normal timing difference|no action needed/i);
    // The other unmatched entries (Comcast, Amazon, deposit in transit) are still neutral.
    expect(m2.missingFromBank).toHaveLength(3);
  });

  it("entries with no identifiable cause are simply 'no confirmed bank match'", () => {
    const amazon = ledgerBy("Amazon - studio supplies");
    expect(toMissingTxn(amazon, "ledger").hint).toBe("This entry is in your records and has no confirmed bank match.");
    const ex = buildReportModel(ctxFor({})).summary!.exceptions.filter((e) => e.description === amazon.description);
    expect(ex.map((e) => e.type)).toEqual(["In your records only — no confirmed bank match"]);
  });

  it("the assistant is given neutral reasons and is told not to assign a cause", () => {
    const ctx = buildReconContext({
      matches: demo.result.matches,
      compositeMatches: demo.result.compositeMatches,
      bankTxns: demo.bankTxns,
      ledgerTxns: demo.ledgerTxns,
      baseMissingFromBooks: demo.result.missingFromBooks,
      baseMissingFromBank: demo.result.missingFromBank,
      userAddedEntries: [],
      acknowledgedBankIds: [],
      balanceProof: demo.result.balanceProof,
      reconciled: false,
      periodLabel: "Jan 2 – Mar 31, 2026",
    });
    const fromBank = ctx.items.filter((i) => i.bucket === "missing-from-bank");
    expect(fromBank.length).toBe(4);
    for (const i of fromBank) expect(i.reasons.join(" ")).not.toMatch(TIMING_WORDS);
    expect(COPILOT_SYSTEM_PROMPT).toContain("NEVER ASSIGN A CAUSE THE DATA DOES NOT ESTABLISH");
    expect(COPILOT_SYSTEM_PROMPT).toContain("not account balances");
  });
});

// ───────────────────────── RECON-002 ─────────────────────────
describe("RECON-002 — the net difference is stated, never explained by a guess", () => {
  const amt = (list: Txn[]) => list.map((t) => ({ amount: t.amount }));
  const demoNet = netDifference({
    bankNet: demo.result.balanceProof.bankNetChange,
    ledgerNet: demo.result.balanceProof.ledgerNetChange,
    bankOnly: amt(demo.result.missingFromBooks),
    ledgerOnly: amt(demo.result.missingFromBank),
  });

  it("labels the three figures and says they are activity, not balances", () => {
    expect(NET_LABELS.bank).toBe("Bank net activity");
    expect(NET_LABELS.ledger).toBe("Ledger net activity");
    expect(NET_LABELS.difference).toBe("Net activity difference (bank minus ledger)");
    expect(NET_LABELS.scope).toMatch(/not bank account balances/);
  });

  it("demo: −$2,977.56 − (−$1,668.02) = −$1,309.54, made of 9 bank-only and 4 records-only rows", () => {
    expect(demoNet.bankNet).toBe(-297756);
    expect(demoNet.ledgerNet).toBe(-166802);
    expect(demoNet.difference).toBe(-130954);
    expect(demoNet.difference).toBe(demoNet.bankNet - demoNet.ledgerNet);
    expect(demoNet.bankOnly).toEqual({ count: 9, net: -34696 });
    expect(demoNet.ledgerOnly).toEqual({ count: 4, net: 96258 });
    expect(demoNet.tiesOut).toBe(true);
    expect(netDifferenceSentence(demoNet)).toBe("Bank net activity is $1,309.54 lower than ledger net activity.");
    const lines = netDifferenceBreakdown(demoNet);
    expect(lines[0]).toBe("Bank only: 9 transactions totalling −$346.96.");
    expect(lines[1]).toBe("In your records only: 4 entries totalling $962.58.");
    expect(lines[2]).toContain("−$1,309.54 — the whole difference");
    expect(lines.join(" ")).not.toMatch(CAUSE_WORDS);
  });

  it("one missing entry and several offsetting ones with the same gap read the same way — no cause is inferred", () => {
    const single = netDifference({ bankNet: -3500, ledgerNet: 0, bankOnly: [{ amount: -3500 }], ledgerOnly: [] });
    const several = netDifference({
      bankNet: -3500,
      ledgerNet: 0,
      bankOnly: [{ amount: -10000 }, { amount: 2500 }, { amount: -1000 }],
      ledgerOnly: [{ amount: -9000 }, { amount: 4000 }],
    });
    expect(single.difference).toBe(-3500);
    expect(several.difference).toBe(-3500);
    expect(several.tiesOut).toBe(true);
    expect(netDifferenceSentence(single)).toBe(netDifferenceSentence(several));
    for (const d of [single, several]) {
      const text = [netDifferenceSentence(d), ...netDifferenceBreakdown(d)].join(" ");
      expect(text).not.toMatch(CAUSE_WORDS);
      expect(text).toContain("no single one is assumed to explain it");
    }
  });

  it("handles positive, negative and zero differences with signed arithmetic", () => {
    const pos = netDifference({ bankNet: 5000, ledgerNet: 1000, bankOnly: [{ amount: 4000 }], ledgerOnly: [] });
    expect(pos.difference).toBe(4000);
    expect(netDifferenceSentence(pos)).toBe("Bank net activity is $40.00 higher than ledger net activity.");
    const neg = netDifference({ bankNet: 1000, ledgerNet: 5000, bankOnly: [], ledgerOnly: [{ amount: 4000 }] });
    expect(neg.difference).toBe(-4000);
    expect(signedDollars(neg.difference)).toBe("−$40.00");
    expect(netDifferenceSentence(neg)).toBe("Bank net activity is $40.00 lower than ledger net activity.");
    const zero = netDifference({ bankNet: 700, ledgerNet: 700, bankOnly: [], ledgerOnly: [] });
    expect(zero.difference).toBe(0);
    expect(netDifferenceSentence(zero)).toBe("Bank net activity and ledger net activity are equal.");
    expect(netDifferenceBreakdown(zero)).toEqual([]);
  });

  it("offsetting unmatched items that net to zero are still reported as unmatched", () => {
    const d = netDifference({ bankNet: -5000, ledgerNet: -5000, bankOnly: [{ amount: -5000 }], ledgerOnly: [{ amount: -5000 }] });
    expect(d.difference).toBe(0);
    expect(netDifferenceBreakdown(d)[2]).toMatch(/cancel in the net figure — they are still unmatched/);
  });

  it("bank items the user added are subtracted, and the breakdown still ties out", () => {
    const fee = demo.result.missingFromBooks[0]; // Jan service fee, −$15.00
    const d = netDifference({
      bankNet: demoNet.bankNet,
      ledgerNet: demoNet.ledgerNet,
      added: [{ amount: fee.amount }],
      bankOnly: amt(demo.result.missingFromBooks.slice(1)),
      ledgerOnly: amt(demo.result.missingFromBank),
    });
    expect(d.difference).toBe(-130954 + 1500);
    expect(d.tiesOut).toBe(true);
  });

  it("a rejected equal-amount suggestion adds a row to each side and leaves the difference unchanged", () => {
    const d = netDifference({
      bankNet: demoNet.bankNet,
      ledgerNet: demoNet.ledgerNet,
      bankOnly: [...amt(demo.result.missingFromBooks), { amount: -4320 }],
      ledgerOnly: [...amt(demo.result.missingFromBank), { amount: -4320 }],
    });
    expect(d.bankOnly.count).toBe(10);
    expect(d.ledgerOnly.count).toBe(5);
    expect(d.difference).toBe(-130954);
    expect(d.tiesOut).toBe(true);
  });

  it("PDF and Excel use the same labels and the signed value, and no cause wording", async () => {
    const ctx = ctxFor({});
    const model = buildReportModel(ctx);
    expect(model.net).toEqual({ bankNet: -297756, ledgerNet: -166802, addedNet: 0, difference: -130954 });
    const exec = Object.fromEntries(model.summary!.executive);
    expect(exec["Bank net activity"]).toBe("($2,977.56)");
    expect(exec["Ledger net activity"]).toBe("($1,668.02)");
    expect(exec["Net activity difference (bank minus ledger)"]).toBe("($1,309.54)");
    expect(Object.keys(exec).some((k) => /unexplained/i.test(k))).toBe(false);
    const pdf = (await buildPdfDocument(ctx)).output();
    // (Long labels wrap in the PDF, so look for their opening words.)
    for (const t of ["Bank net activity", "Ledger net activity", "Net activity difference", "1,309.54"]) {
      expect(pdf, t).toContain(t);
    }
    expect(pdf).not.toMatch(CAUSE_WORDS);
    const xl = await excelText(ctx);
    expect(xl).toContain("Net activity difference (bank minus ledger)");
    expect(xl).toContain("not bank account balances");
    expect(xl).not.toMatch(CAUSE_WORDS);
  });
});

// ───────────────────────── RECON-004 ─────────────────────────
describe("RECON-004 — duplicate detection, decision and status never contradict each other", () => {
  const group = demo.groups.find((g) => g.autoSetAsideIds.length === 0)!; // Mar 5 Adobe pair
  const at = "2026-11-11T10:00:00.000Z";
  const unexplained = (state: DuplicateState) =>
    reconcile(activeTxns(demo.imported.bank, state), activeTxns(demo.imported.ledger, state)).balanceProof
      .unexplainedDifference;

  const undecided = demo.dupState;
  const setAside = setAsideRows(undecided, group.suggestedSetAsideIds, "user", at);
  const restored = restoreRows(setAside, group.suggestedSetAsideIds, at);
  const kept = dismissGroup(restored, group.id, true, at);
  const undone = dismissGroup(kept, group.id, false, at);

  it("the detection rationale is historical and identical in every state", () => {
    const texts = [undecided, setAside, restored, kept, undone].map((s) => describeDuplicateDecision(group, s).detection);
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toMatch(/so no row was set aside automatically\.$/);
    expect(texts[0]).not.toMatch(/nothing was set aside/);
    const autos = [undecided, setAside, restored, kept, undone].map((s) => describeDuplicateDecision(group, s).automatic);
    expect(new Set(autos).size).toBe(1);
    expect(autos[0]).toMatch(/^No row was set aside automatically/);
  });

  it("undecided → set aside → restore → keep separate → undo: decision, status and totals at each step", () => {
    const base = unexplained(undecided);
    expect(base).toBe(-130954);

    const a = describeDuplicateDecision(group, undecided);
    expect(a.decision).toBe("No decision from you yet.");
    expect(a.status).toBe("All 2 rows are included in the reconciliation totals. This group still needs your decision.");
    expect(groupStatus(group, undecided)).toBe("needs-review");

    const b = describeDuplicateDecision(group, setAside);
    expect(b.decision).toBe("You chose to set aside 1 copy.");
    expect(b.status).toBe("1 row excluded from the reconciliation totals; 1 row included.");
    expect([b.excluded, b.inUse]).toEqual([1, 1]);
    expect(unexplained(setAside)).toBe(base + 5999); // the extra −$59.99 bank row is out
    expect(groupStatus(group, setAside)).toBe("resolved");

    const c = describeDuplicateDecision(group, restored);
    expect(c.decision).toBe("No decision from you yet.");
    expect(c.status).toMatch(/^All 2 rows are included/);
    expect(unexplained(restored)).toBe(base);

    const d = describeDuplicateDecision(group, kept);
    expect(d.decision).toBe("You confirmed these are separate transactions on Nov 11, 2026.");
    expect(d.status).toBe("All 2 rows are included in the reconciliation totals.");
    expect(unexplained(kept)).toBe(base);
    expect(unresolvedGroupCount(demo.groups, kept)).toBe(0);

    const e = describeDuplicateDecision(group, undone);
    expect(e.decision).toBe("No decision from you yet.");
    expect(e.status).toMatch(/still needs your decision/);
    expect(unexplained(undone)).toBe(base);
    expect(unresolvedGroupCount(demo.groups, undone)).toBe(1);
  });

  it("an automatic set-aside and a user restore of it are described as what they are", () => {
    const strong = demo.groups.find((g) => g.autoSetAsideIds.length === 1)!;
    const auto = describeDuplicateDecision(strong, undecided);
    expect(auto.automatic).toMatch(/^Reconly set aside 1 copy automatically at import/);
    expect(auto.decision).toBe("No decision from you — Reconly's automatic set-aside stands.");
    expect(auto.status).toBe("1 row excluded from the reconciliation totals; 1 row included.");
    const back = describeDuplicateDecision(strong, restoreRows(undecided, strong.autoSetAsideIds, at));
    expect(back.automatic).toBe(auto.automatic); // history is not rewritten
    expect(back.decision).toBe("You restored 1 row that Reconly had set aside.");
    expect(back.status).toMatch(/^All 2 rows are included/);
  });

  it("report, Excel and PDF: 'Set aside by you' is never paired with 'nothing was set aside'", async () => {
    for (const [name, state] of Object.entries({ undecided, setAside, restored, kept, undone })) {
      const ctx = ctxFor({ state });
      const model = buildReportModel(ctx);
      const lines = [...model.setAsideLines, ...model.possibleDuplicateLines, ...model.reviewedSeparateLines];
      for (const l of lines) {
        expect(l.reason, name).not.toMatch(/nothing was set aside/);
        // Each part is present and separate.
        expect(l.reason).toContain(`Why it was flagged: ${l.detection}`);
        expect(l.reason).toContain(`Current status: ${l.currentStatus}`);
      }
      const adobe = lines.filter((l) => l.description === "ADOBE CREATIVE CLOUD" && l.date === "Mar 5, 2026");
      const xl = await excelText(ctx);
      const pdf = (await buildPdfDocument(ctx)).output();
      expect(xl, name).not.toMatch(/nothing was set aside/);
      expect(pdf, name).not.toMatch(/nothing was set aside/);

      if (name === "setAside") {
        expect(adobe.map((l) => l.status)).toEqual(["Set aside by you"]);
        expect(adobe[0].decision).toBe("You chose to set aside this row.");
        expect(adobe[0].automatic).toMatch(/^No row was set aside automatically/);
        expect(adobe[0].currentStatus).toMatch(/^This row is excluded from the reconciliation totals\. The copy still in use is bank-feb-mar-overlap\.csv · row 10\.$/);
        expect(xl).toContain("You chose to set aside this row.");
        expect(model.net.difference).toBe(-130954 + 5999);
      } else if (name === "kept") {
        expect(adobe.map((l) => l.status)).toEqual(["Reviewed and retained", "Reviewed and retained"]);
        expect(adobe[0].decision).toMatch(/^Confirmed by you on Nov 11, 2026 as separate transactions/);
        expect(model.net.difference).toBe(-130954);
      } else {
        expect(adobe.map((l) => l.status)).toEqual(["Still included", "Still included"]);
        expect(adobe[0].decision).toBe("No decision from you yet.");
        expect(adobe[0].currentStatus).toMatch(/included in the reconciliation totals\. The group still needs your decision\.$/);
        expect(model.net.difference).toBe(-130954);
      }
    }
  });
});

// ───────────────────────── RECON-005 ─────────────────────────
describe("RECON-005 — every statement outcome is named", () => {
  const counts = (c: Partial<Record<StatementStatus, number>>): Record<StatementStatus, number> => ({
    verified: 0, "running-consistent": 0, mismatch: 0, "convention-review": 0, insufficient: 0, conflict: 0, ...c,
  });

  it("demo: 1 mismatch · 1 file could not be verified · 1 running-balance check only · 1 verified", () => {
    expect(demo.statements.counts).toEqual(counts({ verified: 1, mismatch: 1, "running-consistent": 1, insufficient: 1 }));
    expect(statementOutcomeText(demo.statements.counts)).toBe(
      "1 mismatch · 1 file could not be verified · 1 running-balance check only · 1 verified"
    );
    const exec = Object.fromEntries(buildReportModel(ctxFor({})).summary!.executive);
    expect(exec["Statement verification"]).toBe(
      "Statement review needed — 1 mismatch · 1 file could not be verified · 1 running-balance check only · 1 verified (of 4 bank files)"
    );
  });

  it("covers each category on its own, and mixed", () => {
    expect(statementOutcomeText(counts({ verified: 2 }))).toBe("2 verified");
    expect(statementOutcomeText(counts({ mismatch: 2 }))).toBe("2 mismatches");
    expect(statementOutcomeText(counts({ "running-consistent": 1 }))).toBe("1 running-balance check only");
    expect(statementOutcomeText(counts({ insufficient: 1 }))).toBe("1 file could not be verified");
    expect(statementOutcomeText(counts({ conflict: 1, "convention-review": 1, verified: 3 }))).toBe(
      "1 file with conflicting evidence · 1 file with an unclear sign convention · 3 verified"
    );
    expect(statementOutcomeText(counts({}))).toBe("No bank file carried statement information.");
  });

  it("an all-unverified upload is never worded as a success", () => {
    const c = counts({ insufficient: 3 });
    expect(statementOutcomeText(c)).toBe("3 files could not be verified");
    expect(statementOutcomeText(c)).not.toMatch(/(^|· )\d+ verified/);
    expect(summarizeStatements(c)).toBe("not-verified");
  });

  it("February stays a mismatch scoped to its own file, even though the missing $1,350 is in the overlap file", () => {
    const feb = demo.statements.statements.find((s) => s.file === "bank-feb-2026.csv")!;
    expect(feb.status).toBe("mismatch");
    expect(feb.difference).toBe(-135000);
    expect(feb.rowCount).toBe(14); // only its own rows
  });

  it("finishing transaction review changes no statement outcome and does not produce 'reconciled'", () => {
    const done = ctxFor({ decide: "accept-all" });
    expect(done.review!.statements.counts).toEqual(demo.statements.counts);
    expect(done.matches.some((m) => m.status === "suggested")).toBe(false);
    const verdict = deriveVerdict({
      unexplainedDifference: done.unexplainedDifference,
      openItemCount: done.result.missingFromBooks.length + done.result.missingFromBank.length,
      unresolvedDuplicateGroups: unresolvedGroupCount(demo.groups, demo.dupState),
      statements: done.review!.statements.counts,
    });
    expect(verdict.reconciled).toBe(false);
    expect(verdict.statement).toBe("review-needed");
  });
});
