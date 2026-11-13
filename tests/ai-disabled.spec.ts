/**
 * Phase 6A — the AI copilot is on hold. No assistant control is shown, no
 * flow sends a request to /api/copilot, and the endpoint itself refuses
 * every request with a plain "not available" (never a rate-limit message).
 */
import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

const fixture = (name: string) => resolve(__dirname, "fixtures", name);

/** Records every request to the copilot endpoint or any non-local host. */
function watchNetwork(page: Page) {
  const copilot: string[] = [];
  const offOrigin: string[] = [];
  const problems: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/copilot")) copilot.push(r.method() + " " + r.url());
    // Same origin as the page under test (localhost locally, the deployment on a preview).
    const home = new URL(page.url() === "about:blank" ? r.url() : page.url());
    if (u.origin !== home.origin && !["data:", "blob:"].includes(u.protocol)) offOrigin.push(r.url());
  });
  page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text()));
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  return { copilot, offOrigin, problems };
}

async function expectNoAssistant(page: Page) {
  await expect(page.getByTestId("copilot-launcher")).toHaveCount(0);
  await expect(page.getByTestId("copilot-chip")).toHaveCount(0);
  await expect(page.getByTestId("copilot-notice")).toHaveCount(0);
  await expect(page.getByText(/ask about this reconciliation/i)).toHaveCount(0);
}

test("no assistant control appears and no AI request is made across the app", async ({ page }) => {
  const net = watchNetwork(page);

  await page.goto("/");
  await expect(page.locator("#privacy")).toContainText("No AI features are active");
  await expectNoAssistant(page);

  // Original sample → results → review.
  await page.goto("/app");
  await expectNoAssistant(page);
  await page.getByTestId("try-sample-btn").click();
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
  await expectNoAssistant(page);
  await page.getByTestId("sidebar").getByRole("button", { name: /review/i }).click();
  await expectNoAssistant(page);

  // Save it, reload, reopen from History.
  await page.getByTestId("sidebar").getByRole("button", { name: /results/i }).click();
  await page.getByTestId("save-btn").click();
  await page.getByTestId("save-account-name").fill("No AI Account");
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByTestId("save-btn")).toHaveText(/save changes/i);
  await page.reload();
  await page.getByTestId("nav-history").click();
  await page.getByTestId("history-row").filter({ hasText: "No AI Account" }).click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
  await expectNoAssistant(page);

  // Advanced Demo (via /app/demo) and own files.
  await page.goto("/app/demo");
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
  await expectNoAssistant(page);
  await page.goto("/app");
  await page.getByTestId("bank-file-input").setInputFiles(fixture("bank_statement.csv"));
  await page.getByTestId("ledger-file-input").setInputFiles(fixture("ledger.csv"));
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
  await expectNoAssistant(page);

  expect(net.copilot).toEqual([]);
  expect(net.offOrigin).toEqual([]);
  expect(net.problems).toEqual([]);
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("the mobile layout and menu show no assistant", async ({ page }) => {
    const net = watchNetwork(page);
    await page.goto("/app/demo");
    await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
    await expectNoAssistant(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const menu = page.getByRole("navigation", { name: "Mobile" });
    await expect(menu).toBeVisible();
    await expect(menu).not.toContainText(/assistant|\bAI\b/);
    expect(net.copilot).toEqual([]);
  });
});

test("a direct POST to /api/copilot is refused with a plain unavailable response", async ({ request, baseURL }) => {
  const body = {
    question: "Why doesn't my account balance?",
    sessionId: "session-12345678",
    context: { summary: {}, items: [], omittedItemCount: 0 },
  };
  for (const data of [body, {}, "not json"]) {
    const res = await request.post("/api/copilot", {
      headers: { origin: baseURL!, "content-type": "application/json" },
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
    expect(res.status()).toBe(503);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const json = await res.json();
    expect(json).toEqual({ error: "The assistant is not available." });
    expect(JSON.stringify(json)).not.toMatch(/a lot of questions|key|upstash|anthropic|token|env/i);
  }
  // Same answer without an Origin header (the gate runs before every other check).
  const bare = await request.post("/api/copilot", { data: "{}" });
  expect(bare.status()).toBe(503);
  // Other methods are not served.
  expect((await request.get("/api/copilot")).status()).toBe(405);
});
