/**
 * QA remediation (Playwright) — the eight findings of "Reconly —
 * Consolidated QA and Financial Accuracy Review", checked in the browser on
 * the advanced demo and on real uploads.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import XLSX from "xlsx-js-style";

const fixture = (...p: string[]) => resolve(__dirname, "fixtures", ...p);

async function openDemo(page: Page) {
  await page.goto("/app");
  await page.getByTestId("advanced-demo-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
}

/** Whole-page text of the scrollable results area. */
const mainText = (page: Page) => page.locator("main").innerText();

async function inViewport(page: Page, el: Locator) {
  await expect(el).toBeInViewport({ ratio: 0.99 });
  const box = (await el.boundingBox())!;
  const header = (await page.locator("header").first().boundingBox())!;
  expect(box.y, "hidden under the top bar").toBeGreaterThanOrEqual(header.y + header.height - 1);
}

// ───────────────────────── RECON-001 / 002 / 005 ─────────────────────────
test("RECON-001/002/005: results use neutral, signed, evidence-based wording", async ({ page }) => {
  await openDemo(page);

  // RECON-002 — labelled net activity, signed difference, no assumed cause.
  const hero = page.getByTestId("recon-status");
  await expect(hero).toContainText("$1,309.54 net difference");
  await expect(hero).toContainText("Bank net activity is $1,309.54 lower than ledger net activity.");
  await expect(hero).toContainText("Bank net activity");
  await expect(hero).toContainText("Ledger net activity");
  await expect(page.getByTestId("net-difference-row")).toContainText("Net activity difference (bank minus ledger)");
  await expect(page.getByTestId("net-difference-row")).toContainText("−$1,309.54");
  await expect(page.getByTestId("net-scope-note")).toContainText("not bank account balances");
  await expect(page.getByTestId("net-breakdown")).toContainText("Bank only: 9 transactions totalling −$346.96.");
  await expect(page.getByTestId("net-breakdown")).toContainText("In your records only: 4 entries totalling $962.58.");
  await expect(page.getByTestId("net-breakdown")).toContainText("no single one is assumed to explain it");

  // RECON-005 — every statement outcome named.
  await expect(page.getByTestId("status-statements")).toContainText("Statement review needed");
  await expect(page.getByTestId("status-statements-outcomes")).toHaveText(
    "1 mismatch · 1 file could not be verified · 1 running-balance check only · 1 verified"
  );

  // RECON-001 — the ledger-only list.
  await page.getByTestId("tab-missing-bank").click();
  await expect(page.getByTestId("tab-missing-bank")).toContainText("In your records only");
  await expect(page.locator("main")).toContainText(
    "These entries have no confirmed bank match. Review them to determine why"
  );
  // Comcast: flagged as a possible amount difference, on both sides.
  const ledgerHint = page.getByTestId("amount-difference-hint");
  await expect(ledgerHint).toHaveCount(1);
  await expect(ledgerHint).toContainText("the bank shows the same description on the same date for −$129.99");
  await expect(ledgerHint).toContainText("$10.00 apart");
  await page.getByTestId("tab-missing-books").click();
  await expect(page.getByTestId("amount-difference-hint")).toContainText("your records have the same description on the same date for −$139.99");

  // Nothing on the page calls an unmatched entry a timing difference or guesses a cause.
  for (const tab of ["tab-missing-bank", "tab-missing-books"]) {
    await page.getByTestId(tab).click();
    const text = await mainText(page);
    expect(text).not.toMatch(/not cleared yet|haven.t cleared|no action needed|that.s normal|matter of timing/i);
    expect(text).not.toMatch(/usually means|one missing entry|your bank says|your books say/i);
  }

  // A genuine outstanding check: timing wording only as the user's own classification.
  await page.getByTestId("tab-missing-bank").click();
  const row = page.locator(".txn", { hasText: "Check 1203 - Alder Studio Supply" });
  await row.getByRole("button", { name: "Mark as expected" }).click();
  await expect(page.locator(".txn", { hasText: "Check 1203 - Alder Studio Supply" })).toContainText("Marked by you as expected");
  await expect(page.getByTestId("tab-missing-bank")).toContainText("3");
  // Marking it changes no total.
  await expect(page.getByTestId("net-difference-row")).toContainText("−$1,309.54");
});

