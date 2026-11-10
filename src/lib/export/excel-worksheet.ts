// ============================================================
// Reconly — Excel reconciliation worksheet
// Pure TypeScript. No React. No framework imports.
// Uses xlsx-js-style (browser-compatible SheetJS fork).
//
// FRAMING RULE (non-negotiable):
//   This file describes findings only — never instructs the user
//   to record entries, categorize transactions, or file taxes.
//   User-added items are described as "to be recorded in your
//   books" — NOT as "recorded" or "added to your books".
// ============================================================

import { formatPeriod } from "@/lib/data/utils";
import { attentionHeading, exportFileName, type ExportContext } from "./buckets";
import {
  buildReportModel,
  dollars,
  type DuplicateLine,
  type PairLine,
  type SideLine,
} from "./report-model";

export type ExcelExportContext = ExportContext;

// ---- Style constants -------------------------------------------------

type CellStyle = {
  font?: {
    bold?: boolean;
    sz?: number;
    color?: { rgb: string };
    italic?: boolean;
  };
  fill?: {
    fgColor: { rgb: string };
  };
  alignment?: {
    horizontal?: "left" | "center" | "right";
    vertical?: "center";
    wrapText?: boolean;
  };
  border?: {
    bottom?: { style: "thin"; color: { rgb: string } };
    top?: { style: "thin"; color: { rgb: string } };
  };
  numFmt?: string;
};

const GREY_HEADER_BG = "F1F1F7";
const GREEN_BG       = "DCFCE7";
const GREEN_INK      = "166534";
const AMBER_BG       = "FEF3C7";
const AMBER_INK      = "78350F";
const DIVIDER_COLOR  = "DCDDE4";
const MUTED_INK      = "808299";
const BLACK          = "1E1E23";
const ATTENTION_BG   = "FFFBEB"; // amber tint — unresolved items needing action
const RESOLVED_BG    = "EEF2FF"; // indigo-50 — items user has already addressed

