/**
 * Reconly — duplicate & overlap review (Playwright), Phase 2.
 * Thin wiring checks over the real UI; the rules are covered by the Vitest
 * suites in src/lib/import/__tests__.
 */
import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

const dupes = (name: string) => resolve(__dirname, "fixtures", "dupes", name);
const multi = (name: string) => resolve(__dirname, "fixtures", "multi", name);

async function analyze(page: Page, bank: string[], ledger: string, titled = false) {
  await page.goto("/");
  await page.getByTestId("bank-file-input").setInputFiles(bank);
  await page.getByTestId("ledger-file-input").setInputFiles(ledger);
  await page.getByTestId("start-analysis-btn").click();
  if (titled) await page.getByTestId("use-suggested-header").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15000 });
}

test("proven copies are set aside automatically, stay visible, and can be restored", async ({ page }) => {
  await analyze(page, [dupes("bank-jan-ids.csv"), dupes("bank-q1-ids.csv")], dupes("ledger-q1.csv"));

  // Totals reflect rows in use only: the one real gap is the $12.00 fee.
  await expect(page.getByTestId("recon-status")).toContainText("12.00");
  await expect(page.getByTestId("parse-notices")).toContainText(/3 repeated rows were set aside automatically/i);

  const panel = page.getByTestId("duplicates-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("dup-counts-bank")).toHaveText(/8 rows imported · 5 in use · 3 set aside/);
  await expect(panel.getByTestId("dup-counts-ledger")).toHaveText(/4 rows imported · 4 in use · 0 set aside/);
  await expect(panel.getByTestId("dup-overlaps")).toContainText("bank-jan-ids.csv");

  // Every set-aside row is shown with its reason, file and row number.
  const done = panel.getByTestId("dup-section-set-aside");
  await expect(done.getByTestId("dup-group")).toHaveCount(3);
  const first = done.getByTestId("dup-group").first();
  await expect(first.getByTestId("dup-evidence")).toContainText(/same transaction ID \(TX1\)/);
  await expect(first.getByTestId("dup-row-source")).toHaveText(["bank-jan-ids.csv · row 2", "bank-q1-ids.csv · row 2"]);
  await expect(first).toContainText("Set aside automatically");
  await first.getByRole("button", { name: /show row/i }).last().click();
  await expect(first.getByTestId("dup-original-row")).toContainText("TX1");

  // One click restores it; totals are recomputed and the group needs a decision.
  await first.getByTestId("dup-restore").click();
  await expect(panel.getByTestId("dup-counts-bank")).toHaveText(/8 rows imported · 6 in use · 2 set aside/);
  await expect(page.getByTestId("recon-status")).toContainText("57.10"); // 12.00 + the restored 45.10
  const check = panel.getByTestId("dup-section-check");
  await expect(check.getByTestId("dup-group")).toHaveCount(1);

  // …and one click sets it aside again.
  await check.getByTestId("dup-set-aside-repeats").click();
  await expect(panel.getByTestId("dup-counts-bank")).toHaveText(/8 rows imported · 5 in use · 3 set aside/);
  await expect(page.getByTestId("recon-status")).toContainText("12.00");
});

test("duplicate decisions survive save, reload and reopen", async ({ page }) => {
  await analyze(page, [dupes("bank-jan-ids.csv"), dupes("bank-q1-ids.csv")], dupes("ledger-q1.csv"));
  const panel = page.getByTestId("duplicates-panel");
  // Change one decision so the saved state differs from the automatic one.
  await panel.getByTestId("dup-section-set-aside").getByTestId("dup-group").first().getByTestId("dup-restore").click();
  await panel.getByTestId("dup-section-check").getByTestId("dup-keep-all").click();
  await expect(panel.getByTestId("dup-counts-bank")).toHaveText(/8 rows imported · 6 in use · 2 set aside/);

  await page.getByTestId("save-btn").click();
  await page.getByTestId("save-account-name").fill("Duplicate Review Account");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByTestId("save-btn")).toHaveText(/save changes/i);

  await page.reload();
  await page.getByTestId("nav-history").click();
  await page.getByText(/duplicate review account/i).click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15000 });

  const reopened = page.getByTestId("duplicates-panel");
  await expect(reopened.getByTestId("dup-counts-bank")).toHaveText(/8 rows imported · 6 in use · 2 set aside/);
  await expect(reopened.getByTestId("dup-section-kept")).toBeVisible();
  await expect(reopened.getByTestId("dup-section-check")).toHaveCount(0);
  await expect(page.getByTestId("recon-status")).toContainText("57.10");
});