// ───────────────────────── RECON-004 ─────────────────────────
test("RECON-004: duplicate detection, decision and status stay consistent through set aside → restore → keep → undo", async ({ page }) => {
  await openDemo(page);
  const panel = page.getByTestId("duplicates-panel");
  const adobe = () => panel.getByTestId("dup-group").filter({ hasText: "ADOBE CREATIVE CLOUD" }).filter({ hasText: "Mar 5" });
  const difference = page.getByTestId("net-difference-row");

  // Undecided.
  await expect(adobe().getByTestId("dup-evidence")).toContainText("no row was set aside automatically");
  await expect(adobe().getByTestId("dup-decision-automatic")).toContainText("No row was set aside automatically");
  await expect(adobe().getByTestId("dup-decision-user")).toHaveText("No decision from you yet.");
  await expect(adobe().getByTestId("dup-decision-status")).toContainText("All 2 rows are included");
  await expect(difference).toContainText("−$1,309.54");

  // Set aside the copy.
  await adobe().getByTestId("dup-set-aside-repeats").click();
  await expect(adobe()).toContainText("Set aside by you");
  await expect(adobe().getByTestId("dup-decision-user")).toHaveText("You chose to set aside 1 copy.");
  await expect(adobe().getByTestId("dup-decision-status")).toHaveText("1 row excluded from the reconciliation totals; 1 row included.");
  // The detection text is unchanged and no longer contradicts the decision.
  await expect(adobe().getByTestId("dup-evidence")).toContainText("no row was set aside automatically");
  await expect(adobe()).not.toContainText("nothing was set aside");
  await expect(difference).toContainText("−$1,249.55"); // 1,309.54 − 59.99

  // Restore.
  await adobe().getByTestId("dup-restore").click();
  await expect(adobe().getByTestId("dup-decision-user")).toHaveText("No decision from you yet.");
  await expect(adobe().getByTestId("dup-decision-status")).toContainText("This group still needs your decision.");
  await expect(difference).toContainText("−$1,309.54");

  // Keep separate.
  await adobe().getByTestId("dup-keep-all").click();
  await page.getByTestId("dup-section-kept").getByRole("button").first().click(); // section starts collapsed
  await expect(adobe().getByTestId("dup-decision-user")).toContainText("You confirmed these are separate transactions");
  await expect(adobe().getByTestId("dup-decision-status")).toHaveText("All 2 rows are included in the reconciliation totals.");
  await expect(page.getByTestId("status-duplicates")).toContainText("Complete");
  await expect(difference).toContainText("−$1,309.54");

  // Undo.
  await adobe().getByRole("button", { name: "Undo" }).click();
  await expect(adobe().getByTestId("dup-decision-user")).toHaveText("No decision from you yet.");
  await expect(page.getByTestId("status-duplicates")).toContainText("1 possible duplicate group to review");
  await expect(difference).toContainText("−$1,309.54");
});

