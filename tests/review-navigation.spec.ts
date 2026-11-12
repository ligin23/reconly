/**
 * Reconly — review decisions survive leaving the Review screen (Playwright)
 *
 * Bug: the Review screen only reported a decision to the app AFTER the
 * card's ~290ms exit animation, and unmounting cancelled that timer. Leaving
 * Review during the animation ("Results", browser Back) silently dropped the
 * most recent accept/reject.
 *
 * Each case below decides and navigates away in the SAME browser task, so
 * the navigation is guaranteed to land inside the exit animation. Then it
 * checks that Results, Review and the Excel export all agree on the decision.
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import XLSX from "xlsx-js-style";

const csv = (rows: string[]) => Buffer.from("Date,Description,Amount\n" + rows.join("\n") + "\n");
// One exact pair in every case so the reconciliation is never empty.
const RENT_BANK = "01/20/2026,RENT JANUARY,-900.00";
const RENT_BOOKS = "01/20/2026,RENT JANUARY,-900.00";

type Kind = "normal" | "composite" | "cross-month" | "ambiguous";
type Case = {
  bank: string[];
  ledger: string[];
  bankDesc: string;
  dataKind: "pair" | "group";
  /** Books entries that must count as matched once accepted. */
  acceptedBooks: string[];
  /** Books entries that must NOT count as matched once accepted. */
  notChosenBooks?: string[];
  decidedText?: RegExp;
};

const CASES: Record<Kind, Case> = {
  normal: {
    bank: ["01/16/2026,SQ *BLUE BOTTLE COFFEE,-18.50", RENT_BANK],
    ledger: ["01/16/2026,Blue Bottle - client coffee,-18.50", RENT_BOOKS],
    bankDesc: "SQ *BLUE BOTTLE COFFEE",
    dataKind: "pair",
    acceptedBooks: ["Blue Bottle - client coffee"],
  },
  composite: {
    bank: ["01/12/2026,STRIPE PAYOUT,4750.00", RENT_BANK],
    ledger: [
      "01/06/2026,Invoice 1041 Harbor,1500.00",
      "01/07/2026,Invoice 1042 Quill,2000.00",
      "01/09/2026,Invoice 1043 Fernwood,1250.00",
      RENT_BOOKS,
    ],
    bankDesc: "STRIPE PAYOUT",
    dataKind: "group",
    acceptedBooks: ["Invoice 1041 Harbor", "Invoice 1042 Quill", "Invoice 1043 Fernwood"],
  },
  "cross-month": {
    bank: ["02/02/2026,CHECK 1187 NORTHWIND PRINT,-1240.00", RENT_BANK],
    ledger: ["01/30/2026,Check 1187 - Northwind Print Co.,-1240.00", RENT_BOOKS],
    bankDesc: "CHECK 1187 NORTHWIND PRINT",
    dataKind: "pair",
    acceptedBooks: ["Check 1187 - Northwind Print Co."],
    decidedText: /crosses a month boundary/,
  },
  ambiguous: {
    bank: ["01/10/2026,STRIPE PAYOUT,100.00", "01/12/2026,RENT,-900.00"],
    ledger: [
      "01/08/2026,Invoice A,60.00",
      "01/08/2026,Invoice B,40.00",
      "01/09/2026,Invoice C,60.00",
      "01/09/2026,Invoice D,40.00",
      "01/12/2026,RENT,-900.00",
    ],
    bankDesc: "STRIPE PAYOUT",
    dataKind: "group",
    acceptedBooks: ["Invoice C", "Invoice D"],
    notChosenBooks: ["Invoice A", "Invoice B"],
  },
};

async function load(page: Page, c: Case) {
  await page.goto("/");
  await page.getByTestId("bank-file-input").setInputFiles({ name: "bank.csv", mimeType: "text/csv", buffer: csv(c.bank) });
  await page.getByTestId("ledger-file-input").setInputFiles({ name: "ledger.csv", mimeType: "text/csv", buffer: csv(c.ledger) });
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
}

const ACCEPT = /^(yes, it.?s a match|yes, they match|accept selected)$/i;
const REJECT = /^(not a match|none of these)$/i;

/** Decide, then leave Review in the same task — i.e. during the exit animation. */
async function decideAndLeave(page: Page, decision: "accept" | "reject", via: "results" | "browser-back") {
  await page.evaluate(
    ({ decision, via, accept, reject }) => {
      const buttons = [...document.querySelectorAll("main button")] as HTMLButtonElement[];
      const re = new RegExp(decision === "accept" ? accept : reject, "i");
      const target = buttons.find((b) => re.test(b.innerText.trim()));
      if (!target || target.disabled) throw new Error(`no enabled ${decision} button`);
      target.click();
      if (via === "results") {
        const back = buttons.find((b) => b.innerText.trim() === "Results");
        if (!back) throw new Error("no Results button");
        back.click();
      } else {
        window.history.back();
      }
    },
    { decision, via, accept: ACCEPT.source, reject: REJECT.source }
  );
  await expect(page.getByTestId("recon-status")).toBeVisible();
}

/** The Reconciliation sheet, split into its matched and needs-attention parts. */
async function exportSections(page: Page) {
  const wait = page.waitForEvent("download");
  await page.getByTestId("export-menu-btn").click();
  await page.getByTestId("export-excel-btn").click();
  const wb = XLSX.read(readFileSync((await (await wait).path())!));
  const text = XLSX.utils.sheet_to_csv(wb.Sheets["Reconciliation"]);
  const start = text.indexOf("Matched transactions");
  const end = text.indexOf("Needs your attention");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return { matched: text.slice(start, end), attention: text.slice(end) };
}

