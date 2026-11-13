/**
 * Phase 6A — draft Privacy Policy (/privacy) and Terms of Service (/terms).
 * Covers rendering, required sections, draft labelling, placeholders,
 * no-index, links/navigation, keyboard access, responsive layout, console
 * errors and network requests, plus the corrected privacy disclosures.
 */
import { test, expect, type Page } from "@playwright/test";

function watch(page: Page) {
  const problems: string[] = [];
  const offOrigin: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text()));
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("requestfailed", (r) => problems.push("failed: " + r.url()));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  page.on("request", (r) => {
    const u = new URL(r.url());
    // Same origin as the page under test (localhost locally, the deployment on a preview).
    const home = new URL(page.url() === "about:blank" ? r.url() : page.url());
    if (u.origin !== home.origin && u.protocol !== "data:") offOrigin.push(r.url());
  });
  return { problems, offOrigin };
}

const PRIVACY_SECTIONS = [
  "Introduction and scope",
  "Who operates Reconly",
  "Categories of information processed",
  "CSV uploads",
  "Browser-local storage",
  "Saved reconciliations",
  "Data deletion",
  "Report exports",
  "AI functionality status",
  "Third-party service providers",
  "Hosting and technical logs",
  "Analytics and cookies",
  "Purposes for processing information",
  "Data retention",
  "Security measures and limitations",
  "International processing",
  "Privacy rights and requests",
  "Children’s privacy",
  "Changes to this policy",
  "Contact information",
  "Effective date",
];

const TERMS_SECTIONS = [
  "Acceptance of these terms",
  "Description of Reconly",
  "Eligibility",
  "Permitted use",
  "Your responsibilities",
  "Your financial information",
  "Accuracy and reconciliation limitations",
  "No professional advice",
  "AI features",
  "Intellectual property",
  "Third-party services",
  "Service availability",
  "Local browser storage and risk of data loss",
  "Deleting saved data",
  "Report exports",
  "Disclaimer of warranties",
  "Limitation of liability",
  "Indemnification",
  "Changes to the Service and these Terms",
  "Termination or discontinuation",
  "Governing law and dispute resolution",
  "Contact information",
  "Effective date",
];

const DOCS = [
  { path: "/privacy", h1: "Privacy Policy", sections: PRIVACY_SECTIONS, other: "/terms" },
  { path: "/terms", h1: "Terms of Service", sections: TERMS_SECTIONS, other: "/privacy" },
] as const;