test("without proof nothing is set aside; the user decides, and can undo", async ({ page }) => {
  await analyze(
    page,
    [multi("bank-feb.csv"), multi("bank-late-jan.csv"), multi("bank-jan-titled.csv")],
    multi("ledger-jan-feb.csv"),
    true
  );
  const panel = page.getByTestId("duplicates-panel");
  await expect(panel.getByTestId("dup-counts-bank")).toHaveText(/8 rows imported · 8 in use · 0 set aside/);
  await expect(panel).toContainText(/1 possible duplicate to check/i);
  await expect(page.getByTestId("recon-status")).toContainText("1,180.00");

  const group = panel.getByTestId("dup-section-check").getByTestId("dup-group");
  await expect(group).toHaveCount(1);
  await expect(group.getByTestId("dup-evidence")).toContainText(/nothing was set aside/i);
  await expect(group.getByTestId("dup-row-source")).toHaveText(["bank-jan-titled.csv · row 6", "bank-late-jan.csv · row 2"]);

  // The user says it is a repeat → the copy leaves the totals.
  await group.getByTestId("dup-set-aside-repeats").click();
  await expect(panel.getByTestId("dup-counts-bank")).toHaveText(/8 rows imported · 7 in use · 1 set aside/);
  await expect(page.getByTestId("recon-status")).toContainText("20.00");
  await expect(panel.getByTestId("dup-section-set-aside").getByTestId("dup-group")).toContainText("Set aside by you");

  // Undo: restore, then record that the two are separate instead.
  await panel.getByTestId("dup-section-set-aside").getByTestId("dup-restore").click();
  await expect(page.getByTestId("recon-status")).toContainText("1,180.00");
  await panel.getByTestId("dup-section-check").getByTestId("dup-keep-all").click();
  await expect(panel.getByTestId("dup-counts-bank")).toHaveText(/8 rows imported · 8 in use · 0 set aside/);
  await expect(panel.getByTestId("dup-section-check")).toHaveCount(0);
  await expect(page.getByTestId("recon-status")).toContainText("1,180.00"); // totals untouched
});

test("provenance shows on review cards and both exports still download", async ({ page }) => {
  await analyze(page, [multi("bank-jan-titled.csv"), multi("bank-feb.csv")], multi("ledger-jan-feb.csv"), true);
  // No repeated rows and no overlap here → the panel stays out of the way.
  await expect(page.getByTestId("duplicates-panel")).toHaveCount(0);

  const pdf = page.waitForEvent("download");
  await page.getByTestId("export-menu-btn").click();
  await page.getByTestId("export-pdf-btn").click();
  expect((await pdf).suggestedFilename()).toMatch(/\.pdf$/i);
  const xlsx = page.waitForEvent("download");
  await page.getByTestId("export-menu-btn").click();
  await page.getByTestId("export-excel-btn").click();
  expect((await xlsx).suggestedFilename()).toMatch(/\.xlsx$/i);

  await page.getByRole("button", { name: /clear it up/i }).first().click();
  const sources = page.getByTestId("review-source");
  await expect(sources).toHaveCount(2);
  await expect(sources.first()).toHaveText(/From bank-.*\.csv · row \d+/);
  await expect(sources.last()).toHaveText(/From ledger-jan-feb\.csv · row \d+/);
});

test("totals agree but duplicates are unreviewed → 'duplicate review needed', cleared by confirming", async ({ page }) => {
  await analyze(page, [dupes("bank-twin.csv")], dupes("ledger-twin.csv"));

  // The money agrees and nothing is unmatched — but it is NOT called fully reconciled.
  const status = page.getByTestId("recon-status");
  await expect(status).toContainText("Totals agree — duplicate review needed");
  await expect(status).not.toContainText(/fully reconciled/i);
  await expect(status).toContainText("$0.00"); // the financial side shows clean
  await expect(page.getByTestId("status-financial")).toContainText(/totals agree/i);
  await expect(page.getByTestId("status-duplicates")).toContainText(/2 possible duplicate groups to review/i);

  const panel = page.getByTestId("duplicates-panel");
  await expect(panel.getByTestId("dup-counts-bank")).toHaveText(/3 rows imported · 3 in use · 0 set aside/);

  // Confirm the first group as separate: still one to go.
  await panel.getByTestId("dup-section-check").getByTestId("dup-keep-all").first().click();
  await expect(status).toContainText("Totals agree — duplicate review needed");
  await expect(page.getByTestId("status-duplicates")).toContainText(/1 possible duplicate group to review/i);

  // Confirm the second: nothing blocks any more, and nothing was excluded.
  await panel.getByTestId("dup-section-check").getByTestId("dup-keep-all").first().click();
  await expect(status).toContainText(/fully reconciled/i);
  await expect(page.getByTestId("status-duplicates")).toContainText(/complete/i);
  await expect(panel.getByTestId("dup-counts-bank")).toHaveText(/3 rows imported · 3 in use · 0 set aside/);

  // Undo one confirmation → the verdict is recalculated.
  await panel.getByTestId("dup-section-kept").getByRole("button").first().click();
  await panel.getByTestId("dup-section-kept").getByRole("button", { name: /^undo$/i }).first().click();
  await expect(status).toContainText("Totals agree — duplicate review needed");
});

test("a real difference stays 'not reconciled' even with duplicates to review; restoring recalculates", async ({ page }) => {
  await analyze(page, [dupes("bank-jan-ids.csv"), dupes("bank-q1-ids.csv")], dupes("ledger-q1.csv"));
  const status = page.getByTestId("recon-status");
  // $12.00 fee is missing from the books; duplicates were all set aside.
  await expect(status).toContainText("12.00");
  await expect(status).not.toContainText(/totals agree/i);
  await expect(page.getByTestId("status-financial")).toContainText(/not reconciled/i);
  await expect(page.getByTestId("status-duplicates")).toContainText(/complete/i);

  // Restore one proven copy: both statuses now show a problem, kept separate.
  await page.getByTestId("duplicates-panel").getByTestId("dup-section-set-aside").getByTestId("dup-restore").first().click();
  await expect(status).toContainText("57.10");
  await expect(page.getByTestId("status-financial")).toContainText(/not reconciled/i);
  await expect(page.getByTestId("status-duplicates")).toContainText(/1 possible duplicate group to review/i);
});