for (const kind of Object.keys(CASES) as Kind[]) {
  for (const decision of ["accept", "reject"] as const) {
    for (const via of ["results", "browser-back"] as const) {
      test(`${kind}: ${decision} then ${via === "results" ? "Results" : "browser Back"} mid-animation keeps the decision`, async ({ page }) => {
        const c = CASES[kind];
        await load(page, c);
        await page.getByRole("button", { name: "Open review" }).click();
        await expect(page.getByText("0 of 1 reviewed")).toBeVisible();
        if (kind === "ambiguous") {
          await expect(page.getByText("Ambiguous group")).toBeVisible();
          if (decision === "accept") {
            await page.locator("main button").filter({ hasText: "Invoice C" }).filter({ hasText: "Invoice D" }).first().click();
          }
        }

        await decideAndLeave(page, decision, via);

        // Results: exactly one decision, the one that was made.
        const decided = page.getByTestId("decided-item");
        await expect(decided).toHaveCount(1);
        await expect(decided).toHaveAttribute("data-decision", decision === "accept" ? "accepted" : "rejected");
        await expect(decided).toHaveAttribute("data-kind", c.dataKind);
        await expect(decided).toContainText(c.bankDesc);
        if (c.decidedText) await expect(decided).toContainText(c.decidedText);
        if (kind === "ambiguous" && decision === "accept") await expect(decided).toContainText("Invoice C; Invoice D");

        // Export: the same final state.
        const { matched, attention } = await exportSections(page);
        if (decision === "accept") {
          expect(matched).toContain(c.bankDesc);
          for (const b of c.acceptedBooks) expect(matched).toContain(b);
          for (const b of c.notChosenBooks ?? []) expect(matched).not.toContain(b);
          expect(attention).not.toContain(c.bankDesc);
        } else {
          expect(matched).not.toContain(c.bankDesc);
          for (const b of [...c.acceptedBooks, ...(c.notChosenBooks ?? [])]) expect(matched).not.toContain(b);
          expect(attention).toContain(c.bankDesc);
        }

        // Review: the item is not back in the queue.
        await page.getByTestId("sidebar").getByRole("button", { name: /review/i }).first().click();
        await expect(page.getByText("All reviewed!")).toBeVisible();
      });
    }
  }
}

// ───────────── "Back to results" on the finished screen ─────────────
test("Back to results after the last decision shows the decision", async ({ page }) => {
  await load(page, CASES.normal);
  await page.getByRole("button", { name: "Open review" }).click();
  await page.getByRole("button", { name: ACCEPT }).click();
  await expect(page.getByText("All reviewed!")).toBeVisible();
  await page.getByRole("button", { name: "Back to results" }).click();
  await expect(page.getByTestId("decided-item")).toHaveCount(1);
  await expect(page.getByTestId("decided-item")).toHaveAttribute("data-decision", "accepted");
});

// ───────────── browser Back / history behaviour ─────────────
test("browser Back from Review returns to Results without reloading, and never leaves a dead history entry", async ({ page }) => {
  await load(page, CASES.normal);
  let loads = 0;
  page.on("load", () => loads++);

  // In-app Results, then browser Back: leaves Review via the app first,
  // so Back must not land on a stale "Review" entry.
  await page.getByRole("button", { name: "Open review" }).click();
  await page.getByRole("main").getByRole("button", { name: /^results$/i }).click();
  await expect(page.getByTestId("recon-status")).toBeVisible();
  await page.getByRole("button", { name: "Open review" }).click();
  await expect(page.getByText("0 of 1 reviewed")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("recon-status")).toBeVisible();
  await expect(page.getByText("0 of 1 reviewed")).toHaveCount(0);
  expect(loads).toBe(0); // same page, same in-memory reconciliation
});

// ───────────── rapid clicking ─────────────
const TWO_PAIRS: Case = {
  bank: ["01/16/2026,SQ *BLUE BOTTLE COFFEE,-18.50", "02/02/2026,CHECK 1187 NORTHWIND PRINT,-1240.00", RENT_BANK],
  ledger: ["01/16/2026,Blue Bottle - client coffee,-18.50", "01/30/2026,Check 1187 - Northwind Print Co.,-1240.00", RENT_BOOKS],
  bankDesc: "",
  dataKind: "pair",
  acceptedBooks: [],
};

test("a double-click records one decision, never two", async ({ page }) => {
  await load(page, TWO_PAIRS);
  await page.getByRole("button", { name: "Open review" }).click();
  await expect(page.getByText("0 of 2 reviewed")).toBeVisible();
  await page.getByRole("button", { name: ACCEPT }).dblclick();
  await expect(page.getByText("1 of 2 reviewed")).toBeVisible();
  // The second item is still waiting for its own decision.
  await expect(page.getByRole("button", { name: ACCEPT })).toBeEnabled();
  await expect(page.getByText("1 of 2 reviewed")).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: /^results$/i }).click();
  await expect(page.getByTestId("decided-item")).toHaveCount(1);
});

test("accept then an immediate reject click keeps the accept", async ({ page }) => {
  await load(page, TWO_PAIRS);
  await page.getByRole("button", { name: "Open review" }).click();
  await page.evaluate(
    ({ accept, reject }) => {
      const buttons = [...document.querySelectorAll("main button")] as HTMLButtonElement[];
      buttons.find((b) => new RegExp(accept, "i").test(b.innerText.trim()))!.click();
      // Same task, before React re-renders: the second handler must be ignored.
      buttons.find((b) => new RegExp(reject, "i").test(b.innerText.trim()))!.click();
    },
    { accept: ACCEPT.source, reject: REJECT.source }
  );
  await expect(page.getByText("1 of 2 reviewed")).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: /^results$/i }).click();
  const decided = page.getByTestId("decided-item");
  await expect(decided).toHaveCount(1);
  await expect(decided).toHaveAttribute("data-decision", "accepted");
});
