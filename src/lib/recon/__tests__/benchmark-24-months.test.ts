/**
 * 24-month performance benchmark for the (unchanged) matching engine.
 *
 * Purpose: prove whether one reconcile() call over a full 24-month range is
 * fast enough to run in the browser before multi-month reviews are built on
 * top of it. The data is synthetic but deterministic (seeded generator, no
 * Math.random), and shaped like real books: mostly exact matches, some
 * date/description drift, a few items missing on each side, and a few
 * batched deposits.
 *
 * The time budget is deliberately generous so the test is not flaky on a
 * slow CI machine — it exists to catch an order-of-magnitude regression
 * (e.g. the combinatorial freeze fixed in the June review), not to
 * micro-benchmark. The measured time is printed on every run.
 */
import { describe, it, expect } from "vitest";
import { reconcile } from "@/lib/recon/engine";
import type { Txn } from "@/lib/recon/types";

const MONTHS = 24;
const PER_MONTH = 300;
const BUDGET_MS = 5_000;

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VENDORS = [
  "ADOBE CREATIVE CLOUD", "AMAZON WEB SERVICES", "STAPLES STORE", "SHELL OIL",
  "COMCAST BUSINESS", "DELTA AIR LINES", "UBER TRIP", "HOME DEPOT", "FEDEX OFFICE",
  "GUSTO PAYROLL", "STRIPE TRANSFER", "SQUARE DEPOSIT", "CITY UTILITIES",
  "STATE FARM INSURANCE", "COSTCO WHOLESALE", "LINKEDIN ADS", "GOOGLE WORKSPACE",
  "ZOOM VIDEO", "WEWORK RENT", "VERIZON WIRELESS",
];

function iso(year: number, monthIndex: number, day: number): string {
  const d = new Date(Date.UTC(year, monthIndex, day));
  return d.toISOString().slice(0, 10);
}

function generate(): { bank: Txn[]; ledger: Txn[] } {
  const rand = rng(20260101);
  const bank: Txn[] = [];
  const ledger: Txn[] = [];
  const push = (list: Txn[], source: "bank" | "ledger", date: string, description: string, amount: number) =>
    list.push({ id: `${source}-${list.length}`, source, date, description, amount, raw: {} });

  for (let m = 0; m < MONTHS; m++) {
    const year = 2024 + Math.floor(m / 12);
    const monthIndex = m % 12;
    for (let i = 0; i < PER_MONTH; i++) {
      const day = 1 + Math.floor(rand() * 28);
      const vendor = VENDORS[Math.floor(rand() * VENDORS.length)];
      const cents = 500 + Math.floor(rand() * 250_000);
      const amount = rand() < 0.8 ? -cents : cents;
      const kind = rand();
      if (kind < 0.86) {
        // Same on both sides.
        push(bank, "bank", iso(year, monthIndex, day), vendor, amount);
        push(ledger, "ledger", iso(year, monthIndex, day), vendor, amount);
      } else if (kind < 0.94) {
        // Cleared a few days later with a messier bank description.
        const lag = 1 + Math.floor(rand() * 4);
        push(bank, "bank", iso(year, monthIndex, day + lag), `POS ${vendor} #${1000 + i}`, amount);
        push(ledger, "ledger", iso(year, monthIndex, day), vendor, amount);
      } else if (kind < 0.96) {
        push(bank, "bank", iso(year, monthIndex, day), `BANK FEE ${i}`, amount); // not in books
      } else if (kind < 0.98) {
        push(ledger, "ledger", iso(year, monthIndex, day), `CHECK ${4000 + i}`, amount); // not cleared
      } else {
        // One bank deposit covering two ledger invoices.
        const a = 1_000 + Math.floor(rand() * 50_000);
        const b = 1_000 + Math.floor(rand() * 50_000);
        push(bank, "bank", iso(year, monthIndex, day), "MERCHANT BATCH DEPOSIT", a + b);
        push(ledger, "ledger", iso(year, monthIndex, day), `INVOICE ${m}-${i}A`, a);
        push(ledger, "ledger", iso(year, monthIndex, day), `INVOICE ${m}-${i}B`, b);
      }
    }
  }
  return { bank, ledger };
}

describe("24-month benchmark (7,200 transactions per side)", () => {
  const { bank, ledger } = generate();

  it("generates a realistic, deterministic 24-month data set", () => {
    expect(bank.length).toBeGreaterThan(6_500);
    expect(ledger.length).toBeGreaterThan(6_500);
    expect(bank[0].date.slice(0, 7)).toBe("2024-01");
    expect(bank[bank.length - 1].date.slice(0, 4)).toBe("2025");
    const again = generate();
    expect(again.bank).toEqual(bank); // same data every run
  });

  it(`reconciles the full range in one pass within ${BUDGET_MS} ms`, () => {
    const t0 = performance.now();
    const result = reconcile(bank, ledger);
    const ms = performance.now() - t0;
    console.log(
      `[benchmark] reconcile(${bank.length} bank, ${ledger.length} ledger) took ${ms.toFixed(0)} ms — ` +
        `${result.matches.length} matches, ${result.compositeMatches.length} composites, ` +
        `${result.missingFromBooks.length} + ${result.missingFromBank.length} unmatched`
    );
    expect(ms).toBeLessThan(BUDGET_MS);

    // Conservation: every transaction is accounted for exactly once.
    const bankSeen = new Set<string>();
    const ledgerSeen = new Set<string>();
    const mark = (set: Set<string>, id: string) => {
      expect(set.has(id)).toBe(false);
      set.add(id);
    };
    for (const m of result.matches) {
      mark(bankSeen, m.bankTxnId);
      mark(ledgerSeen, m.ledgerTxnId);
    }
    for (const c of result.compositeMatches) {
      mark(bankSeen, c.bankTxnId);
      for (const id of c.ledgerTxnIds) mark(ledgerSeen, id);
    }
    for (const t of result.missingFromBooks) mark(bankSeen, t.id);
    for (const t of result.missingFromBank) mark(ledgerSeen, t.id);
    expect(bankSeen.size).toBe(bank.length);
    expect(ledgerSeen.size).toBe(ledger.length);
  });

  it("is deterministic at scale: two runs give identical output", () => {
    expect(reconcile(bank, ledger)).toEqual(reconcile(bank, ledger));
  });

  it("matches across month boundaries (full-range pass, not month-by-month)", () => {
    const result = reconcile(bank, ledger);
    const bankById = new Map(bank.map((t) => [t.id, t]));
    const ledgerById = new Map(ledger.map((t) => [t.id, t]));
    const crossMonth = result.matches.filter(
      (m) =>
        bankById.get(m.bankTxnId)!.date.slice(0, 7) !==
        ledgerById.get(m.ledgerTxnId)!.date.slice(0, 7)
    );
    expect(crossMonth.length).toBeGreaterThan(0);
  });
});
