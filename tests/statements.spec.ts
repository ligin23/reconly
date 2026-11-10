/**
 * Reconly — statement balance verification on screen (Playwright), Phase 4.
 * The rules are covered by src/lib/review/__tests__/statements.test.ts.
 */
import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

const stmt = (name: string) => resolve(__dirname, "fixtures", "statements", name);
const fixture = (name: string) => resolve(__dirname, "fixtures", name);
const row = (page: Page, month: string) => page.locator(`[data-testid="month-row"][data-month="${month}"]`);

test("several months: statement balance shown per month, separately from matching", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("bank-file-input").setInputFiles([stmt("stmt-jan.csv"), stmt("stmt-feb.csv")]);
  await page.getByTestId("ledger-file-input").setInputFiles(stmt("stmt-ledger.csv"));
  await page.getByTestId("start-analysis-btn").click();
  // Both bank files have a title line above the header: accept the suggested row for each.
  await page.getByTestId("use-suggested-header").first().click();
  await page.getByTestId("use-suggested-header").first().click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15000 });

  const panel = page.getByTestId("month-review");
  await expect(panel.getByTestId("mr-statements")).toHaveText(
    "Statement balances: 1 verified · 1 with a mismatch"
  );
  // January: nothing unresolved AND statement verified. February: fee unmatched AND statement mismatch.
  await expect(row(page, "2026-01").getByTestId("month-status").first()).toHaveText("No unresolved items identified");
  await expect(row(page, "2026-01").getByTestId("month-statement-cell")).toHaveText("Statement balance verified");
  await expect(row(page, "2026-02").getByTestId("month-status").first()).toHaveText("Review needed");
  await expect(row(page, "2026-02").getByTestId("month-statement-cell")).toHaveText("Statement balance mismatch");
  await expect(panel).not.toContainText(/fully reconciled/i);

  // Month detail: the stated figures and the exact difference.
  await row(page, "2026-02").getByTestId("month-view").click();
  const check = panel.getByTestId("month-statement").getByTestId("statement-check");
  await expect(check).toHaveAttribute("data-status", "mismatch");
  await expect(check.getByTestId("statement-figures")).toContainText("Opening $2,154.90 (stated, line 3)");
  await expect(check.getByTestId("statement-figures")).toContainText("difference −$57.10");
  await expect(check).toContainText("gives $1,242.90, but the file states a closing balance of $1,300.00");

  // Coverage notes mention the check, and coverage is still not called verified.
  await panel.getByTestId("mr-coverage-toggle").click();
  await expect(panel.getByTestId("mr-coverage-finding").first()).toContainText("1 with stated balances verified, 0 with a consistent running balance only, 1 with a mismatch");
  await expect(panel.getByTestId("mr-coverage")).toContainText("Coverage not verified");

  // The overall verdict is unchanged by the statement check: still about the $12.00 fee.
  await expect(page.getByTestId("recon-status")).toContainText("12.00");
});

test("a single month still shows statement balance and source notes in a compact card", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("bank-file-input").setInputFiles(fixture("bank_one_fee.csv"));
  await page.getByTestId("ledger-file-input").setInputFiles(fixture("ledger_missing_fee.csv"));
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15000 });

  await expect(page.getByTestId("month-review")).toHaveCount(0); // multi-month panel stays hidden
  const card = page.getByTestId("source-checks");
  // The file states an opening balance and a running balance, but no closing
  // balance: internal consistency only — not statement verification.
  await expect(card.getByTestId("source-checks-headline")).toContainText("Statement balances: 1 running balance consistent only");
  await expect(page.getByTestId("status-statements")).toContainText("Running balance consistent — stated balances not verified");
  await expect(card).toContainText("Coverage not verified");
  await card.getByTestId("source-checks-toggle").click();
  await expect(card.getByTestId("statement-check")).toHaveAttribute("data-status", "running-consistent");
  await expect(card.getByTestId("statement-check")).toContainText("Running balance consistency verified");
  await expect(card.getByTestId("statement-figures")).toContainText("(last running balance)");
  await expect(card.getByTestId("statement-figures")).toContainText("(stated, line 2)");
  await expect(card.getByTestId("source-checks-finding").first()).toContainText(/statement balances were checked/i);
});

test("a single month with no balance information says so instead of staying silent", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("bank-file-input").setInputFiles(resolve(__dirname, "fixtures", "dupes", "bank-twin.csv"));
  await page.getByTestId("ledger-file-input").setInputFiles(resolve(__dirname, "fixtures", "dupes", "ledger-twin.csv"));
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("source-checks-headline")).toContainText("Not verified — the uploaded bank file does not carry enough balance information to check");
  await expect(page.getByTestId("status-statements")).toContainText("Not verified");
});

test("transactions match but the statement's balances don't add up → not 'Fully reconciled'", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("bank-file-input").setInputFiles(stmt("stmt-jan-bad-closing.csv"));
  await page.getByTestId("ledger-file-input").setInputFiles(stmt("stmt-ledger-jan.csv"));
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("use-suggested-header").click();
  await page.getByTestId("confirm-mapping-btn").click();
  const status = page.getByTestId("recon-status");
  await expect(status).toBeVisible({ timeout: 15000 });

  await expect(status).toContainText("Transactions match — statement review needed");
  await expect(status).not.toContainText(/fully reconciled/i);
  await expect(status).toContainText("$0.00"); // totals and matches are untouched

  // Three separate statuses, side by side.
  await expect(page.getByTestId("status-financial")).toContainText("Totals agree — nothing left open");
  await expect(page.getByTestId("status-duplicates")).toContainText("No repeated rows found");
  await expect(page.getByTestId("status-statements")).toContainText("Statement review needed");
  await expect(page.getByTestId("status-statements")).toContainText("1 bank file needs review");

  const card = page.getByTestId("source-checks");
  await expect(card.getByTestId("source-checks-headline")).toContainText("1 with a mismatch");
  await card.getByTestId("source-checks-toggle").click();
  await expect(card.getByTestId("statement-check")).toHaveAttribute("data-status", "mismatch");
  await expect(card.getByTestId("statement-figures")).toContainText("difference −$7,844.10");

  // Saved status is "in progress", never "reconciled".
  await page.getByTestId("save-btn").click();
  await page.getByTestId("save-account-name").fill("Statement Mismatch Account");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByTestId("save-btn")).toHaveText(/save changes/i);
  await page.getByTestId("nav-history").click();
  await expect(page.getByText(/statement mismatch account/i).first()).toBeVisible();
  const main = page.locator("main");
  await expect(main.getByText("In progress", { exact: true })).toBeVisible();
  await expect(main.getByText("Reconciled", { exact: true })).toHaveCount(0);
});

test("fully reconciled with no statement evidence says 'Not verified' beside the all-clear", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("bank-file-input").setInputFiles(stmt("stmt-ledger-jan.csv"));
  await page.getByTestId("ledger-file-input").setInputFiles(stmt("stmt-ledger-jan.csv"));
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  const status = page.getByTestId("recon-status");
  await expect(status).toContainText(/fully reconciled/i, { timeout: 15000 });
  await expect(status.getByTestId("reconciled-statement-note")).toContainText("Statement balances: Not verified");
  await expect(page.getByTestId("status-statements")).toContainText("Not verified");
  await expect(page.getByTestId("status-statements")).toContainText("missing evidence, not an error");
});
