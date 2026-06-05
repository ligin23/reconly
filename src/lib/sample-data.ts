// Reconly sample data — freelance designer persona.
// Plain-English copy. Money stored in cents to avoid float drift.
// Field names and shapes match the prototype exactly so screens render
// against this without rewiring. The engine (Phase 2) will produce these
// same shapes.

export type TxnType = "in" | "out";

export type SimpleTxn = {
  date: string;
  desc: string;
  who: string;
  amount: number; // cents (positive); direction carried by `type`
  type: TxnType;
};

export type MissingTxn = SimpleTxn & {
  hint: string;
};

export type ReviewReason = {
  ok: boolean;
  text: string;
};

export type ReviewSide = {
  date: string;
  desc: string;
  sub: string;
};

export type ReviewItem = {
  id: string;
  confidence: number;
  amount: number; // cents (positive)
  type: TxnType;
  bank: ReviewSide;
  books: ReviewSide;
  reasons: ReviewReason[];
};

export type Account = {
  name: string;
  bank: string;
  last4: string;
  period: string;
  periodRange: string;
};

export type FileMeta = {
  name: string;
  size: string;
  rows: number;
};

export type Counts = {
  matched: number;
  review: number;
  missingFromBooks: number;
  missingFromBank: number;
};

export type ReconData = {
  account: Account;
  files: { bank: FileMeta; ledger: FileMeta };
  matched: SimpleTxn[];
  matchedExtraCount: number;
  review: ReviewItem[];
  missingFromBooks: MissingTxn[];
  missingFromBank: MissingTxn[];
  counts: Counts;
  unexplained: number; // cents
};

/** Format a signed-cents amount the way the UI shows it. */
export function money(cents: number): string {
  const neg = cents < 0;
  const v = Math.abs(cents) / 100;
  const s = v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (neg ? "−$" : "$") + s; // unicode minus for out
}

const account: Account = {
  name: "Everyday Checking",
  bank: "Cedar Mutual",
  last4: "4471",
  period: "March 2026",
  periodRange: "Mar 1 – Mar 31, 2026",
};

const files = {
  bank: { name: "cedar-checking-mar2026.csv", size: "48 KB", rows: 138 },
  ledger: { name: "my-books-march.csv", size: "31 KB", rows: 130 },
};

const matched: SimpleTxn[] = [
  { date: "Mar 28", desc: "Figma — annual plan", who: "Figma", amount: 14400, type: "out" },
  { date: "Mar 27", desc: "Client payment — Harborline", who: "Harborline Co.", amount: 320000, type: "in" },
  { date: "Mar 25", desc: "Adobe Creative Cloud", who: "Adobe", amount: 5999, type: "out" },
  { date: "Mar 22", desc: "Coffee — Plain & Co.", who: "Plain & Co.", amount: 640, type: "out" },
  { date: "Mar 20", desc: "Client payment — Brightfox", who: "Brightfox", amount: 180000, type: "in" },
  { date: "Mar 19", desc: "Notion — yearly", who: "Notion Labs", amount: 9600, type: "out" },
  { date: "Mar 18", desc: "Train ticket — client visit", who: "Rail Co.", amount: 4200, type: "out" },
  { date: "Mar 15", desc: "Webflow hosting", who: "Webflow", amount: 2300, type: "out" },
  { date: "Mar 14", desc: "Lunch — studio meeting", who: "Greenhouse Cafe", amount: 3180, type: "out" },
  { date: "Mar 12", desc: "Client payment — Maple & Vine", who: "Maple & Vine", amount: 95000, type: "in" },
  { date: "Mar 11", desc: "Domain renewal", who: "Hover", amount: 1800, type: "out" },
  { date: "Mar 08", desc: "Co-working — March desk", who: "The Annex", amount: 22000, type: "out" },
];

const matchedExtraCount = 112; // total matched = 124

