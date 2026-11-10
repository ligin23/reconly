// ============================================================
// Reconly — multi-file import
// Pure TypeScript. No React. Sits in FRONT of the matching engine: it turns
// one or more uploaded CSVs for one side (bank or ledger) into a single
// transaction list, and reports what each file contributed.
//
// HARD RULE: this module never merges, removes or de-duplicates rows.
// Every row the parser accepts from every file is passed through, tagged
// with the file and line it came from. Overlapping date ranges between
// files are REPORTED so the user can decide — nothing is dropped.
// (Duplicate detection is a separate, not-yet-built feature.)
// ============================================================

import {
  parseCsvDetailed,
  type CsvColumnMap,
  type ParseDiagnostics,
} from "@/lib/parser";
import type { Txn } from "@/lib/recon/types";

export type ImportSide = "bank" | "ledger";

export type ImportFileInput = {
  name: string;
  content: string;
  map: CsvColumnMap;
  /** 1-based line holding the column titles. Default 1. */
  headerRow?: number;
};

export type ImportedFile = {
  side: ImportSide;
  name: string;
  headerRow: number;
  /** Transactions read from this file (rows the parser accepted). */
  rowCount: number;
  /** Earliest / latest transaction date in this file, or null if none. */
  coverage: { start: string; end: string } | null;
  diagnostics: ParseDiagnostics;
};

/** Two files on the same side whose date ranges overlap. */
export type CoverageOverlap = {
  side: ImportSide;
  fileA: string;
  fileB: string;
  /** The overlapping date range (inclusive, ISO yyyy-mm-dd). */
  start: string;
  end: string;
};

export type CombinedImport = {
  /** All transactions from all files, in a stable order (see combineFiles). */
  txns: Txn[];
  /** One entry per input file, in the same stable order. */
  files: ImportedFile[];
  overlaps: CoverageOverlap[];
};

function coverageOf(txns: Txn[]): { start: string; end: string } | null {
  if (txns.length === 0) return null;
  let start = txns[0].date;
  let end = txns[0].date;
  for (const t of txns) {
    if (t.date < start) start = t.date;
    if (t.date > end) end = t.date;
  }
  return { start, end };
}

/**
 * Parse and combine the files uploaded for one side.
 *
 * Ordering: files are ordered by their earliest transaction date, then by
 * name — NOT by upload order — so the same set of files always produces the
 * same transaction list (the engine is deterministic for a given input
 * order, so the input order must be deterministic too). Rows keep their
 * original order within each file.
 *
 * IDs: with a single file, ids are `bank-0`, `bank-1`… exactly as before
 * multi-file import existed, so single-file behaviour and previously saved
 * reconciliations are unaffected. With several files, ids are
 * `bank-f1-0`, `bank-f2-0`… (file number in the stable order above).
 */
export function combineFiles(side: ImportSide, inputs: ImportFileInput[]): CombinedImport {
  const parsed = inputs.map((input) => {
    const result = parseCsvDetailed(input.content, side, input.map, {
      headerRow: input.headerRow,
      sourceFile: input.name,
    });
    return { input, result, coverage: coverageOf(result.txns) };
  });

  const NO_DATES = "9999-99-99"; // files with no readable rows sort last
  const ordered = parsed
    .map((p, uploadIndex) => ({ ...p, uploadIndex }))
    .sort(
      (a, b) =>
        (a.coverage?.start ?? NO_DATES).localeCompare(b.coverage?.start ?? NO_DATES) ||
        a.input.name.localeCompare(b.input.name) ||
        a.uploadIndex - b.uploadIndex
    );

  const single = ordered.length === 1;
  const txns: Txn[] = [];
  const files: ImportedFile[] = [];

  ordered.forEach((p, fileIndex) => {
    for (const t of p.result.txns) {
      txns.push(
        single
          ? t
          : // Re-key so ids stay unique across files; the row index after the
            // file tag is the same index the parser assigned within that file.
            { ...t, id: `${side}-f${fileIndex + 1}-${t.id.slice(side.length + 1)}` }
      );
    }
    files.push({
      side,
      name: p.input.name,
      headerRow: p.input.headerRow && p.input.headerRow > 1 ? p.input.headerRow : 1,
      rowCount: p.result.txns.length,
      coverage: p.coverage,
      diagnostics: p.result.diagnostics,
    });
  });

  const overlaps: CoverageOverlap[] = [];
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const a = files[i].coverage;
      const b = files[j].coverage;
      if (!a || !b) continue;
      const start = a.start > b.start ? a.start : b.start;
      const end = a.end < b.end ? a.end : b.end;
      if (start <= end) {
        overlaps.push({ side, fileA: files[i].name, fileB: files[j].name, start, end });
      }
    }
  }

  return { txns, files, overlaps };
}

export { sourceLabel } from "./provenance";