const S = {
  reportTitle: {
    font: { bold: true, sz: 14, color: { rgb: BLACK } },
    fill: { fgColor: { rgb: "FFFFFF" } },
    alignment: { horizontal: "left" as const },
  } satisfies CellStyle,

  kvLabel: {
    font: { bold: false, sz: 10, color: { rgb: MUTED_INK } },
    alignment: { horizontal: "left" as const },
  } satisfies CellStyle,

  kvValue: {
    font: { bold: true, sz: 10, color: { rgb: BLACK } },
    alignment: { horizontal: "left" as const },
  } satisfies CellStyle,

  verdictGood: {
    font: { bold: true, sz: 11, color: { rgb: GREEN_INK } },
    fill: { fgColor: { rgb: GREEN_BG } },
    alignment: { horizontal: "left" as const },
  } satisfies CellStyle,

  verdictWarn: {
    font: { bold: true, sz: 11, color: { rgb: AMBER_INK } },
    fill: { fgColor: { rgb: AMBER_BG } },
    alignment: { horizontal: "left" as const },
  } satisfies CellStyle,

  disclaimer: {
    font: { sz: 9, italic: true, color: { rgb: MUTED_INK } },
    alignment: { horizontal: "left" as const, wrapText: true },
  } satisfies CellStyle,

  sectionHead: {
    font: { bold: true, sz: 10, color: { rgb: BLACK } },
    fill: { fgColor: { rgb: GREY_HEADER_BG } },
    alignment: { horizontal: "left" as const },
    border: {
      top: { style: "thin" as const, color: { rgb: DIVIDER_COLOR } },
      bottom: { style: "thin" as const, color: { rgb: DIVIDER_COLOR } },
    },
  } satisfies CellStyle,

  subHead: {
    font: { bold: true, sz: 9, color: { rgb: MUTED_INK } },
    fill: { fgColor: { rgb: GREY_HEADER_BG } },
    alignment: { horizontal: "left" as const },
  } satisfies CellStyle,

  // Sub-heading for resolved items — indigo tint
  subHeadResolved: {
    font: { bold: true, sz: 9, color: { rgb: "3730A3" } },
    fill: { fgColor: { rgb: "E0E7FF" } },
    alignment: { horizontal: "left" as const },
  } satisfies CellStyle,

  colHeader: {
    font: { bold: true, sz: 9, color: { rgb: MUTED_INK } },
    fill: { fgColor: { rgb: "F8F8FC" } },
    border: {
      bottom: { style: "thin" as const, color: { rgb: DIVIDER_COLOR } },
    },
  } satisfies CellStyle,

  data: {
    font: { sz: 9.5, color: { rgb: BLACK } },
    alignment: { horizontal: "left" as const },
  } satisfies CellStyle,

  amount: {
    font: { sz: 9.5, color: { rgb: BLACK } },
    alignment: { horizontal: "right" as const },
  } satisfies CellStyle,

  // Unresolved attention row
  attentionData: {
    font: { sz: 9.5, color: { rgb: BLACK } },
    fill: { fgColor: { rgb: ATTENTION_BG } },
    alignment: { horizontal: "left" as const },
  } satisfies CellStyle,

  attentionAmount: {
    font: { sz: 9.5, color: { rgb: AMBER_INK } },
    fill: { fgColor: { rgb: ATTENTION_BG } },
    alignment: { horizontal: "right" as const },
  } satisfies CellStyle,

  // Resolved row — indigo tint, neutral
  resolvedData: {
    font: { sz: 9.5, color: { rgb: BLACK } },
    fill: { fgColor: { rgb: RESOLVED_BG } },
    alignment: { horizontal: "left" as const },
  } satisfies CellStyle,

  resolvedAmount: {
    font: { sz: 9.5, color: { rgb: "3730A3" } },
    fill: { fgColor: { rgb: RESOLVED_BG } },
    alignment: { horizontal: "right" as const },
  } satisfies CellStyle,

  // Inline note (italic, muted, light bg)
  note: {
    font: { sz: 9, italic: true, color: { rgb: MUTED_INK } },
    fill: { fgColor: { rgb: RESOLVED_BG } },
    alignment: { horizontal: "left" as const, wrapText: true },
  } satisfies CellStyle,
};

// ---- Cell builder helpers -------------------------------------------

type XlsxCell = { v: string | number; t: "s" | "n"; s?: CellStyle };

function cell(value: string, style?: CellStyle): XlsxCell {
  return { v: value, t: "s", ...(style ? { s: style } : {}) };
}

function numCell(value: string, style?: CellStyle): XlsxCell {
  return { v: value, t: "s", ...(style ? { s: style } : {}) };
}

function blank(style?: CellStyle): XlsxCell {
  return { v: "", t: "s", ...(style ? { s: style } : {}) };
}

// ---- Main export function --------------------------------------------

/** Trigger the browser download of the Excel worksheet. */
export async function downloadExcelWorksheet(ctx: ExcelExportContext): Promise<void> {
  const XLSX = (await import("xlsx-js-style")).default;
  const wb = await buildExcelWorkbook(ctx);
  XLSX.writeFile(wb, exportFileName(ctx.accountName, ctx.periodStart, ctx.periodEnd, "xlsx"));
}

/**
 * Build the workbook. Everything it prints comes from the shared report
 * model (report-model.ts), which is what the unit tests check.
 *
 * SAFETY: every cell is written as an explicit string ({ t: "s" }) — that
 * is what stops a description like "=HYPERLINK(...)" becoming a formula.
 */
