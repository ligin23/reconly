/**
 * Reconly — phone-width layout (Playwright).
 * At 375–430px the sidebar must be a drawer, not a column that takes most
 * of the screen; content must be readable; nothing important may be
 * clipped or pushed off-screen. Desktop (1280px) must be unchanged.
 */
import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

const fx = (...p: string[]) => resolve(__dirname, "fixtures", ...p);

async function analyze(page: Page, bank: string[], ledger: string, headerClicks = 0) {
  await page.goto("/app");
  await page.getByTestId("bank-file-input").setInputFiles(bank);
  await page.getByTestId("ledger-file-input").setInputFiles(ledger);
  await page.getByTestId("start-analysis-btn").click();
  for (let i = 0; i < headerClicks; i++) await page.getByTestId("use-suggested-header").first().click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
}

/** No sideways scrolling of the page or of the main scroll area. */
async function expectNoPageOverflow(page: Page) {
  const o = await page.evaluate(() => {
    const main = document.querySelector("main")!;
    return {
      doc: document.documentElement.scrollWidth - window.innerWidth,
      main: main.scrollWidth - main.clientWidth,
    };
  });
  expect(o.doc, "page scrolls sideways").toBeLessThanOrEqual(1);
  expect(o.main, "main area scrolls sideways").toBeLessThanOrEqual(1);
}

/** The element is fully inside the viewport horizontally. */
async function expectWithinViewport(page: Page, testId: string, index = 0) {
  const el = page.getByTestId(testId).nth(index);
  await el.scrollIntoViewIfNeeded();
  const box = (await el.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x, `${testId} starts off-screen`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${testId} is clipped on the right`).toBeLessThanOrEqual(width + 1);
}

for (const width of [375, 390, 412]) {
  test.describe(`phone ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("the sidebar is a drawer: closed by default, opens and closes easily", async ({ page }) => {
      await page.goto("/app");
      const sidebar = page.getByTestId("sidebar");
      await expect(sidebar).toBeHidden();
      await expect(page.getByTestId("menu-btn")).toBeVisible();

      // The upload screen has the full width.
      const card = (await page.getByTestId("start-analysis-btn").boundingBox())!;
      expect(card.x).toBeGreaterThanOrEqual(0);
      await expectNoPageOverflow(page);
      const heading = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
      expect(heading.width).toBeGreaterThan(width * 0.8);

      // Open with the menu button.
      await page.getByTestId("menu-btn").click();
      await expect(sidebar).toBeVisible();
      await expect(page.getByTestId("menu-btn")).toHaveAttribute("aria-expanded", "true");
      // It slides in; wait for it to settle at the left edge.
      await expect.poll(async () => (await sidebar.boundingBox())!.x).toBe(0);
      const box = (await sidebar.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(300);
      expect(box.width).toBeLessThan(width); // content still peeks out behind it
      await expect(page.getByTestId("nav-history")).toBeVisible();

      // Close three ways: the close button, the backdrop, Escape.
      await page.getByTestId("sidebar-close").click();
      await expect(sidebar).toBeHidden();
      await page.getByTestId("menu-btn").click();
      await page.getByTestId("sidebar-backdrop").click({ position: { x: width - 10, y: 400 } });
      await expect(sidebar).toBeHidden();
      await page.getByTestId("menu-btn").click();
      await page.keyboard.press("Escape");
      await expect(sidebar).toBeHidden();

      // Navigating from the drawer closes it.
      await page.getByTestId("menu-btn").click();
      await page.getByTestId("nav-history").click();
      await expect(sidebar).toBeHidden();
      await expect(page.locator("header").getByText("History", { exact: true })).toBeVisible();
    });

    test("results, Financial Review and month details are readable and unclipped", async ({ page }) => {
      await analyze(page, [fx("statements", "stmt-jan.csv"), fx("statements", "stmt-feb.csv")], fx("statements", "stmt-ledger.csv"), 2);
      await expectNoPageOverflow(page);

      // Main content uses nearly the whole width.
      const hero = (await page.getByTestId("recon-status").boundingBox())!;
      expect(hero.width).toBeGreaterThan(width * 0.9);
      await expect(page.getByTestId("recon-status")).toContainText("net difference");

      // Top-bar actions are all reachable.
      await expectWithinViewport(page, "menu-btn");
      await expectWithinViewport(page, "export-menu-btn");
      await expectWithinViewport(page, "save-btn");

      // The four summary cards are present (two per row at this width).
      for (const label of ["Matched", "Needs review", "Not in your records", "In your records only"]) {
        await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
      }
      // The three status cards stack.
      for (const id of ["status-financial", "status-duplicates", "status-statements"]) {
        await expectWithinViewport(page, id);
        expect((await page.getByTestId(id).boundingBox())!.width).toBeGreaterThan(width * 0.85);
      }

      // Financial Review: the table scrolls inside its own box; the month
      // name opens the details without sideways scrolling.
      const panel = page.getByTestId("month-review");
      expect((await panel.boundingBox())!.width).toBeGreaterThan(width * 0.9);
      await expectWithinViewport(page, "month-review-title");
      await expectWithinViewport(page, "mr-months");
      await expectWithinViewport(page, "mr-duplicates");
      await expectWithinViewport(page, "month-name", 1);
      await panel.getByTestId("month-name").nth(1).click();
      const detail = panel.getByTestId("month-detail");
      await expect(detail).toContainText("MONTHLY SERVICE FEE");
      expect((await detail.boundingBox())!.width).toBeGreaterThan(width * 0.8);
      await expectWithinViewport(page, "month-txn");
      await expectWithinViewport(page, "statement-figures");
      await expectNoPageOverflow(page);

      // Transaction list: text and action button both visible.
      await page.getByTestId("tab-missing-books").click();
      const add = page.getByRole("button", { name: /add to my reconciliation/i }).first();
      await add.scrollIntoViewIfNeeded();
      const addBox = (await add.boundingBox())!;
      expect(addBox.x).toBeGreaterThanOrEqual(0);
      expect(addBox.x + addBox.width).toBeLessThanOrEqual(width + 1);
      await add.click();
      await expect(page.getByTestId("remove-added-btn").first()).toBeVisible();
      await expectWithinViewport(page, "remove-added-btn");
      await expectNoPageOverflow(page);
    });

    test("duplicate review and the review cards are usable", async ({ page }) => {
      await analyze(page, [fx("dupes", "bank-jan-ids.csv"), fx("dupes", "bank-q1-ids.csv")], fx("dupes", "ledger-q1.csv"));
      const panel = page.getByTestId("duplicates-panel");
      expect((await panel.boundingBox())!.width).toBeGreaterThan(width * 0.9);
      await expectWithinViewport(page, "dup-counts-bank");
      await expectWithinViewport(page, "dup-restore");
      await expectWithinViewport(page, "dup-row-source");
      await panel.getByTestId("dup-section-set-aside").getByTestId("dup-restore").first().click();
      await expect(panel.getByTestId("dup-counts-bank")).toHaveText(/8 rows imported · 6 in use · 2 set aside/);
      await expectWithinViewport(page, "dup-set-aside-repeats");
      await expectWithinViewport(page, "dup-keep-all");
      await panel.getByTestId("dup-section-check").getByTestId("dup-set-aside-repeats").click();
      await expect(panel.getByTestId("dup-counts-bank")).toHaveText(/8 rows imported · 5 in use · 3 set aside/);
      await expectNoPageOverflow(page);
    });

    test("mapping and review screens stack instead of squeezing", async ({ page }) => {
      await page.goto("/app");
      await page.getByTestId("bank-file-input").setInputFiles(fx("multi", "bank-jan-titled.csv"));
      await page.getByTestId("ledger-file-input").setInputFiles(fx("multi", "ledger-jan-feb.csv"));
      await expect(page.getByTestId("uploaded-file")).toHaveCount(2);
      await expectNoPageOverflow(page);
      await page.getByTestId("start-analysis-btn").click();
      await expectWithinViewport(page, "use-suggested-header");
      await expectWithinViewport(page, "header-row-select");
      await page.getByTestId("use-suggested-header").click();
      await expectWithinViewport(page, "confirm-mapping-btn");
      await expectNoPageOverflow(page);
      await page.getByTestId("confirm-mapping-btn").click();
      await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });

      await page.getByRole("button", { name: /clear it up/i }).first().click();
      const yes = page.getByRole("button", { name: /yes, it.?s a match/i }).first();
      const no = page.getByRole("button", { name: /not a match/i }).first();
      for (const b of [yes, no]) {
        const box = (await b.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      }
      await expectNoPageOverflow(page);
    });
  });
}

