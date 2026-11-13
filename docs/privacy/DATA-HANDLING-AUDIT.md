# Reconly — Phase 6A Data-Handling & Privacy Audit (revision 2)

Audited: branch `feature/privacy-legal` (from `474c2a6`, = production `main`) **including the uncommitted Phase 6A changes**, 2026-11-12.
Method: source-code reading, Next.js/CSP config, automated tests, `vercel env ls` (names only, read-only, earlier in Phase 6A). No production traffic was generated; no settings or credentials were changed. No secrets appear here.

Legend — **[V]** verified in code/tests · **[P]** third-party claim, unverified · **[F]** proposed future functionality · **[L]** unresolved legal question · **[R]** risk.

Revision 2 changes: AI copilot disabled in UI and server (§C); individual saved-reconciliation deletion added (§B); copy and drafts updated. Revision 3: CSV data minimization Option A implemented for new imports (§A2).

---

## 1. Data flow (current implementation)

```
 Visitor's browser (all financial processing)                Servers / third parties
 ────────────────────────────────────────────                ───────────────────────
 CSV file ─File API─► parser ─► engine ─► results UI
                                    ├─► Save (user click) ──► IndexedDB "reconly" (this browser only)
                                    ├─► Delete (History, confirmed) ─► removes that one IndexedDB record
                                    └─► PDF / Excel ────────► download to device
 (no assistant panel — COPILOT_UI_ENABLED = false)

 Any POST /api/copilot ──► Vercel Function: feature gate → 503 "The assistant is not available."
                           (body not read; no Upstash; no Anthropic)
 Every page/asset request ─────────────────────────────────► Vercel edge/CDN (standard request metadata)
```

CSP (`next.config.ts:11-22`): `default-src 'self'`, `connect-src 'self'`, `font-src 'self'`, `img-src 'self' data: blob:`, `form-action 'self'`, `frame-ancestors 'none'` — browser code cannot contact third-party origins. **[V]**
While AI is disabled, **no server-side code path contacts any third party**: the gate returns before `checkRateLimit` (Upstash) and `callAnthropic`. **[V]** (`route.ts:171-179`, unit test `src/app/api/copilot/__tests__/feature-gate.test.ts`)

## 2. Data inventory

| # | Category | Source | Processed | Stored | Third party | Retention | Deletion | Code |
|---|---|---|---|---|---|---|---|---|
| 1 | CSV contents — new imports: retained columns only (§A2); older saved records: every column | User-chosen files | Browser (full row read once at parse time) | Memory; IndexedDB **only on Save** (`Txn.raw` = retained columns) | None | Memory: until tab closes / Start over. Saved: until deleted | **History → Delete (one record, confirmed)**, or clear site data (all) | `parser/index.ts:808-821`, `recon/types.ts:7-28`, `app-shell.tsx` (save handlers) |
| 2 | File names, row/line numbers, header row, statement period & stated balances | Parser | Browser | IndexedDB on Save (`sourceFiles`, `Txn.sourceFile/sourceLine`) | None | As #1 | As #1 | `data/repository.ts` (`SourceFileInfo`) |
| 3 | User decisions, account label, period, status, difference | User | Browser | IndexedDB on Save | None | As #1 | As #1 | `repository.ts` (`ReconciliationRecord`) |
| 4 | `localStorage["reconly-copilot-notice-ack"]="1"` | Set only by the (now unmounted) assistant panel | Browser | localStorage, only if set before Phase 6A | None | Until site data cleared | Clear site data | `copilot-panel.tsx:25,81` |
| 5 | Hosting request metadata (IP, UA, path, time, status) | Every request | Vercel | Vercel logs **[P]** | Vercel | Per Vercel plan **[P]** | Vercel-controlled | platform |
| 6 | `/api/copilot` requests while disabled | Only a manual/direct POST (no UI sends one) | Vercel Function | **Not read, not logged** by Reconly code | None | — | — | `route.ts:171-179` |
| 7 | PDF / Excel reports | Browser | Browser (jsPDF, xlsx-js-style) | User's device | None | User-controlled | User-controlled | `export/pdf-report.ts:52-54`, `export/excel-worksheet.ts:228-231` |
| 8 | Demo/sample CSVs | Same-origin static files | Browser | As #1 if saved (`sampleData: true`) | None | — | As #1 | `app-shell.tsx` (`useSample`, advanced demo) |
| 9 | Analytics events | `track()` | Local DOM event only; forwards to `window.va` only if that script exists (it does not) | None | None | — | — | `analytics/track.ts` |

