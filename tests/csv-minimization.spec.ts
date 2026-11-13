/**
 * Phase 6A — CSV data minimization (Option A), end to end.
 * New imports store only the columns Reconly uses; results, duplicate review,
 * provenance and saving are unchanged; reconciliations saved earlier (with
 * every column) reopen and stay exactly as they were.
 */
import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

const minimize = (name: string) => resolve(__dirname, "fixtures", "minimize", name);
const dupes = (name: string) => resolve(__dirname, "fixtures", "dupes", name);

const UNUSED = ["memo", "card number", "payee address"];
const SECRETS = ["PRIVATE MEMO", "4111111111111111", "Secret Lane"];

async function analyze(page: Page, bank: string[], ledger: string) {
  await page.goto("/app");
  await page.getByTestId("bank-file-input").setInputFiles(bank);
  await page.getByTestId("ledger-file-input").setInputFiles(ledger);
  await page.getByTestId("start-analysis-btn").click();
  await page.getByTestId("confirm-mapping-btn").click();
  await expect(page.getByTestId("recon-status")).toBeVisible({ timeout: 15_000 });
}

async function save(page: Page, name: string) {
  await page.getByTestId("save-btn").click();
  await page.getByTestId("save-account-name").fill(name);
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByTestId("save-btn")).toHaveText(/save changes/i);
}

type StoredTxn = { raw: Record<string, string>; sourceFile?: string; sourceLine?: number };
type StoredRecord = { id: string; accountName: string; bankTxns: StoredTxn[]; ledgerTxns: StoredTxn[] };

/** Read (or rewrite) the stored records straight from IndexedDB. */
async function readRecords(page: Page): Promise<StoredRecord[]> {
  return page.evaluate(
    () =>
      new Promise<StoredRecord[]>((resolve, reject) => {
        const open = indexedDB.open("reconly");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction("reconciliations").objectStore("reconciliations").getAll();
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
      })
  );
}

test("a new import stores only the columns Reconly uses, with identical results", async ({ page }) => {
  // Same rows as the dupes fixtures plus account, memo, card and address columns.
  await analyze(page, [minimize("bank-jan-extra.csv"), minimize("bank-q1-extra.csv")], dupes("ledger-q1.csv"));

  // Results and duplicate handling exactly as for the plain fixtures (duplicates.spec).
  await expect(page.getByTestId("recon-status")).toContainText("12.00");
  const panel = page.getByTestId("duplicates-panel");
  await expect(panel.getByTestId("dup-counts-bank")).toHaveText(/8 rows imported · 5 in use · 3 set aside/);
  await expect(panel.getByTestId("dup-overlaps")).toContainText("bank-jan-extra.csv");
  const first = panel.getByTestId("dup-section-set-aside").getByTestId("dup-group").first();
  await expect(first.getByTestId("dup-evidence")).toContainText(/same transaction ID \(TX1\)/);
  await expect(first.getByTestId("dup-row-source")).toHaveText(["bank-jan-extra.csv · row 2", "bank-q1-extra.csv · row 2"]);

  // The original-row view shows the kept columns only, and says so.
  await first.getByRole("button", { name: /show row/i }).last().click();
  const row = first.getByTestId("dup-original-row");
  await expect(row).toContainText("TX1");
  await expect(row).toContainText("account number");
  await expect(row).toContainText("000123456789");
  for (const s of [...SECRETS, ...UNUSED]) await expect(row).not.toContainText(s);
  await expect(first.getByTestId("dup-original-row-note")).toContainText("Only these columns are stored");

  // Saved record: required columns kept, unused ones gone, provenance intact.
  await save(page, "Minimized Import");
  const [rec] = await readRecords(page);
  const bankRows = rec.bankTxns;
  expect(bankRows).toHaveLength(8);
  for (const t of bankRows) {
    expect(Object.keys(t.raw).sort()).toEqual(["account number", "amount", "date", "description", "transaction id"]);
    expect(t.raw["account number"]).toBe("000123456789");
    expect(t.sourceFile).toMatch(/^bank-(jan|q1)-extra\.csv$/);
    expect(t.sourceLine).toBeGreaterThanOrEqual(2);
  }
  expect(JSON.stringify(rec)).not.toMatch(new RegExp(SECRETS.join("|")));

  // Reopens with the same results.
  await page.reload();
  await page.getByTestId("nav-history").click();
  await page.getByText("Minimized Import").click();
  await expect(page.getByTestId("recon-status")).toContainText("12.00");
  await expect(page.getByTestId("duplicates-panel").getByTestId("dup-counts-bank")).toHaveText(/8 rows imported · 5 in use · 3 set aside/);
});

test("a reconciliation saved before minimization reopens unchanged and keeps every column", async ({ page }) => {
  await analyze(page, [minimize("bank-jan-extra.csv"), minimize("bank-q1-extra.csv")], dupes("ledger-q1.csv"));
  await save(page, "Older Record");

  // Turn the stored record into what an older version saved: every column of every row.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("reconly");
        open.onsuccess = () => {
          const tx = open.result.transaction("reconciliations", "readwrite");
          const store = tx.objectStore("reconciliations");
          const req = store.getAll();
          req.onsuccess = () => {
            for (const rec of req.result) {
              for (const t of rec.bankTxns) {
                t.raw = { ...t.raw, memo: `PRIVATE MEMO ${t.raw["transaction id"]}`, "card number": "4111111111111111" };
              }
              store.put(rec);
            }
          };
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      })
  );
  const before = JSON.stringify(await readRecords(page));

  await page.reload();
  await page.getByTestId("nav-history").click();
  await page.getByText("Older Record").click();
  await expect(page.getByTestId("recon-status")).toContainText("12.00");
  const panel = page.getByTestId("duplicates-panel");
  await expect(panel.getByTestId("dup-counts-bank")).toHaveText(/8 rows imported · 5 in use · 3 set aside/);
  const first = panel.getByTestId("dup-section-set-aside").getByTestId("dup-group").first();
  await first.getByRole("button", { name: /show row/i }).last().click();
  // The older record still shows (and still holds) every column it was saved with.
  await expect(first.getByTestId("dup-original-row")).toContainText("PRIVATE MEMO TX1");

  // Opening never rewrites it…
  expect(JSON.stringify(await readRecords(page))).toBe(before);
  // …and saving changes keeps its stored rows as they were (no migration).
  await page.getByTestId("save-btn").click();
  await expect(page.getByTestId("save-btn")).toHaveText(/save changes/i);
  const [after] = await readRecords(page);
  expect(after.bankTxns.every((t) => t.raw.memo?.startsWith("PRIVATE MEMO"))).toBe(true);
});
