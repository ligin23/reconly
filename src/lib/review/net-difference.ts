// ============================================================
// Reconly — net activity difference (wording + breakdown)
// Pure TypeScript. Reads results; never matches or changes anything.
//
// The "difference" Reconly shows is
//     bank net activity − ledger net activity
// over the imported rows in use (less anything the user added to the
// reconciliation). It is a total of TRANSACTION ACTIVITY, not an account
// balance, and its size says nothing about its cause: one missing entry
// and fifteen offsetting ones can produce the same figure. So this module
// only ever states the arithmetic and lists what contributes — it never
// offers a cause.
// ============================================================

export type SignedItem = { amount: number };

export type NetDifference = {
  /** Signed cents: sum of the bank rows in use. */
  bankNet: number;
  /** Signed cents: sum of the ledger rows in use. */
  ledgerNet: number;
  /** Signed cents: bank rows the user added to the reconciliation. */
  addedNet: number;
  /** Signed cents: bankNet − ledgerNet − addedNet. */
  difference: number;
  /** Bank rows with no confirmed match (not added by the user). */
  bankOnly: { count: number; net: number };
  /** Ledger rows with no confirmed bank match (including ones the user
   *  marked as expected — they are still in the ledger total). */
  ledgerOnly: { count: number; net: number };
  /**
   * True when the unmatched rows account for the whole difference
   * (bankOnly.net − ledgerOnly.net === difference). False while a
   * suggested or confirmed pairing covers rows whose amounts differ —
   * which the engine never produces, but is checked rather than assumed.
   */
  tiesOut: boolean;
};

const sum = (items: SignedItem[]) => items.reduce((s, t) => s + t.amount, 0);

export function netDifference(input: {
  bankNet: number;
  ledgerNet: number;
  added?: SignedItem[];
  bankOnly: SignedItem[];
  ledgerOnly: SignedItem[];
}): NetDifference {
  const addedNet = sum(input.added ?? []);
  const difference = input.bankNet - input.ledgerNet - addedNet;
  const bankOnly = { count: input.bankOnly.length, net: sum(input.bankOnly) };
  const ledgerOnly = { count: input.ledgerOnly.length, net: sum(input.ledgerOnly) };
  return {
    bankNet: input.bankNet,
    ledgerNet: input.ledgerNet,
    addedNet,
    difference,
    bankOnly,
    ledgerOnly,
    tiesOut: bankOnly.net - ledgerOnly.net === difference,
  };
}

/** Signed dollars with a real minus sign: "−$1,309.54", "$10.00". */
export function signedDollars(cents: number): string {
  const s = (Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (cents < 0 ? "−$" : "$") + s;
}

const abs = (cents: number) => signedDollars(Math.abs(cents));

export const NET_LABELS = {
  bank: "Bank net activity",
  ledger: "Ledger net activity",
  difference: "Net activity difference (bank minus ledger)",
  scope:
    "These are totals of the imported transactions in use — money in less money out — not bank account balances.",
} as const;

/** Direction and size of the difference, with no cause attached. */
export function netDifferenceSentence(d: Pick<NetDifference, "difference">): string {
  if (d.difference === 0) return "Bank net activity and ledger net activity are equal.";
  return `Bank net activity is ${abs(d.difference)} ${d.difference < 0 ? "lower" : "higher"} than ledger net activity.`;
}

/**
 * What contributes to the difference: the unmatched rows on each side.
 * States the count and signed total of each, and whether together they
 * account for all of it. Never says which row — or how many — "explains" it.
 */
export function netDifferenceBreakdown(d: NetDifference): string[] {
  if (d.bankOnly.count === 0 && d.ledgerOnly.count === 0) return [];
  const rows = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const lines = [
    `Bank only: ${rows(d.bankOnly.count, "transaction", "transactions")} totalling ${signedDollars(d.bankOnly.net)}.`,
    `In your records only: ${rows(d.ledgerOnly.count, "entry", "entries")} totalling ${signedDollars(d.ledgerOnly.net)}.`,
  ];
  if (d.tiesOut) {
    lines.push(
      d.difference === 0
        ? "Their totals are equal, so they cancel in the net figure — they are still unmatched."
        : `Bank only minus records only is ${signedDollars(d.difference)} — the whole difference. Several items contribute; no single one is assumed to explain it.`
    );
  }
  return lines;
}