for (const doc of DOCS) {
  test(`${doc.path} renders every section with a logical heading order`, async ({ page }) => {
    const { problems, offOrigin } = watch(page);
    await page.goto(doc.path);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveText(doc.h1);
    const h2 = (await page.locator("main section h2").allInnerTexts()).map((t) => t.replace(/^\d+\.\s*/, ""));
    expect(h2).toEqual([...doc.sections]);
    // No heading level is skipped (h1 → h2 → h3).
    const levels = await page.locator("main h1, main h2, main h3").evaluateAll((els) => els.map((e) => Number(e.tagName[1])));
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    // Table of contents links resolve to sections.
    const tocHrefs = await page.locator('nav[aria-labelledby="toc-title"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(tocHrefs).toHaveLength(doc.sections.length);
    for (const href of tocHrefs) await expect(page.locator(href!)).toBeAttached();
    expect(problems).toEqual([]);
    expect(offOrigin).toEqual([]);
  });

  test(`${doc.path} is clearly a draft, shows placeholders and is not indexed`, async ({ page, request }) => {
    await page.goto(doc.path);
    await expect(page).toHaveTitle(`${doc.h1} (draft) — Reconly`);
    await expect(page.getByTestId("draft-banner")).toBeVisible();
    await expect(page.getByTestId("draft-banner")).toContainText("Draft — not in effect");
    await expect(page.getByTestId("effective-date")).toContainText("[OWNER:");
    // No real-looking date was filled in.
    expect(await page.getByTestId("effective-date").innerText()).not.toMatch(/\b20\d\d\b/);
    const placeholders = page.getByTestId("placeholder");
    expect(await placeholders.count()).toBeGreaterThan(5);
    await expect(placeholders.first()).toBeVisible();
    expect(await page.getByTestId("review-flag").count()).toBeGreaterThan(2);

    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots).toContain("noindex");
    expect(robots).toContain("nofollow");
    expect(await (await request.get("/sitemap.xml")).text()).not.toContain(doc.path);
  });

  test(`${doc.path} links back home and to the other document`, async ({ page }) => {
    await page.goto(doc.path);
    await page.getByTestId("legal-other").click();
    await expect(page).toHaveURL(new RegExp(`${doc.other}$`));
    await page.goto(doc.path);
    await page.getByTestId("legal-home").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("h1")).toHaveText("Bank reconciliation, without the accounting headache.");
  });

  for (const [w, h] of [[375, 812], [390, 844], [768, 1024], [1440, 900]] as const) {
    test(`${doc.path} at ${w}px has no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(doc.path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
      await expect(page.getByTestId("draft-banner")).toBeVisible();
      await expect(page.getByTestId("legal-home")).toBeVisible();
    });
  }
}

test("legal pages are keyboard accessible: skip link, then header links in order", async ({ page }) => {
  await page.goto("/privacy");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Reconly home", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("legal-home")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("legal-other")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/terms$/);
});

test("every internal link on the legal pages resolves", async ({ page, request }) => {
  const seen = new Set<string>();
  for (const path of ["/privacy", "/terms"]) {
    await page.goto(path);
    const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    for (const href of hrefs) {
      const u = new URL(href);
      expect(u.origin).toBe(new URL(page.url()).origin); // no external links
      const key = u.pathname;
      if (seen.has(key)) continue;
      seen.add(key);
      expect((await request.get(key)).status(), key).toBe(200);
    }
  }
  expect([...seen]).toEqual(expect.arrayContaining(["/", "/privacy", "/terms", "/app"]));
});

test("the landing footer links to both legal pages and keeps the financial disclaimer", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByTestId("footer-disclaimer")).toContainText("It is not accounting or tax advice.");
  await footer.getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  // The legal pages share the footer; its section links lead back to the landing page.
  await page.getByRole("contentinfo").getByRole("link", { name: "FAQ" }).click();
  await expect(page).toHaveURL(/\/#faq$/);
  await page.getByRole("contentinfo").getByRole("link", { name: "Terms of Service" }).click();
  await expect(page).toHaveURL(/\/terms$/);
});

test("the landing privacy section states the current behaviour accurately", async ({ page }) => {
  await page.goto("/");
  const privacy = page.locator("#privacy");
  await expect(privacy).toContainText("You can delete any saved reconciliation from Past reconciliations");
  await expect(privacy).toContainText("No AI features are active");
  await expect(privacy).toContainText("Other columns in newly imported files aren't kept");
  await expect(privacy).toContainText("Reconly sends no reconciliation data to any AI service");
  await expect(privacy).toContainText("not every piece of information stays on your device");
  await expect(privacy).not.toContainText("not used to train");
  await expect(privacy).not.toContainText("There is no delete button");
  await expect(privacy).not.toContainText("If you ask the assistant");
});

test("the drafts describe AI as disabled and deletion as available, with no unsupported claims", async ({ page }) => {
  await page.goto("/privacy");
  const ai = page.locator("#ai-status");
  await expect(ai).toContainText("It is currently disabled.");
  await expect(ai).toContainText("no reconciliation data, questions or other financial information are sent to an AI provider");
  await expect(ai).toContainText("this policy will be updated before they are reactivated");
  await expect(page.locator("#deletion")).toContainText("choose Delete next to it and confirm");
  await expect(page.locator("#deletion")).toContainText("does not promise that deleted data is permanently erased");
  await expect(page.locator("#browser-storage")).toContainText("not synchronised to your other devices");
  await expect(page.locator("#csv-uploads")).toContainText("are not kept for newly imported files");
  await expect(page.locator("#csv-uploads")).toContainText("account columns, if your file has them, are kept in full");
  await expect(page.locator("#saved-reconciliations")).toContainText("Reconciliations saved before this change may contain every column");
  await expect(page.locator("#saved-reconciliations")).toContainText("does not rewrite or trim them automatically");
  await expect(page.locator("#hosting-logs")).toContainText("Vercel");
  const all = await page.locator("main").innerText();
  for (const banned of [/not used to train/i, /SOC ?2/i, /PCI/i, /bank-level/i, /end-to-end encrypt/i, /names? (are|is) (automatically )?masked/i, /never leaves? your device/i]) {
    expect(all).not.toMatch(banned);
  }

  await page.goto("/terms");
  await expect(page.locator("#description")).toContainText("does not currently provide an active AI assistant");
  await expect(page.locator("#accuracy")).toContainText("does not guarantee a complete or error-free reconciliation");
  await expect(page.locator("#no-advice")).toContainText("does not replace an accountant");
  await expect(page.locator("#deletion")).toContainText("delete an individual saved reconciliation");
  const terms = await page.locator("main").innerText();
  expect(terms).not.toMatch(/subscription|billing|payment terms|refund/i);
});
