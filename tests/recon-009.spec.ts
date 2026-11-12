/**
 * RECON-009 (Playwright) — accepting one option of an ambiguous grouped
 * match must leave the OTHER option's entries unmatched, on the results
 * screen, in Excel and in the PDF alike.
 *
 * June sample: the $300 MOBILE CHECK DEPOSIT (Jun 26) can be
 *   option A: Invoice 1047 - Beacon Dental $175 + Invoice 1048 - Loom Floral $125
 *   option B: Workshop tickets (4 seats) $120 + Print sale - art fair $180
 * With every other suggestion accepted and either option picked, "In your
 * records only" must hold 5 entries totalling $1,025.00, bank-only must be
 * 3 totalling −$35.17, and the difference −$1,060.17.
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import XLSX from "xlsx-js-style";

const ACCEPT = /^(yes, it.?s a match|yes, they match)$/i;
const A = ["Beacon Dental", "Loom Floral"];
const B = ["Workshop tickets", "Print sale"];
const ALWAYS_UNMATCHED = ["Figma subscription", "Check 1043 - Window cleaning", "Invoice 1046 - Cedar & Co"];

async function openSample(page: Page) {
  await page.goto("/");
  await page.getByTestId("try-sample-btn").click();
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 20_000 });
}

/** Accept every suggestion until the ambiguous group is on screen. */
async function reachAmbiguous(page: Page) {
  await page.getByRole("button", { name: "Open review" }).click();
  for (let i = 0; i < 20; i++) {
    // Wait for the card on screen to be the live one (not one animating out).
    await expect(page.getByRole("button", { name: /^(not a match|none of these)$/i })).toBeEnabled();
    if (await page.getByText("Ambiguous group").isVisible()) return;
    const n = Number((await page.getByText(/\d+ of \d+ reviewed/).innerText()).match(/^(\d+)/)![1]);
    await page.getByRole("button", { name: ACCEPT }).click();
    await expect(page.getByText(new RegExp(`^${n + 1} of \\d+ reviewed`))).toBeVisible();
  }
  throw new Error("ambiguous group not reached");
}

async function pickOption(page: Page, entry: string) {
  await page.locator("main button").filter({ hasText: entry }).first().click();
  await expect(page.getByRole("button", { name: "Accept selected" })).toBeEnabled();
}

/** Results → "In your records only": the rendered rows themselves. */
async function ledgerOnlyRows(page: Page) {
  await page.getByTestId("tab-missing-bank").click();
  const rows = page.getByTestId("missing-item");
  const items = await rows.evaluateAll((els) =>
    els.map((e) => ({
      id: e.getAttribute("data-txn-id"),
      cents: Number(e.getAttribute("data-signed-cents")),
      text: (e as HTMLElement).innerText,
    }))
  );
  const tabCount = Number(await page.getByTestId("tab-missing-bank").locator(".count").innerText());
  return { items, tabCount };
}

/** Every Results assertion for an accepted option (unpicked = the other one). */
async function expectResults(page: Page, picked: string[], unpicked: string[]) {
  const { items, tabCount } = await ledgerOnlyRows(page);
  // UI count === rendered rows; IDs unique (nothing listed twice).
  expect(items).toHaveLength(5);
  expect(tabCount).toBe(items.length);
  expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  for (const u of [...unpicked, ...ALWAYS_UNMATCHED]) expect(items.some((i) => i.text.includes(u)), `${u} listed`).toBe(true);
  for (const p of picked) expect(items.some((i) => i.text.includes(p)), `${p} not listed`).toBe(false);
  // Displayed subtotal === sum of the rendered rows === authoritative figure.
  const sum = items.reduce((s, i) => s + i.cents, 0);
  expect(sum).toBe(102500);
  const breakdown = await page.getByTestId("net-breakdown").innerText();
  expect(breakdown).toContain("Bank only: 3 transactions totalling −$35.17.");
  expect(breakdown).toContain("In your records only: 5 entries totalling $1,025.00.");
  expect(breakdown).toContain("−$1,060.17");
  await expect(page.getByTestId("net-difference-row")).toContainText("−$1,060.17");
  // Bank side: rendered rows add up to the stated bank-only figure.
  await page.getByTestId("tab-missing-books").click();
  const bank = await page.getByTestId("missing-item").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-signed-cents"))));
  expect(bank).toHaveLength(3);
  expect(bank.reduce((s, c) => s + c, 0)).toBe(-3517);
}

async function download(page: Page, id: "export-excel-btn" | "export-pdf-btn") {
  const wait = page.waitForEvent("download");
  await page.getByTestId("export-menu-btn").click();
  await page.getByTestId(id).click();
  return readFileSync((await (await wait).path())!);
}

/** Excel "In your records only" rows (numeric amount cells). */
async function excelLedgerOnly(page: Page) {
  const wb = XLSX.read(await download(page, "export-excel-btn"));
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Reconciliation"], { header: 1, raw: true, defval: null });
  const start = rows.findIndex((r) => typeof r[0] === "string" && r[0].startsWith("In your records only"));
  const out: { desc: string; amount: number; source: string }[] = [];
  for (const r of rows.slice(start + 3)) {
    if (!r[1]) break;
    expect(typeof r[2]).toBe("number");
    out.push({ desc: String(r[1]), amount: r[2] as number, source: String(r[3]) });
  }
  return out;
}

