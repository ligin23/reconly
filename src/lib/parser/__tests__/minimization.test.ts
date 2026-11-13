/**
 * Phase 6A — CSV data minimization (Option A, new imports only).
 *
 * `Txn.raw` keeps only the mapped columns, the running-balance column and
 * every column duplicate / overlap detection, statement checks and the month
 * review read (IDs, references, balances, account columns). Other columns are
 * not kept. These tests rebuild each row's FULL original columns from the
 * file itself and prove every feature gives the same answer either way.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import Papa from "papaparse";
import { inspectCsv, parseCsvDetailed } from "@/lib/parser";
import { ADVANCED_DEMO_FILES } from "@/lib/demo/advanced-demo";
import { combineFiles, type ImportFileInput } from "@/lib/import/combine";
import {
  DUPLICATE_EVIDENCE_HEADERS,
  EMPTY_DUPLICATE_STATE,
  accountOf,
  detectDuplicates,
  fileOverlaps,
} from "@/lib/import/duplicates";
import { verifyStatements } from "@/lib/review/statements";
import { buildMonthReview } from "@/lib/review/months";
import { reconcile } from "@/lib/recon/engine";
import type { SourceFileInfo } from "@/lib/data/repository";
import type { Txn } from "@/lib/recon/types";

const ROOT = resolve(__dirname, "../../../..");

function csvFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? csvFiles(p) : n.endsWith(".csv") ? [p] : [];
  });
}
const ALL_FILES = [...csvFiles(join(ROOT, "tests/fixtures")), ...csvFiles(join(ROOT, "public/samples"))];

/** The full original columns of a row, read straight from the file. */
function fullRowsByLine(text: string, headerRow = 1): (line: number) => Record<string, string> {
  const lines = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false }).data;
  const headers = lines[headerRow - 1].map((h) => String(h).trim().toLowerCase());
  return (line) => {
    const cells = lines[line - 1];
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (cells[i] !== undefined) row[h] = cells[i];
    });
    return row;
  };
}

type FileInput = { name: string; content: string; headerRow: number; map?: ImportFileInput["map"] };

const withFullRaw = (txns: Txn[], files: Map<string, FileInput>): Txn[] =>
  txns.map((t) => {
    const f = files.get(t.sourceFile!)!;
    return { ...t, raw: fullRowsByLine(f.content, f.headerRow)(t.sourceLine!) };
  });

/** A file as the app would import it: header row detected as on the mapping screen. */
function fileFrom(path: string, extraColumns = false): FileInput {
  let content = readFileSync(path, "utf8");
  const headerRow = inspectCsv(content).suggestedHeaderRow ?? 1;
  if (extraColumns) content = addUnusedColumns(content, headerRow);
  return { name: relative(ROOT, path), content, headerRow };
}

/** Append two columns no feature uses ("Notes", "Category") to every row from the header down. */
function addUnusedColumns(text: string, headerRow: number): string {
  return text
    .split(/\r?\n/)
    .map((line, i) => {
      if (i + 1 < headerRow || line.trim() === "") return line;
      return i + 1 === headerRow ? `${line},Notes,Category` : `${line},"note ${i}",cat-${i % 3}`;
    })
    .join("\n");
}

const sideOf = (path: string): "bank" | "ledger" =>
  /ledger|books|records/i.test(path.split("/").pop()!) ? "ledger" : "bank";

function sourceFilesOf(c: ReturnType<typeof combineFiles>): SourceFileInfo[] {
  return c.files.map((f) => ({
    side: f.side,
    name: f.name,
    rows: f.rowCount,
    headerRow: f.headerRow,
    periodStart: f.coverage?.start ?? null,
    periodEnd: f.coverage?.end ?? null,
    statementStart: f.diagnostics.statementPeriod?.start ?? null,
    statementEnd: f.diagnostics.statementPeriod?.end ?? null,
    skippedRows: f.diagnostics.issueCount,
    invalidDateRows: f.diagnostics.invalidDateRows,
    statementOpening: f.diagnostics.statement.opening,
    statementClosing: f.diagnostics.statement.closing,
    statementAmbiguities: f.diagnostics.statement.ambiguities,
    ...(f.diagnostics.statement.owedIndication ? { statementOwedIndication: f.diagnostics.statement.owedIndication } : {}),
  }));
}

/** Combine a group of files the way the app does; return trimmed and full-row variants. */
function loadFiles(files: FileInput[], side: "bank" | "ledger") {
  const byName = new Map(files.map((f) => [f.name, f]));
  const c = combineFiles(
    side,
    files.map((f) => ({ name: f.name, content: f.content, headerRow: f.headerRow, map: f.map as ImportFileInput["map"] }))
  );
  return { combined: c, trimmed: c.txns, full: withFullRaw(c.txns, byName), sourceFiles: sourceFilesOf(c) };
}
const load = (paths: string[], side: "bank" | "ledger", extraColumns = false) =>
  loadFiles(paths.map((p) => fileFrom(p, extraColumns)), side);

