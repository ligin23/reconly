/**
 * Public landing page ("/") and the app's move to "/app" (Playwright).
 * Covers: content and SEO, navigation and CTAs, FAQ, the mobile menu,
 * responsive layout at 375 / 390 / 768 / 1440, accessibility basics,
 * privacy-safe analytics events, and that the existing app — demos, saved
 * reconciliations (IndexedDB), figures — is unchanged behind "Open app".
 */
import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

const fixture = (name: string) => resolve(__dirname, "fixtures", name);

/** Capture analytics DOM events across navigations (kept in sessionStorage). */
async function recordAnalytics(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener("reconly:analytics", (e) => {
      const list = JSON.parse(sessionStorage.getItem("__events") ?? "[]");
      list.push((e as CustomEvent).detail);
      sessionStorage.setItem("__events", JSON.stringify(list));
    });
  });
}
const analyticsEvents = (page: Page) =>
  page.evaluate(() => JSON.parse(sessionStorage.getItem("__events") ?? "[]") as { name: string; data: Record<string, string> }[]);

function watchErrors(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text()));
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("requestfailed", (r) => problems.push("failed: " + r.url()));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  return problems;
}

async function loadAllImages(page: Page) {
  await page.evaluate(async () => {
    // Lazy images load only once near the viewport: walk the page slowly.
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await page.evaluate(() => window.scrollTo(0, 0));
}

// ───────────────────────── Content & SEO ─────────────────────────

test("the landing page renders its sections, with one h1 and a logical heading order", async ({ page }) => {
  const problems = watchErrors(page);
  await page.goto("/");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Bank reconciliation, without the accounting headache.");
  await expect(page.getByText("Upload your bank transactions and financial records. Reconly helps you match transactions, identify differences, and understand what needs attention.")).toBeVisible();
  for (const id of ["how-it-works", "features", "product", "who-its-for", "privacy", "faq"]) {
    await expect(page.locator(`#${id}`)).toBeAttached();
  }
  const h2 = await page.locator("main h2").allInnerTexts();
  expect(h2).toEqual([
    "From two exports to a clear answer in four steps",
    "Built for the messy exports real businesses have",
    "See the real interface",
    "For anyone who has to make two sets of numbers agree",
    "What happens to your financial data",
    "Frequently asked questions",
    "Ready to make reconciliation easier?",
  ]);
  // Every h3 sits under an h2 (no skipped levels).
  const levels = await page.locator("main h1, main h2, main h3").evaluateAll((els) => els.map((e) => Number(e.tagName[1])));
  for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  // No sign-up, login or pricing in this phase.
  await expect(page.getByRole("link", { name: /log ?in|sign ?up|pricing/i })).toHaveCount(0);
  // No feedback destination is configured, so no feedback section is shown.
  await expect(page.getByTestId("feedback-link")).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("SEO metadata, robots and sitemap are present; app routes are not indexed", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Reconly — Bank reconciliation, without the accounting headache");
  const meta = (sel: string) => page.locator(sel).first().getAttribute("content");
  expect(await meta('meta[name="description"]')).toContain("match transactions, identify differences");
  expect(await meta('meta[property="og:title"]')).toContain("Bank reconciliation");
  expect(await meta('meta[property="og:type"]')).toBe("website");
  expect(await meta('meta[name="twitter:card"]')).toBe("summary_large_image");
  const ogImage = await meta('meta[property="og:image"]');
  expect(ogImage).toMatch(/\/opengraph-image/);
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(new URL(canonical!).pathname).toBe("/");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0); // indexable

  const og = await request.get(new URL(ogImage!).pathname + (new URL(ogImage!).search ?? ""));
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toContain("image/png");

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /");
  expect(robots).toContain("Disallow: /app");
  expect(robots).toContain("Sitemap:");
  expect(await (await request.get("/sitemap.xml")).text()).toContain("<loc>");

  await page.goto("/app");
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
});

test("product screenshots load, have alt text and are not clipped", async ({ page }) => {
  await page.goto("/");
  await loadAllImages(page);
  // The hero is the main visual: loaded eagerly at high priority, not lazily.
  await expect(page.getByTestId("hero-shot")).toHaveAttribute("loading", "eager");
  await expect(page.getByTestId("hero-shot")).toHaveAttribute("fetchpriority", "high");
  const imgs = await page.locator("main img").evaluateAll((els) =>
    els.map((e) => {
      const img = e as HTMLImageElement;
      const box = img.getBoundingClientRect();
      const frame = img.closest("div")!.getBoundingClientRect();
      return { alt: img.alt, w: img.naturalWidth, box: { l: box.left, r: box.right }, frame: { l: frame.left, r: frame.right } };
    })
  );
  expect(imgs.length).toBe(5); // hero + 4 preview images
  for (const i of imgs) {
    expect(i.alt.length).toBeGreaterThan(20);
    expect(i.w).toBeGreaterThan(0);
    expect(i.box.l).toBeGreaterThanOrEqual(i.frame.l - 1);
    expect(i.box.r).toBeLessThanOrEqual(i.frame.r + 1);
  }
  // Served through Next's optimizer (responsive srcset), not as raw PNGs.
  const src = await page.getByTestId("preview-shot").first().getAttribute("srcset");
  expect(src).toContain("/_next/image");
});

// ───────────────────────── Navigation & CTAs ─────────────────────────

test("nav links jump to their sections; 'See how it works' scrolls to the steps", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  for (const [name, id] of [["Features", "features"], ["How it works", "how-it-works"], ["FAQ", "faq"]] as const) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect(page.locator(`#${id} h2`)).toBeInViewport();
  }
  await page.goto("/");
  await page.getByTestId("hero-how-it-works").click();
  await expect(page).toHaveURL(/#how-it-works$/);
  await expect(page.locator("#how-it-works h2")).toBeInViewport();
});

test("'Try free demo' opens the Advanced Demo without an account; analytics carry only enums", async ({ page }) => {
  await recordAnalytics(page);
  const problems = watchErrors(page);
  await page.goto("/");
  await page.getByTestId("hero-try-demo").click();
  await expect(page).toHaveURL(/\/app\/demo$/);
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("demo-banner")).toBeVisible();
  // Financial figures unchanged by the move.
  await expect(page.getByTestId("net-difference-row")).toContainText("−$1,309.54");
  await expect(page.getByTestId("status-statements")).toContainText("Statement review needed");

  const events = await analyticsEvents(page);
  expect(events.map((e) => e.name)).toEqual(["landing_view", "cta_click", "demo_start", "results_view"]);
  expect(events[1].data).toEqual({ target: "demo", placement: "hero" });
  expect(events[2].data).toEqual({ variant: "advanced" });
  expect(events[3].data).toEqual({ source: "advanced_demo" });
  // Nothing but short enum strings — no amounts, descriptions or file names.
  const flat = JSON.stringify(events);
  expect(flat).not.toMatch(/\$|\d{2,}|\.csv|STRIPE|Cedar/i);
  expect(problems).toEqual([]);
});

