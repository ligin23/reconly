// ============================================================
// Reconly — PDF reconciliation report
// Pure TypeScript. No React. No framework imports.
// Uses jsPDF + jspdf-autotable (browser-compatible).
//
// FRAMING RULE (non-negotiable):
//   This file describes findings only — never instructs the user
//   to record entries, categorize transactions, or file taxes.
//   User-added items are described as "to be recorded in your
//   books" — NOT as "recorded" or "added to your books".
// ============================================================

import { formatPeriod } from "@/lib/data/utils";
import { exportFileName, localIsoDate, type ExportContext } from "./buckets";
import {
  buildReportModel,
  dollars,
  shortDate,
  type DuplicateLine,
  type ReportSummary,
} from "./report-model";

export type PdfExportContext = ExportContext;

/** Subtitle for the coverage section. */
function coverageSubtitle(sum: ReportSummary): string {
  return `Coverage not verified — ${sum.coverage.length} ${sum.coverage.length === 1 ? "note" : "notes"}`;
}

// ---- Colour palette (greyscale-safe, matches app tone) ---------------
const C = {
  ink:        [30, 30, 35] as [number, number, number],
  ink2:       [80, 82, 92] as [number, number, number],
  ink3:       [130, 133, 148] as [number, number, number],
  line:       [220, 221, 228] as [number, number, number],
  good:       [22, 101, 52] as [number, number, number],   // green-800
  goodBg:     [220, 252, 231] as [number, number, number], // green-100
  warn:       [120, 53, 15] as [number, number, number],   // amber-900
  warnBg:     [254, 243, 199] as [number, number, number], // amber-100
  noteBg:     [238, 242, 255] as [number, number, number], // indigo-50 — resolved items
  noteInk:    [55, 48, 163] as [number, number, number],   // indigo-800
  headBg:     [241, 241, 247] as [number, number, number], // light grey header row
  accentBg:   [238, 242, 255] as [number, number, number], // indigo tint
  white:      [255, 255, 255] as [number, number, number],
};

// ---- Main export function --------------------------------------------

/** Trigger the browser download of the PDF report. */
export async function downloadPdfReport(ctx: PdfExportContext): Promise<void> {
  const doc = await buildPdfDocument(ctx);
  doc.save(exportFileName(ctx.accountName, ctx.periodStart, ctx.periodEnd, "pdf"));
}

/**
 * Build the report document. Everything it prints comes from the shared
 * report model (report-model.ts), which is what the unit tests check.
 */