Cookies: none set by Reconly **[V]**. Vercel sets `_vercel_jwt` on login-protected previews only **[P]**. sessionStorage, Cache Storage, service workers: not used **[V]**. Fonts self-hosted at build time **[V]**.

## 3. Findings by area

### A. CSV upload processing — [V]
Files are read with the File API; no upload endpoint exists. Parsed rows live in React state; nothing is persisted until the user presses Save. File contents never leave the browser (the assistant, the only former exception, is disabled).

### A2. CSV field retention — Option A implemented (approved 2026-11-12) — [V]

Lifecycle: file pick → `parseCsvDetailed` reads the **full** row (dates, amounts, balance rows, running balance, statement period/title lines) → `Txn.raw` is reduced to retained columns (`retainedRow`, `src/lib/parser/index.ts`, "Data minimization" block) → engine (date/description/amount only) → `detectDuplicates` / `fileOverlaps` / `accountOf` (statements, month review) read `raw` by header name → provenance (`sourceFile/sourceLine`) → Save → restore re-detects duplicates from stored `raw` → exports (never read `raw`; Vitest asserts no `.raw` in `src/lib/export`).

**Retained in `Txn.raw` (new imports):**
| Column | Why |
|---|---|
| Mapped date, description, amount / debit / credit, reference | Original values for duplicate review display; reference is duplicate evidence |
| Detected running-balance column (`balance`, `running balance`, owed-balance variants) | Statement running-balance evidence; duplicate evidence |
| Any header in `DUPLICATE_EVIDENCE_HEADERS` (`src/lib/import/duplicates.ts`): transaction-ID headers (`transaction id`, `fitid`, …), generic id (`id`, `no`, `#`), reference/check headers, balance headers, **account headers** (`account`, `account number`, `account #`, `account no`, `account id`, `account name`) — mapped or not | Duplicate proof, overlap detection, cross-account safeguard, statement account checks, month-review account-mismatch finding |

**Discarded (new imports):** every other column — e.g. memo/notes, category, card number, payee address, tags, any unrecognised column. Their values are not kept in parsed rows (`Txn.raw`) or in IndexedDB. The uploaded file text itself stays in tab memory (`fileContentsRef`, `app-shell.tsx`) so the mapping/header row can be changed, until Start over, file removal or tab close — it is never persisted. Only their **header names** are reported in-memory as `ParseDiagnostics.omittedColumns` (not persisted).

Other `Txn` fields unchanged: `date`, `description`, `amount`, `reference`, `sourceFile`, `sourceLine`, `runningBalance`, `id`, `source`.

**Compatibility:** no IndexedDB schema/version change; `raw` stays `Record<string,string>`; no new persisted field. Existing saved records are not migrated, rewritten or trimmed — reopening never writes; "Save changes" on an older record re-saves its rows as stored (full columns kept). Duplicate panel "original row" now shows "Columns kept from this row of the file" with a note that older saves may show every column.