test("'Open app' and the final CTAs reach the existing app; the original sample still works", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-open-app").click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId("try-sample-btn")).toBeVisible();
  await page.getByTestId("try-sample-btn").click();
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("net-difference-row")).toContainText("−$1,060.17");

  await page.goto("/");
  await page.getByTestId("final-open-app").click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/");
  await page.getByTestId("final-try-demo").click();
  await expect(page).toHaveURL(/\/app\/demo$/);
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
  await page.goto("/");
  await page.getByTestId("product-try-demo").click();
  await expect(page).toHaveURL(/\/app\/demo$/);
});

test("saved reconciliations survive moving between the landing page and the app", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("bank-file-input").setInputFiles(fixture("clean_bank.csv"));
  await page.getByTestId("ledger-file-input").setInputFiles(fixture("clean_ledger.csv"));
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("save-btn").click();
  await page.getByTestId("save-account-name").fill("Landing Test Checking");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByTestId("save-btn")).toHaveText(/save changes/i);

  // Landing page → Open app → History: still there. Then the demo route too.
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
  await page.getByTestId("nav-open-app").click();
  await page.getByTestId("nav-history").click();
  await expect(page.getByText("Landing Test Checking")).toBeVisible();
  await page.goto("/app/demo");
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("nav-history").click();
  await expect(page.getByText("Landing Test Checking")).toBeVisible();
  await expect(page.getByText(/cedar/i)).toHaveCount(0); // the demo is not auto-saved
});

// ───────────────────────── FAQ ─────────────────────────

