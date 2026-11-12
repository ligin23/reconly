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
import { NET_LABELS } from "@/lib/review/net-difference";
import { attentionHeading, exportFileName, type ExportContext } from "./buckets";
import {
  buildReportModel,
  dollars,
  type DuplicateLine,
  type PairLine,
  type ReportNet,
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

type XlsxCell = { v: string | number; t: "s" | "n"; z?: string; s?: CellStyle };

/**
 * TEXT cell. Anything that came from an uploaded file (descriptions, file
 * names, references) goes through here and is stored as an explicit string
 * — that is what stops "=HYPERLINK(...)" becoming a formula.
 */
function cell(value: string, style?: CellStyle): XlsxCell {
  return { v: value, t: "s", ...(style ? { s: style } : {}) };
}

/** Currency format: negatives in parentheses, e.g. ($59.99). */
export const MONEY_FORMAT = '"$"#,##0.00;("$"#,##0.00)';
export const COUNT_FORMAT = "0";

/**
 * MONEY cell: a real number (dollars, signed) with a currency format, so
 * SUM, sorting and filters work. Built only from integer cents computed by
 * Reconly — never from text read out of an uploaded file. `null` = no
 * amount → an empty text cell.
 */
function moneyCell(cents: number | null, style?: CellStyle): XlsxCell {
  if (cents === null) return blank(style);
  return { v: cents / 100, t: "n", z: MONEY_FORMAT, s: { ...(style ?? {}), numFmt: MONEY_FORMAT } };
}

/** COUNT cell: a whole number stored as a number. */
function countCell(n: number, style?: CellStyle): XlsxCell {
  return { v: n, t: "n", z: COUNT_FORMAT, s: { ...(style ?? {}), numFmt: COUNT_FORMAT } };
}

/** A summary value that is a plain whole number ("47") becomes a count cell. */
function valueCell(value: string, style?: CellStyle): XlsxCell {
  return /^\d+$/.test(value) ? countCell(Number(value), style) : cell(value, style);
}

function blank(style?: CellStyle): XlsxCell {
  return { v: "", t: "s", ...(style ? { s: style } : {}) };
}

/** The net-activity rows as numeric cells, keyed by the label they print under. */
function netCells(net: ReportNet, style: CellStyle): [string, XlsxCell][] {
  return [
    [NET_LABELS.bank, moneyCell(net.bankNet, style)],
    [NET_LABELS.ledger, moneyCell(net.ledgerNet, style)],
    ...(net.addedNet !== 0
      ? ([["Bank items added to the reconciliation by you", moneyCell(net.addedNet, style)]] as [string, XlsxCell][])
      : []),
    [NET_LABELS.difference, moneyCell(net.difference, style)],
  ];
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
 * SAFETY: every TEXT cell is written as an explicit string ({ t: "s" }) —
 * that is what stops a description like "=HYPERLINK(...)" becoming a
 * formula. The only numeric cells are amounts and counts that Reconly
 * computed itself (moneyCell / countCell); no cell is ever a formula.
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
        moneyCell(l.amountCents, amount),
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
    sixth: (l: PairLine) => XlsxCell,
    /** Extra cells after the source columns (e.g. a note). */
    trailing: (l: PairLine) => XlsxCell[] = () => []
  ) => {
    for (const l of lines) {
      const bold: CellStyle = l.kind === "group" ? { ...data, font: { ...data.font, bold: true } } : data;
      const label: CellStyle = l.kind === "part" ? { ...data, ...muted, fill: data.fill } : bold;
      row(
        cell(l.bankDate,         bold),
        cell(l.bankDescription,  label),
        moneyCell(l.bankAmountCents, amount),
        cell(l.booksDate,        data),
        cell(
          // A group's total is a SUBTOTAL of the entries listed under it.
          // It is written here as text, never in an amount column, so
          // adding up a column cannot count the group twice.
          l.kind === "group" && l.groupTotalCents !== null
            ? `${l.booksDescription} — group total ${dollars(l.groupTotalCents)} (subtotal of the entries below, not an extra amount)`
            : l.booksDescription,
          bold
        ),
        sixth(l),
        ...(prov
          ? [
              cell(l.bankSource,  { ...data, ...muted, fill: data.fill }),
              cell(l.booksSource, { ...data, ...muted, fill: data.fill }),
            ]
          : []),
        ...trailing(l),
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

  const kvRows: [string, XlsxCell][] = [
    ["Account", cell(ctx.accountName, S.kvValue)],
    ["Period", cell(periodLabel, S.kvValue)],
  ];
  if (ctx.openingBalance !== null) kvRows.push(["Opening balance", moneyCell(ctx.openingBalance, S.kvValue)]);
  if (ctx.closingBalance !== null) kvRows.push(["Closing balance (bank)", moneyCell(ctx.closingBalance, S.kvValue)]);
  // Signed net activity: bank minus ledger. Transaction totals, not
  // account balances — and never an absolute value without its direction.
  kvRows.push(...netCells(model.net, S.kvValue));
  // Imported / in use / set aside — only when rows were repeated.
  for (const [label, value] of [...model.statusSummary, ...model.importSummary]) {
    kvRows.push([label, valueCell(value, S.kvValue)]);
  }

  for (const [label, value] of kvRows) {
    row(
      cell(label, S.kvLabel),
      value,
      ...Array(COLS - 2).fill(blank())
    );
    r++;
  }
  fullRow(
    `${NET_LABELS.scope} A negative difference means bank net activity is the lower figure. The size of a difference does not indicate its cause.`,
    S.disclaimer
  );

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
    pairRows(model.matchedLines, S.data, S.amount, (l) => moneyCell(l.booksAmountCents, S.amount));
    if (model.buckets.acceptedComposites.length > 0) {
      fullRow(
        "Grouped matches: the bank amount appears once, on the group's first row, and each records entry appears once below it. " +
          "The group total is shown as text only, so adding up either amount column counts every transaction exactly once.",
        S.note
      );
    }
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

  // ---- Sub-group: in records only (unresolved; cause not established) ----
  fullRow("In your records only — no confirmed bank match", S.subHead);
  if (missingFromBank.length === 0) {
    row(cell("None — every entry in your records has a confirmed bank match or was marked by you as expected.", S.data), ...Array(COLS - 1).fill(blank()));
    r++;
  } else {
    fullRow(
      "These entries have no confirmed bank match. The cause is not established: an entry may be waiting to clear, " +
        "may have been entered with a different amount, or may not belong. They are not assumed to be timing differences.",
      S.note
    );
    sideTable(missingFromBank, S.attentionData, S.attentionAmount);
  }
  spacer();

  // ---- Sub-group: marked by the user as expected to clear later ----
  if (acknowledged.length > 0) {
    fullRow(
      `Marked by you as expected to clear later  (${acknowledged.length})`,
      S.subHeadResolved
    );
    fullRow(
      "You marked these records entries as expected to clear the bank later. " +
        "This is your classification; Reconly has not verified it, and they remain unmatched.",
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
      cell("Bank amount",      S.colHeader),
      cell("Books date",       S.colHeader),
      cell("Books description",S.colHeader),
      cell("Books amount",     S.colHeader),
      ...sourceHeaders,
      cell("Note",             S.colHeader),
    );
    r++;

    const noteStyle: CellStyle = { ...S.attentionData, ...muted, fill: S.attentionData.fill };
    pairRows(
      model.reviewLines,
      S.attentionData,
      S.attentionAmount,
      (l) => moneyCell(l.booksAmountCents, S.attentionAmount),
      (l) => [
        cell(
          // An entry listed as one OPTION of an undecided group can appear
          // under several options, so its amount is text, not a number.
          l.kind === "part" && l.booksAmountCents === null
            ? `entry amount ${l.booksAmount} — one of several options, not counted`
            : l.note,
          noteStyle
        ),
      ]
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
      cell("Listed as",        S.colHeader),
      cell("Why it was flagged (detection)", S.colHeader),
      cell("Automatic step",   S.colHeader),
      cell("Your decision",    S.colHeader),
      cell("Current status",   S.colHeader),
    );
    r++;
    const why: CellStyle = { ...data, ...muted, fill: data.fill };
    for (const l of lines) {
      row(
        cell(l.date,        data),
        cell(l.description, data),
        moneyCell(l.amountCents, amount),
        cell(l.side,        data),
        cell(l.source,      data),
        cell(l.status,      data),
        cell(l.detection,   why),
        cell(l.automatic,   why),
        cell(l.decision,    why),
        cell(l.currentStatus, why),
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
        "but the files do not prove it, so no row was set aside automatically. They still need a decision.",
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
    { wch: 22 }, // F  books amount / listed as
    { wch: 44 }, // G  source file · row / detection
    { wch: 44 }, // H  source file · row / automatic step
    { wch: 44 }, // I  note / your decision
    { wch: 44 }, // J  current status
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Reconciliation");

  // ================================================================
  // FINANCIAL SUMMARY worksheet (second sheet; the Reconciliation sheet
  // above). Text cells are explicit strings → no formula injection; amounts
  // and counts are numeric cells computed by Reconly.
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
    /** Body values: text → string cell; a ready-made cell (money / count) is used as is. */
    const table = (head: string[], body: (string | XlsxCell)[][], style: CellStyle = S.data) => {
      data.push(head.map((h) => cell(h, S.colHeader)));
      for (const r of body) data.push(r.map((v) => (typeof v === "string" ? cell(v, style) : v)));
    };
    const netByLabel = new Map(netCells(model.net, S.kvValue));

    title("Financial Summary", S.reportTitle);
    title(model.verdict, verdictStyle);
    gap();

    title("Overall results", S.sectionHead);
    for (const [label, value] of sum.executive) {
      data.push([cell(label, S.kvLabel), netByLabel.get(label) ?? valueCell(value, S.kvValue)]);
    }
    title(NET_LABELS.scope, S.disclaimer);
    gap();

    title("What this review shows", S.sectionHead);
    table(["Category", "Finding"], sum.evidence.map((e) => [e.category, e.text]));
    gap();

    title("Month-by-month findings", S.sectionHead);
    table(
      ["Month", "Bank rows in use", "Records rows in use", "Rows set aside", "Unmatched", "To review", "Duplicate questions", "Cross-month matches", "Findings", "Statement balance", "Coverage notes"],
      sum.months.map((m) => [
        m.month,
        ...[m.bankRows, m.recordsRows, m.setAside, m.unmatched, m.toReview, m.duplicateQuestions, m.crossMonth].map((v) =>
          valueCell(v, S.data)
        ),
        m.findings, m.statementBalance, m.notes,
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
        ["Bank file", "Period", "Opening balance", "Opening balance source", "Net activity", "Rows", "Closing balance", "Closing balance source", "Difference", "Result", "Explanation"],
        sum.statements.map((s) => [
          s.file,
          s.period,
          moneyCell(s.openingCents, S.amount),
          s.openingNote,
          moneyCell(s.netActivityCents, S.amount),
          countCell(s.rowCount, S.data),
          moneyCell(s.closingCents, S.amount),
          s.closingNote,
          s.differenceCents === null ? "Not computable" : moneyCell(s.differenceCents, S.amount),
          s.status,
          s.explanation,
        ])
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
        sum.exceptions.map((e) => [e.type, e.date, e.description, moneyCell(e.amountCents, S.attentionAmount), e.source]),
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
