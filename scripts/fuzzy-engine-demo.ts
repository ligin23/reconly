// One-off demo: runs reconcile() on a mixed dataset exercising all four
// tiers and prints what landed where.
// Run: npx tsx scripts/fuzzy-engine-demo.ts
import { reconcile } from "../src/lib/recon/engine";
import type { Txn } from "../src/lib/recon/types";

function bank(id: string, date: string, description: string, amount: number): Txn {
  return { id, source: "bank", date, description, amount, raw: {} };
}
function ledger(id: string, date: string, description: string, amount: number): Txn {
  return { id, source: "ledger", date, description, amount, raw: {} };
}

const bankTxns = [
  bank("b1", "2026-03-01", "Figma annual plan", -14400),
  bank("b2", "2026-03-05", "Adobe Creative Cloud", -5999),
  bank("b3", "2026-03-10", "Client deposit batch", 300000),
  bank("b4", "2026-03-12", "POS DEBIT 9921 STARBUCKS RESERVE 04412 SEATTLE WA REF 2200391", -1850),
  bank("b5", "2026-03-12", "TST* HMSTD CAFE 0042 OAKLAND CA", -4200),
  bank("b6", "2026-03-15", "Wire transfer out", -99999),
  bank("b7", "2026-03-16", "SQ *BLUE BOTTLE COFFEE", -1850), // same amount as b4!
];
const ledgerTxns = [
  ledger("l1", "2026-03-01", "Figma annual plan", -14400),
  ledger("l2", "2026-03-07", "Adobe CC subscription", -5999),
  ledger("l3", "2026-03-08", "Invoice 1041 Harborline", 120000),
  ledger("l4", "2026-03-09", "Invoice 1042 Meridian", 180000),
  ledger("l5", "2026-03-15", "Starbucks coffee", -1850),
  ledger("l6", "2026-03-14", "Homestead Cafe", -4200),
  ledger("l7", "2026-03-20", "Equipment lease", -45000),
];

const byId = new Map([...bankTxns, ...ledgerTxns].map((t) => [t.id, t]));
const desc = (id: string) => byId.get(id)!.description;

const result = reconcile(bankTxns, ledgerTxns);

console.log("=== One-to-one matches ===");
console.table(
  result.matches.map((m) => ({
    type: m.type,
    conf: m.confidence,
    status: m.status,
    bank: desc(m.bankTxnId),
    ledger: desc(m.ledgerTxnId),
    reasons: m.reasons.join(" | "),
  }))
);
console.log("=== Composite suggestions ===");
console.table(
  result.compositeMatches.map((c) => ({
    target: desc(c.bankTxnId),
    components: c.ledgerTxnIds.map(desc).join(" + "),
    conf: c.confidence,
    status: c.status,
  }))
);
console.log("Missing from books:", result.missingFromBooks.map((t) => t.description));
console.log("Missing from bank: ", result.missingFromBank.map((t) => t.description));
console.log("Balance proof:", result.balanceProof, "reconciled:", result.reconciled);
