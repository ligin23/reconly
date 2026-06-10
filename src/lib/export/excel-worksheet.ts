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

import type { Match, Txn, AnyCompositeMatch } from "@/lib/recon/types";
import type { UserAddedEntry } from "@/lib/sample-data";
import { formatPeriod } from "@/lib/data/utils";

export type ExcelExportContext = {
  accountName: string;
  periodStart: string; // ISO yyyy-mm-dd
  periodEnd: string;   // ISO yyyy-mm-dd
  openingBalance: number | null; // cents
  closingBalance: number | null; // cents
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

/** Derive attention buckets — mirrors pdf-report.ts deriveBuckets. */
function deriveBuckets(ctx: ExcelExportContext) {
  const {
    matches, compositeMatches, bankTxns, ledgerTxns,
    userAddedEntries, acknowledgedBankIds,
  } = ctx;

  const acceptedBankIds = new Set<string>();
  const acceptedLedgerIds = new Set<string>();
  const suggestedBankIds = new Set<string>();
  const suggestedLedgerIds = new Set<string>();

  const acceptedPairs: Array<{ bankTxn: Txn; ledgerTxn: Txn }> = [];
  const reviewPairs: Array<{ bankTxn: Txn; ledgerTxn: Txn; reasons: string[] }> = [];

  for (const m of matches) {
    const bank = bankTxns.find((t) => t.id === m.bankTxnId);
    const ledger = ledgerTxns.find((t) => t.id === m.ledgerTxnId);
    if (!bank || !ledger) continue;

    if (m.status === "accepted" || m.status === "manual") {
      acceptedBankIds.add(m.bankTxnId);
      acceptedLedgerIds.add(m.ledgerTxnId);
      acceptedPairs.push({ bankTxn: bank, ledgerTxn: ledger });
    } else if (m.status === "suggested") {
      suggestedBankIds.add(m.bankTxnId);
      suggestedLedgerIds.add(m.ledgerTxnId);
      reviewPairs.push({ bankTxn: bank, ledgerTxn: ledger, reasons: m.reasons });
    }
    // rejected → falls to unmatched
  }

  // Accepted composite matches
  for (const c of compositeMatches) {
    if (c.status === "accepted") {
      acceptedBankIds.add(c.bankTxnId);
      for (const id of c.ledgerTxnIds) acceptedLedgerIds.add(id);
    } else if (c.status === "suggested") {
      suggestedBankIds.add(c.bankTxnId);
      for (const id of c.ledgerTxnIds) suggestedLedgerIds.add(id);
    }
  }

  const allMissingFromBooks = bankTxns.filter(
    (t) => !acceptedBankIds.has(t.id) && !suggestedBankIds.has(t.id)
  );

  const addedTxnIds = new Set(userAddedEntries.map((e) => e.txnId));
  const missingFromBooks = allMissingFromBooks.filter((t) => !addedTxnIds.has(t.id));

  const allMissingFromBank = ledgerTxns.filter(
    (t) => !acceptedLedgerIds.has(t.id) && !suggestedLedgerIds.has(t.id)
  );

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

export async function downloadExcelWorksheet(
  ctx: ExcelExportContext
): Promise<void> {
  const XLSX = (await import("xlsx-js-style")).default;

  const wb = XLSX.utils.book_new();
  const wsData: XlsxCell[][] = [];

  const row = (...cells: XlsxCell[]) => wsData.push(cells);

  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  const merge = (r: number, c1: number, c2: number) =>
    merges.push({ s: { r, c: c1 }, e: { r, c: c2 } });

  const {
    acceptedPairs,
    reviewPairs,
    missingFromBooks,
    addedToReconciliation,
    missingFromBank,
    acknowledgedBank,
  } = deriveBuckets(ctx);

  const periodLabel = formatPeriod(ctx.periodStart, ctx.periodEnd);
  const verdictText = ctx.reconciled
    ? "Your records match your bank for this period."
    : `Your records and your bank differ by ${dollars(Math.abs(ctx.unexplainedDifference))} for this period.`;
  const verdictStyle = ctx.reconciled ? S.verdictGood : S.verdictWarn;

  const COLS = 6;
  const lastCol = COLS - 1;

  // ================================================================
  // ABOUT THIS REPORT block
  // ================================================================
  let r = 0;

  row(cell("About this report", S.reportTitle), ...Array(COLS - 1).fill(blank()));
  merge(r, 0, lastCol);
  r++;

  row(...Array(COLS).fill(blank()));
  r++;

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

  for (const [label, value] of kvRows) {
    row(
      cell(label, S.kvLabel),
      cell(value, S.kvValue),
      ...Array(COLS - 2).fill(blank())
    );
    r++;
  }

  row(...Array(COLS).fill(blank()));
  r++;

  row(cell(verdictText, verdictStyle), ...Array(COLS - 1).fill(blank(verdictStyle)));
  merge(r, 0, lastCol);
  r++;

  row(...Array(COLS).fill(blank()));
  r++;

  const disclaimerText =
    "Reconly helps you check whether your records match your bank. " +
    "It is not accounting or tax advice. " +
    "For decisions about how to record transactions or file taxes, consult a qualified accountant.";
  row(cell(disclaimerText, S.disclaimer), ...Array(COLS - 1).fill(blank(S.disclaimer)));
  merge(r, 0, lastCol);
  r++;

  row(...Array(COLS).fill(blank()));
  r++;

  // ================================================================
  // MATCHED TRANSACTIONS
  // ================================================================
  row(
    cell(`Matched transactions  (${acceptedPairs.length})`, S.sectionHead),
    ...Array(COLS - 1).fill(blank(S.sectionHead))
  );
  merge(r, 0, lastCol);
  r++;

  if (acceptedPairs.length === 0) {
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
    );
    r++;

    for (const { bankTxn, ledgerTxn } of acceptedPairs) {
      row(
        cell(shortDate(bankTxn.date),          S.data),
        cell(bankTxn.description,              S.data),
        numCell(dollars(bankTxn.amount),       S.amount),
        cell(shortDate(ledgerTxn.date),        S.data),
        cell(ledgerTxn.description,            S.data),
        numCell(dollars(ledgerTxn.amount),     S.amount),
      );
      r++;
    }
  }

  row(...Array(COLS).fill(blank()));
  r++;

  // ================================================================
  // NEEDS YOUR ATTENTION
  // ================================================================
  const totalAttention = missingFromBooks.length + missingFromBank.length + reviewPairs.length;
  const totalResolved = addedToReconciliation.length + acknowledgedBank.length;
  const totalSection = totalAttention + totalResolved;

  row(
    cell(`Needs your attention  (${totalAttention} item${totalAttention !== 1 ? "s" : ""})`, S.sectionHead),
    ...Array(COLS - 1).fill(blank(S.sectionHead))
  );
  merge(r, 0, lastCol);
  r++;

  // ---- Sub-group: on bank, not in records (unresolved) ----
  row(
    cell("On your bank statement but not in your records", S.subHead),
    ...Array(COLS - 1).fill(blank(S.subHead))
  );
  merge(r, 0, lastCol);
  r++;

  if (missingFromBooks.length === 0) {
    row(cell("None — every bank transaction has a matching entry in your records.", S.data), ...Array(COLS - 1).fill(blank()));
    r++;
  } else {
    row(
      cell("Date",        S.colHeader),
      cell("Description", S.colHeader),
      cell("Amount",      S.colHeader),
      blank(),
      blank(),
      blank(),
    );
    r++;
    for (const txn of missingFromBooks) {
      row(
        cell(shortDate(txn.date),      S.attentionData),
        cell(txn.description,          S.attentionData),
        numCell(dollars(txn.amount),   S.attentionAmount),
        blank(),
        blank(),
        blank(),
      );
      r++;
    }
  }

  row(...Array(COLS).fill(blank()));
  r++;

  // ---- Sub-group: added to reconciliation (resolved — to be recorded) ----
  if (addedToReconciliation.length > 0) {
    row(
      cell(
        `Added to your reconciliation — to be recorded in your books  (${addedToReconciliation.length})`,
        S.subHeadResolved
      ),
      ...Array(COLS - 1).fill(blank(S.subHeadResolved))
    );
    merge(r, 0, lastCol);
    r++;

    // Inline note
    const noteText =
      "These bank transactions are included in this reconciliation so your report is complete. " +
      "You or your accountant will need to record them in your books.";
    row(cell(noteText, S.note), ...Array(COLS - 1).fill(blank(S.note)));
    merge(r, 0, lastCol);
    r++;

    row(
      cell("Date",        S.colHeader),
      cell("Description", S.colHeader),
      cell("Amount",      S.colHeader),
      blank(),
      blank(),
      blank(),
    );
    r++;
    for (const entry of addedToReconciliation) {
      row(
        cell(shortDate(entry.date),      S.resolvedData),
        cell(entry.description,          S.resolvedData),
        numCell(dollars(entry.amount),   S.resolvedAmount),
        blank(),
        blank(),
        blank(),
      );
      r++;
    }

    row(...Array(COLS).fill(blank()));
    r++;
  }

  // ---- Sub-group: in records, not cleared (unresolved) ----
  row(
    cell("In your records but not yet cleared by your bank", S.subHead),
    ...Array(COLS - 1).fill(blank(S.subHead))
  );
  merge(r, 0, lastCol);
  r++;

  if (missingFromBank.length === 0) {
    row(cell("None — every entry in your records has cleared the bank.", S.data), ...Array(COLS - 1).fill(blank()));
    r++;
  } else {
    row(
      cell("Date",        S.colHeader),
      cell("Description", S.colHeader),
      cell("Amount",      S.colHeader),
      blank(),
      blank(),
      blank(),
    );
    r++;
    for (const txn of missingFromBank) {
      row(
        cell(shortDate(txn.date),      S.attentionData),
        cell(txn.description,          S.attentionData),
        numCell(dollars(txn.amount),   S.attentionAmount),
        blank(),
        blank(),
        blank(),
      );
      r++;
    }
  }

  row(...Array(COLS).fill(blank()));
  r++;

  // ---- Sub-group: marked as outstanding (resolved — timing only) ----
  if (acknowledgedBank.length > 0) {
    row(
      cell(
        `Marked as outstanding — known timing difference  (${acknowledgedBank.length})`,
        S.subHeadResolved
      ),
      ...Array(COLS - 1).fill(blank(S.subHeadResolved))
    );
    merge(r, 0, lastCol);
    r++;

    const noteText =
      "These are in your records but your bank hasn't processed them yet. " +
      "This is a normal timing difference — no action needed.";
    row(cell(noteText, S.note), ...Array(COLS - 1).fill(blank(S.note)));
    merge(r, 0, lastCol);
    r++;

    row(
      cell("Date",        S.colHeader),
      cell("Description", S.colHeader),
      cell("Amount",      S.colHeader),
      blank(),
      blank(),
      blank(),
    );
    r++;
    for (const txn of acknowledgedBank) {
      row(
        cell(shortDate(txn.date),      S.resolvedData),
        cell(txn.description,          S.resolvedData),
        numCell(dollars(txn.amount),   S.resolvedAmount),
        blank(),
        blank(),
        blank(),
      );
      r++;
    }

    row(...Array(COLS).fill(blank()));
    r++;
  }

  // ---- Sub-group: review items (possible matches) ----
  if (reviewPairs.length > 0) {
    row(
      cell("Possible matches — amounts are close but something didn't line up exactly", S.subHead),
      ...Array(COLS - 1).fill(blank(S.subHead))
    );
    merge(r, 0, lastCol);
    r++;

    row(
      cell("Bank date",        S.colHeader),
      cell("Bank description", S.colHeader),
      cell("Amount",           S.colHeader),
      cell("Books date",       S.colHeader),
      cell("Books description",S.colHeader),
      cell("Note",             S.colHeader),
    );
    r++;

    for (const { bankTxn, ledgerTxn, reasons } of reviewPairs) {
      row(
        cell(shortDate(bankTxn.date),      S.attentionData),
        cell(bankTxn.description,          S.attentionData),
        numCell(dollars(bankTxn.amount),   S.attentionAmount),
        cell(shortDate(ledgerTxn.date),    S.attentionData),
        cell(ledgerTxn.description,        S.attentionData),
        cell(
          reasons.join("; ") || "Amounts similar, dates differ",
          { ...S.attentionData, font: { sz: 9, italic: true, color: { rgb: MUTED_INK } } }
        ),
      );
      r++;
    }

    row(...Array(COLS).fill(blank()));
    r++;
  }

  // unused — suppress lint warning
  void totalSection;

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
  ];

  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  XLSX.utils.book_append_sheet(wb, ws, "Reconciliation");

  // ================================================================
  // Download
  // ================================================================
  const safeName = ctx.accountName.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  const period = `${ctx.periodStart}_${ctx.periodEnd}`;
  XLSX.writeFile(wb, `reconly-${safeName}-${period}.xlsx`);
}