const MESSY = [
  "Date,Description,Amount,Transaction ID,Account Number,Balance,Check #,Memo,Category,Notes,Card Number,Payee Address",
  "2026-01-02,Coffee Shop,-4.50,TX1,123456789,995.50,,private memo,Meals,call Dana re: lunch,4111111111111111,1 Main St",
  "2026-01-03,Client Payment,500.00,TX2,123456789,1495.50,1001,invoice 7,Income,,4111111111111111,2 Side Rd",
  "2026-01-03,Client Payment,500.00,TX2,123456789,1495.50,1001,invoice 7,Income,,4111111111111111,2 Side Rd",
].join("\n");

describe("new imports keep only the columns Reconly uses", () => {
  it("drops unused columns (values AND keys) and lists their header names only", () => {
    const { txns, diagnostics } = parseCsvDetailed(MESSY, "bank", undefined, { sourceFile: "messy.csv" });
    expect(txns).toHaveLength(3);
    for (const t of txns) {
      expect(Object.keys(t.raw).sort()).toEqual(
        ["account number", "amount", "balance", "check #", "date", "description", "transaction id"].sort()
      );
      const serialized = JSON.stringify(t);
      for (const gone of ["private memo", "Meals", "Dana", "4111111111111111", "Main St", "Side Rd", "invoice 7"]) {
        expect(serialized).not.toContain(gone);
      }
    }
    expect(diagnostics.omittedColumns).toEqual(["memo", "category", "notes", "card number", "payee address"]);
  });

  it("keeps required identifiers, references, account and balance values exactly as written", () => {
    const [t1, t2] = parseCsvDetailed(MESSY, "bank").txns;
    expect(t1.raw).toEqual({
      date: "2026-01-02", description: "Coffee Shop", amount: "-4.50", "transaction id": "TX1",
      "account number": "123456789", balance: "995.50", "check #": "",
    });
    expect(t2.raw["check #"]).toBe("1001");
    expect(t2.reference).toBe("1001");
    expect(t1.runningBalance).toBe(99550);
    expect(accountOf(t1)).toBe("123456789");
  });

  it("keeps mapped columns even when their headers are unusual", () => {
    const csv = ["When,What,Out,In,Ref Code,Notes", "01/05/2026,Rent,1200.00,,R-9,landlord phone 555"].join("\n");
    const [t] = parseCsvDetailed(csv, "bank", { date: "when", description: "what", debit: "out", credit: "in", reference: "ref code" }).txns;
    expect(t.raw).toEqual({ when: "01/05/2026", what: "Rent", out: "1200.00", in: "", "ref code": "R-9" });
    expect(t.amount).toBe(-120000);
  });

  it("every header the duplicate checks read is retained when present", () => {
    const headers = ["date", "description", "amount", ...DUPLICATE_EVIDENCE_HEADERS.filter((h) => !["date", "description", "amount"].includes(h))];
    const values = headers.map((h, i) => (h === "date" ? "2026-02-01" : h === "description" ? "X" : h === "amount" ? "1.00" : `v${i}`));
    const csv = [headers.map((h) => `"${h}"`).join(","), values.map((v) => `"${v}"`).join(",")].join("\n");
    const [t] = parseCsvDetailed(csv, "bank").txns;
    expect(Object.keys(t.raw).sort()).toEqual([...new Set(headers)].sort());
  });

  it("parse-time results are identical to a full-row parse (only raw differs)", () => {
    const strip = ({ raw: _raw, ...rest }: Txn) => rest;
    for (const path of ALL_FILES) {
      const plain = load([path], sideOf(path));
      const { trimmed, full } = load([path], sideOf(path), true);
      // Unused columns change nothing but raw: same rows, amounts, dates, lines, balances.
      expect(trimmed.map(strip), path).toEqual(plain.trimmed.map(strip));
      expect(trimmed.map((t) => t.raw), path).toEqual(plain.trimmed.map((t) => t.raw));
      expect(trimmed.map(strip), path).toEqual(full.map(strip));
      // The trimmed row is exactly the full row restricted to the kept columns.
      trimmed.forEach((t, i) => {
        for (const [k, v] of Object.entries(t.raw)) expect(full[i].raw[k], `${path} ${k}`).toBe(v);
      });
    }
  });
});