test.describe("desktop 1280px is unchanged", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("sidebar is a fixed column, no menu button, four summary cards in one row", async ({ page }) => {
    await analyze(page, [fx("statements", "stmt-jan.csv"), fx("statements", "stmt-feb.csv")], fx("statements", "stmt-ledger.csv"), 2);
    const sidebar = page.getByTestId("sidebar");
    await expect(sidebar).toBeVisible();
    const box = (await sidebar.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(260);
    await expect(page.getByTestId("menu-btn")).toBeHidden();
    await expect(page.getByTestId("sidebar-close")).toBeHidden();
    await expect(page.getByTestId("sidebar-backdrop")).toBeHidden();

    // Content starts to the right of the sidebar.
    const hero = (await page.getByTestId("recon-status").boundingBox())!;
    expect(hero.x).toBeGreaterThan(260);

    // The four summary cards sit side by side.
    const tops: number[] = [];
    for (const label of ["Matched", "Needs review", "Not in your records", "In your records only"]) {
      const b = (await page.getByText(label, { exact: true }).first().boundingBox())!;
      tops.push(Math.round(b.y));
    }
    expect(new Set(tops).size).toBe(1);

    // The three status cards sit side by side too.
    const a = (await page.getByTestId("status-financial").boundingBox())!;
    const c = (await page.getByTestId("status-statements").boundingBox())!;
    expect(Math.round(a.y)).toBe(Math.round(c.y));

    // Sidebar navigation still works directly.
    await page.getByTestId("nav-history").click();
    await expect(sidebar).toBeVisible();
  });
});
