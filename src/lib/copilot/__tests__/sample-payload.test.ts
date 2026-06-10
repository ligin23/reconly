// ============================================================
// End-to-end grounding demo: real sample CSVs through the real
// engine and context builder, with an injected account-number
// transaction to prove masking. Also writes the payload to
// tmp/copilot-sample-payload.json for inspection.
// ============================================================

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { reconcile } from "../../recon/engine";
import { buildReconContext } from "../context-builder";
import { copilotRequestSchema } from "../schema";
import type { Txn } from "../../recon/types";

const root = resolve(__dirname, "../../../..");

function parseCsv(path: string, source: "bank" | "ledger"): Txn[] {
  return readFileSync(resolve(root, path), "utf-8")
    .trim()
    .split("\n")
    .slice(1)
    .map((line, i) => {
      const [date, description, amount] = line.split(",");
      return {
        id: `${source}-${i}`,
        source,
        date,
        description,
        amount: Math.round(parseFloat(amount) * 100),
        raw: { date, description, amount },
      };
    });
}

describe("sample grounding payload (real CSVs, real engine)", () => {
  const bank = parseCsv("public/samples/bank-march2026.csv", "bank");
  const ledger = parseCsv("public/samples/ledger-march2026.csv", "ledger");

  // Injected: a bank txn whose description embeds a full account number.
  bank.push({
    id: "bank-injected",
    source: "bank",
    date: "2026-03-28",
    description: "ACH WIRE TRANSFER FROM ACCT 873209114471 CHASE NY REF 5512",
    amount: -15000,
    raw: {},
  });

  const result = reconcile(bank, ledger);
  const context = buildReconContext({
    matches: result.matches,
    compositeMatches: result.compositeMatches,
    bankTxns: bank,
    ledgerTxns: ledger,
    baseMissingFromBooks: result.missingFromBooks,
    baseMissingFromBank: result.missingFromBank,
    userAddedEntries: [],
    acknowledgedBankIds: [],
    balanceProof: result.balanceProof,
    reconciled: result.reconciled,
    periodLabel: "March 2026",
  });
  const request = {
    question: "Why doesn't my account balance?",
    sessionId: "sample-payload-demo-1",
    context,
  };

  it("validates against the exact schema the route enforces", () => {
    expect(() => copilotRequestSchema.parse(request)).not.toThrow();
  });

  it("masks the injected account number to last-4", () => {
    const json = JSON.stringify(request);
    expect(json).not.toContain("873209114471");
    expect(json).toContain("****4471");
  });

  it("writes the payload artifact for inspection", () => {
    mkdirSync(resolve(root, "tmp"), { recursive: true });
    writeFileSync(
      resolve(root, "tmp/copilot-sample-payload.json"),
      JSON.stringify(request, null, 2)
    );
  });
});
