/**
 * Reconly — UI Smoke Test (Playwright)
 * ============================================================================
 * Deliberately THIN. This does NOT re-test matching correctness — the Vitest
 * engine suite owns that. This only proves the critical user path is wired:
 * upload → analyze → see a verdict → export. If this passes, the plumbing
 * works; if the engine tests pass, the answer is right. You need both.
 *
 * WIRING NOTES
 * ─────────────────────────────────────────────────────────────────────────────
 * All selectors use data-testid attributes added during the wiring pass:
 *   bank-file-input      — hidden <input type="file"> in the bank UploadCard
 *   ledger-file-input    — hidden <input type="file"> in the ledger UploadCard
 *   start-analysis-btn   — "Start analysis" primary button on upload screen
 *   confirm-mapping-btn  — "Looks good — continue" on the mapping screen
 *                          (the app has a column-mapping step between upload
 *                          and results; the parser auto-detects columns so
 *                          clicking confirm without changes is correct)
 *   export-menu-btn      — "Export" dropdown toggle in the top bar
 *   export-pdf-btn       — "Report (PDF)" item inside the export dropdown
 *   export-excel-btn     — "Worksheet (Excel)" item inside the export dropdown
 *   save-btn             — "Save reconciliation" button in the top bar
 *   save-account-name    — account name text input in the Save dialog
 *   nav-history          — "Past reconciliations" button in the sidebar
 *
 * Dev server: configured in playwright.config.ts via `webServer` so the test
 * starts Next.js automatically. Run: npx playwright test tests/ui-smoke.spec.ts
 * ============================================================================
 */

import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

const fixture = (name: string) => resolve(__dirname, "fixtures", name);

test.describe("critical path: upload → verdict → export", () => {
  test("not-reconciled files produce an honest verdict and downloadable exports", async ({ page }) => {
    await page.goto("/");

    // --- Upload both files (hidden inputs; setInputFiles bypasses visibility) ---
    await page.getByTestId("bank-file-input").setInputFiles(fixture("bank_statement.csv"));
    await page.getByTestId("ledger-file-input").setInputFiles(fixture("ledger.csv"));

    // --- Start analysis ---
    await page.getByTestId("start-analysis-btn").click();

    // --- Column-mapping screen: parser auto-detects columns; just confirm ---
    await page.getByTestId("confirm-mapping-btn").click();

    // --- Processing animation runs (~4 s); land on results ---
    // The not-reconciled hero renders the dollar amount (e.g. "$3,191.41 unexplained")
    await expect(
      page.getByText(/not reconciled|differ by|\$[\d,]+\.\d{2}/i).first()
    ).toBeVisible({ timeout: 15000 });

    // --- KPI cards render ---
    await expect(page.getByText(/matched/i).first()).toBeVisible();
    await expect(page.getByText(/need.*review|missing/i).first()).toBeVisible();

    // --- PDF export: open dropdown, click item, assert download ---
    const pdfDownload = page.waitForEvent("download");
    await page.getByTestId("export-menu-btn").click();
    await page.getByTestId("export-pdf-btn").click();
    const pdf = await pdfDownload;
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/i);

    // --- Excel export: re-open dropdown, click item, assert download ---
    const xlsxDownload = page.waitForEvent("download");
    await page.getByTestId("export-menu-btn").click();
    await page.getByTestId("export-excel-btn").click();
    const xlsx = await xlsxDownload;
    expect(xlsx.suggestedFilename()).toMatch(/\.(xlsx|xls)$/i);
  });

  test("reconciled files show the all-clear verdict", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("bank-file-input").setInputFiles(fixture("clean_bank.csv"));
    await page.getByTestId("ledger-file-input").setInputFiles(fixture("clean_ledger.csv"));
    await page.getByTestId("start-analysis-btn").click();
    await page.getByTestId("confirm-mapping-btn").click();

    // The reconciled hero renders "Fully reconciled"
    await expect(
      page.getByText(/reconciled|records match|all.*match/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test("persistence: a completed reconciliation survives reload and reopens", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("bank-file-input").setInputFiles(fixture("clean_bank.csv"));
    await page.getByTestId("ledger-file-input").setInputFiles(fixture("clean_ledger.csv"));
    await page.getByTestId("start-analysis-btn").click();
    await page.getByTestId("confirm-mapping-btn").click();
    await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15000 });

    // "Fully reconciled" requires the suggested pairs to be reviewed — a
    // zero difference with pending suggestions is in-progress, not done.
    await page.getByRole("button", { name: /clear it up/i }).first().click();
    const acceptBtn = page.getByRole("button", { name: /yes, it.?s a match/i });
    while ((await acceptBtn.count()) > 0) {
      await acceptBtn.first().click();
      await page.waitForTimeout(400); // decision animation (~290ms)
    }
    await page.getByRole("button", { name: /back to results/i }).click();
    await expect(page.getByText(/fully reconciled|records match/i).first()).toBeVisible({ timeout: 15000 });

    // --- Save the reconciliation via the Save dialog ---
    await page.getByTestId("save-btn").click();
    // Fill account name (required field); period dates auto-populated from CSV dates
    await page.getByTestId("save-account-name").fill("Smoke Test Account");
    await page.getByRole("button", { name: /^save$/i }).click();

    // Wait for the IndexedDB write to land before reloading: the top-bar
    // button flips to "Save changes" only after saveReconciliation resolves.
    // Reloading immediately can abort the in-flight async write.
    await expect(page.getByTestId("save-btn")).toHaveText(/save changes/i);

    // --- Reload and navigate to history ---
    await page.reload();
    await page.getByTestId("nav-history").click();

    // The saved record should appear in the history list by its account name
    await expect(page.getByText(/smoke test account/i)).toBeVisible({ timeout: 5000 });
  });
});
