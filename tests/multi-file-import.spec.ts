/**
 * Reconly — multi-file import (Playwright), Phase 1.
 * Thin wiring checks; the import logic itself is covered by the Vitest
 * suites (parser header-row tests, lib/import/combine tests).
 */
import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

const multi = (name: string) => resolve(__dirname, "fixtures", "multi", name);
const fixture = (name: string) => resolve(__dirname, "fixtures", name);

test("several files per side, a title-row file, and provenance on the results", async ({ page }) => {
  await page.goto("/app");

  // Two bank files (one with title lines above the header) + one ledger file.
  await page
    .getByTestId("bank-file-input")
    .setInputFiles([multi("bank-jan-titled.csv"), multi("bank-feb.csv")]);
  await page.getByTestId("ledger-file-input").setInputFiles(multi("ledger-jan-feb.csv"));
  await expect(page.getByTestId("uploaded-file")).toHaveCount(3);

  await page.getByTestId("start-analysis-btn").click();

  // The header row is suggested, never applied silently: until the user
  // accepts it, the file can't be mapped and "continue" stays disabled.
  await expect(page.getByTestId("header-row-suggestion")).toHaveCount(1);
  await expect(page.getByTestId("header-row-suggestion")).toContainText(/row 4/i);
  await expect(page.getByTestId("confirm-mapping-btn")).toBeDisabled();

  await page.getByTestId("use-suggested-header").click();
  await expect(page.getByTestId("header-row-suggestion")).toHaveCount(0);
  // Both bank files now have the same columns, so they share one mapping card.
  await expect(page.getByText(/2 files with the same columns/i)).toBeVisible();
  await expect(page.getByTestId("confirm-mapping-btn")).toBeEnabled();
  await page.getByTestId("confirm-mapping-btn").click();

  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15000 });
  // The only real gap is February's $12.00 fee.
  await expect(page.getByTestId("recon-status")).toContainText("12.00");

  // Provenance: the unmatched fee names its file and its row in that file.
  await page.getByTestId("tab-missing-books").click();
  await expect(page.getByText(/monthly service fee/i).first()).toBeVisible();
  await expect(page.getByTestId("txn-source").first()).toHaveText(/bank-feb\.csv · row 4/);

  // Cross-month pairs (cheque written in Jan, cleared in Feb) reach review.
  await page.getByRole("button", { name: /clear it up/i }).first().click();
  await expect(page.getByText(/0 of 2 reviewed/)).toBeVisible();
});

test("overlapping files are all kept and the overlap is reported", async ({ page }) => {
  await page.goto("/app");
  await page
    .getByTestId("bank-file-input")
    .setInputFiles([multi("bank-feb.csv"), multi("bank-late-jan.csv")]);
  await page.getByTestId("bank-file-input").setInputFiles(multi("bank-jan-titled.csv"));
  await page.getByTestId("ledger-file-input").setInputFiles(multi("ledger-jan-feb.csv"));
  await expect(page.getByTestId("uploaded-file")).toHaveCount(4);

  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("use-suggested-header").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15000 });

  const notices = page.getByTestId("parse-notices");
  await expect(notices).toContainText(/both cover/i);
  await expect(notices).toContainText(/nothing was removed/i);
  await expect(notices).toContainText("bank-jan-titled.csv");
  await expect(notices).toContainText("bank-late-jan.csv");

  // The repeated $1,200 payment was NOT dropped: it shows as unmatched.
  await page.getByTestId("tab-missing-books").click();
  await expect(page.getByText(/client payment acme/i).first()).toBeVisible();
});

test("upload guards: same file twice, Excel workbook, and the CSV guide", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("csv-guide")).toBeVisible();

  await page.getByTestId("bank-file-input").setInputFiles(fixture("clean_bank.csv"));
  await expect(page.getByTestId("uploaded-file")).toHaveCount(1);
  await page.getByTestId("bank-file-input").setInputFiles(fixture("clean_bank.csv"));
  await expect(page.getByTestId("upload-error")).toContainText(/exactly the same contents/i);
  await expect(page.getByTestId("uploaded-file")).toHaveCount(1);

  await page.getByTestId("ledger-file-input").setInputFiles({
    name: "ledger.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("PK\u0003\u0004 not really a workbook"),
  });
  await expect(page.getByTestId("upload-error")).toContainText(/Excel workbook/i);
  await expect(page.getByTestId("uploaded-file")).toHaveCount(1);
  await expect(page.getByTestId("start-analysis-btn")).toBeDisabled();
});

test("a multi-file reconciliation survives save, reload and reopen with provenance", async ({ page }) => {
  await page.goto("/app");
  await page
    .getByTestId("bank-file-input")
    .setInputFiles([multi("bank-jan-titled.csv"), multi("bank-feb.csv")]);
  await page.getByTestId("ledger-file-input").setInputFiles(multi("ledger-jan-feb.csv"));
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("use-suggested-header").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15000 });

  await page.getByTestId("save-btn").click();
  await page.getByTestId("save-account-name").fill("Multi File Account");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByTestId("save-btn")).toHaveText(/save changes/i);

  await page.reload();
  await page.getByTestId("nav-history").click();
  await page.getByText(/multi file account/i).click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("tab-missing-books").click();
  await expect(page.getByTestId("txn-source").first()).toHaveText(/bank-feb\.csv · row 4/);
});
