/**
 * Phase 6A — deleting individual saved reconciliations (History).
 * Confirmation, cancel, only-the-chosen-record, persistence after reload and
 * navigation, the currently open record, double clicks, storage failures,
 * the empty list, and sample / Advanced Demo records.
 */
import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

const fixture = (name: string) => resolve(__dirname, "fixtures", name);

async function saveAs(page: Page, name: string) {
  await page.getByTestId("save-btn").click();
  await page.getByTestId("save-account-name").fill(name);
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByTestId("save-btn")).toHaveText(/save changes/i);
}

async function runOwnFiles(page: Page) {
  await page.goto("/app");
  await page.getByTestId("bank-file-input").setInputFiles(fixture("clean_bank.csv"));
  await page.getByTestId("ledger-file-input").setInputFiles(fixture("clean_ledger.csv"));
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
}

async function runSample(page: Page) {
  await page.goto("/app");
  await page.getByTestId("try-sample-btn").click();
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
}

async function runAdvancedDemo(page: Page) {
  await page.goto("/app");
  await page.getByTestId("advanced-demo-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
}

/** Three saved records: own files, original sample, Advanced Demo. */
async function seedThree(page: Page) {
  await runOwnFiles(page);
  await saveAs(page, "Alpha Checking");
  await runSample(page);
  await saveAs(page, "Bravo Sample");
  await runAdvancedDemo(page);
  await saveAs(page, "Charlie Demo"); // saved as "Sample data — Charlie Demo"
}

const rows = (page: Page) => page.getByTestId("history-row");
const rowNamed = (page: Page, name: string) => rows(page).filter({ hasText: name });

async function storedNames(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("reconly");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction("reconciliations").objectStore("reconciliations").getAll();
          req.onsuccess = () => {
            resolve((req.result as { accountName: string }[]).map((r) => r.accountName).sort());
            open.result.close();
          };
          req.onerror = () => reject(req.error);
        };
      })
  );
}

async function openHistory(page: Page) {
  // At phone width the sidebar is a drawer behind the menu button.
  if (!(await page.getByTestId("nav-history").isVisible())) await page.getByTestId("menu-btn").click();
  await page.getByTestId("nav-history").click();
  await expect(page.locator("header").getByText("History", { exact: true })).toBeVisible();
}

test("cancel keeps the record; confirming deletes only the chosen one, also after reload and navigation", async ({ page }) => {
  await seedThree(page);
  await page.reload();
  await openHistory(page);
  await expect(rows(page)).toHaveCount(3);

  // Cancel (button) — nothing happens.
  await rowNamed(page, "Bravo Sample").getByTestId("history-delete").click();
  const dialog = page.getByTestId("delete-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "alertdialog");
  await expect(page.getByTestId("delete-dialog-target")).toContainText("Bravo Sample");
  await expect(page.getByTestId("delete-cancel")).toBeFocused(); // safe default
  await page.getByTestId("delete-cancel").click();
  await expect(dialog).toHaveCount(0);
  // Cancel (Escape) — nothing happens either.
  await rowNamed(page, "Bravo Sample").getByTestId("history-delete").click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(rows(page)).toHaveCount(3);
  expect(await storedNames(page)).toEqual(["Alpha Checking", "Bravo Sample", "Sample data — Charlie Demo"]);
  // The delete button never opens the record.
  await expect(page.getByTestId("recon-status")).toHaveCount(0);

  // Confirm.
  await rowNamed(page, "Bravo Sample").getByTestId("history-delete").click();
  await page.getByTestId("delete-confirm").click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("delete-status")).toContainText("Deleted “Bravo Sample”");
  await expect(rows(page)).toHaveCount(2);
  await expect(rowNamed(page, "Bravo Sample")).toHaveCount(0);
  expect(await storedNames(page)).toEqual(["Alpha Checking", "Sample data — Charlie Demo"]);

  // Refresh: still gone, others intact.
  await page.reload();
  await openHistory(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(rowNamed(page, "Bravo Sample")).toHaveCount(0);

  // Navigate away and back.
  await page.getByTestId("sidebar").getByRole("button", { name: /upload files/i }).click();
  await openHistory(page);
  await expect(rows(page)).toHaveCount(2);

  // The remaining records still open with their results.
  await rowNamed(page, "Alpha Checking").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
  await openHistory(page);
  await rowNamed(page, "Charlie Demo").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("demo-banner")).toBeVisible();
});

