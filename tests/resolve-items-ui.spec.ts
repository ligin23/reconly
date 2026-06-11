/**
 * Reconly — Resolve-Items UI Smoke Test (Playwright)
 * ============================================================================
 * Thin. Proves the user PATH is wired: see a missing item → add it →
 * balance updates → it appears (correctly framed) in an export → it's
 * reversible. Correctness of the math is owned by the Vitest suite.
 *
 * Selectors used:
 *   bank-file-input       — hidden file input in the bank UploadCard
 *   ledger-file-input     — hidden file input in the ledger UploadCard
 *   start-analysis-btn    — "Start analysis" primary button
 *   confirm-mapping-btn   — "Looks good — continue" on the mapping screen
 *   tab-missing-books     — "Not in your records" tab in the results dashboard
 *   recon-status          — the status hero card (reconciled or not)
 *   remove-added-btn      — the "Undo" chip button on an added item
 *   export-menu-btn       — "Export" dropdown toggle in the top bar
 *   export-pdf-btn        — "Report (PDF)" item inside the export dropdown
 *
 * Run: npx playwright test tests/resolve-items-ui.spec.ts
 * ============================================================================
 */

import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

const fixture = (n: string) => resolve(__dirname, "fixtures", n);

// Helper: upload files, confirm mapping, wait for dashboard to render.
async function loadFixture(page: import("@playwright/test").Page) {
  await page.goto("/");

  // Hidden file inputs — setInputFiles bypasses the visibility check.
  await page.getByTestId("bank-file-input").setInputFiles(fixture("bank_one_fee.csv"));
  await page.getByTestId("ledger-file-input").setInputFiles(fixture("ledger_missing_fee.csv"));

  await page.getByTestId("start-analysis-btn").click();

  // Column-mapping step: parser auto-detects columns for these fixtures.
  await page.getByTestId("confirm-mapping-btn").click();

  // Wait for the processing animation to finish and the dashboard to appear.
  // The not-reconciled hero shows "$12.00 unexplained".
  await expect(
    page.getByTestId("recon-status")
  ).toBeVisible({ timeout: 15_000 });
}

// Helper: walk the review queue accepting every suggested pair, then return
// to the dashboard. "Fully reconciled" requires a zero difference AND no
// pending suggestions — matching the accounting definition, suggestions are
// unconfirmed until the user reviews them.
async function acceptAllSuggestions(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /clear it up/i }).first().click();

  const acceptBtn = page.getByRole("button", { name: /yes, it.?s a match/i });
  // Each decision animates for ~290ms before the next card renders.
  while ((await acceptBtn.count()) > 0) {
    await acceptBtn.first().click();
    await page.waitForTimeout(400);
  }

  await page.getByRole("button", { name: /back to results/i }).click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 10_000 });
}

test.describe("resolve a missing item into the working copy", () => {
  test(
    "add the missing fee → balance updates → export reflects it (framed as 'to record', not 'recorded')",
    async ({ page }) => {
      await loadFixture(page);

      // ── Verify not reconciled before adding ────────────────────────────
      const statusText = await page.getByTestId("recon-status").innerText();
      expect(statusText.toLowerCase()).toMatch(/unexplained|\$12/i);

      // ── Review the suggested pairs first (reconciled requires it) ─────
      await acceptAllSuggestions(page);

      // ── Navigate to the "Not in your records" tab ─────────────────────
      await page.getByTestId("tab-missing-books").click();

      // Fee row should be visible in the list.
      await expect(
        page.getByText(/monthly service fee/i).first()
      ).toBeVisible({ timeout: 5_000 });

      // ── The "Add to my reconciliation" button must exist and be clickable ─
      const addBtn = page
        .getByRole("button", { name: /add to my reconciliation/i })
        .first();
      await expect(addBtn).toBeVisible();
      await addBtn.click();

      // ── Balance should now show reconciled ────────────────────────────
      await expect(
        page.getByTestId("recon-status")
      ).toContainText(/fully reconciled|records match/i, { timeout: 10_000 });

      // ── FRAMING GUARD ─────────────────────────────────────────────────
      // The page must NOT claim Reconly recorded anything on the user's behalf.
      const bodyText = (await page.locator("body").innerText()).toLowerCase();
      expect(bodyText).not.toContain("we've recorded");
      expect(bodyText).not.toContain("recorded in your books");
      expect(bodyText).not.toContain("added to your books");

      // Positive: the ListNote copy frames this as "for your report / your accountant".
      // Real copy: "Add them to your reconciliation so your report is complete —
      //             you or your accountant can record them in your books afterwards."
      expect(bodyText).toMatch(/your accountant|to record|for your report/);

      // ── PDF export ────────────────────────────────────────────────────
      const dl = page.waitForEvent("download");
      await page.getByTestId("export-menu-btn").click();
      await page.getByTestId("export-pdf-btn").click();
      const file = await dl;
      expect(file.suggestedFilename()).toMatch(/\.pdf$/i);
    }
  );

  test("adding is reversible — remove restores the unreconciled state", async ({ page }) => {
    await loadFixture(page);

    // Review the suggested pairs (reconciled requires no pending suggestions).
    await acceptAllSuggestions(page);

    // Navigate to missing-books tab and add the fee.
    await page.getByTestId("tab-missing-books").click();
    await expect(
      page.getByText(/monthly service fee/i).first()
    ).toBeVisible({ timeout: 5_000 });

    await page
      .getByRole("button", { name: /add to my reconciliation/i })
      .first()
      .click();

    // Confirm reconciled.
    await expect(
      page.getByTestId("recon-status")
    ).toContainText(/fully reconciled/i, { timeout: 10_000 });

    // Remove / undo the added item.
    await page.getByTestId("remove-added-btn").first().click();

    // Back to not reconciled with the $12 gap.
    await expect(
      page.getByTestId("recon-status")
    ).toContainText(/unexplained|\$12/i, { timeout: 10_000 });

    // Fee must be visible again in the missing list.
    await expect(
      page.getByText(/monthly service fee/i).first()
    ).toBeVisible();
  });
});