**Proof (tests):** `src/lib/parser/__tests__/minimization.test.ts` (84 cases): unused columns absent (keys and values) and listed by name only; required IDs/accounts/balances/references kept verbatim; every evidence header retained; for every fixture and sample file — alone, grouped per folder, and with two injected unused columns — parse output (dates, amounts, lines, running balances), `detectDuplicates`, `fileOverlaps`, `accountOf`, `verifyStatements` and source file/row are identical between trimmed rows and the full rows rebuilt from the file; Advanced Demo (exact demo maps/header rows) duplicate groups and month review identical; reconciliation matches and balance proof identical. Playwright `tests/csv-minimization.spec.ts`: a new import with memo/card/address columns gives the same results as the plain fixtures, the stored record contains only kept columns and no secret values, provenance intact, reopens correctly; an older full-column record reopens unchanged, is not rewritten on open, and keeps its columns after "Save changes".

**Remaining limitations:** (1) account columns are kept in full (needed by duplicate/statement checks; masking would change detection — not done); (2) descriptions may themselves contain names/numbers and are kept (required); (3) older saved records keep every column until the user deletes them; (4) a future feature that reads a new header from `raw` must add it to `DUPLICATE_EVIDENCE_HEADERS`, or it will silently see nothing on new imports (documented at the constant).

### B. Browser-local storage & deletion — [V]
- IndexedDB `reconly` / store `reconciliations` / v1, one object per reconciliation, no other stores or associated records (`indexeddb-repository.ts:13-40`).
- **New: History → Delete** (`history-screen.tsx`): per-row button (labelled with the record name), `alertdialog` confirmation naming account, period and save date, focus on Cancel, Escape/backdrop cancel; calls `repository.deleteReconciliation(id)` via `app-shell.tsx` `deleteSavedRecord`, then **re-reads the list from IndexedDB**; confirm disabled while pending (no double delete); storage error → message "nothing was removed", dialog stays, list unchanged.
- Deleting the record that is open: working state stays in memory (shown note), `currentRecordId` cleared so a later Save creates a new record rather than recreating the old id.
- No other in-app copies: `savedRecords` state is refreshed from storage; `currentRecord` derives from it.
- Not claimed: physical erasure from disk (browsers compact IndexedDB lazily), OS/device backups, synced profiles **[P]**.
- Same-profile access, no encryption, browser eviction, private windows — disclosed in drafts.

### C. AI copilot — disabled — [V]
- **UI:** single entry point was `<CopilotPanel>` in `app-shell.tsx`; now mounted only if `COPILOT_UI_ENABLED` (code constant `false`, `src/lib/copilot/feature-gate.ts`). No launcher, chips, notice or panel render anywhere (landing, app, sample, demo, review, history, mobile). No other AI controls existed.
- **Server:** `isCopilotServerEnabled()` true only when `COPILOT_ENABLED === "true"` exactly; missing/empty/other → disabled. Checked as the first statement of `POST` — before origin check, body read, Zod, Upstash or Anthropic. Response: `503 {"error":"The assistant is not available."}`, `Cache-Control: no-store`; no configuration details. GET → 405.
- **Misleading 429 removed** for the disabled state: previously, with no Upstash env in production, every request hit the fail-closed limiter and returned "You've asked a lot of questions…". Now the gate answers first.
- **Preserved unchanged:** context builder, schema, system prompt, rate limiter, Anthropic/Ollama paths and their tests; panel component and its (corrected) notice text.
- **Tests:** Vitest `feature-gate.test.ts` (6) — default/invalid values disabled; 503 with all credentials set; `fetch` never called (no Upstash/Anthropic/Ollama); Anthropic client never constructed; request body never read; enabling the flag restores the previous pipeline. Playwright `ai-disabled.spec.ts` — no AI controls and **zero `/api/copilot` requests** across landing, sample, results, review, save/reload/reopen, `/app/demo`, own files, phone width + mobile menu; direct POSTs (valid, empty, malformed, no Origin) → 503.
- **Reactivation requirements [F]:** (1) code change `COPILOT_UI_ENABLED = true` with review; (2) server env `COPILOT_ENABLED=true`; (3) `ANTHROPIC_API_KEY`; (4) `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (else fail-closed 429); (5) verify Anthropic API data-use/training/retention terms and Upstash terms **[P]**; (6) consider hashing IPs before use as limiter keys; (7) gate sending on notice acknowledgement (earlier finding P-4); (8) update Privacy Policy, Terms, landing copy **before** reactivation; (9) Anthropic spend cap.

### D. Exports — [V]
Generated in the browser, no network request. Contain account label, period, verdict/status, totals, transaction dates/descriptions/amounts, source file names and row numbers, decisions, duplicate and statement findings. Not `raw`. User responsible after download.

### E. Hosting & network — [V]/[P]
Routes: `/`, `/privacy`, `/terms` (static, noindex, not in sitemap), `/app`, `/app/demo`, `/api/copilot` (gated), `/robots.txt`, `/sitemap.xml`, `/opengraph-image`. Browser network: same-origin only (Playwright asserts no off-origin requests on legal pages, app flows). No analytics, no error-reporting SDK, no cookies. Vercel receives standard request metadata **[P]**.

### F. Rate limiting while AI is disabled — [V]
Never invoked; no IP or session counters are written anywhere. (`rate-limit.ts` unchanged and still fail-closed for any future enablement.)

### G. Security — [V]
CSP + `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS, Permissions-Policy. No credentials in client code; route never echoes configuration. Delete requires confirmation and affects one id. No certifications claimed.

