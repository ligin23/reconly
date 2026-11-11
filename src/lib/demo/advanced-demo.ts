// ============================================================
// Reconly — advanced demo workspace (fictional data only)
//
// Describes the synthetic "Cedar & Co. Creative Studio" files in
// public/samples/advanced/ and the column mapping each one needs. The demo
// runs these files through the SAME import pipeline as real uploads
// (parser → combine → duplicate detection → matching engine → statement
// checks). Nothing here computes or hard-codes a result.
//
// The mappings below are exactly what Reconly's own column detection picks
// for these files (a test asserts this), plus the header row for files
// that start with statement title lines. They exist only so a first-time
// visitor is not asked to confirm seven column mappings.
// ============================================================

import type { CsvColumnMap } from "@/lib/parser";

export const ADVANCED_DEMO_BUSINESS = "Cedar & Co. Creative Studio";
export const ADVANCED_DEMO_PERIOD = "January – March 2026";
export const ADVANCED_DEMO_NOTICE = "Demo workspace — all financial data is fictional.";
/** Used as the account label in exports and as the prefix of any saved name. */
export const ADVANCED_DEMO_ACCOUNT_LABEL = `Sample data — ${ADVANCED_DEMO_BUSINESS} (fictional)`;

/** Where the demo CSVs are served from. */
export const ADVANCED_DEMO_BASE_PATH = "/samples/advanced/";

export type DemoFile = {
  side: "bank" | "ledger";
  name: string;
  /** 1-based line holding the column titles (lines above are statement titles). */
  headerRow: number;
  map: CsvColumnMap;
};

const BANK_MAP: CsvColumnMap = { date: "date", description: "description", amount: "amount" };
const LEDGER_MAP: CsvColumnMap = {
  date: "date",
  description: "description",
  amount: "amount",
  reference: "reference",
};

export const ADVANCED_DEMO_FILES: readonly DemoFile[] = [
  { side: "bank", name: "bank-jan-2026.csv", headerRow: 5, map: BANK_MAP },
  { side: "bank", name: "bank-feb-2026.csv", headerRow: 3, map: BANK_MAP },
  { side: "bank", name: "bank-mar-2026.csv", headerRow: 1, map: BANK_MAP },
  { side: "bank", name: "bank-feb-mar-overlap.csv", headerRow: 1, map: BANK_MAP },
  { side: "ledger", name: "ledger-jan-2026.csv", headerRow: 1, map: LEDGER_MAP },
  { side: "ledger", name: "ledger-feb-2026.csv", headerRow: 1, map: LEDGER_MAP },
  { side: "ledger", name: "ledger-mar-2026.csv", headerRow: 1, map: LEDGER_MAP },
];

/** The short tour shown in the "Explore features" panel. */
export type DemoTourStep = {
  id: string;
  title: string;
  text: string;
  /** Where the step's link goes: a section on the Results screen, the
   *  Review screen, or the Export menu. */
  target:
    | { kind: "section"; testId: string }
    /** A Results-screen tab to switch to, then scroll into view. */
    | { kind: "tab"; testId: string }
    | { kind: "review" }
    | { kind: "export" };
  action: string;
};

export const ADVANCED_DEMO_TOUR: readonly DemoTourStep[] = [
  {
    id: "months",
    title: "Multi-month Financial Review",
    text: "See which of January, February and March need attention.",
    target: { kind: "section", testId: "month-review" },
    action: "Show months",
  },
  {
    id: "duplicates",
    title: "Duplicate Detection",
    text: "Two bank exports overlap. See which repeated rows were set aside and which need your call.",
    target: { kind: "section", testId: "duplicates-panel" },
    action: "Show repeats",
  },
  {
    id: "statements",
    title: "Statement Verification",
    text: "One month checks out, one doesn't add up, one can't be fully checked.",
    target: { kind: "section", testId: "status-statements" },
    action: "Show statements",
  },
  {
    id: "review",
    title: "Transaction Review",
    text: "Accept or reject the matches Reconly wasn't sure about.",
    target: { kind: "review" },
    action: "Start reviewing",
  },
  {
    id: "sources",
    title: "Source Tracking",
    text: "Every row shows the file and line it came from — try the unmatched lists.",
    target: { kind: "tab", testId: "tab-missing-books" },
    action: "Show sources",
  },
  {
    id: "reports",
    title: "Financial Reports",
    text: "Download everything you found as a PDF or Excel file.",
    target: { kind: "export" },
    action: "Open export",
  },
];