describe("every feature gives the same answer with trimmed and full rows", () => {
  // Every fixture group as the app would import it: each file alone, and each
  // folder's same-side files together (multi-file imports, overlaps).
  const groups: { label: string; paths: string[]; side: "bank" | "ledger" }[] = [];
  for (const p of ALL_FILES) groups.push({ label: relative(ROOT, p), paths: [p], side: sideOf(p) });
  const byDir = new Map<string, string[]>();
  for (const p of ALL_FILES) byDir.set(p.slice(0, p.lastIndexOf("/")), [...(byDir.get(p.slice(0, p.lastIndexOf("/"))) ?? []), p]);
  for (const [dir, paths] of byDir) {
    for (const side of ["bank", "ledger"] as const) {
      const same = paths.filter((p) => sideOf(p) === side);
      if (same.length > 1) groups.push({ label: `${relative(ROOT, dir)} (${side} ×${same.length})`, paths: same, side });
    }
  }

  it.each(groups.flatMap((g) => [{ ...g, extra: false }, { ...g, label: g.label + " + unused columns", extra: true }]))(
    "$label — duplicates, overlaps, accounts and statements",
    ({ paths, side, extra }) => {
      const { trimmed, full, sourceFiles } = load(paths, side, extra);
      expect(trimmed.length).toBeGreaterThan(0);
      if (extra) {
        for (const t of trimmed) expect(Object.keys(t.raw)).not.toContain("notes");
        expect(full.every((t) => "notes" in t.raw)).toBe(true);
        // Same answers as the untouched file, too.
        const plain = load(paths, side, false);
        expect(JSON.stringify(detectDuplicates(side, trimmed))).toBe(JSON.stringify(detectDuplicates(side, plain.trimmed)));
      }
      expect(JSON.stringify(detectDuplicates(side, trimmed))).toBe(JSON.stringify(detectDuplicates(side, full)));
      expect(fileOverlaps(side, trimmed)).toEqual(fileOverlaps(side, full));
      expect(trimmed.map(accountOf)).toEqual(full.map(accountOf));
      expect(trimmed.map((t) => [t.sourceFile, t.sourceLine])).toEqual(full.map((t) => [t.sourceFile, t.sourceLine]));
      if (side === "bank") {
        expect(verifyStatements(trimmed, sourceFiles)).toEqual(verifyStatements(full, sourceFiles));
      }
    }
  );

  it("the Advanced Demo's duplicate groups, statements and month review are unchanged", () => {
    const demo = (side: "bank" | "ledger") =>
      loadFiles(
        ADVANCED_DEMO_FILES.filter((f) => f.side === side).map((f) => ({
          name: f.name,
          content: readFileSync(join(ROOT, "public/samples/advanced", f.name), "utf8"),
          headerRow: f.headerRow,
          map: f.map,
        })),
        side
      );
    const bank = demo("bank");
    const ledger = demo("ledger");
    expect(bank.trimmed.length).toBeGreaterThan(0);
    const groupsT = [...detectDuplicates("bank", bank.trimmed), ...detectDuplicates("ledger", ledger.trimmed)];
    const groupsF = [...detectDuplicates("bank", bank.full), ...detectDuplicates("ledger", ledger.full)];
    expect(groupsT.length).toBeGreaterThan(0); // the demo does contain repeats
    expect(JSON.stringify(groupsT)).toBe(JSON.stringify(groupsF));

    const months = (b: Txn[], l: Txn[], groups: typeof groupsT) => {
      const result = reconcile(b, l);
      return buildMonthReview({
        imported: { bank: b, ledger: l },
        bankTxns: b,
        ledgerTxns: l,
        matches: result.matches,
        compositeMatches: result.compositeMatches,
        addedBankIds: new Set(),
        acknowledgedLedgerIds: new Set(),
        duplicateGroups: groups,
        duplicateState: EMPTY_DUPLICATE_STATE,
        sourceFiles: [...bank.sourceFiles, ...ledger.sourceFiles],
        statementReview: verifyStatements(b, bank.sourceFiles),
      });
    };
    expect(JSON.stringify(months(bank.trimmed, ledger.trimmed, groupsT))).toBe(
      JSON.stringify(months(bank.full, ledger.full, groupsF))
    );
  });

  it("reconciliation results and the export model never read the dropped columns", () => {
    const bank = load([join(ROOT, "public/samples/bank-june2026.csv")], "bank");
    const ledger = load([join(ROOT, "public/samples/ledger-june2026.csv")], "ledger");
    const rT = reconcile(bank.trimmed, ledger.trimmed);
    const rF = reconcile(bank.full, ledger.full);
    expect(rT.matches).toEqual(rF.matches);
    expect(rT.balanceProof).toEqual(rF.balanceProof);
    // PDF / Excel exports are built from Txn fields only — never from raw.
    const exportDir = join(ROOT, "src/lib/export");
    for (const f of readdirSync(exportDir).filter((n) => n.endsWith(".ts"))) {
      expect(readFileSync(join(exportDir, f), "utf8"), f).not.toMatch(/\.raw\b|raw\[/);
    }
  });
});

describe("rows saved before minimization", () => {
  it("full stored rows still work unchanged (no migration)", () => {
    // An older record holds every column; duplicate detection reads it as before.
    const { trimmed, full } = load([join(ROOT, "tests/fixtures/dupes/bank-twin.csv")], "bank");
    expect(Object.keys(full[0].raw).length).toBeGreaterThanOrEqual(Object.keys(trimmed[0].raw).length);
    expect(JSON.stringify(detectDuplicates("bank", full))).toBe(JSON.stringify(detectDuplicates("bank", trimmed)));
  });
});