export async function buildPdfDocument(ctx: PdfExportContext) {
  const model = buildReportModel(ctx);
  // Dynamic import keeps jsPDF out of the server-side bundle.
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const PW = doc.internal.pageSize.getWidth();  // 612
  const PH = doc.internal.pageSize.getHeight(); // 792
  const ML = 48; // left margin
  const MR = PW - 48; // right margin
  const CW = MR - ML; // content width

  let y = 0; // current Y cursor

  // ---- Helper: add a new page and reset cursor ----------------------
  const newPage = () => {
    doc.addPage();
    y = 48;
  };

  // ---- Helper: check remaining space, add page if needed -----------
  const ensureSpace = (needed: number) => {
    if (y + needed > PH - 72) newPage();
  };

  // ==================================================================
  // PAGE 1 — HEADER
  // ==================================================================
  y = 48;

  // App name / report label
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...C.ink3);
  doc.text("RECONLY  ·  RECONCILIATION REPORT", ML, y);
  y += 28;

  // Account + period headline
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...C.ink);
  doc.text(ctx.accountName, ML, y);
  y += 26;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(...C.ink2);
  doc.text(formatPeriod(ctx.periodStart, ctx.periodEnd), ML, y);

  // Generated date flush right
  doc.setFontSize(10);
  doc.setTextColor(...C.ink3);
  const genLine = `Generated ${shortDate(localIsoDate())}`;
  doc.text(genLine, MR, y, { align: "right" });
  y += 22;

  // Divider
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.5);
  doc.line(ML, y, MR, y);
  y += 24;

  // ==================================================================
  // VERDICT BANNER
  // ==================================================================
  const bgColor: [number, number, number] = ctx.reconciled ? C.goodBg : C.warnBg;
  const textColor: [number, number, number] = ctx.reconciled ? C.good : C.warn;
  const verdictText = model.verdict;

  // The verdict sentence can be long ("Transactions match — statement
  // review needed: …"), so it wraps and the banner grows with it.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  const verdictLines: string[] = doc.splitTextToSize(verdictText, CW - 28);
  const bannerHeight = 28 + verdictLines.length * 16;
  doc.setFillColor(...bgColor);
  doc.roundedRect(ML, y, CW, bannerHeight, 4, 4, "F");
  doc.setTextColor(...textColor);
  doc.text(verdictLines, ML + 14, y + 27);
  y += bannerHeight + 20;

  // ==================================================================
  // SUMMARY NUMBERS
  // ==================================================================
  const plainHeading = (title: string) => {
    ensureSpace(60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...C.ink);
    doc.text(title, ML, y);
    y += 14;
  };

  const { missingFromBooks, added, missingFromBank, acknowledged } = model;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  /** Description with the file and row it came from on a second line. */
  const withSource = (text: string, source: string) =>
    source ? `${text}\nfrom ${source}` : text;
  const lastY = () =>
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  const summaryRows: string[][] = [
    ["Matched transactions", String(model.matchedCount)],
    ["On bank statement, not yet in your records", String(missingFromBooks.length)],
    ["Added to your reconciliation (to be recorded in your books)", String(added.length)],
    ["In records, not yet cleared by bank", String(missingFromBank.length)],
    ["Marked as outstanding — known timing difference", String(acknowledged.length)],
    ["Possible matches (not confirmed)", String(model.reviewCount)],
  ];
  if (ctx.openingBalance !== null) {
    summaryRows.unshift(["Opening balance", dollars(ctx.openingBalance)]);
  }
  if (ctx.closingBalance !== null) {
    summaryRows.push(["Closing balance (bank)", dollars(ctx.closingBalance)]);
  }
  summaryRows.push([
    "Unexplained difference",
    ctx.reconciled ? "$0.00" : dollars(Math.abs(ctx.unexplainedDifference)),
  ]);

  const keyValueTable = (rows: string[][], highlightLast: boolean, labelShare = 0.65) => {
    autoTable(doc, {
      startY: y,
      head: [],
      body: rows,
      margin: { left: ML, right: 48 },
      tableWidth: CW,
      styles: {
        font: "helvetica",
        fontSize: 10.5,
        cellPadding: { top: 5, bottom: 5, left: 10, right: 10 },
        textColor: C.ink,
        lineColor: C.line,
        lineWidth: 0.4,
      },
      columnStyles: {
        0: { cellWidth: CW * labelShare, fontStyle: "normal", textColor: C.ink2 },
        1: { cellWidth: CW * (1 - labelShare), halign: "right", fontStyle: "bold" },
      },
      alternateRowStyles: { fillColor: C.white },
      didParseCell(data) {
        if (highlightLast && data.row.index === rows.length - 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.textColor = ctx.reconciled ? C.good : C.warn;
        }
      },
    });
    y = lastY() + 32;
  };
  // Executive summary first (when the review is available), then the
  // original summary table, unchanged.
  if (model.summary) {
    plainHeading("Executive summary");
    keyValueTable(model.summary.executive, false, 0.38);
  }
  plainHeading("Summary");
  keyValueTable(summaryRows, true);

  // ==================================================================
  // HELPER: section heading
  // ==================================================================
  /** `reserve`: room the section's first rows need, so a heading is never
   *  left alone at the bottom of a page. */
  const sectionHeading = (title: string, subtitle?: string, reserve = 0) => {
    ensureSpace(50 + reserve);
    doc.setFillColor(...C.headBg);
    doc.rect(ML, y, CW, 30, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...C.ink);
    doc.text(title, ML + 10, y + 19);
    if (subtitle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...C.ink3);
      doc.text(subtitle, MR - 10, y + 19, { align: "right" });
    }
    y += 34;
  };

  // ---- Helper: txn table (date / description / amount) --------------
  const txnTable = (
    lines: { date: string; description: string; amount: string; source: string }[],
    emptyMsg: string,
    rowBg?: [number, number, number]
  ) => {
    if (lines.length === 0) {
      ensureSpace(30);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(10);
      doc.setTextColor(...C.ink3);
      doc.text(emptyMsg, ML + 10, y + 16);
      y += 30;
      return;
    }
    ensureSpace(Math.min(lines.length, 6) * 22 + 20);
    autoTable(doc, {
      startY: y,
      head: [["Date", "Description", "Amount"]],
      body: lines.map((l) => [l.date, withSource(l.description, l.source), l.amount]),
      margin: { left: ML, right: 48 },
      tableWidth: CW,
      styles: {
        font: "helvetica",
        fontSize: 9.5,
        cellPadding: { top: 5, bottom: 5, left: 8, right: 8 },
        textColor: C.ink,
        lineColor: C.line,
        lineWidth: 0.3,
      },
      headStyles: {
        fillColor: [248, 248, 252] as [number, number, number],
        textColor: C.ink2,
        fontStyle: "bold",
        fontSize: 8.5,
      },
      columnStyles: {
        0: { cellWidth: 70 },
        1: { cellWidth: "auto" },
        2: { cellWidth: 80, halign: "right" },
      },
      alternateRowStyles: { fillColor: C.white },
      ...(rowBg
        ? {
            bodyStyles: { fillColor: rowBg },
            alternateRowStyles: { fillColor: rowBg },
          }
        : {}),
    });
    y = lastY() + 16;
  };

  // ---- Helper: inline note below a section -------------------------
  const inlineNote = (note: string) => {
    ensureSpace(28);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...C.ink3);
    const lines = doc.splitTextToSize(note, CW - 20);
    doc.text(lines, ML + 10, y + 12);
    y += lines.length * 13 + 10;
  };

  // ==================================================================
  // SECTION: IMPORTED ROWS (only when rows were repeated / set aside)
  // ==================================================================
  if (model.importSummary.length > 0) {
    sectionHeading("Imported rows", "what was uploaded, what is in use, what was set aside");
    // The two statuses are already in the executive summary when it is shown.
    keyValueTable(model.summary ? model.importSummary : [...model.statusSummary, ...model.importSummary], false);
  }

  // ==================================================================
  // SECTIONS: WHAT THE REVIEW SHOWS · MONTH BY MONTH · STATEMENT BALANCES
  // ==================================================================
  if (model.summary) {
    const sum = model.summary;
    const gridTable = (
      head: string[],
      body: string[][],
      columnStyles: Record<number, { cellWidth?: number; halign?: "right" | "left" }>,
      fontSize = 8
    ) => {
      autoTable(doc, {
        startY: y,
        head: [head],
        body,
        margin: { left: ML, right: 48 },
        tableWidth: CW,
        styles: {
          font: "helvetica",
          fontSize,
          cellPadding: { top: 4, bottom: 4, left: 5, right: 5 },
          textColor: C.ink,
          lineColor: C.line,
          lineWidth: 0.3,
          overflow: "linebreak",
        },
        headStyles: { fillColor: C.headBg, textColor: C.ink2, fontStyle: "bold", fontSize: fontSize - 0.5 },
        columnStyles,
        alternateRowStyles: { fillColor: C.white },
      });
      y = lastY() + 24;
    };

    if (sum.evidence.length > 0) {
      sectionHeading("What this review shows", "verified facts, possible discrepancies, missing evidence, your decisions", 110);
      gridTable(
        ["", "Finding"],
        sum.evidence.map((e, i) => [i === 0 || sum.evidence[i - 1].category !== e.category ? e.category : "", e.text]),
        { 0: { cellWidth: 120 } },
        8.5
      );
    }

    sectionHeading("Month-by-month findings", `${plural(sum.months.length, "month")} — matched across the whole period, grouped by each row's own date`, 120);
    gridTable(
      ["Month", "Bank rows", "Records rows", "Un-\nmatched", "To review", "Dup. questions", "Findings", "Statement balance", "Coverage notes"],
      sum.months.map((m) => [
        m.month, m.bankRows, m.recordsRows, m.unmatched, m.toReview, m.duplicateQuestions, m.findings, m.statementBalance, m.notes,
      ]),
      {
        0: { cellWidth: 50 },
        1: { cellWidth: 32, halign: "right" },
        2: { cellWidth: 40, halign: "right" },
        3: { cellWidth: 50, halign: "right" },
        4: { cellWidth: 34, halign: "right" },
        5: { cellWidth: 46, halign: "right" },
        6: { cellWidth: 66 },
        7: { cellWidth: 66 },
      },
      7.5
    );
    inlineNote(
      "Bank and records rows are rows in use (rows set aside as repeated are excluded). A match is counted once, in the month of its bank row. " +
      "These describe the uploaded records only; a month with nothing unresolved is not necessarily complete or balanced."
    );

    if (sum.statements.length > 0) {
      sectionHeading("Statement balance checks", "each bank file against its own stated balances — separate from matching", 120);
      gridTable(
        ["Bank file", "Period", "Opening", "Net activity", "Closing", "Difference", "Result"],
        sum.statements.map((s) => [
          s.file, s.period, s.opening, s.netActivity, s.closing, s.difference, `${s.status}. ${s.explanation}`,
        ]),
        { 0: { cellWidth: 84 }, 1: { cellWidth: 60 }, 2: { cellWidth: 56 }, 3: { cellWidth: 54 }, 4: { cellWidth: 56 }, 5: { cellWidth: 48, halign: "right" } },
        7.5
      );
      inlineNote(
        "Every row read from the file is used here, including rows later set aside as repeated. " +
        "A verified statement means the file's balances agree with its own transactions — not that the period is reconciled."
      );
    }

    sectionHeading("Source coverage", coverageSubtitle(sum), 40);
    for (const note of sum.coverage) inlineNote(`• ${note}`);
    y += 10;
  }

  // ==================================================================
  // SECTION: MATCHED TRANSACTIONS (pairs, then grouped matches)
  // ==================================================================
  if (model.matchedLines.length > 0) {
    const pairs = model.buckets.acceptedPairs.length;
    const grouped = model.buckets.acceptedComposites.length;
    sectionHeading(
      "Matched transactions",
      grouped === 0
        ? `${plural(pairs, "pair")} — amounts and dates line up on both sides`
        : `${plural(pairs, "pair")} and ${plural(grouped, "grouped match", "grouped matches")} — amounts line up on both sides`
    );

    ensureSpace(Math.min(model.matchedLines.length, 6) * 22 + 30);
    autoTable(doc, {
      startY: y,
      head: [["Bank date", "Bank description", "Bank amount", "Books date", "Books description", "Books amount"]],
      body: model.matchedLines.map((l) => [
        l.bankDate,
        withSource(l.bankDescription, l.bankSource),
        l.bankAmount,
        l.booksDate,
        withSource(l.booksDescription, l.booksSource),
        l.booksAmount,
      ]),
      margin: { left: ML, right: 48 },
      tableWidth: CW,
      styles: {
        font: "helvetica",
        fontSize: 8.5,
        cellPadding: { top: 4, bottom: 4, left: 6, right: 6 },
        textColor: C.ink,
        lineColor: C.line,
        lineWidth: 0.3,
      },
      headStyles: {
        fillColor: C.headBg,
        textColor: C.ink2,
        fontStyle: "bold",
        fontSize: 8,
      },
      columnStyles: {
        2: { halign: "right", cellWidth: 65 },
        5: { halign: "right", cellWidth: 65 },
      },
      alternateRowStyles: { fillColor: C.white },
      didParseCell(data) {
        if (data.section !== "body") return;
        const kind = model.matchedLines[data.row.index]?.kind;
        if (kind === "group") data.cell.styles.fontStyle = "bold";
        if (kind === "part" && data.column.index === 1) data.cell.styles.textColor = C.ink3;
      },
    });
    y = lastY() + 24;
  }

  // ==================================================================
  // SECTION: ON BANK STATEMENT BUT NOT IN RECORDS (unresolved)
  // ==================================================================
  sectionHeading(
    "On your bank statement but not in your records",
    plural(missingFromBooks.length, "item")
  );
  txnTable(missingFromBooks, "None — every bank transaction has a matching entry in your records.");

  // ==================================================================
  // SECTION: ADDED TO YOUR RECONCILIATION (user-added, to be recorded)
  // ==================================================================
  if (added.length > 0) {
    sectionHeading(
      "Added to your reconciliation",
      `${plural(added.length, "item")} — to be recorded in your books`
    );
    inlineNote(
      "These bank transactions are included in this reconciliation so your report is complete. " +
      "You or your accountant will need to record them in your books."
    );
    txnTable(added, "", C.noteBg);
  }

  // ==================================================================
  // SECTION: IN RECORDS BUT NOT YET CLEARED (unacknowledged)
  // ==================================================================
  sectionHeading(
    "In your records but not yet cleared by your bank",
    plural(missingFromBank.length, "item")
  );
  txnTable(missingFromBank, "None — every entry in your records has cleared the bank.");

  // ==================================================================
  // SECTION: MARKED AS OUTSTANDING (acknowledged — timing only)
  // ==================================================================
  if (acknowledged.length > 0) {
    sectionHeading(
      "Marked as outstanding — known timing difference",
      plural(acknowledged.length, "item")
    );
    inlineNote(
      "These are in your records but your bank hasn't processed them yet. " +
      "This is a normal timing difference — no action needed."
    );
    txnTable(acknowledged, "", C.noteBg);
  }

  // ==================================================================
  // SECTION: POSSIBLE MATCHES (pairs, then grouped suggestions)
  // ==================================================================
  if (model.reviewLines.length > 0) {
    const pairs = model.buckets.reviewPairs.length;
    const grouped = model.buckets.reviewComposites.length;
    sectionHeading(
      "Possible matches we weren't sure about",
      grouped === 0
        ? `${plural(pairs, "pair")} — amounts are close but something didn't line up exactly`
        : `${plural(pairs, "pair")} and ${plural(grouped, "grouped match", "grouped matches")} — not confirmed`
    );

    ensureSpace(Math.min(model.reviewLines.length, 5) * 28 + 30);
    autoTable(doc, {
      startY: y,
      head: [["Bank", "Books", "Amount", "Note"]],
      body: model.reviewLines.map((l) =>
        l.kind === "part"
          ? [
              l.bankDescription,
              withSource(`${l.booksDate}  ${l.booksDescription}`, l.booksSource),
              l.booksAmount,
              "",
            ]
          : [
              withSource(`${l.bankDate}  ${l.bankDescription}`, l.bankSource),
              l.kind === "group"
                ? l.booksDescription
                : withSource(`${l.booksDate}  ${l.booksDescription}`, l.booksSource),
              l.bankAmount,
              l.note,
            ]
      ),
      margin: { left: ML, right: 48 },
      tableWidth: CW,
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: { top: 5, bottom: 5, left: 8, right: 8 },
        textColor: C.ink,
        lineColor: C.line,
        lineWidth: 0.3,
      },
      headStyles: {
        fillColor: C.headBg,
        textColor: C.ink2,
        fontStyle: "bold",
        fontSize: 8.5,
      },
      columnStyles: {
        2: { halign: "right", cellWidth: 70 },
        3: { cellWidth: 160, textColor: C.ink3, fontSize: 8.5 },
      },
      alternateRowStyles: { fillColor: C.white },
      didParseCell(data) {
        if (data.section !== "body") return;
        const kind = model.reviewLines[data.row.index]?.kind;
        if (kind === "group" && data.column.index < 3) data.cell.styles.fontStyle = "bold";
        if (kind === "part" && data.column.index === 0) data.cell.styles.textColor = C.ink3;
      },
    });
    y = lastY() + 24;
  }

  // ==================================================================
  // SECTIONS: REPEATED ROWS (set aside / possible duplicates)
  // ==================================================================
  const duplicateTable = (lines: DuplicateLine[], rowBg?: [number, number, number]) => {
    ensureSpace(Math.min(lines.length, 4) * 34 + 30);
    autoTable(doc, {
      startY: y,
      head: [["Side", "Date", "Description", "Amount", "Why it is listed"]],
      body: lines.map((l) => [
        l.side,
        l.date,
        withSource(l.description, l.source),
        l.amount,
        `${l.status}. ${l.reason}`,
      ]),
      margin: { left: ML, right: 48 },
      tableWidth: CW,
      styles: {
        font: "helvetica",
        fontSize: 8.5,
        cellPadding: { top: 4, bottom: 4, left: 6, right: 6 },
        textColor: C.ink,
        lineColor: C.line,
        lineWidth: 0.3,
      },
      headStyles: {
        fillColor: C.headBg,
        textColor: C.ink2,
        fontStyle: "bold",
        fontSize: 8,
      },
      columnStyles: {
        0: { cellWidth: 38 },
        1: { cellWidth: 62 },
        3: { halign: "right", cellWidth: 62 },
        4: { cellWidth: 190, textColor: C.ink3, fontSize: 8 },
      },
      alternateRowStyles: { fillColor: rowBg ?? C.white },
      ...(rowBg ? { bodyStyles: { fillColor: rowBg } } : {}),
    });
    y = lastY() + 24;
  };

  if (model.setAsideLines.length > 0) {
    sectionHeading(
      "Rows set aside as repeated",
      `${plural(model.setAsideLines.length, "row")} — imported, but not part of this reconciliation`
    );
    inlineNote(
      "These rows were uploaded but are not counted above, because the same row was imported more than once. " +
      "They are listed so nothing is hidden; each can be restored in Reconly."
    );
    duplicateTable(model.setAsideLines, C.noteBg);
  }

  if (model.possibleDuplicateLines.length > 0) {
    sectionHeading(
      "Possible duplicates still included",
      `${plural(model.possibleDuplicateLines.length, "row")} — counted above, not confirmed either way`
    );
    inlineNote(
      "These rows ARE counted in this reconciliation. They look like they may be the same row imported twice, " +
      "but the files do not prove it, so nothing was set aside."
    );
    duplicateTable(model.possibleDuplicateLines);
  }

  if (model.reviewedSeparateLines.length > 0) {
    sectionHeading(
      "Reviewed and retained — confirmed as separate",
      `${plural(model.reviewedSeparateLines.length, "row")} — counted above`
    );
    inlineNote(
      "These rows looked like possible duplicates. They were reviewed in Reconly and confirmed as separate, " +
      "legitimate transactions, so all of them are kept and counted in this reconciliation."
    );
    duplicateTable(model.reviewedSeparateLines);
  }

  // ==================================================================
  // DISCLAIMER — printed on last page, after all content
  // ==================================================================
  ensureSpace(64);
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.5);
  doc.line(ML, y, MR, y);
  y += 14;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...C.ink3);
  doc.text("About this report", ML, y);
  y += 12;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...C.ink3);
  const disclaimerText =
    "Reconly helps you check whether your records match your bank. " +
    "It is not accounting or tax advice. " +
    "For decisions about how to record transactions or file taxes, consult a qualified accountant.";
  const lines = doc.splitTextToSize(disclaimerText, CW);
  doc.text(lines, ML, y);

  // ==================================================================
  // PAGE FOOTERS (page n of N)
  // ==================================================================
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...C.ink3);
    doc.text(
      `${ctx.accountName}  ·  ${formatPeriod(ctx.periodStart, ctx.periodEnd)}`,
      ML,
      PH - 24
    );
    doc.text(`Page ${i} of ${totalPages}`, MR, PH - 24, { align: "right" });
  }

  return doc;
}
