// ============================================================
// Reconly — upload structure check
// Pure TypeScript. Runs when a file is picked, BEFORE column mapping, and
// answers one question: could this file possibly hold a table of
// transactions? It does not parse amounts or dates (the parser does that,
// and reports row-level problems on the mapping screen) and it never
// alters a file.
//
// It is deliberately permissive — a valid export must never be turned
// away because of how it is laid out:
//   - title lines above the column titles are fine (they have one cell);
//   - the first row does not have to be the header;
//   - any delimiter the parser can detect is fine (comma, semicolon, tab, pipe).
// Only three situations are refused, because no column mapping can fix them:
//   empty       the file has no content at all;
//   no-columns  no row has two or more separate values (plain text, or a
//               delimiter Reconly cannot read), or nothing in the file
//               looks like a date or an amount;
//   no-rows     there is a row of column titles but nothing beneath it.
// ============================================================

import Papa from "papaparse";

export type FileProblemKind = "empty" | "no-columns" | "no-rows";

export type FileProblem = {
  kind: FileProblemKind;
  /** Completes the sentence `"name.csv" wasn't added — it …` */
  message: string;
};

/** Rows inspected; enough to see past any title block without parsing a huge file twice. */
const SCAN_ROWS = 500;

export function checkFileStructure(content: string): FileProblem | null {
  const text = content.replace(/^﻿/, "");
  if (text.trim() === "") {
    return { kind: "empty", message: "it is empty. Export your transactions again and check the file has content." };
  }

  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: "greedy", preview: SCAN_ROWS });
  const rows = parsed.data.map((r) => r.map((c) => String(c ?? "").trim()));
  // A row of a table: at least two separate, non-empty values.
  const tabular = rows.filter((r) => r.filter((c) => c !== "").length >= 2);

  if (tabular.length === 0) {
    return {
      kind: "no-columns",
      message:
        "it doesn't contain a table of transactions: no row has separate columns. " +
        "Reconly reads CSV files whose columns are separated by commas, semicolons, tabs or | — " +
        "with a row of column titles and one row per transaction.",
    };
  }
  if (tabular.length === 1) {
    return {
      kind: "no-rows",
      message:
        rows.length === 1 || tabular[0].every((c) => !/\d/.test(c))
          ? "it has column titles but no transaction rows beneath them."
          : "it has only one row. Reconly needs a row of column titles and at least one transaction row.",
    };
  }
  // Dates and amounts both contain digits. A "table" with none anywhere
  // (prose that happens to contain commas) cannot hold transactions.
  if (!tabular.some((r) => r.some((c) => /\d/.test(c)))) {
    return {
      kind: "no-columns",
      message: "it contains no usable transaction records: nothing in it looks like a date or an amount.",
    };
  }
  return null;
}