export async function buildExcelWorkbook(ctx: ExcelExportContext) {
  const XLSX = (await import("xlsx-js-style")).default;

  const wb = XLSX.utils.book_new();
  const wsData: XlsxCell[][] = [];

  const row = (...cells: XlsxCell[]) => wsData.push(cells);

  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  const merge = (r: number, c1: number, c2: number) =>
    merges.push({ s: { r, c: c1 }, e: { r, c: c2 } });

  const model = buildReportModel(ctx);
  const { missingFromBooks, added, missingFromBank, acknowledged } = model;

  const periodLabel = formatPeriod(ctx.periodStart, ctx.periodEnd);
  const verdictText = model.verdict;
  const verdictStyle = ctx.reconciled ? S.verdictGood : S.verdictWarn;

  // Two extra columns (bank source, books source) appear only when the
  // transactions know which file and row they came from — reports for
  // older saved reconciliations keep their original six columns.
  const prov = model.hasProvenance;
  const COLS = prov ? 8 : 6;
  const lastCol = COLS - 1;

  let r = 0;
  const fullRow = (text: string, style: CellStyle, filler: CellStyle | undefined = style) => {
    row(cell(text, style), ...Array(COLS - 1).fill(blank(filler)));
    merge(r, 0, lastCol);
    r++;
  };
  const spacer = () => {
    row(...Array(COLS).fill(blank()));
    r++;
  };
  const muted: CellStyle = { font: { sz: 9, italic: true, color: { rgb: MUTED_INK } } };

  /** One-sided table: Date / Description / Amount (+ Source). */
  const sideTable = (lines: SideLine[], data: CellStyle, amount: CellStyle) => {
    row(
      cell("Date",        S.colHeader),
      cell("Description", S.colHeader),
      cell("Amount",      S.colHeader),
      prov ? cell("Source", S.colHeader) : blank(),
      blank(),
      blank(),
    );
    r++;
    for (const l of lines) {
      row(
        cell(l.date,        data),
        cell(l.description, data),
        numCell(l.amount,   amount),
        prov ? cell(l.source, { ...data, ...muted, fill: data.fill }) : blank(),
        blank(),
        blank(),
      );
      r++;
    }
  };

  /** Two-sided table rows. `sixth` picks what the sixth column shows. */
  const pairRows = (
    lines: PairLine[],
    data: CellStyle,
    amount: CellStyle,
    sixth: (l: PairLine) => XlsxCell
  ) => {
    for (const l of lines) {
      const bold: CellStyle = l.kind === "group" ? { ...data, font: { ...data.font, bold: true } } : data;
      const label: CellStyle = l.kind === "part" ? { ...data, ...muted, fill: data.fill } : bold;
      row(
        cell(l.bankDate,         bold),
        cell(l.bankDescription,  label),
        numCell(l.bankAmount,    amount),
        cell(l.booksDate,        data),
        cell(l.booksDescription, bold),
        sixth(l),
        ...(prov
          ? [
              cell(l.bankSource,  { ...data, ...muted, fill: data.fill }),
              cell(l.booksSource, { ...data, ...muted, fill: data.fill }),
            ]
          : []),
      );
      r++;
    }
  };
  const sourceHeaders = prov
    ? [cell("Bank source", S.colHeader), cell("Books source", S.colHeader)]
    : [];

  // ================================================================
  // ABOUT THIS REPORT block
  // ================================================================
  fullRow("About this report", S.reportTitle, undefined);
  spacer();

  const kvRows: [string, string][] = [
    ["Account", ctx.accountName],
    ["Period", periodLabel],
  ];
  if (ctx.openingBalance !== null) kvRows.push(["Opening balance", dollars(ctx.openingBalance)]);
  if (ctx.closingBalance !== null) kvRows.push(["Closing balance (bank)", dollars(ctx.closingBalance)]);
  kvRows.push([
    "Unexplained difference",
    ctx.reconciled ? "$0.00" : dollars(Math.abs(ctx.unexplainedDifference)),
  ]);
  // Imported / in use / set aside — only when rows were repeated.
  kvRows.push(...model.statusSummary, ...model.importSummary);

  for (const [label, value] of kvRows) {
    row(
      cell(label, S.kvLabel),
      cell(value, S.kvValue),
      ...Array(COLS - 2).fill(blank())
    );
    r++;
  }

  spacer();
  fullRow(verdictText, verdictStyle);
  spacer();

  const disclaimerText =
    "Reconly helps you check whether your records match your bank. " +
    "It is not accounting or tax advice. " +
    "For decisions about how to record transactions or file taxes, consult a qualified accountant.";
  fullRow(disclaimerText, S.disclaimer);
  spacer();

  // ================================================================
  // MATCHED TRANSACTIONS (pairs, then grouped matches)
  // ================================================================
  fullRow(`Matched transactions  (${model.matchedCount})`, S.sectionHead);

  if (model.matchedLines.length === 0) {
    row(cell("No matched transactions yet.", S.data), ...Array(COLS - 1).fill(blank()));
    r++;
  } else {
    row(
      cell("Bank date",          S.colHeader),
      cell("Bank description",   S.colHeader),
      cell("Bank amount",        S.colHeader),
      cell("Books date",         S.colHeader),
      cell("Books description",  S.colHeader),
      cell("Books amount",       S.colHeader),
      ...sourceHeaders,
    );
    r++;
    pairRows(model.matchedLines, S.data, S.amount, (l) => numCell(l.booksAmount, S.amount));
  }

  spacer();

  // ================================================================
  // NEEDS YOUR ATTENTION
  // ================================================================
  fullRow(attentionHeading(model.buckets), S.sectionHead);

  // ---- Sub-group: on bank, not in records (unresolved) ----
  fullRow("On your bank statement but not in your records", S.subHead);
  if (missingFromBooks.length === 0) {
    row(cell("None — every bank transaction has a matching entry in your records.", S.data), ...Array(COLS - 1).fill(blank()));
    r++;
  } else {
    sideTable(missingFromBooks, S.attentionData, S.attentionAmount);
  }
  spacer();

  // ---- Sub-group: added to reconciliation (resolved — to be recorded) ----
  if (added.length > 0) {
    fullRow(
      `Added to your reconciliation — to be recorded in your books  (${added.length})`,
      S.subHeadResolved
    );
    fullRow(
      "These bank transactions are included in this reconciliation so your report is complete. " +
        "You or your accountant will need to record them in your books.",
      S.note
    );
    sideTable(added, S.resolvedData, S.resolvedAmount);
    spacer();
  }

  // ---- Sub-group: in records, not cleared (unresolved) ----
  fullRow("In your records but not yet cleared by your bank", S.subHead);
  if (missingFromBank.length === 0) {
    row(cell("None — every entry in your records has cleared the bank.", S.data), ...Array(COLS - 1).fill(blank()));
    r++;
  } else {
    sideTable(missingFromBank, S.attentionData, S.attentionAmount);
  }
  spacer();

  // ---- Sub-group: marked as outstanding (resolved — timing only) ----
  if (acknowledged.length > 0) {
    fullRow(
      `Marked as outstanding — known timing difference  (${acknowledged.length})`,
      S.subHeadResolved
    );
    fullRow(
      "These are in your records but your bank hasn't processed them yet. " +
        "This is a normal timing difference — no action needed.",
      S.note
    );
    sideTable(acknowledged, S.resolvedData, S.resolvedAmount);
    spacer();
  }

  // ---- Sub-group: review items (possible matches, incl. grouped) ----
  if (model.reviewLines.length > 0) {
    fullRow(
      model.buckets.reviewComposites.length === 0
        ? "Possible matches — amounts are close but something didn't line up exactly"
        : `Possible matches — not confirmed  (${model.reviewCount}, including ${model.buckets.reviewComposites.length} grouped)`,
      S.subHead
    );

    row(
      cell("Bank date",        S.colHeader),
      cell("Bank description", S.colHeader),
      cell("Amount",           S.colHeader),
      cell("Books date",       S.colHeader),
      cell("Books description",S.colHeader),
      cell("Note",             S.colHeader),
      ...sourceHeaders,
    );
    r++;

    const noteStyle: CellStyle = { ...S.attentionData, ...muted, fill: S.attentionData.fill };
    pairRows(model.reviewLines, S.attentionData, S.attentionAmount, (l) =>
      cell(l.kind === "part" ? `entry amount ${l.booksAmount}` : l.note, noteStyle)
    );
    spacer();
  }

  // ================================================================
  // REPEATED ROWS (set aside / possible duplicates)
  // ================================================================
  const duplicateTable = (lines: DuplicateLine[], data: CellStyle, amount: CellStyle) => {
    row(
      cell("Date",             S.colHeader),
      cell("Description",      S.colHeader),
      cell("Amount",           S.colHeader),
      cell("Side",             S.colHeader),
      cell("Source",           S.colHeader),
      cell("Why it is listed", S.colHeader),
    );
    r++;
    for (const l of lines) {
      row(
        cell(l.date,        data),
        cell(l.description, data),
        numCell(l.amount,   amount),
        cell(l.side,        data),
        cell(l.source,      data),
        cell(`${l.status}. ${l.reason}`, { ...data, ...muted, fill: data.fill }),
      );
      r++;
    }
  };

  if (model.setAsideLines.length > 0) {
    fullRow(
      `Rows set aside as repeated  (${model.setAsideLines.length}) — imported, but not part of this reconciliation`,
      S.sectionHead
    );
    fullRow(
      "These rows were uploaded but are not counted above, because the same row was imported more than once. " +
        "They are listed so nothing is hidden; each can be restored in Reconly.",
      S.note
    );
    duplicateTable(model.setAsideLines, S.resolvedData, S.resolvedAmount);
    spacer();
  }

  if (model.possibleDuplicateLines.length > 0) {
    fullRow(
      `Possible duplicates still included  (${model.possibleDuplicateLines.length}) — counted above, not confirmed either way`,
      S.sectionHead
    );
    fullRow(
      "These rows ARE counted in this reconciliation. They look like they may be the same row imported twice, " +
        "but the files do not prove it, so nothing was set aside.",
      S.note
    );
    duplicateTable(model.possibleDuplicateLines, S.attentionData, S.attentionAmount);
    spacer();
  }

  if (model.reviewedSeparateLines.length > 0) {
    fullRow(
      `Reviewed and retained — confirmed as separate  (${model.reviewedSeparateLines.length}) — counted above`,
      S.sectionHead
    );
    fullRow(
      "These rows looked like possible duplicates. They were reviewed in Reconly and confirmed as separate, " +
        "legitimate transactions, so all of them are kept and counted in this reconciliation.",
      S.note
    );
    duplicateTable(model.reviewedSeparateLines, S.data, S.amount);
    spacer();
  }

  // ================================================================
  // Build the worksheet
  // ================================================================
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  for (let ri = 0; ri < wsData.length; ri++) {
    for (let ci = 0; ci < wsData[ri].length; ci++) {
      const src = wsData[ri][ci];
      if (!src.s) continue;
      const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
      if (ws[addr]) {
        (ws[addr] as { s?: CellStyle }).s = src.s;
      }
    }
  }

  ws["!merges"] = merges;

  ws["!cols"] = [
    { wch: 14 }, // A  date
    { wch: 38 }, // B  description
    { wch: 13 }, // C  amount
    { wch: 14 }, // D  date (books side)
    { wch: 38 }, // E  description (books side)
    { wch: 38 }, // F  note / books amount
    ...(prov ? [{ wch: 30 }, { wch: 30 }] : []), // G, H  source file · row
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Reconciliation");

  // ================================================================
  // FINANCIAL SUMMARY worksheet (second sheet; the Reconciliation sheet
  // above is unchanged). Same string-only cells → no formula injection.
  // ================================================================
  if (model.summary) {
    const sum = model.summary;
    const data: XlsxCell[][] = [];
    const sMerges: typeof merges = [];
    const WIDTH = 11;
    const title = (text: string, style: CellStyle) => {
      data.push([cell(text, style), ...Array(WIDTH - 1).fill(blank(style))]);
      sMerges.push({ s: { r: data.length - 1, c: 0 }, e: { r: data.length - 1, c: WIDTH - 1 } });
    };
    const gap = () => data.push([blank()]);
    const table = (head: string[], body: string[][], style: CellStyle = S.data) => {
      data.push(head.map((h) => cell(h, S.colHeader)));
      for (const r of body) data.push(r.map((v) => cell(v, style)));
    };

    title("Financial Summary", S.reportTitle);
    title(model.verdict, verdictStyle);
    gap();

    title("Overall results", S.sectionHead);
    for (const [label, value] of sum.executive) data.push([cell(label, S.kvLabel), cell(value, S.kvValue)]);
    gap();

    title("What this review shows", S.sectionHead);
    table(["Category", "Finding"], sum.evidence.map((e) => [e.category, e.text]));
    gap();

    title("Month-by-month findings", S.sectionHead);
    table(
      ["Month", "Bank rows in use", "Records rows in use", "Rows set aside", "Unmatched", "To review", "Duplicate questions", "Cross-month matches", "Findings", "Statement balance", "Coverage notes"],
      sum.months.map((m) => [
        m.month, m.bankRows, m.recordsRows, m.setAside, m.unmatched, m.toReview, m.duplicateQuestions, m.crossMonth, m.findings, m.statementBalance, m.notes,
      ])
    );
    title(
      "A match is counted once, in the month of its bank row; cross-month matches are an 'involves' count and are not added into totals. " +
        "These describe the uploaded records only — a month with nothing unresolved is not necessarily complete or balanced.",
      S.note
    );
    gap();

    title("Statement balance verification", S.sectionHead);
    if (sum.statements.length === 0) {
      data.push([cell("No statement information is available for this reconciliation.", S.data)]);
    } else {
      table(
        ["Bank file", "Period", "Opening balance", "Net activity", "Closing balance", "Difference", "Result", "Explanation"],
        sum.statements.map((s) => [s.file, s.period, s.opening, s.netActivity, s.closing, s.difference, s.status, s.explanation])
      );
      title(
        "Every row read from each file is used, including rows later set aside as repeated. A verified statement means the file's balances agree with its own transactions — not that the period is reconciled.",
        S.note
      );
    }
    gap();

    title(`Unresolved exceptions  (${sum.exceptions.length})`, S.sectionHead);
    if (sum.exceptions.length === 0) {
      data.push([cell("None.", S.data)]);
    } else {
      table(
        ["Type", "Date", "Description", "Amount", "Source"],
        sum.exceptions.map((e) => [e.type, e.date, e.description, e.amount, e.source]),
        S.attentionData
      );
    }
    gap();

    title("Source coverage limitations — Coverage not verified", S.sectionHead);
    for (const note of sum.coverage) data.push([cell(note, S.data)]);

    const ss = XLSX.utils.aoa_to_sheet(data);
    for (let ri = 0; ri < data.length; ri++) {
      for (let ci = 0; ci < data[ri].length; ci++) {
        const src = data[ri][ci];
        if (!src.s) continue;
        const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
        if (ss[addr]) (ss[addr] as { s?: CellStyle }).s = src.s;
      }
    }
    ss["!merges"] = sMerges;
    ss["!cols"] = [
      { wch: 34 }, { wch: 40 }, { wch: 34 }, { wch: 24 }, { wch: 30 }, { wch: 16 },
      { wch: 30 }, { wch: 40 }, { wch: 34 }, { wch: 34 }, { wch: 60 },
    ];
    XLSX.utils.book_append_sheet(wb, ss, "Financial Summary");
  }

  return wb;
}
