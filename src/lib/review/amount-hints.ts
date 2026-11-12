// ============================================================
// Reconly — "possible amount difference" indicator
// Pure TypeScript. Informational only: it NEVER matches, excludes or
// changes a total, and the matching engine does not know it exists.
//
// It points out one narrow, evidence-based situation among rows that are
// ALREADY unmatched: a bank row and a ledger row with the same date, the
// same direction and the same description (after the engine's own text
// normalization) whose amounts differ — for example a $129.99 bank charge
// and a $139.99 ledger entry for the same vendor on the same day.
//
// A pair is reported only when it is unambiguous: each row has exactly one
// such counterpart. Anything less clear is left alone.
// ============================================================

import { normalize } from "@/lib/recon/normalize";
import type { Txn } from "@/lib/recon/types";

export type AmountHint = {
  bankTxnId: string;
  ledgerTxnId: string;
  /** Signed cents: bank amount − ledger amount. */
  difference: number;
};

export function possibleAmountDifferences(bankUnmatched: Txn[], ledgerUnmatched: Txn[]): AmountHint[] {
  const key = (t: Txn) => {
    const desc = normalize(t.description);
    return desc === "" ? null : `${t.date}\u0000${t.amount < 0 ? "-" : "+"}\u0000${desc}`;
  };
  const group = (txns: Txn[]) => {
    const m = new Map<string, Txn[]>();
    for (const t of txns) {
      if (t.amount === 0) continue;
      const k = key(t);
      if (!k) continue;
      const list = m.get(k);
      if (list) list.push(t);
      else m.set(k, [t]);
    }
    return m;
  };
  const bank = group(bankUnmatched);
  const ledger = group(ledgerUnmatched);
  const out: AmountHint[] = [];
  for (const [k, b] of bank) {
    const l = ledger.get(k);
    if (!l || b.length !== 1 || l.length !== 1) continue; // only unambiguous pairs
    if (b[0].amount === l[0].amount) continue; // same amount is the engine's business, not ours
    out.push({ bankTxnId: b[0].id, ledgerTxnId: l[0].id, difference: b[0].amount - l[0].amount });
  }
  return out;
}
