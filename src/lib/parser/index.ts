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

/** Column titles that hold a running balance. */
const BALANCE_HEADERS = ["balance", "running balance", "running bal", "running bal.", "bal"];

/**
 * A balance the uploaded file states explicitly. `origin` says where it was
 * read from; nothing here is ever calculated.
 */
export type StatementBalance = {
  /** Signed cents, exactly as the file states it. */
  cents: number;
  /** 1-based line in the original file. */
  line: number;
  origin: "balance-row" | "title-line";
};

/** What a file says about its own opening / closing balances. */
export type StatementBalances = {
  opening: StatementBalance | null;
  closing: StatementBalance | null;
  /** True when the file has a running-balance column. */
  hasBalanceColumn: boolean;
  /** Balance cells on transaction rows that could not be read. */
  unreadableBalanceCells: number;
  /**
   * Anything about the file's balance information that is unclear — two
   * different opening balances, a balance row with no readable value, an
   * amount and a balance that disagree. When non-empty, the balances are
   * NOT used for verification; the file is flagged for review instead.
   */
  ambiguities: string[];
};

const OPENING_WORDS = /\b(opening|beginning|starting|previous)\s+balance\b/i;
const CLOSING_WORDS = /\b(closing|ending|new)\s+balance\b/i;

/**
 * Balances stated in the title lines above the header row, e.g.
 * "Opening balance: $1,234.56". A line counts only when it names exactly
 * one kind of balance and contains exactly one readable amount.
 */
function titleLineBalances(
  csvText: string,
  titleLineCount: number,
  decimalComma: boolean
): { kind: "opening" | "closing"; cents: number; line: number }[] {
  if (titleLineCount <= 0) return [];
  const out: { kind: "opening" | "closing"; cents: number; line: number }[] = [];
  csvText.split(LINE_BREAK, titleLineCount).forEach((text, i) => {
    const isOpening = OPENING_WORDS.test(text);
    const isClosing = CLOSING_WORDS.test(text);
    if (isOpening === isClosing) return; // neither, or both on one line
    const cells = Papa.parse<string[]>(text, { header: false }).data[0] ?? [];
    const amounts: number[] = [];
    for (const cell of cells) {
      const rest = String(cell)
        .replace(OPENING_WORDS, "")
        .replace(CLOSING_WORDS, "")
        .replace(/^[\s:=]+/, "")
        .trim();
      if (!rest || DATE_LIKE.test(rest) || !/\d/.test(rest)) continue;
      const cents = toCents(rest, decimalComma);
      if (cents !== null) amounts.push(cents);
    }
    if (amounts.length === 1) out.push({ kind: isOpening ? "opening" : "closing", cents: amounts[0], line: i + 1 });
  });
  return out;
}

/**
 * Cheap pre-parse to feed the column-mapping UI: returns the header row Papa
 * detected plus the first few data rows, so the user can see how their CSV
 * looks before committing to a column map.
 */
export type CsvInspection = {
  headers: string[];
  sampleRows: Record<string, string>[];
  detected: CsvColumnMap;
  /** 1-based line the column titles were read from. */
  headerRow: number;
  /** First physical lines of the file, verbatim — feeds the header-row picker. */
  rawLines: string[];
  /**
   * A line other than `headerRow` that looks like the real column-title row
   * (exports often start with a bank name, account number or date range).
   * This is only ever a SUGGESTION shown to the user — it is never applied
   * automatically. null when the current header row already looks right or
   * nothing better was found.
   */
  suggestedHeaderRow: number | null;
  /** Set when the chosen header row looks like a transaction, not titles. */
  headerWarning: string | null;
};

export type ParseOptions = {
  /** 1-based physical line holding the column titles. Default 1. Lines
   *  above it (titles, account info) are ignored. */
  headerRow?: number;
  /** Stamped on every Txn as `sourceFile` (provenance). */
  sourceFile?: string;
  /** Transaction ids are `${idPrefix}-${rowIndex}`. Defaults to `source`,
   *  which keeps single-file ids exactly as they have always been. */
  idPrefix?: string;
};

/** How many leading lines the header-row picker looks at / offers. */
export const HEADER_SCAN_LINES = 15;

const LINE_BREAK = /\r\n|\n|\r/;

/** Remove the first `count` physical lines (title rows above the header). */
function dropLeadingLines(text: string, count: number): string {
  let rest = text;
  for (let i = 0; i < count; i++) {
    const m = LINE_BREAK.exec(rest);
    if (!m) return "";
    rest = rest.slice(m.index + m[0].length);
  }
  return rest;
}

function normalizeHeaderRow(headerRow: number | undefined): number {
  return headerRow && Number.isInteger(headerRow) && headerRow > 1 ? headerRow : 1;
}

function cellsOfLine(line: string): string[] {
  const parsed = Papa.parse<string[]>(line, { header: false });
  return (parsed.data[0] ?? []).map((c) => String(c).trim().toLowerCase());
}

