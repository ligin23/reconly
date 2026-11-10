/**
 * Phase 1 — header-row selection and row provenance in the CSV parser.
 * Amount/date parsing rules are untouched; these tests cover WHERE the
 * parser starts reading and how each transaction is traced to its source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspectCsv, parseCsv, parseCsvDetailed } from "@/lib/parser";

const fixture = (n: string) =>
  readFileSync(resolve(__dirname, "../../../../tests/fixtures", n), "utf8");

const TITLED = [
  "First National Bank",
  "Account: ****4821,Business Checking",
  "Statement period: 01/01/2026 - 01/31/2026",
  "Date,Description,Amount",
  "01/05/2026,COFFEE SUPPLY CO,-45.10",
  "01/09/2026,CLIENT PAYMENT,1200.00",
].join("\n");

describe("backward compatibility — no options means historical behaviour", () => {
  it.each(["bank_statement.csv", "clean_bank.csv", "bank_one_fee.csv"])(
    "%s: same transactions, same ids, in the same order",
    (name) => {
      const csv = fixture(name);
      const before = parseCsv(csv, "bank");
      const withOptions = parseCsvDetailed(csv, "bank", undefined, { headerRow: 1 }).txns;
      expect(withOptions).toEqual(before);
      before.forEach((t, i) => {
        expect(t.id).toMatch(/^bank-\d+$/);
        expect(t.sourceFile).toBeUndefined(); // only set when a file name is supplied
        expect(t.sourceLine).toBeGreaterThanOrEqual(2);
        if (i > 0) expect(t.sourceLine!).toBeGreaterThan(before[i - 1].sourceLine!);
      });
    }
  );
});

describe("files with title lines above the column titles", () => {
  it("reads nothing — and says why — when the header row is left at line 1 (never guessed)", () => {
    const { txns, diagnostics } = parseCsvDetailed(TITLED, "bank");
    expect(txns).toEqual([]);
    expect(diagnostics.warnings.join(" ")).toMatch(/column .* was not found/i);
  });

  it("inspectCsv SUGGESTS the real header row but does not apply it", () => {
    const insp = inspectCsv(TITLED);
    expect(insp.headerRow).toBe(1);
    expect(insp.suggestedHeaderRow).toBe(4);
    expect(insp.headers).not.toContain("amount"); // still reading line 1
    expect(insp.rawLines.slice(0, 4)).toEqual(TITLED.split("\n").slice(0, 4));
  });

  it("parses correctly once the user picks the header row", () => {
    const insp = inspectCsv(TITLED, 3, { headerRow: 4 });
    expect(insp.headers).toEqual(["date", "description", "amount"]);
    expect(insp.suggestedHeaderRow).toBeNull();
    expect(insp.headerWarning).toBeNull();

    const { txns, diagnostics } = parseCsvDetailed(TITLED, "bank", insp.detected, {
      headerRow: 4,
      sourceFile: "jan.csv",
    });
    expect(diagnostics.issueCount).toBe(0);
    expect(txns.map((t) => [t.date, t.description, t.amount])).toEqual([
      ["2026-01-05", "COFFEE SUPPLY CO", -4510],
      ["2026-01-09", "CLIENT PAYMENT", 120000],
    ]);
    // Provenance points at the line in the ORIGINAL file, title lines included.
    expect(txns.map((t) => [t.sourceFile, t.sourceLine])).toEqual([
      ["jan.csv", 5],
      ["jan.csv", 6],
    ]);
  });

  it("handles Windows (CRLF) line endings the same way", () => {
    const { txns } = parseCsvDetailed(TITLED.replace(/\n/g, "\r\n"), "bank", undefined, {
      headerRow: 4,
    });
    expect(txns.map((t) => t.sourceLine)).toEqual([5, 6]);
    expect(txns[0].amount).toBe(-4510);
  });

  it("a header row past the end of the file reads nothing rather than inventing rows", () => {
    const { txns } = parseCsvDetailed(TITLED, "bank", undefined, { headerRow: 40 });
    expect(txns).toEqual([]);
  });
});

describe("row numbers are the physical line in the file", () => {
  it("counts blank lines", () => {
    const csv = "Date,Description,Amount\n\n01/05/2026,A,-1.00\n\n\n01/06/2026,B,-2.00\n";
    const { txns } = parseCsvDetailed(csv, "bank");
    expect(txns.map((t) => t.sourceLine)).toEqual([3, 6]);
  });

  it("counts quoted fields that span several lines", () => {
    const csv =
      'Date,Description,Amount\n01/05/2026,"ACME\nSUITE 4\nNEW YORK",-1.00\n01/06/2026,B,-2.00\n';
    const { txns } = parseCsvDetailed(csv, "bank");
    expect(txns.map((t) => t.sourceLine)).toEqual([2, 5]);
  });

  it("skipped rows are reported with their true line, title lines included", () => {
    const csv = ["Bank export", "", "Date,Description,Amount", "01/05/2026,A,-1.00", "99/99/2026,B,-2.00", "01/07/2026,C,abc"].join("\n");
    const { txns, diagnostics } = parseCsvDetailed(csv, "bank", undefined, { headerRow: 3 });
    expect(txns).toHaveLength(1);
    expect(diagnostics.issues.map((i) => i.line)).toEqual([5, 6]);
  });

  it("ids restart per file and honour an id prefix", () => {
    const { txns } = parseCsvDetailed(TITLED, "bank", undefined, { headerRow: 4, idPrefix: "bank-f2" });
    expect(txns.map((t) => t.id)).toEqual(["bank-f2-0", "bank-f2-1"]);
  });
});

describe("malformed and ambiguous files", () => {
  it("a headerless file is flagged, not silently read with its first row as titles", () => {
    const insp = inspectCsv("01/05/2026,COFFEE,-45.10\n01/06/2026,RENT,-900.00\n");
    expect(insp.headerWarning).toMatch(/looks like a transaction/i);
    expect(insp.suggestedHeaderRow).toBeNull();
    expect(parseCsvDetailed("01/05/2026,COFFEE,-45.10\n01/06/2026,RENT,-900.00\n", "bank").txns).toEqual([]);
  });

  it("a real header row is not mistaken for data", () => {
    expect(inspectCsv(fixture("bank_statement.csv")).headerWarning).toBeNull();
    expect(inspectCsv(fixture("bank_statement.csv")).suggestedHeaderRow).toBeNull();
  });

  it("when no row looks like a header, nothing is suggested", () => {
    const insp = inspectCsv("Posted,Memo,Amt\n01/05/2026,COFFEE,-45.10\n");
    expect(insp.suggestedHeaderRow).toBeNull(); // user maps the columns by hand
  });

  it("empty file, header-only file and binary junk all yield zero transactions", () => {
    expect(parseCsvDetailed("", "bank").txns).toEqual([]);
    expect(parseCsvDetailed("Date,Description,Amount\n", "bank").txns).toEqual([]);
    const junk = "\u0000\u0001PK\u0003\u0004��,,\n�\u0000,\u0002";
    expect(parseCsvDetailed(junk, "bank").txns).toEqual([]);
    expect(() => inspectCsv(junk)).not.toThrow();
  });

  it("an unclosed quote is reported as a structural problem", () => {
    const csv = 'Date,Description,Amount\n01/05/2026,"BROKEN,-1.00\n01/06/2026,B,-2.00\n';
    const { diagnostics } = parseCsvDetailed(csv, "bank");
    expect(diagnostics.csvErrors.length + diagnostics.issueCount).toBeGreaterThan(0);
  });

  it("rows with the wrong number of fields are reported, good rows still read", () => {
    const csv = "Date,Description,Amount\n01/05/2026,A,-1.00\n01/06/2026,ONLY TWO\n01/07/2026,C,-3.00\n";
    const { txns, diagnostics } = parseCsvDetailed(csv, "bank");
    expect(txns.map((t) => t.sourceLine)).toEqual([2, 4]);
    expect(diagnostics.csvErrors.length + diagnostics.issueCount).toBeGreaterThan(0);
  });
});
