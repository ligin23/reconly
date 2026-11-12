/**
 * RECON-010 — PDF layout. The account title used to be drawn on one line
 * with no width limit (running off the page), and the running footer printed
 * the full title on the same baseline as the right-aligned "Page n of N", so
 * long titles drew one string on top of the other.
 *
 * These tests read the generated PDF's own text operators (font, size,
 * position, line advance) and measure every string with jsPDF's font metrics:
 *   - every string lies inside the 48pt page margins
 *   - no two strings on the same baseline overlap horizontally
 * Visual inspection of rendered pages is done separately; this guards the
 * geometry automatically.
 */
import { describe, it, expect } from "vitest";
import { jsPDF } from "jspdf";
import { reconcile } from "@/lib/recon";
import { decideCompositeOnce, decideMatchOnce } from "@/lib/recon/decisions";
import { activeTxns } from "@/lib/import/duplicates";
import { verifyStatements } from "@/lib/review/statements";
import { buildMonthReview } from "@/lib/review/months";
import { buildPdfDocument, fitWidth, wrapAndClamp } from "@/lib/export/pdf-report";
import type { ExportContext } from "@/lib/export/buckets";
import { runDemoPipeline } from "@/lib/demo/__tests__/pipeline";

const PAGE_W = 612;
const MARGIN = 48;
const LONG =
  "Northwind Community Arts Collective — Operating Account (Business Checking ••••4821) — Fiscal Year Reconciliation for the Board Treasurer and External Auditor Review";
const UNBROKEN = "Account" + "X".repeat(140); // one "word" wider than the page

// ---- contexts ---------------------------------------------------------

const demo = runDemoPipeline();
function demoCtx(accountName: string, opts: { decideAll?: boolean; review?: boolean } = {}): ExportContext {
  const bank = activeTxns(demo.imported.bank, demo.dupState);
  const ledger = activeTxns(demo.imported.ledger, demo.dupState);
  const result = reconcile(bank, ledger);
  let matches = result.matches;
  let composites = result.compositeMatches;
  if (opts.decideAll) {
    for (const m of matches) matches = decideMatchOnce(matches, m.id, "accept");
    for (const c of composites) if (!c.ambiguous) composites = decideCompositeOnce(composites, c.id, "accept");
  }
  const statements = verifyStatements(demo.imported.bank, demo.sourceFiles);
  const months = buildMonthReview({
    statementReview: statements, imported: demo.imported, bankTxns: bank, ledgerTxns: ledger,
    matches, compositeMatches: composites, addedBankIds: new Set(), acknowledgedLedgerIds: new Set(),
    duplicateGroups: demo.groups, duplicateState: demo.dupState, sourceFiles: demo.sourceFiles,
  });
  return {
    accountName, periodStart: "2026-01-02", periodEnd: "2026-03-31",
    openingBalance: null, closingBalance: null, reconciled: false,
    unexplainedDifference: result.balanceProof.unexplainedDifference,
    bankTxns: bank, ledgerTxns: ledger, matches, compositeMatches: composites,
    userAddedEntries: [], acknowledgedBankIds: [],
    ...(opts.review === false ? {} : { review: { months, statements } }),
    duplicates: { allBankTxns: demo.imported.bank, allLedgerTxns: demo.imported.ledger, groups: demo.groups, state: demo.dupState },
  };
}

// ---- reading the PDF's text geometry ---------------------------------

type Run = { page: number; text: string; x: number; y: number; w: number; size: number };

/** WinAnsi bytes back to text (only the high bytes jsPDF emits here). */
const WINANSI: Record<number, string> = { 0x85: "…", 0x95: "•", 0x96: "–", 0x97: "—", 0xb7: "·" };
const decode = (s: string) =>
  s.replace(/\\([()\\])/g, "$1").replace(/[\x80-\xff]/g, (c) => WINANSI[c.charCodeAt(0)] ?? c);

function textRuns(pdf: string): Run[] {
  // Font resource id (F1, F2, …) → [family, style], for measuring.
  const measure = new jsPDF({ unit: "pt", format: "letter" });
  const fontById = new Map<string, [string, string]>();
  for (const [family, styles] of Object.entries(measure.getFontList())) {
    for (const style of styles) {
      measure.setFont(family, style);
      fontById.set(String(measure.getFont().id), [family, style]); // "F1", "F2", … at runtime
    }
  }
  const runs: Run[] = [];
  const pages = pdf.split(/\/Type \/Page\b(?!s)/).slice(1);
  pages.forEach((page, p) => {
    const stream = page.slice(page.indexOf("stream"), page.indexOf("endstream"));
    for (const block of stream.matchAll(/BT\n([\s\S]*?)\nET/g)) {
      const b = block[1];
      const font = b.match(/\/(F\d+) ([\d.]+) Tf/);
      const td = b.match(/([-\d.]+) ([-\d.]+) Td/);
      if (!font || !td) continue;
      const tl = Number(b.match(/([\d.]+) TL/)?.[1] ?? 0);
      const [family, style] = fontById.get(font[1])!;
      const size = Number(font[2]);
      measure.setFont(family, style);
      measure.setFontSize(size);
      let y = Number(td[2]);
      let first = true;
      for (const m of b.matchAll(/(T\* )?\(((?:\\.|[^\\)])*)\) Tj/g)) {
        if (!first || m[1]) y -= m[1] ? tl : 0;
        first = false;
        const text = decode(m[2]);
        runs.push({ page: p + 1, text, x: Number(td[1]), y, w: measure.getTextWidth(text), size });
      }
    }
  });
  return runs;
}