const review: ReviewItem[] = [
  {
    id: "r1",
    confidence: 94,
    amount: 4800,
    type: "out",
    bank: { date: "Mar 24", desc: "SQUARESPACE INC", sub: "Card • Mar 24" },
    books: { date: "Mar 22", desc: "Squarespace subscription", sub: "Logged Mar 22" },
    reasons: [
      { ok: true, text: "Amounts match exactly ($48.00)" },
      { ok: false, text: "Dates differ by 2 days" },
      { ok: true, text: "Names look like the same company" },
    ],
  },
  {
    id: "r2",
    confidence: 88,
    amount: 12500,
    type: "in",
    bank: { date: "Mar 21", desc: "DEPOSIT — OAKWELL DESIGN", sub: "Transfer • Mar 21" },
    books: { date: "Mar 21", desc: "Invoice #204 — Oakwell", sub: "Logged Mar 19" },
    reasons: [
      { ok: true, text: "Amounts match exactly ($125.00)" },
      { ok: true, text: "Both happened the same week" },
      { ok: false, text: "Wording is quite different" },
    ],
  },
  {
    id: "r3",
    confidence: 79,
    amount: 2600,
    type: "out",
    bank: { date: "Mar 17", desc: "UBER *EATS", sub: "Card • Mar 17" },
    books: { date: "Mar 17", desc: "Team dinner", sub: "Logged Mar 17" },
    reasons: [
      { ok: true, text: "Same day" },
      { ok: false, text: "Amount is off by $2.00 (tip?)" },
      { ok: false, text: "Names don't obviously match" },
    ],
  },
  {
    id: "r4",
    confidence: 91,
    amount: 7900,
    type: "out",
    bank: { date: "Mar 13", desc: "GOOGLE *WORKSPACE", sub: "Card • Mar 13" },
    books: { date: "Mar 13", desc: "Google Workspace", sub: "Logged Mar 13" },
    reasons: [
      { ok: true, text: "Amounts match exactly ($79.00)" },
      { ok: true, text: "Same day" },
      { ok: false, text: "Logged twice — possible duplicate" },
    ],
  },
  {
    id: "r5",
    confidence: 85,
    amount: 5400,
    type: "out",
    bank: { date: "Mar 10", desc: "DRIBBBLE PRO", sub: "Card • Mar 10" },
    books: { date: "Mar 09", desc: "Dribbble yearly", sub: "Logged Mar 09" },
    reasons: [
      { ok: true, text: "Amounts match exactly ($54.00)" },
      { ok: false, text: "Dates differ by 1 day" },
      { ok: true, text: "Names look like the same company" },
    ],
  },
  {
    id: "r6",
    confidence: 73,
    amount: 16000,
    type: "in",
    bank: { date: "Mar 07", desc: "ZELLE FROM J. PARK", sub: "Transfer • Mar 07" },
    books: { date: "Mar 05", desc: "Deposit — Parkside logo", sub: "Logged Mar 05" },
    reasons: [
      { ok: true, text: "Amounts match exactly ($160.00)" },
      { ok: false, text: "Dates differ by 2 days" },
      { ok: false, text: "Hard to tell if it's the same client" },
    ],
  },
  {
    id: "r7",
    confidence: 96,
    amount: 1200,
    type: "out",
    bank: { date: "Mar 04", desc: "AWS", sub: "Card • Mar 04" },
    books: { date: "Mar 04", desc: "Amazon Web Services", sub: "Logged Mar 04" },
    reasons: [
      { ok: true, text: "Amounts match exactly ($12.00)" },
      { ok: true, text: "Same day" },
      { ok: true, text: "Names look like the same company" },
    ],
  },
  {
    id: "r8",
    confidence: 81,
    amount: 8800,
    type: "out",
    bank: { date: "Mar 02", desc: "LINKEDIN PREMIUM", sub: "Card • Mar 02" },
    books: { date: "Mar 01", desc: "LinkedIn (career)", sub: "Logged Mar 01" },
    reasons: [
      { ok: true, text: "Amounts match exactly ($88.00)" },
      { ok: false, text: "Dates differ by 1 day" },
      { ok: false, text: "Might be a personal expense" },
    ],
  },
];

const missingFromBooks: MissingTxn[] = [
  { date: "Mar 29", desc: "Monthly account fee", who: "Cedar Mutual", amount: 3500, type: "out", hint: "A $35 bank fee that isn't in your books yet." },
  { date: "Mar 23", desc: "Card foreign-use fee", who: "Cedar Mutual", amount: 410, type: "out", hint: "Small fee from an overseas charge." },
  { date: "Mar 16", desc: "Interest earned", who: "Cedar Mutual", amount: 120, type: "in", hint: "A little interest the bank paid you." },
  { date: "Mar 06", desc: "Returned payment fee", who: "Cedar Mutual", amount: 1500, type: "out", hint: "Charged when a payment bounced." },
];

const missingFromBank: MissingTxn[] = [
  { date: "Mar 30", desc: "Check #112 — illustrator", who: "Sam Okafor", amount: 45000, type: "out", hint: "You wrote this check, but it hasn't cleared the bank yet." },
  { date: "Mar 28", desc: "Check #113 — print run", who: "Press Bros.", amount: 28000, type: "out", hint: "Written, but the bank hasn't taken it yet." },
];

export const sampleData: ReconData = {
  account,
  files,
  matched,
  matchedExtraCount,
  review,
  missingFromBooks,
  missingFromBank,
  counts: {
    matched: 124,
    review: review.length,
    missingFromBooks: missingFromBooks.length,
    missingFromBank: missingFromBank.length,
  },
  unexplained: 3500, // $35.00 bank fee
};
