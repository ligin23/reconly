# Reconly

Reconly reconciles a bank statement against a ledger — upload two CSVs, and a
deterministic matching engine pairs the transactions, flags what's missing on
either side, and proves (or disproves) that the books balance. Everything runs
in the browser: transaction data never leaves the device, except when the user
explicitly asks the AI copilot a question about their results.

## Features

- **Deterministic matching engine** — exact, near, fuzzy, and composite
  (many-to-one) matching over integer-cent amounts. No AI in the matching
  path, no randomness: same inputs, same answer, every time.
- **Reject-don't-guess CSV parsing** — handles real-world formats (accounting
  parentheses, trailing minus, DR/CR markers, European decimal commas, DD/MM
  dates), and anything it can't confidently read is skipped *and reported*,
  never silently zeroed.
- **Honest verdict** — "Fully reconciled" requires every item explained, not
  just totals that happen to net to zero.
- **Review workflow** — suggested matches need an explicit yes/no; missing
  items can be added to the reconciliation (framed as "to record", Reconly
  never claims to change the books).
- **Local-first persistence** — reconciliations save to IndexedDB in the
  browser. No accounts, no server-side storage.
- **Exports** — styled Excel worksheet and PDF report.
- **AI copilot (explain-only)** — answers questions about the current
  reconciliation, grounded in the engine's actual output. It never produces,
  alters, or overrides results. Served through a hardened serverless proxy
  (`/api/copilot`); the API key never reaches the client.

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000
```

Try it with the built-in sample data ("Try with sample data" on the upload
screen) or the CSVs in `public/samples/`.

## Tests

```bash
npm test                      # Vitest unit suite (engine, parser, copilot)
PORT=4123 npx playwright test # e2e (uses the production build via `npm start`)
```

The Playwright config reuses an existing server on the chosen port — set
`PORT` to something free or it may test the wrong app.

## Configuration

Copy `.env.example` to `.env.local` and fill in what you need. The app runs
without any env vars; only the copilot requires them:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the copilot route |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Distributed rate limiting — **required in production**; without them the copilot fails closed |
| `COPILOT_ALLOWED_ORIGIN` | Optional origin allow-list behind proxies |

## Deploying

1. Set `ANTHROPIC_API_KEY` and the Upstash variables in the host's project
   settings (e.g. Vercel).
2. **Set a hard monthly spend limit on the Anthropic key in the console.**
   This is the operational backstop behind the per-IP, per-session, and
   global daily rate limits — do not skip it.
3. `npm run build` / deploy as a standard Next.js app. Security headers
   (CSP, HSTS, frame-ancestors) are configured in `next.config.ts`.

## Project layout

```
src/lib/recon/      matching engine (pure TS, no framework)
src/lib/parser/     CSV → transactions, with diagnostics
src/lib/data/       IndexedDB persistence
src/lib/export/     Excel + PDF report generation
src/lib/copilot/    copilot schema, context builder, rate limiting
src/app/api/copilot the only server-side surface
src/components/     UI (upload → mapping → processing → dashboard → review)
tests/              Playwright e2e + engine answer-key suite
```