function layoutProblems(runs: Run[]): string[] {
  const out: string[] = [];
  for (const r of runs) {
    if (r.x < MARGIN - 0.5 || r.x + r.w > PAGE_W - MARGIN + 0.5) {
      out.push(`p${r.page} outside margins: "${r.text.slice(0, 50)}" x=${r.x.toFixed(1)}..${(r.x + r.w).toFixed(1)}`);
    }
  }
  const byLine = new Map<string, Run[]>();
  for (const r of runs) {
    const k = `${r.page}:${r.y.toFixed(1)}`;
    byLine.set(k, [...(byLine.get(k) ?? []), r]);
  }
  for (const line of byLine.values()) {
    const sorted = [...line].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1];
      const b = sorted[i];
      if (a.x + a.w > b.x + 0.5) out.push(`p${a.page} overlap: "${a.text.slice(0, 40)}" runs into "${b.text.slice(0, 40)}"`);
    }
  }
  return out;
}

const render = async (ctx: ExportContext) => (await buildPdfDocument(ctx)).output();

// ---- tests ------------------------------------------------------------

describe("RECON-010 — every string stays inside the margins and nothing overlaps", () => {
  it.each([
    ["advanced demo, undecided", demoCtx("Sample data — Cedar & Co. Creative Studio (fictional)")],
    ["advanced demo, all decided (composites, duplicates, statement findings)", demoCtx("Sample data — Cedar & Co. Creative Studio (fictional)", { decideAll: true })],
    ["long account title", demoCtx(LONG)],
    ["long title, no executive summary", demoCtx(LONG, { review: false })],
    ["one unbroken over-long word", demoCtx(UNBROKEN)],
    ["short title", demoCtx("Acme")],
  ])("%s", async (_label, ctx) => {
    const runs = textRuns(await render(ctx));
    expect(runs.length).toBeGreaterThan(100); // the parser really read the pages
    expect(layoutProblems(runs)).toEqual([]);
  });

  it("the parser does detect the old defects (a title drawn past the margin, a footer collision)", () => {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    doc.setFont("helvetica", "bold").setFontSize(22);
    doc.text(LONG, 48, 100);
    doc.setFont("helvetica", "normal").setFontSize(8);
    doc.text(`${LONG}  ·  Jan 2 – Mar 31, 2026`, 48, 768);
    doc.text("Page 1 of 6", 564, 768, { align: "right" });
    const problems = layoutProblems(textRuns(doc.output()));
    expect(problems.some((p) => p.includes("outside margins"))).toBe(true);
    expect(problems.some((p) => p.includes("overlap"))).toBe(true);
  });
});

describe("RECON-010 — the title is wrapped, never lost", () => {
  it("a long title wraps to at most three lines and the full name is still in the report", async () => {
    const runs = textRuns(await render(demoCtx(LONG)));
    const title = runs.filter((r) => r.page === 1 && r.size === 22);
    expect(title.length).toBe(3);
    expect(title[2].text.endsWith("…")).toBe(true);
    // Executive summary "Account" row carries the whole name (wrapped in its cell).
    const page1 = runs.filter((r) => r.page === 1).map((r) => r.text).join(" ");
    expect(page1.replace(/\s+/g, " ")).toContain(LONG);
  });

  it("with no executive summary, a shortened title is printed in full under the header", async () => {
    const runs = textRuns(await render(demoCtx(LONG, { review: false })));
    const page1 = runs.filter((r) => r.page === 1).map((r) => r.text).join(" ").replace(/\s+/g, " ");
    expect(page1).toContain(`Account: ${LONG}`);
  });

  it("a short title is unchanged: one line, no ellipsis", async () => {
    const runs = textRuns(await render(demoCtx("Acme")));
    const title = runs.filter((r) => r.page === 1 && r.size === 22);
    expect(title.map((r) => r.text)).toEqual(["Acme"]);
  });

  it("every footer keeps the period and the page number whole", async () => {
    const runs = textRuns(await render(demoCtx(LONG)));
    const footers = runs.filter((r) => r.size === 8 && r.y < 40);
    const pages = Math.max(...runs.map((r) => r.page));
    expect(footers.filter((r) => /^Page \d+ of \d+$/.test(r.text))).toHaveLength(pages);
    for (const f of footers.filter((r) => !r.text.startsWith("Page "))) {
      expect(f.text.endsWith("·  Jan 2 – Mar 31, 2026")).toBe(true);
      expect(f.text).toContain("…");
    }
  });
});

describe("fitWidth / wrapAndClamp", () => {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFont("helvetica", "bold").setFontSize(22);

  it("returns text unchanged when it fits; otherwise ends in … within the width", () => {
    expect(fitWidth(doc, "Acme", 200)).toBe("Acme");
    const cut = fitWidth(doc, LONG, 200);
    expect(cut.endsWith("…")).toBe(true);
    expect(doc.getTextWidth(cut)).toBeLessThanOrEqual(200);
    expect(LONG.startsWith(cut.slice(0, -1).trimEnd())).toBe(true);
  });

  it("wraps within the width and clamps to the line limit", () => {
    const { lines, truncated } = wrapAndClamp(doc, LONG, 516, 3);
    expect(truncated).toBe(true);
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(doc.getTextWidth(l)).toBeLessThanOrEqual(516);
    const short = wrapAndClamp(doc, "Sample data — Cedar & Co. Creative Studio (fictional)", 516, 3);
    expect(short.truncated).toBe(false);
    expect(short.lines.join(" ")).toBe("Sample data — Cedar & Co. Creative Studio (fictional)");
  });
});
