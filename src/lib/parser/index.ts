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

// Header synonyms recognised by detectColumnMap. All entries are already
// lower-case because Papa's transformHeader lowercases incoming headers.
const HEADER_SYNONYMS = {
  date: ["date", "txn date", "transaction date", "post date", "posted date", "posting date"],
  description: ["description", "memo", "details", "narration", "payee", "name"],
  amount: ["amount", "signed amount", "txn amount", "transaction amount"],
  debit: ["debit", "debits", "withdrawal", "withdrawals", "money out", "payment"],
  credit: ["credit", "credits", "deposit", "deposits", "money in"],
  reference: ["reference", "ref", "check #", "check number", "check", "chk"],
} as const;

/**
 * Inspect the headers Papa parsed and pick the best column for each field.
 * Falls back to the legacy `{date, description, amount, reference}` map when
 * nothing matches, so existing tests / sample CSVs stay green.
 *
 * Prefers a signed `amount` column over debit/credit when both are present.
 */
export function detectColumnMap(headers: string[]): CsvColumnMap {
  const present = new Set(headers);
  const pick = (candidates: readonly string[]): string | undefined =>
    candidates.find((c) => present.has(c));

  const map: CsvColumnMap = {
    date: pick(HEADER_SYNONYMS.date) ?? "date",
    description: pick(HEADER_SYNONYMS.description) ?? "description",
    reference: pick(HEADER_SYNONYMS.reference),
  };

  const amountCol = pick(HEADER_SYNONYMS.amount);
  if (amountCol) {
    map.amount = amountCol;
  } else {
    const debitCol = pick(HEADER_SYNONYMS.debit);
    const creditCol = pick(HEADER_SYNONYMS.credit);
    if (debitCol || creditCol) {
      map.debit = debitCol;
      map.credit = creditCol;
    } else {
      // Nothing found — keep legacy default so old fixtures still parse.
      map.amount = "amount";
    }
  }

  return map;
}

// Rows whose description matches this pattern are not real transactions
// (statement-style header rows that carry no debit/credit).
const NON_TXN_DESCRIPTION = /^(opening|beginning|closing|ending)\s+balance$/i;

/**
 * Cheap pre-parse to feed the column-mapping UI: returns the header row Papa
 * detected plus the first few data rows, so the user can see how their CSV
 * looks before committing to a column map.
 */
export type CsvInspection = {
  headers: string[];
  sampleRows: Record<string, string>[];
  detected: CsvColumnMap;
};

export function inspectCsv(csvText: string, sampleSize = 3): CsvInspection {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const headers = result.meta.fields ?? [];
  return {
    headers,
    sampleRows: result.data.slice(0, sampleSize),
    detected: detectColumnMap(headers),
  };
}

// ---- Public parser --------------------------------------------------

/**
 * Parse a CSV string into Txn[].
 *
 * @param csvText  Raw CSV text (UTF-8).
 * @param source   "bank" | "ledger" — stamped on every Txn.
 * @param colMap   Optional explicit column mapping. When omitted, the parser
 *                 auto-detects columns from the header row using known
 *                 synonyms (handles `Txn Date`, `Memo`, split `Debit`/`Credit`,
 *                 etc.) so real-world bank and ledger exports work out of the box.
 */
export function parseCsv(
  csvText: string,
  source: "bank" | "ledger",
  colMap?: CsvColumnMap
): Txn[] {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const headers = result.meta.fields ?? [];
  const effectiveMap = colMap ?? detectColumnMap(headers);

  return result.data
    .map((row, i): Txn | null => {
      const dateRaw = row[effectiveMap.date];
      const descRaw = row[effectiveMap.description];

      if (!dateRaw || !descRaw) return null; // skip rows with missing essentials
      if (NON_TXN_DESCRIPTION.test(descRaw.trim())) return null; // skip OPENING BALANCE etc.

      // Amount: prefer the single signed column; fall back to debit/credit split
      let amount = 0;
      if (effectiveMap.amount && row[effectiveMap.amount] !== undefined) {
        amount = toCents(row[effectiveMap.amount]);
      } else if (effectiveMap.debit || effectiveMap.credit) {
        const debitVal = effectiveMap.debit ? toCents(row[effectiveMap.debit] ?? "0") : 0;
        const creditVal = effectiveMap.credit ? toCents(row[effectiveMap.credit] ?? "0") : 0;
        // debit column stores positive values for outflows → negate
        amount = creditVal - debitVal;
      }

      const reference = effectiveMap.reference ? row[effectiveMap.reference] : undefined;

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
