// ============================================================
// CSV → Txn[] parser.
// Kept completely separate from the matching engine so PDF /
// QuickBooks / OFX parsers can slot in later without touching
// reconciliation logic.
//
// Parsing philosophy: REJECT, never guess. An amount or date the
// parser can't confidently interpret skips the row and is reported
// in diagnostics — a silently wrong number is far worse than a
// visibly skipped row in a reconciliation tool.
// ============================================================

import Papa from "papaparse";
import type { Txn } from "@/lib/recon/types";

// ---- Date helpers ---------------------------------------------------

/** True when (y, m, d) is a real calendar date (catches Feb 30, month 13…). */
function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Convert common date formats to ISO yyyy-mm-dd, or null when the value
 * can't be interpreted as a real date.
 * Handles: "2026-03-04", "3/4/2026", "03-04-2026", "04.03.2026".
 * `dayFirst` selects DD/MM for slash-style dates (detected per file).
 * When only one of MM/DD / DD/MM is a valid date, that one wins regardless.
 * The free-form fallback formats from LOCAL date parts — never via
 * toISOString(), which shifts the day for users east of UTC.
 */
function toIsoDate(raw: string, dayFirst = false): string | null {
  const s = raw.trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (!isValidYmd(y, m, d)) return null;
    return `${iso[1]}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const first = Number(dmy[1]);
    const second = Number(dmy[2]);
    const y = Number(dmy[3]);
    let m = dayFirst ? second : first;
    let d = dayFirst ? first : second;
    // If the chosen order is impossible but the other isn't, swap.
    if ((m > 12 || !isValidYmd(y, m, d)) && isValidYmd(y, d, m)) {
      [m, d] = [d, m];
    }
    if (!isValidYmd(y, m, d)) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // Last resort: let JS try ("Mar 4, 2026", "04-Mar-2026").
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Decide whether a file's slash-style dates are day-first (DD/MM) by
 * sampling the date column: any first segment > 12 proves day-first; any
 * second segment > 12 proves month-first. Conflicting evidence keeps the
 * month-first default and reports a warning.
 */
function detectDayFirst(dateValues: string[]): {
  dayFirst: boolean;
  warning?: string;
} {
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;
  for (const v of dateValues) {
    const m = v.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.]\d{4}$/);
    if (!m) continue;
    if (Number(m[1]) > 12) dayFirstEvidence++;
    if (Number(m[2]) > 12) monthFirstEvidence++;
  }
  if (dayFirstEvidence > 0 && monthFirstEvidence === 0) {
    return { dayFirst: true };
  }
  if (dayFirstEvidence > 0 && monthFirstEvidence > 0) {
    return {
      dayFirst: false,
      warning:
        "Dates use conflicting day/month order — assumed month-first (MM/DD). Check the parsed dates carefully.",
    };
  }
  return { dayFirst: false };
}

// ---- Amount helpers -------------------------------------------------

/**
 * Parse a money string to signed integer cents, or null when the value
 * can't be confidently interpreted. Never silently returns 0 for garbage.
 *
 * Negative forms handled: leading "-", unicode minus "−", trailing "35.00-",
 * accounting parentheses incl. currency prefix "$(450.00)" / "($450.00)",
 * and a trailing "DR" marker ("CR" is positive).
 * `decimalComma` selects European separators (1.234,56) — detected per file.
 */
function toCents(raw: string, decimalComma = false): number | null {
  let s = raw.trim();
  if (s === "") return null;
  let negative = false;

  // Trailing debit/credit markers: "35.00 DR" → negative, "35.00 CR" → positive
  const drcr = s.match(/^(.*?)\s*(DR|CR)\.?$/i);
  if (drcr) {
    if (drcr[2].toUpperCase() === "DR") negative = true;
    s = drcr[1].trim();
  }

  // Accounting parentheses, with or without a currency prefix:
  // "(450.00)", "$(450.00)", "($450.00)"
  const paren = s.match(/^([^\d]*)\((.+)\)\s*$/);
  if (paren) {
    negative = true;
    s = (paren[1] + paren[2]).trim();
  }

  // Unicode minus / dash variants → ASCII hyphen (money() emits U+2212)
  s = s.replace(/[−‒–—]/g, "-");

  // Currency symbols and internal whitespace
  s = s.replace(/[$£€¥]|\s/g, "");

  // Trailing minus ("35.00-", common in OFX/SAP exports)
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  // Leading sign (after currency strip, so "$-35.00" lands here too)
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }

  // Separators: in comma-decimal files "." and "'" are thousands marks and
  // "," is the decimal point; otherwise "," and "'" are thousands marks.
  if (decimalComma) {
    s = s.replace(/[.'’]/g, "").replace(/,/g, ".");
  } else {
    s = s.replace(/[,'’]/g, "");
  }

  // Whatever remains must be a plain decimal number — anything else
  // (letters, leftover symbols, multiple decimal points) is rejected.
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const num = Number(s);
  if (!Number.isFinite(num)) return null;
  const cents = Math.round(num * 100);
  return negative ? -cents : cents;
}

/**
 * Decide whether a file uses European decimal commas by sampling amount
 * values: a comma followed by 1–2 digits at the end (123,45 / 1.234,56) is
 * comma-decimal evidence; a dot followed by 1–2 digits (123.45 / 1,234.56)
 * is dot-decimal evidence. Dot wins ties — it's the dominant convention and
 * the historical behavior.
 */
function detectDecimalComma(amountValues: string[]): boolean {
  let commaVotes = 0;
  let dotVotes = 0;
  for (const raw of amountValues) {
    const v = raw.replace(/[$£€¥()\s+\-−]|DR\.?$|CR\.?$/gi, "");
    const lastDot = v.lastIndexOf(".");
    const lastComma = v.lastIndexOf(",");
    if (lastComma > lastDot && lastComma >= 0) {
      const tail = v.length - lastComma - 1;
      if (tail >= 1 && tail <= 2) commaVotes++;
    } else if (lastDot > lastComma && lastDot >= 0) {
      const tail = v.length - lastDot - 1;
      if (tail >= 1 && tail <= 2) dotVotes++;
    }
  }
  return commaVotes > 0 && dotVotes === 0;
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

// ---- Diagnostics ----------------------------------------------------

/** One skipped row and why. `line` is the 1-based CSV line (header = 1). */
export type ParseRowIssue = { line: number; reason: string };

/** Cap on the number of per-row issues retained (counts are always exact). */
const MAX_REPORTED_ISSUES = 50;

export type ParseDiagnostics = {
  /** Data rows Papa produced (excludes header and empty lines). */
  totalDataRows: number;
  /** Rows successfully converted to transactions. */
  parsedCount: number;
  /** OPENING/CLOSING BALANCE style rows skipped by design. */
  skippedBalanceRows: number;
  /** Total rows skipped for problems (missing fields, bad amount/date). */
  issueCount: number;
  /** First MAX_REPORTED_ISSUES problems, for display. */
  issues: ParseRowIssue[];
  /** Structural CSV errors reported by Papa (bad quotes, field counts…). */
  csvErrors: string[];
  /** File-level warnings (mixed date order, unmapped columns…). */
  warnings: string[];
  dateOrder: "month-first" | "day-first";
  decimalStyle: "dot" | "comma";
};

export type ParseResult = { txns: Txn[]; diagnostics: ParseDiagnostics };

// ---- Public parser --------------------------------------------------

/**
 * Parse a CSV string into transactions plus diagnostics.
 *
 * Nothing is silently guessed: structurally broken rows, unparseable
 * amounts, and impossible dates are skipped AND reported. Callers showing
 * results to a user must surface `diagnostics` — see app-shell.
 *
 * @param csvText  Raw CSV text (UTF-8).
 * @param source   "bank" | "ledger" — stamped on every Txn.
 * @param colMap   Optional explicit column mapping. When omitted, columns
 *                 are auto-detected from the header row using known synonyms.
 */
export function parseCsvDetailed(
  csvText: string,
  source: "bank" | "ledger",
  colMap?: CsvColumnMap
): ParseResult {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const headers = result.meta.fields ?? [];
  const effectiveMap = colMap ?? detectColumnMap(headers);

  const warnings: string[] = [];
  const csvErrors: string[] = [];
  const issues: ParseRowIssue[] = [];
  let issueCount = 0;
  let skippedBalanceRows = 0;

  // Structural errors from Papa (missing quotes, inconsistent field counts).
  const seenErrors = new Set<string>();
  for (const err of result.errors) {
    const line = typeof err.row === "number" ? ` (line ${err.row + 2})` : "";
    const msg = `${err.message}${line}`;
    if (!seenErrors.has(msg)) {
      seenErrors.add(msg);
      if (csvErrors.length < MAX_REPORTED_ISSUES) csvErrors.push(msg);
    }
  }

  // Mapped columns must actually exist in the file.
  const headerSet = new Set(headers);
  const mappedCols: [string, string | undefined][] = [
    ["date", effectiveMap.date],
    ["description", effectiveMap.description],
    ["amount", effectiveMap.amount],
    ["debit", effectiveMap.debit],
    ["credit", effectiveMap.credit],
  ];
  for (const [field, col] of mappedCols) {
    if (col && !headerSet.has(col)) {
      warnings.push(`The ${field} column "${col}" was not found in this file.`);
    }
  }

  // File-level format detection (date order, decimal style).
  const dateSamples = result.data
    .map((row) => row[effectiveMap.date])
    .filter((v): v is string => Boolean(v));
  const { dayFirst, warning: dateWarning } = detectDayFirst(dateSamples);
  if (dateWarning) warnings.push(dateWarning);

  const amountCols = [
    effectiveMap.amount,
    effectiveMap.debit,
    effectiveMap.credit,
  ].filter((c): c is string => Boolean(c));
  const amountSamples = result.data.flatMap((row) =>
    amountCols.map((c) => row[c]).filter((v): v is string => Boolean(v?.trim()))
  );
  const decimalComma = detectDecimalComma(amountSamples);

  const reportIssue = (line: number, reason: string) => {
    issueCount++;
    if (issues.length < MAX_REPORTED_ISSUES) issues.push({ line, reason });
  };

  const txns = result.data
    .map((row, i): Txn | null => {
      const line = i + 2; // 1-based, after the header row
      const dateRaw = row[effectiveMap.date];
      const descRaw = row[effectiveMap.description];

      if (!dateRaw?.trim() || !descRaw?.trim()) {
        reportIssue(line, "missing date or description");
        return null;
      }
      if (NON_TXN_DESCRIPTION.test(descRaw.trim())) {
        skippedBalanceRows++; // skip OPENING BALANCE etc. — by design
        return null;
      }

      const date = toIsoDate(dateRaw, dayFirst);
      if (date === null) {
        reportIssue(line, `unrecognized date "${dateRaw.trim()}"`);
        return null;
      }

      // Amount: prefer the single signed column; fall back to debit/credit split
      let amount: number;
      if (effectiveMap.amount && row[effectiveMap.amount] !== undefined) {
        const parsed = toCents(row[effectiveMap.amount], decimalComma);
        if (parsed === null) {
          reportIssue(
            line,
            `unrecognized amount "${row[effectiveMap.amount].trim()}"`
          );
          return null;
        }
        amount = parsed;
      } else if (effectiveMap.debit || effectiveMap.credit) {
        // Empty cells in a split layout legitimately mean "no value" → 0.
        const parseSplit = (col: string | undefined): number | null => {
          const v = col ? row[col] : undefined;
          if (v === undefined || v.trim() === "") return 0;
          return toCents(v, decimalComma);
        };
        const debitVal = parseSplit(effectiveMap.debit);
        const creditVal = parseSplit(effectiveMap.credit);
        if (debitVal === null || creditVal === null) {
          reportIssue(line, "unrecognized debit/credit amount");
          return null;
        }
        // debit column stores positive values for outflows → negate
        amount = creditVal - debitVal;
      } else {
        reportIssue(line, "no amount column mapped");
        return null;
      }

      const reference = effectiveMap.reference ? row[effectiveMap.reference] : undefined;

      return {
        id: `${source}-${i}`,
        source,
        date,
        description: descRaw.trim(),
        amount,
        reference: reference?.trim() || undefined,
        raw: row,
      };
    })
    .filter((t): t is Txn => t !== null);

  return {
    txns,
    diagnostics: {
      totalDataRows: result.data.length,
      parsedCount: txns.length,
      skippedBalanceRows,
      issueCount,
      issues,
      csvErrors,
      warnings,
      dateOrder: dayFirst ? "day-first" : "month-first",
      decimalStyle: decimalComma ? "comma" : "dot",
    },
  };
}

/**
 * Back-compat wrapper returning just the transactions.
 * Prefer parseCsvDetailed anywhere results are shown to a user — silently
 * discarding the diagnostics defeats the reject-don't-guess design.
 */
export function parseCsv(
  csvText: string,
  source: "bank" | "ledger",
  colMap?: CsvColumnMap
): Txn[] {
  return parseCsvDetailed(csvText, source, colMap).txns;
}
