/**
 * Reconly — month-by-month Financial Review (Playwright), Phase 3.
 * Wiring checks plus a browser-level performance check on a 24-month
 * data set. The counting rules are covered by src/lib/review/__tests__.
 */
import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

const multi = (name: string) => resolve(__dirname, "fixtures", "multi", name);
const dupes = (name: string) => resolve(__dirname, "fixtures", "dupes", name);

async function analyze(page: Page, bank: string[], ledger: string, titled = false) {
  await page.goto("/app");
  await page.getByTestId("bank-file-input").setInputFiles(bank);
  await page.getByTestId("ledger-file-input").setInputFiles(ledger);
  await page.getByTestId("start-analysis-btn").click();
  if (titled) await page.getByTestId("use-suggested-header").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15000 });
}

const row = (page: Page, month: string) => page.locator(`[data-testid="month-row"][data-month="${month}"]`);

test("several months: overview, monthly table, month details with sources, coverage", async ({ page }) => {
  await analyze(page, [multi("bank-jan-titled.csv"), multi("bank-feb.csv")], multi("ledger-jan-feb.csv"), true);

  const panel = page.getByTestId("month-review");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("month-review-title")).toHaveText("Financial Review — January to February 2026");
  await expect(panel.getByTestId("mr-months")).toHaveText("2");
  await expect(panel.getByTestId("mr-months-findings")).toHaveText("2");
  await expect(panel.getByTestId("mr-unmatched")).toHaveText("1");
  await expect(panel.getByTestId("mr-duplicates")).toHaveText("0");
  await expect(panel.getByTestId("mr-secondary")).toContainText("2 suggested matches are awaiting your yes or no");
  await expect(panel.getByTestId("mr-secondary")).toContainText("2 matches cross a month boundary");

  // Monthly table — statuses are descriptive, never "reconciled".
  await expect(panel.getByTestId("month-row")).toHaveCount(2);
  await expect(row(page, "2026-01").getByTestId("month-bank-rows")).toHaveText("3");
  await expect(row(page, "2026-01").getByTestId("month-ledger-rows")).toHaveText("3");
  await expect(row(page, "2026-01").getByTestId("month-unmatched")).toHaveText("0");
  await expect(row(page, "2026-01").getByTestId("month-to-review")).toHaveText("1");
  await expect(row(page, "2026-02").getByTestId("month-unmatched")).toHaveText("1");
  await expect(row(page, "2026-02").getByTestId("month-status").first()).toHaveText("Review needed");
  await expect(panel).not.toContainText(/fully reconciled/i);

  // Coverage is never claimed as verified.
  await expect(panel.getByTestId("mr-coverage")).toContainText("Coverage not verified");
  await panel.getByTestId("mr-coverage-toggle").click();
  await expect(panel.getByTestId("mr-coverage-finding").first()).toContainText(/balances were not checked/i);

  // Select February: its findings, with file and row.
  await row(page, "2026-02").getByTestId("month-view").click();
  const detail = panel.getByTestId("month-detail");
  await expect(detail.getByTestId("month-side-bank")).toContainText("3 rows imported · 3 in use · 0 set aside");
  await expect(detail.getByTestId("month-unmatched-bank")).toContainText("MONTHLY SERVICE FEE");
  await expect(detail.getByTestId("month-unmatched-bank").getByTestId("month-txn-source")).toHaveText("From bank-feb.csv · row 4");
  await expect(detail.getByTestId("month-cross").getByTestId("month-match")).toHaveCount(2);
  await expect(detail.getByTestId("month-files")).toContainText("bank-feb.csv (bank, 3 rows)");

  // The overall verdict is still there, separately, below.
  await expect(page.getByTestId("recon-status")).toContainText("12.00");

  // Confirming the two cross-month suggestions updates the month view.
  await page.getByRole("button", { name: /clear it up/i }).first().click();
  const accept = page.getByRole("button", { name: /yes, it.?s a match/i });
  while ((await accept.count()) > 0) {
    await accept.first().click();
    await page.waitForTimeout(400);
  }
  await page.getByRole("button", { name: /back to results/i }).click();
  await expect(page.getByTestId("month-review").getByTestId("mr-secondary")).toContainText("0 suggested matches are awaiting");
  await expect(row(page, "2026-01").getByTestId("month-status").first()).toHaveText("No unresolved items identified");
  await expect(row(page, "2026-02").getByTestId("month-status").first()).toHaveText("Review needed");
});

test("a single month keeps the original results screen (no month panel)", async ({ page }) => {
  await analyze(page, [dupes("bank-twin.csv")], dupes("ledger-twin.csv"));
  await expect(page.getByTestId("month-review")).toHaveCount(0);
  await expect(page.getByTestId("recon-status")).toBeVisible();
});