/** PDF text-show strings in drawing order (jsPDF writes them uncompressed). */
async function pdfStrings(page: Page) {
  const raw = (await download(page, "export-pdf-btn")).toString("latin1");
  return [...raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, "$1"));
}

for (const [label, pick, other] of [
  ["option A (Beacon/Loom)", A, B],
  ["option B (Workshop/Print)", B, A],
] as const) {
  test(`E — accept ${label}, Results immediately: the other option stays unmatched`, async ({ page }) => {
    await openSample(page);
    await reachAmbiguous(page);
    await pickOption(page, pick[0]);
    // Accept and leave in the same task — during the exit animation.
    await page.evaluate(() => {
      const bs = [...document.querySelectorAll("main button")] as HTMLButtonElement[];
      bs.find((b) => b.innerText.trim() === "Accept selected")!.click();
      bs.find((b) => b.innerText.trim() === "Results")!.click();
    });
    await expect(page.getByTestId("recon-status")).toBeVisible();
    await expectResults(page, [...pick], [...other]);
  });
}

test("F — accept, then browser Back: same classification", async ({ page }) => {
  await openSample(page);
  await reachAmbiguous(page);
  await pickOption(page, "Beacon Dental");
  await page.getByRole("button", { name: "Accept selected" }).click();
  await page.goBack();
  await expect(page.getByTestId("recon-status")).toBeVisible();
  await expectResults(page, A, B);
});

test("G/H — Excel and PDF list exactly the rows the Results screen shows", async ({ page }) => {
  await openSample(page);
  await reachAmbiguous(page);
  await pickOption(page, "Workshop tickets");
  await page.getByRole("button", { name: "Accept selected" }).click();
  await expect(page.getByText("All reviewed!")).toBeVisible();
  await page.getByRole("button", { name: "Back to results" }).click();
  await expectResults(page, B, A);

  const xl = await excelLedgerOnly(page);
  expect(xl).toHaveLength(5);
  expect(Math.round(xl.reduce((s, r) => s + r.amount, 0) * 100)).toBe(102500);
  for (const u of [...A, ...ALWAYS_UNMATCHED]) expect(xl.some((r) => r.desc.includes(u))).toBe(true);
  for (const p of B) expect(xl.some((r) => r.desc.includes(p))).toBe(false);
  expect(xl.map((r) => r.source)).toContain("ledger-june2026.csv · row 19"); // Beacon Dental, provenance kept

  const strings = await pdfStrings(page);
  // Summary table row, then the section itself ("… 5 items").
  const row = strings.findIndex((s) => s.startsWith("In your records only"));
  expect(strings[row + 1]).toBe("5");
  const at = strings.findIndex((s, i) => s.startsWith("In your records only") && /^\d+ items?$/.test(strings[i + 1] ?? ""));
  expect(at).toBeGreaterThan(row);
  expect(strings[at + 1]).toBe("5 items");
  const section = strings.slice(at, strings.findIndex((s, i) => i > at + 1 && /^(Possible matches|Rows set aside|Possible duplicates|About this report)/.test(s)));
  for (const u of [...A, ...ALWAYS_UNMATCHED]) expect(section.some((s) => s.includes(u)), `${u} in PDF`).toBe(true);
  for (const p of B) expect(section.some((s) => s.includes(p)), `${p} not in PDF section`).toBe(false);
});

test("C — rejecting the group lists all four candidates", async ({ page }) => {
  await openSample(page);
  await reachAmbiguous(page);
  await page.getByRole("button", { name: "None of these" }).click();
  await expect(page.getByText("All reviewed!")).toBeVisible();
  await page.getByRole("button", { name: "Back to results" }).click();
  const { items, tabCount } = await ledgerOnlyRows(page);
  expect(items).toHaveLength(7);
  expect(tabCount).toBe(7);
  for (const u of [...A, ...B]) expect(items.some((i) => i.text.includes(u))).toBe(true);
});

test("D/I/J — accept (double-clicked), Undo, pick the other option", async ({ page }) => {
  await openSample(page);
  await reachAmbiguous(page);
  await pickOption(page, "Beacon Dental");
  await page.getByRole("button", { name: "Accept selected" }).dblclick();
  await expect(page.getByText("All reviewed!")).toBeVisible();
  await page.getByRole("button", { name: "Back to results" }).click();
  await expectResults(page, A, B);

  // Undo puts the group back with both options; nothing it held is "unmatched".
  await page.getByRole("main").locator("button.tab").filter({ hasText: "Needs review" }).click();
  const group = page.getByTestId("decided-item").filter({ hasText: "MOBILE CHECK DEPOSIT" });
  await group.getByTestId("undo-decision").click();
  const afterUndo = await ledgerOnlyRows(page);
  expect(afterUndo.items).toHaveLength(3);
  for (const u of [...A, ...B]) expect(afterUndo.items.some((i) => i.text.includes(u))).toBe(false);

  await page.getByTestId("sidebar").getByRole("button", { name: /review/i }).first().click();
  await expect(page.getByText("Ambiguous group")).toBeVisible();
  await pickOption(page, "Workshop tickets");
  await page.getByRole("button", { name: "Accept selected" }).click();
  await page.getByRole("main").getByRole("button", { name: /^(results|back to results)$/i }).first().click();
  await expectResults(page, B, A);
});