/** True when a line names a date, a description and an amount-ish column. */
function looksLikeHeaderCells(cells: string[]): boolean {
  const has = (candidates: readonly string[]) => candidates.some((c) => cells.includes(c));
  return (
    has(HEADER_SYNONYMS.date) &&
    has(HEADER_SYNONYMS.description) &&
    (has(HEADER_SYNONYMS.amount) || has(HEADER_SYNONYMS.debit) || has(HEADER_SYNONYMS.credit))
  );
}

const DATE_LIKE = /^\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}$/;
const AMOUNT_LIKE = /^[-+(]?\s*[$£€¥]?\s*\d[\d.,']*\)?-?$/;

/** True when a "header" row is really a transaction (headerless file). */
function looksLikeDataCells(cells: string[]): boolean {
  return cells.some((c) => DATE_LIKE.test(c)) && cells.some((c) => AMOUNT_LIKE.test(c) && !DATE_LIKE.test(c));
}

export function inspectCsv(
  csvText: string,
  sampleSize = 3,
  options: Pick<ParseOptions, "headerRow"> = {}
): CsvInspection {
  const headerRow = normalizeHeaderRow(options.headerRow);
  const result = Papa.parse<Record<string, string>>(dropLeadingLines(csvText, headerRow - 1), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const headers = result.meta.fields ?? [];

  const rawLines = csvText.split(LINE_BREAK, HEADER_SCAN_LINES);
  const lineCells = rawLines.map(cellsOfLine);

  let suggestedHeaderRow: number | null = null;
  if (!looksLikeHeaderCells(lineCells[headerRow - 1] ?? [])) {
    const idx = lineCells.findIndex(looksLikeHeaderCells);
    if (idx !== -1 && idx + 1 !== headerRow) suggestedHeaderRow = idx + 1;
  }

  const headerWarning = looksLikeDataCells(lineCells[headerRow - 1] ?? [])
    ? `Row ${headerRow} looks like a transaction, not column titles. Reconly needs a row of column titles — if this file has none, add one (for example: Date, Description, Amount) and upload it again.`
    : null;

  return {
    headers,
    sampleRows: result.data.slice(0, sampleSize),
    detected: detectColumnMap(headers),
    headerRow,
    rawLines,
    suggestedHeaderRow,
    headerWarning,
  };
}

const DATE_TOKEN = /\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}/g;
const PERIOD_WORDS = /\b(period|statement|from|through|thru|between)\b/i;

/**
 * Look for an explicit statement period in the title lines above the header
 * row: a line that names a period and contains exactly two dates. Returns
 * null unless the file states one unambiguously — this is evidence about
 * what the file covers, so it is never guessed.
 */
function findStatementPeriod(
  csvText: string,
  titleLineCount: number,
  dayFirst: boolean
): { start: string; end: string } | null {
  if (titleLineCount <= 0) return null;
  const found: { start: string; end: string }[] = [];
  for (const line of csvText.split(LINE_BREAK, titleLineCount)) {
    if (!PERIOD_WORDS.test(line)) continue;
    const tokens = line.match(DATE_TOKEN) ?? [];
    if (tokens.length !== 2) continue;
    const start = toIsoDate(tokens[0], dayFirst);
    const end = toIsoDate(tokens[1], dayFirst);
    if (start && end && start <= end) found.push({ start, end });
  }
  return found.length === 1 ? found[0] : null;
}

/**
 * Physical 1-based line number of every non-empty record in `body`
 * (index 0 = the header record). Accounts for blank lines and for quoted
 * fields that span several lines, so a reported line number is the line a
 * person would find in a text editor. Returns null if the record count
 * doesn't line up with the main parse — callers then fall back to counting.
 */
function recordLineNumbers(
  body: string,
  delimiter: string,
  expectedRecords: number,
  lineOffset: number
): number[] | null {
  const raw = Papa.parse<string[]>(body, { header: false, skipEmptyLines: false, delimiter });
  const lines: number[] = [];
  let line = 1 + lineOffset;
  for (const record of raw.data) {
    const isEmpty = record.length === 1 && record[0].length === 0;
    if (!isEmpty) lines.push(line);
    let span = 1;
    for (const field of record) {
      if (field.length > 0 && (field.includes("\n") || field.includes("\r"))) {
        span += field.split(LINE_BREAK).length - 1;
      }
    }
    line += span;
  }
  return lines.length === expectedRecords ? lines : null;
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
  /** Opening / closing balances the file states, and whether they are usable. */
  statement: StatementBalances;
  /**
   * The statement period the FILE ITSELF states in its title lines (for
   * example "Statement period: 01/01/2026 - 01/31/2026"), or null when it
   * states none. Never inferred from the transaction dates.
   */
  statementPeriod: { start: string; end: string } | null;
  /** Skipped rows whose date was missing or unreadable (subset of issueCount). */
  invalidDateRows: number;
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
 * @param options  Header row (for files with title lines above the column
 *                 titles) and provenance (source file name, id prefix).
 *                 Omitting it gives exactly the historical behaviour.
 */
export function parseCsvDetailed(
  csvText: string,
  source: "bank" | "ledger",
  colMap?: CsvColumnMap,
  options: ParseOptions = {}
): ParseResult {
  const headerRow = normalizeHeaderRow(options.headerRow);
  const lineOffset = headerRow - 1;
  const body = dropLeadingLines(csvText, lineOffset);
  const idPrefix = options.idPrefix ?? source;

  const result = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  // Exact physical line of each data row (provenance + skipped-row reports).
  const recordLines = recordLineNumbers(
    body,
    result.meta.delimiter,
    result.data.length + 1,
    lineOffset
  );
  const lineOf = (i: number): number =>
    recordLines ? recordLines[i + 1] : i + 2 + lineOffset;

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
    const line = typeof err.row === "number" ? ` (line ${lineOf(err.row)})` : "";
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

  let invalidDateRows = 0;

  // ---- Statement balances (captured, never calculated) -------------
  const mappedSet = new Set(
    [effectiveMap.date, effectiveMap.description, effectiveMap.amount, effectiveMap.debit, effectiveMap.credit]
      .filter((c): c is string => Boolean(c))
  );
  const balanceCol = headers.find((h) => BALANCE_HEADERS.includes(h) && !mappedSet.has(h));
  const statement: StatementBalances = {
    opening: null,
    closing: null,
    hasBalanceColumn: Boolean(balanceCol),
    unreadableBalanceCells: 0,
    ambiguities: [],
  };
  const noteBalance = (kind: "opening" | "closing", found: StatementBalance) => {
    const existing = statement[kind];
    if (!existing) {
      statement[kind] = found;
    } else if (existing.cents !== found.cents) {
      statement.ambiguities.push(
        `The file gives two different ${kind} balances (line ${existing.line} and line ${found.line}).`
      );
    }
  };
  for (const t of titleLineBalances(csvText, lineOffset, decimalComma)) {
    noteBalance(t.kind, { cents: t.cents, line: t.line, origin: "title-line" });
  }
  /** A row labelled "Opening balance" / "Closing balance": read its value. */
  const captureBalanceRow = (row: Record<string, string>, line: number, label: string) => {
    const kind: "opening" | "closing" = /^(opening|beginning)/i.test(label) ? "opening" : "closing";
    const cell = (col: string | undefined) => (col ? (row[col] ?? "").trim() : "");
    const balText = cell(balanceCol);
    const amtText = cell(effectiveMap.amount) || cell(effectiveMap.credit) || cell(effectiveMap.debit);
    const bal = balText ? toCents(balText, decimalComma) : null;
    const amt = amtText ? toCents(amtText, decimalComma) : null;
    if (balText && bal === null) {
      statement.ambiguities.push(`Line ${line} is labelled "${label}" but its balance "${balText}" could not be read.`);
      return;
    }
    if (bal !== null && amt !== null && amt !== 0 && amt !== bal) {
      statement.ambiguities.push(
        `Line ${line} is labelled "${label}" but shows both an amount and a different balance.`
      );
      return;
    }
    const value = bal ?? amt;
    if (value === null) {
      statement.ambiguities.push(`Line ${line} is labelled "${label}" but has no readable balance.`);
      return;
    }
    noteBalance(kind, { cents: value, line, origin: "balance-row" });
  };
  const reportIssue = (line: number, reason: string) => {
    issueCount++;
    if (/date/i.test(reason)) invalidDateRows++;
    if (issues.length < MAX_REPORTED_ISSUES) issues.push({ line, reason });
  };

  /** The running balance printed on a transaction row, if any. */
  const readRunningBalance = (row: Record<string, string>): { runningBalance?: number } => {
    if (!balanceCol) return {};
    const text = (row[balanceCol] ?? "").trim();
    if (!text) return {};
    const cents = toCents(text, decimalComma);
    if (cents === null) {
      statement.unreadableBalanceCells++;
      return {};
    }
    return { runningBalance: cents };
  };

  const txns = result.data
    .map((row, i): Txn | null => {
      const line = lineOf(i); // 1-based physical line in the original file
      const dateRaw = row[effectiveMap.date];
      const descRaw = row[effectiveMap.description];

      if (!dateRaw?.trim() || !descRaw?.trim()) {
        reportIssue(line, "missing date or description");
        return null;
      }
      if (NON_TXN_DESCRIPTION.test(descRaw.trim())) {
        skippedBalanceRows++; // not a transaction — but its balance is evidence
        captureBalanceRow(row, line, descRaw.trim());
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
        id: `${idPrefix}-${i}`,
        source,
        date,
        description: descRaw.trim(),
        amount,
        reference: reference?.trim() || undefined,
        raw: row,
        ...(options.sourceFile !== undefined ? { sourceFile: options.sourceFile } : {}),
        sourceLine: line,
        ...readRunningBalance(row),
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
      statement,
      statementPeriod: findStatementPeriod(csvText, lineOffset, dayFirst),
      invalidDateRows,
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