## 4. Claims review (current copy)

| Location | Status |
|---|---|
| Landing › Privacy › AI card | Replaced: "No AI features are active … Reconly sends no reconciliation data to any AI service" |
| Landing › Privacy › saved card | Now: delete from Past reconciliations; clearing site data removes all; not synced; same-profile access |
| Landing › Privacy footnote | Now says not every piece of information stays on the device (hosting metadata) |
| FAQ "Where is my data stored?" | AI mention removed; deletion added |
| Assistant notice text | Corrected earlier (no training claim, names not masked); component not rendered |
| Footer, disclaimer | Unchanged disclaimer; Privacy Policy / Terms links |
| Legal drafts | AI described as disabled; deletion described; no masking/training/certification claims (Playwright asserts banned phrases are absent) |

## 5. Remaining risks

| ID | Severity | Risk | Status |
|---|---|---|---|
| P-1 | ~~High~~ → Low | No in-app deletion | **Resolved** (individual delete). Remaining: no "delete all" button — clear site data instead. |
| P-2/P-3 | — | Unverified training claim / incomplete notice | Resolved (wording) and moot while AI disabled |
| P-4 | Medium (future) | Notice does not gate sending | Moot while disabled; must fix before reactivation |
| P-5 | — | Misleading 429 in production | **Resolved** by gate (503 "not available") |
| P-6 | Low | New imports keep only used columns (§A2); account columns still kept in full; older saved records keep every column until deleted | Implemented Option A; residual disclosed |
| P-7 | Low | Unencrypted local storage; shared-profile access; eviction | Disclosed |
| P-8 | Low | CSP allows `'unsafe-inline'` scripts | Existing follow-up |
| P-9 | Info | Vercel retention/locations unverified | Owner checklist |
| P-10 | Low | Pre-existing `reconly-copilot-notice-ack` flag may remain in some browsers | Disclosed; harmless |

## 6. Unverified third-party claims [P]
Vercel log contents/retention/regions/DPA; browser IndexedDB physical-deletion and eviction behaviour; (for future AI) Anthropic and Upstash data terms.

## 7. Unresolved legal questions [L]
Operator identity and jurisdiction; customer geography → applicable laws (GDPR/UK GDPR, CCPA/CPRA and other US state laws, PIPEDA); legal bases; whether localStorage use needs consent; browse-wrap enforceability; liability cap, indemnity, governing law/forum; notification approach for policy changes.

## 8. Future features (not implemented) [F]
Analytics (Vercel Web Analytics requires CSP change, new data categories, policy update, consent assessment); feedback form (new processor, contact data, retention); AI reactivation (§C list); "delete all saved data" control; (CSV minimization Option A — now implemented).
