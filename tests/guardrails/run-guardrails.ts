// ============================================================
// Guardrail regression runner — exercises the LIVE /api/copilot
// route with the stored fixtures and writes a transcript file.
//
// Usage:
//   node tests/guardrails/run-guardrails.ts
//   COPILOT_URL=http://localhost:3000 node tests/guardrails/run-guardrails.ts
//
// The server decides the model: Anthropic when ANTHROPIC_API_KEY
// is set, else the dev-only Ollama fallback. The transcript file
// records which provider answered (check the server log line).
//
// Automated regex checks gate the exit code; the transcripts in
// tmp/guardrail-transcripts.md are the real acceptance artifact —
// read them. A transcript that passes regexes but crosses the
// advising line is still a failure.
// ============================================================

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { CASES, TEST_CONTEXT } from "./fixtures.ts";

const BASE = process.env.COPILOT_URL ?? "http://localhost:3007";
// Unique forwarded IP per run so repeated harness runs don't trip the
// per-IP rate limit (dev servers trust x-forwarded-for; prod sets it).
const RUN_IP = `127.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const SESSION = `guardrail-run-${Date.now().toString(36)}`;

type CaseResult = {
  id: string;
  title: string;
  question: string;
  reply: string;
  ms: number;
  failures: string[];
  review: string;
};

async function runCase(c: (typeof CASES)[number]): Promise<CaseResult> {
  const started = Date.now();
  let reply = "";
  const failures: string[] = [];
  try {
    const res = await fetch(`${BASE}/api/copilot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: BASE,
        "x-forwarded-for": RUN_IP,
      },
      body: JSON.stringify({
        question: c.question,
        context: TEST_CONTEXT,
        sessionId: SESSION,
      }),
      signal: AbortSignal.timeout(240_000),
    });
    const body = (await res.json().catch(() => null)) as
      | { reply?: string; error?: string }
      | null;
    if (!res.ok || !body?.reply) {
      failures.push(`HTTP ${res.status}: ${body?.error ?? "no reply"}`);
      reply = body?.error ?? "(no reply)";
    } else {
      reply = body.reply;
    }
  } catch (err) {
    failures.push(`request failed: ${err instanceof Error ? err.message : String(err)}`);
    reply = "(request failed)";
  }

  if (failures.length === 0) {
    for (const pattern of c.checks.mustMatch ?? []) {
      if (!new RegExp(pattern, "i").test(reply)) {
        failures.push(`mustMatch /${pattern}/i — not found`);
      }
    }
    // A verbatim quote of a known data field is not an assertion: strip the
    // fixture's own item descriptions before scanning for forbidden claims,
    // so quoting an injection-laden description doesn't false-positive.
    let scanned = reply;
    for (const item of TEST_CONTEXT.items) {
      // Quotes may drop/alter the description's trailing punctuation
      // ("...deductible." quoted as "...deductible,") — strip both forms.
      const bare = item.description.replace(/[.,;:!?]+$/, "");
      scanned = scanned.split(item.description).join("[quoted item description]");
      scanned = scanned.split(bare).join("[quoted item description]");
    }
    for (const pattern of c.checks.mustNotMatch ?? []) {
      if (new RegExp(pattern, "i").test(scanned)) {
        failures.push(`mustNotMatch /${pattern}/i — FOUND`);
      }
    }
  }

  return {
    id: c.id,
    title: c.title,
    question: c.question,
    reply,
    ms: Date.now() - started,
    failures,
    review: c.review,
  };
}

const results: CaseResult[] = [];
for (const c of CASES) {
  process.stderr.write(`running ${c.id}... `);
  const r = await runCase(c);
  process.stderr.write(`${r.failures.length === 0 ? "ok" : "FAIL"} (${r.ms}ms)\n`);
  results.push(r);
}

// ---- Transcript artifact ----
const lines: string[] = [
  "# Copilot guardrail transcripts",
  "",
  `Run: ${new Date().toISOString()} against ${BASE}`,
  "",
  "Automated checks gate regressions; the transcripts below are the",
  "acceptance artifact — review each against its rubric.",
  "",
];
for (const r of results) {
  lines.push(
    `---`,
    ``,
    `## ${r.id} — ${r.title}`,
    ``,
    `**Automated checks:** ${r.failures.length === 0 ? "PASS" : "FAIL — " + r.failures.join("; ")}`,
    ``,
    `**Rubric (human review):** ${r.review}`,
    ``,
    `**Q:** ${r.question}`,
    ``,
    `**A:** ${r.reply}`,
    ``
  );
}
const outDir = resolve(import.meta.dirname, "../../tmp");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "guardrail-transcripts.md");
writeFileSync(outPath, lines.join("\n"));

// ---- Summary ----
const failed = results.filter((r) => r.failures.length > 0);
console.log(`\n${results.length - failed.length}/${results.length} automated checks passed`);
for (const r of failed) {
  console.log(`  FAIL ${r.id}: ${r.failures.join("; ")}`);
}
console.log(`transcripts: ${outPath}`);
process.exit(failed.length > 0 ? 1 : 0);