// ───────────────────────── RECON-003 ─────────────────────────
test("RECON-003: the downloaded Excel file stores amounts and counts as numbers", async ({ page }) => {
  await openDemo(page);
  const wait = page.waitForEvent("download");
  await page.getByTestId("export-menu-btn").click();
  await page.getByTestId("export-excel-btn").click();
  const file = await wait;
  const wb = XLSX.read(readFileSync((await file.path())!), { cellNF: true, cellFormula: true });
  expect(wb.SheetNames).toEqual(["Reconciliation", "Financial Summary"]);

  type Cell = { t: string; v: string | number; z?: string; f?: string; w?: string };
  const rows = (name: string): Cell[][] => {
    const ws = wb.Sheets[name];
    const range = XLSX.utils.decode_range(ws["!ref"]!);
    const out: Cell[][] = [];
    for (let r = 0; r <= range.e.r; r++) {
      const row: Cell[] = [];
      for (let c = 0; c <= range.e.c; c++) row.push((ws[XLSX.utils.encode_cell({ r, c })] as Cell) ?? { t: "z", v: "" });
      out.push(row);
    }
    return out;
  };
  const recon = rows("Reconciliation");
  const summary = rows("Financial Summary");
  const all = [...recon, ...summary].flat().filter((c) => c.t !== "z");

  // No formulas; every number is a real number.
  expect(all.every((c) => c.f === undefined)).toBe(true);
  expect(all.filter((c) => c.t === "n").length).toBeGreaterThan(100);

  // The three amounts the QA report found as text.
  const amountOf = (desc: string, value: number) =>
    recon.some((r) => r[1].v === desc && r[2].t === "n" && r[2].v === value && r[2].z === '"$"#,##0.00;("$"#,##0.00)');
  expect(amountOf("ADOBE CREATIVE CLOUD", -59.99)).toBe(true);
  expect(amountOf("COMCAST BUSINESS", -129.99)).toBe(true);
  expect(amountOf("STRIPE PAYOUT", 4750)).toBe(true);
  // No money is left as a text cell like "($59.99)" in an amount column.
  expect(recon.some((r) => r[2].t === "s" && /^\(?\$[\d,]+\.\d\d\)?$/.test(String(r[2].v)))).toBe(false);

  // Header figures and counts.
  const kv = (sheet: Cell[][], label: string) => sheet.find((r) => r[0].v === label)![1];
  expect(kv(recon, "Net activity difference (bank minus ledger)")).toMatchObject({ t: "n", v: -1309.54 });
  expect(kv(recon, "Bank rows imported")).toMatchObject({ t: "n", v: 54 });
  expect(kv(summary, "Bank net activity")).toMatchObject({ t: "n", v: -2977.56 });
  const feb = summary.find((r) => r[0].v === "bank-feb-2026.csv" && r[9].v === "Statement balance mismatch")!;
  expect(feb[8]).toMatchObject({ t: "n", v: -1350 });

  // Wording carried into the file.
  const text = all.map((c) => String(c.v)).join("\n");
  expect(text).toContain("In your records only — no confirmed bank match");
  expect(text).not.toMatch(/not yet cleared by your bank|known timing difference|Unexplained difference/);
});

