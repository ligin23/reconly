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

import type { Match, Txn, AnyCompositeMatch } from "@/lib/recon/types";
import type { UserAddedEntry } from "@/lib/sample-data";
import { formatPeriod } from "@/lib/data/utils";

export type PdfExportContext = {
  accountName: string;
  periodStart: string; // ISO yyyy-mm-dd
  periodEnd: string;   // ISO yyyy-mm-dd
  openingBalance: number | null; // cents; null when not yet saved
  closingBalance: number | null; // cents; null when not yet saved
  reconciled: boolean;
  unexplainedDifference: number; // cents
  bankTxns: Txn[];
  ledgerTxns: Txn[];
  matches: Match[];
  compositeMatches: AnyCompositeMatch[];
  /** Bank txns the user added to the working copy — will be recorded in books. */
  userAddedEntries: UserAddedEntry[];
  /** Ledger txn IDs the user has acknowledged as outstanding (not yet cleared). */
  acknowledgedBankIds: string[];
};

// ---- Internal helpers ------------------------------------------------

function dollars(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const s = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cents < 0 ? `($${s})` : `$${s}`;
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Derive attention buckets from match state + raw txn lists. */
function deriveBuckets(ctx: PdfExportContext) {
  const {
    matches, compositeMatches, bankTxns, ledgerTxns,
    userAddedEntries, acknowledgedBankIds,
  } = ctx;

  const acceptedBankIds = new Set<string>();
  const acceptedLedgerIds = new Set<string>();
  const suggestedBankIds = new Set<string>();
  const suggestedLedgerIds = new Set<string>();
  const acceptedPairs: Array<{ bankTxn: Txn; ledgerTxn: Txn; reasons: string[] }> = [];
  const reviewPairs: Array<{ bankTxn: Txn; ledgerTxn: Txn; reasons: string[] }> = [];

  for (const m of matches) {
    const bank = bankTxns.find((t) => t.id === m.bankTxnId);
    const ledger = ledgerTxns.find((t) => t.id === m.ledgerTxnId);
    if (!bank || !ledger) continue;

    if (m.status === "accepted" || m.status === "manual") {
      acceptedBankIds.add(m.bankTxnId);
      acceptedLedgerIds.add(m.ledgerTxnId);
      acceptedPairs.push({ bankTxn: bank, ledgerTxn: ledger, reasons: m.reasons });
    } else if (m.status === "suggested") {
      suggestedBankIds.add(m.bankTxnId);
      suggestedLedgerIds.add(m.ledgerTxnId);
      reviewPairs.push({ bankTxn: bank, ledgerTxn: ledger, reasons: m.reasons });
    }
    // rejected → fall through to unmatched
  }

  // Accepted composite matches: bank side + all ledger sides
  for (const c of compositeMatches) {
    if (c.status === "accepted") {
      acceptedBankIds.add(c.bankTxnId);
      for (const id of c.ledgerTxnIds) acceptedLedgerIds.add(id);
    } else if (c.status === "suggested") {
      suggestedBankIds.add(c.bankTxnId);
      for (const id of c.ledgerTxnIds) suggestedLedgerIds.add(id);
    }
  }

  // All unmatched bank txns
  const allMissingFromBooks = bankTxns.filter(
    (t) => !acceptedBankIds.has(t.id) && !suggestedBankIds.has(t.id)
  );

  // Split by whether user has added them to the reconciliation
  const addedTxnIds = new Set(userAddedEntries.map((e) => e.txnId));
  const missingFromBooks = allMissingFromBooks.filter((t) => !addedTxnIds.has(t.id));

  // All unmatched ledger txns
  const allMissingFromBank = ledgerTxns.filter(
    (t) => !acceptedLedgerIds.has(t.id) && !suggestedLedgerIds.has(t.id)
  );

  // Split by whether user has acknowledged them
  const acknowledgedSet = new Set(acknowledgedBankIds);
  const missingFromBank = allMissingFromBank.filter((t) => !acknowledgedSet.has(t.id));
  const acknowledgedBank = allMissingFromBank.filter((t) => acknowledgedSet.has(t.id));

  return {
    acceptedPairs,
    reviewPairs,
    missingFromBooks,
    addedToReconciliation: userAddedEntries,
    missingFromBank,
    acknowledgedBank,
  };
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

export async function downloadPdfReport(ctx: PdfExportContext): Promise<void> {
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
  const genLine = `Generated ${shortDate(new Date().toISOString().slice(0, 10))}`;
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
  const verdictText = ctx.reconciled
    ? "Your records match your bank for this period."
    : `Your records and your bank differ by ${dollars(Math.abs(ctx.unexplainedDifference))} for this period.`;

  doc.setFillColor(...bgColor);
  doc.roundedRect(ML, y, CW, 44, 4, 4, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...textColor);
  doc.text(verdictText, ML + 14, y + 27);
  y += 64;

  // ==================================================================
  // SUMMARY NUMBERS
  // ==================================================================
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...C.ink);
  doc.text("Summary", ML, y);
  y += 14;

  const {
    acceptedPairs,
    reviewPairs,
    missingFromBooks,
    addedToReconciliation,
    missingFromBank,
    acknowledgedBank,
  } = deriveBuckets(ctx);

  const summaryRows: string[][] = [
    ["Matched transactions", String(acceptedPairs.length)],
    ["On bank statement, not yet in your records", String(missingFromBooks.length)],
    ["Added to your reconciliation (to be recorded in your books)", String(addedToReconciliation.length)],
    ["In records, not yet cleared by bank", String(missingFromBank.length)],
    ["Marked as outstanding — known timing difference", String(acknowledgedBank.length)],
    ["Possible matches (not confirmed)", String(reviewPairs.length)],
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

  autoTable(doc, {
    startY: y,
    head: [],
    body: summaryRows,
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
      0: { cellWidth: CW * 0.65, fontStyle: "normal", textColor: C.ink2 },
      1: { cellWidth: CW * 0.35, halign: "right", fontStyle: "bold" },
    },
    alternateRowStyles: { fillColor: C.white },
    didParseCell(data) {
      const lastIdx = summaryRows.length - 1;
      if (data.row.index === lastIdx) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = ctx.reconciled ? C.good : C.warn;
      }
    },
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 32;

  // ==================================================================
  // HELPER: section heading
  // ==================================================================
  const sectionHeading = (title: string, subtitle?: string) => {
    ensureSpace(50);
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
    rows: Array<[string, string, string]>,
    emptyMsg: string,
    rowBg?: [number, number, number]
  ) => {
    if (rows.length === 0) {
      ensureSpace(30);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(10);
      doc.setTextColor(...C.ink3);
      doc.text(emptyMsg, ML + 10, y + 16);
      y += 30;
      return;
    }
    ensureSpace(rows.length * 22 + 20);
    autoTable(doc, {
      startY: y,
      head: [["Date", "Description", "Amount"]],
      body: rows,
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
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
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
  // SECTION: MATCHED TRANSACTIONS
  // ==================================================================
  if (acceptedPairs.length > 0) {
    sectionHeading(
      "Matched transactions",
      `${acceptedPairs.length} pair${acceptedPairs.length !== 1 ? "s" : ""} — amounts and dates line up on both sides`
    );

    ensureSpace(acceptedPairs.length * 22 + 30);
    autoTable(doc, {
      startY: y,
      head: [["Bank date", "Bank description", "Bank amount", "Books date", "Books description", "Books amount"]],
      body: acceptedPairs.map(({ bankTxn, ledgerTxn }) => [
        shortDate(bankTxn.date),
        bankTxn.description,
        dollars(bankTxn.amount),
        shortDate(ledgerTxn.date),
        ledgerTxn.description,
        dollars(ledgerTxn.amount),
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
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  }

  // ==================================================================
  // SECTION: ON BANK STATEMENT BUT NOT IN RECORDS (unresolved)
  // ==================================================================
  sectionHeading(
    "On your bank statement but not in your records",
    `${missingFromBooks.length} item${missingFromBooks.length !== 1 ? "s" : ""}`
  );
  txnTable(
    missingFromBooks.map((t) => [shortDate(t.date), t.description, dollars(t.amount)]),
    "None — every bank transaction has a matching entry in your records."
  );

  // ==================================================================
  // SECTION: ADDED TO YOUR RECONCILIATION (user-added, to be recorded)
  // ==================================================================
  if (addedToReconciliation.length > 0) {
    sectionHeading(
      "Added to your reconciliation",
      `${addedToReconciliation.length} item${addedToReconciliation.length !== 1 ? "s" : ""} — to be recorded in your books`
    );
    inlineNote(
      "These bank transactions are included in this reconciliation so your report is complete. " +
      "You or your accountant will need to record them in your books."
    );
    txnTable(
      addedToReconciliation.map((e) => [shortDate(e.date), e.description, dollars(e.amount)]),
      "",
      C.noteBg
    );
  }

  // ==================================================================
  // SECTION: IN RECORDS BUT NOT YET CLEARED (unacknowledged)
  // ==================================================================
  sectionHeading(
    "In your records but not yet cleared by your bank",
    `${missingFromBank.length} item${missingFromBank.length !== 1 ? "s" : ""}`
  );
  txnTable(
    missingFromBank.map((t) => [shortDate(t.date), t.description, dollars(t.amount)]),
    "None — every entry in your records has cleared the bank."
  );

  // ==================================================================
  // SECTION: MARKED AS OUTSTANDING (acknowledged — timing only)
  // ==================================================================
  if (acknowledgedBank.length > 0) {
    sectionHeading(
      "Marked as outstanding — known timing difference",
      `${acknowledgedBank.length} item${acknowledgedBank.length !== 1 ? "s" : ""}`
    );
    inlineNote(
      "These are in your records but your bank hasn't processed them yet. " +
      "This is a normal timing difference — no action needed."
    );
    txnTable(
      acknowledgedBank.map((t) => [shortDate(t.date), t.description, dollars(t.amount)]),
      "",
      C.noteBg
    );
  }

  // ==================================================================
  // SECTION: POSSIBLE MATCHES (REVIEW ITEMS)
  // ==================================================================
  if (reviewPairs.length > 0) {
    sectionHeading(
      "Possible matches we weren't sure about",
      `${reviewPairs.length} pair${reviewPairs.length !== 1 ? "s" : ""} — amounts are close but something didn't line up exactly`
    );

    ensureSpace(reviewPairs.length * 28 + 30);
    autoTable(doc, {
      startY: y,
      head: [["Bank", "Books", "Amount", "Note"]],
      body: reviewPairs.map(({ bankTxn, ledgerTxn, reasons }) => [
        `${shortDate(bankTxn.date)}  ${bankTxn.description}`,
        `${shortDate(ledgerTxn.date)}  ${ledgerTxn.description}`,
        dollars(bankTxn.amount),
        reasons.join("; ") || "Amounts similar, dates differ",
      ]),
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
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
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

  // ==================================================================
  // SAVE / TRIGGER DOWNLOAD
  // ==================================================================
  const safeName = ctx.accountName.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const period = `${ctx.periodStart}_${ctx.periodEnd}`;
  doc.save(`reconly-${safeName}-${period}.pdf`);
}
