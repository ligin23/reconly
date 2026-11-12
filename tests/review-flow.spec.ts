/**
 * Reconly — review-flow regression (Playwright)
 * Covers the resolve-workflow fixes from Phase 0 that only show in the UI:
 *   B10 — no "Match manually" button (it silently confirmed the pairing)
 *   B12 — the "x of N reviewed" total stays fixed while deciding
 */
import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

const fixture = (name: string) => resolve(__dirname, "fixtures", name);

test("review screen offers only yes/no and keeps a stable total", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("bank-file-input").setInputFiles(fixture("clean_bank.csv"));
  await page.getByTestId("ledger-file-input").setInputFiles(fixture("clean_ledger.csv"));
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: /clear it up/i }).first().click();

  const accept = page.getByRole("button", { name: /yes, it.?s a match/i });
  await expect(accept.first()).toBeVisible();
  await expect(page.getByRole("button", { name: /not a match/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /match manually/i })).toHaveCount(0);

  const counter = page.getByText(/\d+ of \d+ reviewed/);
  const first = (await counter.innerText()).match(/(\d+) of (\d+)/)!;
  expect(Number(first[1])).toBe(0);
  const total = Number(first[2]);
  expect(total).toBeGreaterThan(0);

  await accept.first().click();
  await page.waitForTimeout(450);
  if (total > 1) {
    const next = (await counter.innerText()).match(/(\d+) of (\d+)/)!;
    expect(Number(next[1])).toBe(1);
    expect(Number(next[2])).toBe(total); // denominator must not change
  }
});