test("FAQ items open and close by mouse and keyboard", async ({ page }) => {
  await page.goto("/#faq");
  const items = page.getByTestId("faq-item");
  await expect(items).toHaveCount(8);
  const first = items.nth(0);
  await expect(first).not.toHaveAttribute("open", "");
  await first.locator("summary").click();
  await expect(first).toHaveAttribute("open", "");
  await expect(first).toContainText("compares the transactions in your bank exports");
  await first.locator("summary").click();
  await expect(first).not.toHaveAttribute("open", "");

  const stored = items.filter({ hasText: "Where is my data stored?" });
  await stored.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(stored).toHaveAttribute("open", "");
  await expect(stored).toContainText("not uploaded to Reconly");
  await expect(stored).toContainText("you can delete it at any time from Past reconciliations");
  await expect(stored).not.toContainText("AI assistant");
  // The accountant answer carries the existing disclaimer.
  const accountant = items.filter({ hasText: "Does Reconly replace an accountant?" });
  await accountant.locator("summary").click();
  await expect(accountant).toContainText("It is not accounting or tax advice.");
});

// ───────────────────────── Mobile menu ─────────────────────────

test("mobile menu: opens, closes with Escape (focus returns), and its links work", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const btn = page.getByTestId("landing-menu-btn");
  const menu = page.getByTestId("landing-menu");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await expect(btn).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();

  await btn.click();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(btn).toBeFocused();

  await btn.click();
  await menu.getByRole("link", { name: "FAQ" }).click();
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(/#faq$/);
  await expect(page.locator("#faq h2")).toBeInViewport();

  await btn.click();
  await menu.getByRole("link", { name: "Try free demo" }).click();
  await expect(page).toHaveURL(/\/app\/demo$/);
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
});

// ───────────────────────── Responsive ─────────────────────────

for (const [w, h] of [[375, 812], [390, 844], [768, 1024], [1440, 900]] as const) {
  test(`layout at ${w}px: no horizontal overflow, buttons reachable, no overlapping CTAs`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/");
    await loadAllImages(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
    // Every visible button-like link fits the viewport width and is a usable size.
    const boxes = await page.locator(".landing a.btn:visible").evaluateAll((els) =>
      els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top + scrollY, b: r.bottom + scrollY, h: r.height, text: (e as HTMLElement).innerText }; })
    );
    expect(boxes.length).toBeGreaterThan(3);
    for (const b of boxes) {
      expect(b.l, b.text).toBeGreaterThanOrEqual(0);
      expect(b.r, b.text).toBeLessThanOrEqual(w);
      expect(b.h, b.text).toBeGreaterThanOrEqual(40);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], c = boxes[j];
        const overlap = a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1;
        expect(overlap, `${a.text} overlaps ${c.text}`).toBe(false);
      }
    }
    // Screenshots stay inside the page.
    const imgs = await page.locator("main img").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
    for (const r of imgs) expect(r).toBeLessThanOrEqual(w + 0.5);
  });
}

// ───────────────────────── Accessibility ─────────────────────────

test("keyboard: skip link first, visible focus ring on links and buttons", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  const ring = async () =>
    page.evaluate(() => {
      const s = getComputedStyle(document.activeElement as Element);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
    });
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    const r = await ring();
    expect(r.style).not.toBe("none");
    expect(r.width).toBeGreaterThanOrEqual(2);
  }
});

test("text colours meet WCAG AA contrast against their backgrounds", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    const rgb = (css: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el: Element): string => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        const c = getComputedStyle(e).backgroundColor;
        if (rgb(c).a > 0) return c;
      }
      return "#fff";
    };
    const out: { text: string; ratio: number }[] = [];
    const seen = new Set<string>();
    for (const el of document.querySelectorAll(".landing main p, .landing main h2, .landing main h3, .landing main summary, .landing main figcaption, .landing main li, .landing footer p, .landing header a")) {
      const text = (el as HTMLElement).innerText.trim().slice(0, 40);
      if (!text || seen.has(text) || (el as HTMLElement).offsetParent === null) continue;
      seen.add(text);
      const s = getComputedStyle(el);
      const a = lum(rgb(s.color)), b = lum(rgb(bgOf(el)));
      out.push({ text, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) });
    }
    return out;
  });
  expect(results.length).toBeGreaterThan(30);
  const failing = results.filter((r) => r.ratio < 4.5);
  expect(failing).toEqual([]);
});