// ───────────────────────── RECON-006 ─────────────────────────
for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone 375", width: 375, height: 812 },
  { name: "phone 390", width: 390, height: 844 },
]) {
  test.describe(`RECON-006 tour · ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("Show statements opens February's mismatch, scrolls its heading into view and focuses it", async ({ page }) => {
      await openDemo(page);
      const heading = page.getByTestId("month-statement-heading");

      // 1. Month details collapsed, from the top.
      await expect(page.getByTestId("month-detail")).toHaveCount(0);
      await page.getByTestId("demo-tour-go-statements").click();
      await expect(heading).toHaveText("Statement balance check — February 2026");
      await inViewport(page, heading);
      await expect(heading).toBeFocused();
      const detail = page.getByTestId("month-detail");
      await expect(detail.getByTestId("statement-check").filter({ hasText: "bank-feb-2026.csv" })).toContainText("Statement balance mismatch");
      await expect(detail).toContainText("a difference of -$1,350.00");

      // 2. A different month already open, and the page scrolled to the bottom.
      await page.getByTestId("month-name").first().click(); // January
      await expect(page.getByTestId("month-detail-title")).toContainText("January 2026");
      await page.locator("main").evaluate((m) => m.scrollTo(0, m.scrollHeight));
      await page.getByTestId("demo-tour-go-statements").focus();
      await page.keyboard.press("Enter"); // keyboard activation
      await expect(heading).toHaveText("Statement balance check — February 2026");
      await inViewport(page, heading);
      await expect(heading).toBeFocused();

      // 3. February already open, scrolled to the middle: it is brought back into view.
      await page.locator("main").evaluate((m) => m.scrollTo(0, m.scrollHeight / 2));
      await page.getByTestId("demo-tour-go-statements").click();
      await inViewport(page, heading);
    });

    test("every other tour link still reaches a visible destination", async ({ page }) => {
      await openDemo(page);
      await page.getByTestId("demo-tour-go-months").click();
      await expect(page.getByTestId("month-review-title")).toBeInViewport();
      await page.getByTestId("demo-tour-go-duplicates").click();
      await expect(page.getByTestId("duplicates-panel").getByText("Repeated rows in your files")).toBeInViewport();
      await page.getByTestId("demo-tour-go-sources").click();
      await expect(page.getByTestId("tab-missing-books")).toBeInViewport();
      await expect(page.getByTestId("txn-source").first()).toContainText("bank-jan-2026.csv · row 19");
      await page.getByTestId("demo-tour-go-reports").click();
      await expect(page.getByTestId("export-pdf-btn")).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByTestId("demo-tour-go-review").click();
      await expect(page.getByText(/0 of 6 reviewed/)).toBeVisible();
    });
  });
}

test("RECON-006: with one month of data, the same action opens the Source checks card", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("bank-file-input").setInputFiles(fixture("statements", "stmt-jan.csv"));
  await page.getByTestId("ledger-file-input").setInputFiles(fixture("statements", "stmt-ledger-jan.csv"));
  await page.getByTestId("start-analysis-btn").click();
  const useRow = page.getByTestId("use-suggested-header");
  if (await useRow.count()) await useRow.first().click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("statement-check")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("reconly:show-statements")));
  await expect(page.getByTestId("statement-check").first()).toBeVisible();
  await expect(page.getByTestId("source-checks-headline")).toBeFocused();
});

// ───────────────────────── RECON-007 ─────────────────────────
test("RECON-007: unusable files are refused at upload with the reason; a replacement works", async ({ page }) => {
  await page.goto("/app");
  const bank = page.getByTestId("bank-file-input");
  const error = page.getByTestId("upload-error");
  const start = page.getByTestId("start-analysis-btn");
  await page.getByTestId("ledger-file-input").setInputFiles(fixture("clean_ledger.csv"));

  const cases: [string, string, RegExp][] = [
    ["empty.csv", "", /"empty\.csv" wasn't added — it is empty\./],
    ["header-only.csv", "Date,Description,Amount\n", /"header-only\.csv" wasn't added — it has column titles but no transaction rows beneath them\./],
    ["notes.txt", "This is not a CSV.", /"notes\.txt" wasn't added — it doesn't contain a table of transactions/],
    ["tilde.csv", "Date~Description~Amount\n01/05/2026~COFFEE~-4.50\n01/06/2026~RENT~-900.00\n", /"tilde\.csv" wasn't added — it doesn't contain a table of transactions: no row has separate columns\. Reconly reads CSV files whose columns are separated by commas, semicolons, tabs or \|/],
  ];
  for (const [name, content, message] of cases) {
    await bank.setInputFiles({ name, mimeType: name.endsWith(".txt") ? "text/plain" : "text/csv", buffer: Buffer.from(content) });
    await expect(error, name).toContainText(message);
    await expect(error).toContainText("Choose a different file for the bank statement side.");
    // Not listed, and analysis cannot start: the mapping screen is never reached.
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    await expect(start).toBeDisabled();
  }
  // The valid ledger file picked earlier is untouched.
  await expect(page.getByText("clean_ledger.csv")).toBeVisible();

  // Replacing it with a real file clears the error and the normal flow continues.
  await bank.setInputFiles(fixture("clean_bank.csv"));
  await expect(error).toHaveCount(0);
  await expect(start).toBeEnabled();
  await start.click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
});

test("RECON-007: malformed dates reach mapping and are explained there; valid title-prefixed multi-file uploads still work", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("bank-file-input").setInputFiles({
    name: "bad-dates.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Date,Description,Amount\nnot-a-date,COFFEE,-4.50\nsoon,RENT,-900.00\n"),
  });
  await page.getByTestId("ledger-file-input").setInputFiles(fixture("clean_ledger.csv"));
  await expect(page.getByTestId("upload-error")).toHaveCount(0);
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("mapping-error")).toContainText('unrecognized date "not-a-date"');
  await expect(page.getByTestId("recon-status")).toHaveCount(0);

  // A valid statement with title lines above its header, plus a second bank file.
  await page.goto("/app");
  await page.getByTestId("bank-file-input").setInputFiles([fixture("multi", "bank-jan-titled.csv"), fixture("multi", "bank-feb.csv")]);
  await page.getByTestId("ledger-file-input").setInputFiles(fixture("multi", "ledger-jan-feb.csv"));
  await expect(page.getByTestId("upload-error")).toHaveCount(0);
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("use-suggested-header").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
});

// ───────────────────────── RECON-008 ─────────────────────────
test("RECON-008: accepted and rejected decisions can be found, survive navigation, and be undone", async ({ page }) => {
  await openDemo(page);
  const tabCount = async (name: string) => (await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().innerText()).replace(/\D+/g, "");

  // Decide all six: accept Blue Bottle, reject Google, accept the rest (incl. cross-month and the Stripe group).
  await page.getByTestId("demo-tour-go-review").click();
  await expect(page.getByText("SQ *BLUE BOTTLE COFFEE")).toBeVisible();
  await page.getByRole("button", { name: /yes, it.?s a match/i }).first().click();
  await expect(page.getByText(/1 of 6 reviewed/)).toBeVisible();
  await expect(page.getByText("GOOGLE WORKSPACE GSUITE")).toBeVisible();
  await page.getByRole("button", { name: /not a match/i }).first().click();
  for (let n = 3; n <= 6; n++) {
    await expect(page.getByText(new RegExp(`${n - 1} of 6 reviewed`))).toBeVisible();
    await page.getByRole("button", { name: /yes, it.?s a match|yes, they match/i }).first().click();
  }
  await expect(page.getByText("All reviewed!")).toBeVisible();
  await expect(page.locator("main")).toContainText("each with an Undo");
  await page.getByRole("button", { name: "Back to results" }).click();

  // Found again on Results, under "Needs review".
  const list = page.getByTestId("decided-list");
  await expect(list).toContainText("Your review decisions (6)");
  await expect(list).toContainText("5 confirmed · 1 rejected");
  const item = (text: string) => list.getByTestId("decided-item").filter({ hasText: text });
  await expect(item("GOOGLE WORKSPACE GSUITE")).toHaveAttribute("data-decision", "rejected");
  await expect(item("GOOGLE WORKSPACE GSUITE")).toContainText("Rejected by you");
  await expect(item("STRIPE PAYOUT")).toHaveAttribute("data-kind", "group");
  await expect(item("STRIPE PAYOUT")).toContainText("3 entries: Invoice 1041");
  await expect(item("CHECK 1187 NORTHWIND PRINT")).toContainText("crosses a month boundary");
  expect(await tabCount("Matched")).toBe("37");
  expect(await tabCount("Needs review")).toBe("0");
  expect(await tabCount("Not in your records")).toBe("10");
  expect(await tabCount("In your records only")).toBe("5");

  // Navigate away and back: decisions are still there.
  await page.getByTestId("nav-history").click();
  await page.getByRole("button", { name: /results/i }).first().click();
  await expect(page.getByTestId("decided-item")).toHaveCount(6);

  // Undo the rejection → back in the queue; both rows leave the unmatched lists.
  await item("GOOGLE WORKSPACE GSUITE").getByTestId("undo-decision").click();
  await expect(page.getByTestId("decided-item")).toHaveCount(5);
  expect(await tabCount("Needs review")).toBe("1");
  expect(await tabCount("Not in your records")).toBe("9");
  expect(await tabCount("In your records only")).toBe("4");

  // Undo an ordinary acceptance, the cross-month one and the grouped one.
  await item("SQ *BLUE BOTTLE COFFEE").getByTestId("undo-decision").click();
  await item("CHECK 1187 NORTHWIND PRINT").getByTestId("undo-decision").click();
  await item("STRIPE PAYOUT").getByTestId("undo-decision").click();
  await expect(page.getByTestId("decided-item")).toHaveCount(2);
  expect(await tabCount("Matched")).toBe("34");
  expect(await tabCount("Needs review")).toBe("4");
  // The net difference never moved: every pairing has equal amounts on both sides.
  await expect(page.getByTestId("net-difference-row")).toContainText("−$1,309.54");

  // The four are reviewable again, and a decision can be made differently this time.
  await page.getByRole("button", { name: "Open review" }).click();
  await expect(page.getByText(/2 of 6 reviewed/)).toBeVisible();
  await page.getByRole("button", { name: /not a match/i }).first().click(); // Blue Bottle, now rejected
  await expect(page.getByText(/3 of 6 reviewed/)).toBeVisible(); // the card animates out before the decision lands
  await page.getByRole("button", { name: /results/i }).first().click();
  await expect(page.getByTestId("decided-item").filter({ hasText: "SQ *BLUE BOTTLE COFFEE" })).toHaveAttribute("data-decision", "rejected");

  // The export reflects the corrected state.
  const wait = page.waitForEvent("download");
  await page.getByTestId("export-menu-btn").click();
  await page.getByTestId("export-excel-btn").click();
  const wb = XLSX.read(readFileSync((await (await wait).path())!));
  const text = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n");
  expect(text).toContain("Matched transactions  (34)");
  expect(text).toContain("2 suggested matches confirmed by you.");
  expect(text).toContain("1 suggested match rejected by you.");
});

// ───────────────────────── No console errors or failed requests ─────────────────────────
test("the advanced demo runs with no console errors and no failed requests", async ({ page }) => {
  const errors: string[] = [];
  const failed: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  await openDemo(page);
  await page.getByTestId("demo-tour-go-statements").click();
  await page.getByTestId("demo-tour-go-duplicates").click();
  await page.getByTestId("tab-missing-bank").click();
  await page.getByTestId("demo-tour-go-review").click();
  await page.getByRole("button", { name: /yes, it.?s a match/i }).first().click();
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});

// ───────────────────────── Ambiguous grouped match ─────────────────────────
test("an ambiguous grouped match needs an explicit pick, and undo brings every option back", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("bank-file-input").setInputFiles({
    name: "bank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Date,Description,Amount\n01/10/2026,STRIPE PAYOUT,100.00\n01/12/2026,RENT,-900.00\n"),
  });
  await page.getByTestId("ledger-file-input").setInputFiles({
    name: "ledger.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Date,Description,Amount\n01/08/2026,Invoice A,60.00\n01/08/2026,Invoice B,40.00\n01/09/2026,Invoice C,60.00\n01/09/2026,Invoice D,40.00\n01/12/2026,RENT,-900.00\n"
    ),
  });
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Open review" }).click();
  await expect(page.getByText("Ambiguous group")).toBeVisible();
  const accept = page.getByRole("button", { name: "Accept selected" });
  await expect(accept).toBeDisabled(); // never auto-selected
  const options = page.locator("main button").filter({ hasText: /Invoice [A-D]/ });
  expect(await options.count()).toBeGreaterThan(1);
  await options.filter({ hasText: "Invoice C" }).filter({ hasText: "Invoice D" }).first().click();
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(page.getByText("All reviewed!")).toBeVisible();
  await page.getByRole("button", { name: "Back to results" }).click();

  const decided = page.getByTestId("decided-item");
  await expect(decided).toHaveCount(1);
  await expect(decided).toHaveAttribute("data-kind", "group");
  await expect(decided).toContainText("2 entries: Invoice C; Invoice D");

  // Undo → the group is undecided again, with all of its options.
  await decided.getByTestId("undo-decision").click();
  await expect(page.getByTestId("decided-item")).toHaveCount(0);
  await page.getByRole("button", { name: "Open review" }).click();
  await expect(page.getByText("Ambiguous group")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept selected" })).toBeDisabled();
  expect(await page.locator("main button").filter({ hasText: /Invoice [A-D]/ }).count()).toBeGreaterThan(1);
});

// ───────────────────────── Fresh demo reset ─────────────────────────
test("Start over then reopening the advanced demo gives a fresh, undecided state", async ({ page }) => {
  await openDemo(page);
  // Make a match decision and a duplicate decision.
  await page.getByTestId("demo-tour-go-review").click();
  await page.getByRole("button", { name: /yes, it.?s a match/i }).first().click();
  await expect(page.getByText(/1 of 6 reviewed/)).toBeVisible();
  await page.getByRole("button", { name: /results/i }).first().click();
  await page.getByTestId("duplicates-panel").getByTestId("dup-set-aside-repeats").click();
  await expect(page.getByTestId("decided-item")).toHaveCount(1);
  await expect(page.getByTestId("net-difference-row")).toContainText("−$1,249.55");

  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByTestId("advanced-demo-btn")).toBeVisible();
  await expect(page.getByTestId("demo-banner")).toHaveCount(0);
  await page.getByTestId("advanced-demo-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });

  await expect(page.getByTestId("decided-list")).toHaveCount(0);
  await expect(page.getByTestId("net-difference-row")).toContainText("−$1,309.54");
  await expect(page.getByTestId("status-duplicates")).toContainText("1 possible duplicate group to review");
  await expect(page.getByTestId("duplicates-panel")).toContainText("7 rows set aside");
  await expect(page.getByTestId("demo-tour-step")).toHaveCount(6);
});