test("set-aside and restore change the month's counts", async ({ page }) => {
  await analyze(page, [dupes("bank-jan-ids.csv"), dupes("bank-q1-ids.csv")], dupes("ledger-q1.csv"));
  const jan = row(page, "2026-01");
  await expect(jan.getByTestId("month-bank-rows")).toContainText("3");
  await expect(jan.getByTestId("month-bank-rows")).toContainText("+3 set aside");
  await expect(jan.getByTestId("month-unmatched")).toHaveText("0");
  await expect(jan.getByTestId("month-status").first()).toHaveText("No unresolved items identified");
  await expect(row(page, "2026-02").getByTestId("month-unmatched")).toHaveText("1");

  await page.getByTestId("duplicates-panel").getByTestId("dup-section-set-aside").getByTestId("dup-restore").first().click();
  await expect(jan.getByTestId("month-bank-rows")).toContainText("4");
  await expect(jan.getByTestId("month-bank-rows")).toContainText("+2 set aside");
  await expect(jan.getByTestId("month-unmatched")).toHaveText("1");
  await expect(jan.getByTestId("month-dup")).toHaveText("1");
  await expect(jan.getByTestId("month-status")).toHaveText(["Review needed", "Possible duplicates to review"]);
  // February is untouched by a January restore.
  await expect(row(page, "2026-02").getByTestId("month-unmatched")).toHaveText("1");
});

test("browser performance: 24 months, 24 bank files, ~7,200 rows per side", async ({ page }) => {
  test.setTimeout(120_000);
  // Deterministic synthetic data: mostly matching rows, some drift, some gaps.
  const bankFiles: { name: string; mimeType: string; buffer: Buffer }[] = [];
  const ledgerRows: string[] = [];
  for (let m = 0; m < 24; m++) {
    const year = 2024 + Math.floor(m / 12);
    const mm = String((m % 12) + 1).padStart(2, "0");
    const rows: string[] = [];
    for (let i = 0; i < 300; i++) {
      const day = 1 + (i % 27);
      const amount = (-(5 + ((i * 37 + m * 11) % 900)) - (i % 100) / 100).toFixed(2);
      const vendor = `VENDOR ${(i * 7) % 40}`;
      const d = (n: number) => `${mm}/${String(n).padStart(2, "0")}/${year}`;
      if (i % 50 === 7) {
        rows.push(`${d(day)},BANK FEE ${i},${amount}`);            // not in the books
      } else if (i % 50 === 9) {
        ledgerRows.push(`${d(day)},CHECK ${4000 + i},${amount}`);  // not cleared
      } else if (i % 25 === 3) {
        rows.push(`${d(day + 1)},POS ${vendor} #${i},${amount}`);  // cleared a day later
        ledgerRows.push(`${d(day)},${vendor},${amount}`);
      } else {
        rows.push(`${d(day)},${vendor},${amount}`);
        ledgerRows.push(`${d(day)},${vendor},${amount}`);
      }
    }
    bankFiles.push({
      name: `bank-${year}-${mm}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(["Date,Description,Amount", ...rows].join("\n")),
    });
  }
  const ledgerFile = {
    name: "ledger-2024-2025.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(["Date,Description,Amount", ...ledgerRows].join("\n")),
  };

  await page.goto("/app");
  await page.getByTestId("bank-file-input").setInputFiles(bankFiles);
  await page.getByTestId("ledger-file-input").setInputFiles(ledgerFile);
  await expect(page.getByTestId("uploaded-file")).toHaveCount(25);

  let t = Date.now();
  await page.getByTestId("start-analysis-btn").click();
  await expect(page.getByTestId("confirm-mapping-btn")).toBeEnabled({ timeout: 20_000 });
  const mappingMs = Date.now() - t;

  // Record main-thread long tasks from here on.
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push(e.duration);
    }).observe({ entryTypes: ["longtask"] });
  });

  // Import + duplicate detection + the single full-range engine run happen on this click.
  t = Date.now();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 60_000 });
  const analyzeMs = Date.now() - t; // includes the fixed ~3.3 s progress animation
  await expect(page.getByTestId("month-review").getByTestId("mr-months")).toHaveText("24");

  t = Date.now();
  await row(page, "2025-06").getByTestId("month-view").click();
  await expect(page.getByTestId("month-detail")).toBeVisible({ timeout: 10_000 });
  const detailMs = Date.now() - t;

  // A user action that re-renders everything: add an unmatched fee.
  await page.getByTestId("tab-missing-books").click();
  t = Date.now();
  await page.getByRole("button", { name: /add to my reconciliation/i }).first().click();
  await expect(page.getByTestId("remove-added-btn").first()).toBeVisible({ timeout: 20_000 });
  const actionMs = Date.now() - t;

  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  const longest = Math.round(Math.max(0, ...long));
  const total = Math.round(long.reduce((a, b) => a + b, 0));
  console.log(
    `[browser-perf] rows: ${bankFiles.length} bank files + 1 ledger file, ${ledgerRows.length} ledger rows | ` +
      `mapping screen ready ${mappingMs} ms | analyze → results ${analyzeMs} ms (incl. ~3.3 s animation) | ` +
      `open month detail ${detailMs} ms | add-to-reconciliation ${actionMs} ms | ` +
      `long tasks: ${long.length}, longest ${longest} ms, total ${total} ms`
  );

  // Generous budgets: this guards against an order-of-magnitude regression.
  expect(analyzeMs).toBeLessThan(30_000);
  expect(detailMs).toBeLessThan(5_000);
  expect(actionMs).toBeLessThan(10_000);
});
