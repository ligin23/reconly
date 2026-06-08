// ============================================================
// CSV → Txn[] parser.
// Kept completely separate from the matching engine so PDF /
// QuickBooks / OFX parsers can slot in later without touching
// reconciliation logic.
// ============================================================

import Papa from "papaparse";
import type { Txn } from "@/lib/recon/types";

// ---- Date helpers ---------------------------------------------------

/**
 * Convert common date formats to ISO yyyy-mm-dd.
 * Handles: "2026-03-04", "3/4/2026", "03/04/2026".
 * Falls back to JS Date parsing, then returns the raw string.
 */
function toIsoDate(raw: string): string {
  const s = raw.trim();

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // M/D/YYYY or MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Last resort: let JS try
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return s; // return as-is; engine will reject non-ISO dates during matching
}

// ---- Amount helpers -------------------------------------------------

/**
 * Parse a dollar-amount string to signed integer cents.
 * Supports: "-35.00", "3,200.00", "($450.00)", "+95.00".
 * Does NOT handle split debit/credit columns — use the columnMap for that.
 */
function toCents(raw: string): number {
  const s = raw.trim();
  const negative = s.startsWith("(") || s.startsWith("-");
  const clean = s.replace(/[$,\s()+-]/g, "");
  const num = parseFloat(clean);
  if (isNaN(num)) return 0;
  const cents = Math.round(num * 100);
  return negative ? -cents : cents;
}

// ---- Column mapping -------------------------------------------------

/**
 * Describes which CSV columns map to which Txn fields.
 * All fields are lowercase column names after header normalisation.
 * `debit` / `credit` are alternatives to a signed `amount` column:
 *   debit  → already-positive value that means money out (negated)
 *   credit → already-positive value that means money in (kept positive)
 */
export type CsvColumnMap = {
  date: string;
  description: string;
  /** Single signed amount column, OR leave blank and use debit+credit. */
  amount?: string;
  /** Positive "money out" column (will be negated). */
  debit?: string;
  /** Positive "money in" column. */
  credit?: string;
  reference?: string;
};

const DEFAULT_MAP: CsvColumnMap = {
  date: "date",
  description: "description",
  amount: "amount",
  reference: "reference",
};

// ---- Public parser --------------------------------------------------

/**
 * Parse a CSV string into Txn[].
 *
 * @param csvText  Raw CSV text (UTF-8).
 * @param source   "bank" | "ledger" — stamped on every Txn.
 * @param colMap   Column mapping; defaults to { date, description, amount, reference }.
 */
export function parseCsv(
  csvText: string,
  source: "bank" | "ledger",
  colMap: CsvColumnMap = DEFAULT_MAP
): Txn[] {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  return result.data
    .map((row, i): Txn | null => {
      const dateRaw = row[colMap.date];
      const descRaw = row[colMap.description];

      if (!dateRaw || !descRaw) return null; // skip rows with missing essentials

      // Amount: prefer the single signed column; fall back to debit/credit split
      let amount = 0;
      if (colMap.amount && row[colMap.amount] !== undefined) {
        amount = toCents(row[colMap.amount]);
      } else if (colMap.debit || colMap.credit) {
        const debitVal = colMap.debit ? toCents(row[colMap.debit] ?? "0") : 0;
        const creditVal = colMap.credit ? toCents(row[colMap.credit] ?? "0") : 0;
        // debit column stores positive values for outflows → negate
        amount = creditVal - debitVal;
      }

      const reference = colMap.reference ? row[colMap.reference] : undefined;

      return {
        id: `${source}-${i}`,
        source,
        date: toIsoDate(dateRaw),
        description: descRaw.trim(),
        amount,
        reference: reference?.trim() || undefined,
        raw: row,
      };
    })
    .filter((t): t is Txn => t !== null);
}