test("deleting the record that is open keeps the work on screen as unsaved", async ({ page }) => {
  await runOwnFiles(page);
  await saveAs(page, "Alpha Checking");
  await runSample(page);
  await saveAs(page, "Bravo Sample");
  const statusBefore = await page.getByTestId("recon-status").textContent();

  await openHistory(page);
  await rowNamed(page, "Bravo Sample").getByTestId("history-delete").click();
  await expect(page.getByTestId("delete-dialog-open-note")).toBeVisible();
  await page.getByTestId("delete-confirm").click();
  await expect(rows(page)).toHaveCount(1);
  expect(await storedNames(page)).toEqual(["Alpha Checking"]);

  // The open reconciliation is still there, unchanged, but no longer saved.
  await page.getByTestId("sidebar").getByRole("button", { name: /results/i }).click();
  await expect(page.getByTestId("recon-status")).toHaveText(statusBefore!);
  await expect(page.getByTestId("save-btn")).not.toHaveText(/save changes/i);
  // Saving again creates a new record rather than resurrecting the old id.
  await saveAs(page, "Bravo Again");
  expect(await storedNames(page)).toEqual(["Alpha Checking", "Bravo Again"]);
});

test("the note about an open record is not shown for other records", async ({ page }) => {
  await runOwnFiles(page);
  await saveAs(page, "Alpha Checking");
  await runSample(page);
  await saveAs(page, "Bravo Sample");
  await openHistory(page);
  await rowNamed(page, "Alpha Checking").getByTestId("history-delete").click();
  await expect(page.getByTestId("delete-dialog-open-note")).toHaveCount(0);
});

test("a double click on Delete removes one record, never two", async ({ page }) => {
  await seedThree(page);
  await openHistory(page);
  await rowNamed(page, "Alpha Checking").getByTestId("history-delete").click();
  await page.getByTestId("delete-confirm").dblclick();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByTestId("delete-error")).toHaveCount(0);
  expect(await storedNames(page)).toEqual(["Bravo Sample", "Sample data — Charlie Demo"]);
});

test("a storage failure keeps the record and says nothing was removed", async ({ page }) => {
  await runOwnFiles(page);
  await saveAs(page, "Alpha Checking");
  await openHistory(page);
  await page.evaluate(() => {
    IDBObjectStore.prototype.delete = function () {
      throw new DOMException("Simulated storage failure", "UnknownError");
    };
  });
  await rowNamed(page, "Alpha Checking").getByTestId("history-delete").click();
  await page.getByTestId("delete-confirm").click();
  await expect(page.getByTestId("delete-error")).toContainText("nothing was removed");
  await expect(page.getByTestId("delete-dialog")).toBeVisible(); // can retry or cancel
  await expect(page.getByTestId("delete-confirm")).toBeEnabled();
  await page.getByTestId("delete-cancel").click();
  await expect(rows(page)).toHaveCount(1);

  await page.reload();
  await openHistory(page);
  await expect(rowNamed(page, "Alpha Checking")).toHaveCount(1);
  expect(await storedNames(page)).toEqual(["Alpha Checking"]);
});

test("deleting the last record shows the empty list", async ({ page }) => {
  await runOwnFiles(page);
  await saveAs(page, "Alpha Checking");
  await openHistory(page);
  await rowNamed(page, "Alpha Checking").getByTestId("history-delete").click();
  await page.getByTestId("delete-confirm").click();
  await expect(page.getByText("No saved reconciliations yet")).toBeVisible();
  await expect(page.getByTestId("delete-status")).toBeVisible();
  await page.reload();
  await openHistory(page);
  await expect(page.getByText("No saved reconciliations yet")).toBeVisible();
  expect(await storedNames(page)).toEqual([]);
});

test("the delete control is keyboard reachable and labelled with the record", async ({ page }) => {
  await runOwnFiles(page);
  await saveAs(page, "Alpha Checking");
  await openHistory(page);
  const del = page.getByRole("button", { name: /^Delete saved reconciliation Alpha Checking/ });
  await expect(del).toBeVisible();
  await del.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("delete-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
});

for (const [w, h] of [[375, 812], [390, 844], [768, 1024], [1440, 900]] as const) {
  test(`history with delete controls fits at ${w}px`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await runOwnFiles(page);
    await saveAs(page, "A fairly long account name for layout checks");
    await openHistory(page);
    await expect(page.getByTestId("history-delete")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
    await page.getByTestId("history-delete").click();
    const box = await page.getByTestId("delete-dialog").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(w);
    await expect(page.getByTestId("delete-confirm")).toBeInViewport();
  });
}
