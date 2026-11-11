/**
 * Advanced demo (Playwright) — "Explore advanced demo" loads three months of
 * fictional files and runs them through the normal import, engine, review
 * and export. The basic "Try with sample data" flow must be unchanged, and
 * the demo must never touch or join saved reconciliations unasked.
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import XLSX from "xlsx-js-style";

const fixture = (name: string) => resolve(__dirname, "fixtures", name);

async function openAdvancedDemo(page: Page) {
  await page.goto("/");
  await page.getByTestId("advanced-demo-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
}

test("the basic sample data flow is unchanged and shows no demo banner", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("try-sample-btn")).toHaveText(/try with sample data/i);
  await page.getByTestId("try-sample-btn").click();
  await expect(page.getByText("bank-june2026.csv")).toBeVisible();
  await expect(page.getByText("ledger-june2026.csv")).toBeVisible();
  await expect(page.getByTestId("try-sample-btn")).toHaveText(/replace with sample data/i);
  // Still goes through the column step, exactly as before.
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("sidebar")).toContainText("Sample workspace");
  await expect(page.getByTestId("sidebar")).toContainText("You're exploring with example data. Nothing here is real.");
  await expect(page.getByTestId("demo-banner")).toHaveCount(0);
  await expect(page.getByTestId("demo-tour")).toHaveCount(0);
  await expect(page.getByTestId("month-review")).toHaveCount(0); // one month only
});

test("the advanced demo loads every file and lands on the multi-month Financial Review", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("advanced-demo-btn")).toContainText("Explore advanced demo");
  await expect(page.getByTestId("advanced-demo-btn")).toContainText(
    "See how Reconly finds discrepancies, duplicates, and balance issues across multiple months."
  );
  await page.getByTestId("advanced-demo-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("confirm-mapping-btn")).toHaveCount(0);

  await expect(page.getByTestId("demo-banner")).toContainText("Demo workspace — all financial data is fictional.");
  await expect(page.getByTestId("demo-banner")).toContainText("Cedar & Co. Creative Studio");
  await expect(page.getByTestId("sidebar")).toContainText("Demo workspace");
  await expect(page.getByTestId("demo-tour-step")).toHaveCount(6);

  // Overlap notices name the real files.
  await expect(page.getByTestId("parse-notices")).toContainText("bank-feb-mar-overlap.csv");
  await expect(page.getByTestId("parse-notices")).toContainText("7 repeated rows were set aside automatically");

  const months = page.getByTestId("month-row");
  await expect(months).toHaveCount(3);
  await expect(months.nth(0)).toContainText("January 2026");
  await expect(months.nth(0)).toContainText("Statement balance verified");
  await expect(months.nth(0)).toContainText("1 cross-month match");
  await expect(months.nth(1)).toContainText("Statement balance mismatch");
  await expect(months.nth(1)).toContainText("2 cross-month matches");
  await expect(months.nth(2)).toContainText("Running balance consistent");
  await expect(months.nth(2)).toContainText("Possible duplicates to review");

  await expect(page.getByTestId("status-statements")).toContainText("Statement review needed");
  await expect(page.getByTestId("status-duplicates")).toContainText("1 possible duplicate group to review");
  await expect(page.getByTestId("duplicates-panel")).toContainText("7 rows set aside");
  await expect(page.getByTestId("dup-counts-bank")).toContainText("54 rows imported");
  await expect(page.getByTestId("dup-counts-ledger")).toContainText("44 rows imported");
});

test("review, duplicate decisions and source tracking all work on the demo", async ({ page }) => {
  await openAdvancedDemo(page);

  // Source tracking: file and row on unmatched items.
  await page.getByTestId("demo-tour-go-sources").click();
  await expect(page.getByTestId("txn-source").first()).toHaveText(/bank-jan-2026\.csv · row 19/);

  // The grouped Stripe payout and the cross-month cheque are in the review queue.
  await page.getByTestId("demo-tour-go-review").click();
  await expect(page.getByTestId("demo-banner")).toBeVisible();
  await expect(page.getByText(/0 of 6 reviewed/)).toBeVisible();
  await expect(page.getByTestId("review-source").first()).toContainText("bank-feb-2026.csv · row 12");
  await page.getByRole("button", { name: /yes, it.?s a match/i }).first().click();
  await expect(page.getByText(/1 of 6 reviewed/)).toBeVisible();
  await page.getByRole("button", { name: /results/i }).first().click();

  // Ambiguous duplicate: decide it, then restore an automatic set-aside.
  const dups = page.getByTestId("duplicates-panel");
  await dups.getByTestId("dup-set-aside-repeats").click();
  await expect(page.getByTestId("status-duplicates")).toContainText("Complete");
  await expect(dups).toContainText("8 rows set aside");
  await dups.getByTestId("dup-restore").first().click();
  await expect(dups).toContainText("7 rows set aside");
  await expect(page.getByTestId("status-duplicates")).toContainText("1 possible duplicate group to review");
});

test("PDF and Excel exports contain the demo's findings and say it is sample data", async ({ page }) => {
  await openAdvancedDemo(page);

  const pdfWait = page.waitForEvent("download");
  await page.getByTestId("demo-tour-go-reports").click();
  await page.getByTestId("export-pdf-btn").click();
  const pdf = await pdfWait;
  expect(pdf.suggestedFilename()).toMatch(/^reconly-sample-data-cedar-co-creative-studio-fictional-.*\.pdf$/);
  const pdfText = readFileSync((await pdf.path())!, "latin1");
  for (const t of ["Sample data", "Statement balance mismatch", "Month-by-month findings", "STRIPE", "ATM FEE"]) {
    expect(pdfText, t).toContain(t);
  }

  const xlsxWait = page.waitForEvent("download");
  await page.getByTestId("export-menu-btn").click();
  await page.getByTestId("export-excel-btn").click();
  const xlsx = await xlsxWait;
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
  const wb = XLSX.read(readFileSync((await xlsx.path())!));
  const text = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n");
  for (const t of ["Sample data — Cedar & Co. Creative Studio (fictional)", "Statement balance mismatch", "bank-feb-2026.csv", "Check 1203 - Alder Studio Supply"]) {
    expect(text, t).toContain(t);
  }
});

test("the demo never touches saved reconciliations or auto-saves itself", async ({ page }) => {
  // A real reconciliation, saved first.
  await page.goto("/");
  await page.getByTestId("bank-file-input").setInputFiles(fixture("clean_bank.csv"));
  await page.getByTestId("ledger-file-input").setInputFiles(fixture("clean_ledger.csv"));
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("save-btn").click();
  await page.getByTestId("save-account-name").fill("Real Checking Account");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByTestId("save-btn")).toHaveText(/save changes/i);

  // Running the demo starts a separate, unsaved reconciliation.
  await page.reload();
  await page.getByTestId("advanced-demo-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("save-btn")).not.toHaveText(/save changes/i);
  await page.getByTestId("nav-history").click();
  await expect(page.getByText("Real Checking Account")).toBeVisible();
  await expect(page.getByText(/cedar/i)).toHaveCount(0); // not auto-saved
  await expect(page.getByTestId("history-sample-badge")).toHaveCount(0);

  // The real record opens as itself — no demo labelling carried over.
  await page.getByText("Real Checking Account").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("demo-banner")).toHaveCount(0);
  await expect(page.getByTestId("sidebar")).not.toContainText("Demo workspace");
});

test("saving the demo on purpose labels it as sample data", async ({ page }) => {
  await openAdvancedDemo(page);
  await page.getByTestId("save-btn").click();
  await expect(page.getByTestId("save-sample-note")).toBeVisible();
  await expect(page.getByTestId("save-account-name")).toHaveValue("Sample data — Cedar & Co. Creative Studio (fictional)");
  // Even a name typed over the default keeps the label.
  await page.getByTestId("save-account-name").fill("My demo run");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByTestId("save-btn")).toHaveText(/save changes/i);

  await page.reload();
  await page.getByTestId("nav-history").click();
  await expect(page.getByText("Sample data — My demo run")).toBeVisible();
  await expect(page.getByTestId("history-sample-badge")).toHaveCount(1);
  await page.getByText("Sample data — My demo run").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("demo-banner")).toBeVisible();
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the demo options and the demo itself are usable at 390px", async ({ page }) => {
    await page.goto("/");
    const btn = page.getByTestId("advanced-demo-btn");
    await btn.scrollIntoViewIfNeeded();
    const b = (await btn.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(391);
    await btn.click();
    await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });

    for (const id of ["demo-banner", "demo-tour", "month-review"]) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.x, id).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, id).toBeLessThanOrEqual(391);
    }
    const overflow = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      return Math.max(document.documentElement.scrollWidth - window.innerWidth, main.scrollWidth - main.clientWidth);
    });
    expect(overflow).toBeLessThanOrEqual(1);

    await page.getByTestId("demo-tour-go-duplicates").click();
    await expect(page.getByTestId("duplicates-panel")).toBeInViewport();
  });
});
