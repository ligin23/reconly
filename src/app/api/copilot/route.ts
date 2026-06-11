// ============================================================
// POST /api/copilot — the ONLY server-side surface in Reconly.
//
// Public, unauthenticated endpoint holding the Anthropic API
// key. Treat every request as hostile. Order of the walls:
//
//   1. Origin/Referer check        → 403
//   2. Payload size cap (64 KB)    → 413
//   3. Strict Zod schema           → 400  (also blocks proxy abuse)
//   4. IP + session rate limits    → 429  (fail-closed)
//   5. Anthropic call, max_tokens capped, key from env only
//
// Logging policy: NEVER log the question, the transaction
// context, or the reply (host platforms retain logs). Only
// timestamp, token counts, latency, and error class.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { copilotRequestSchema, type ReconContext } from "@/lib/copilot/schema";
import {
  COPILOT_MODEL,
  COPILOT_MAX_TOKENS,
  COPILOT_SYSTEM_PROMPT,
} from "@/lib/copilot/system-prompt";
import { checkRateLimit } from "@/lib/copilot/rate-limit";

const MAX_BODY_BYTES = 64 * 1024;

/** Friendly, detail-free error body. Upstream errors never pass through. */
function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/** Same-origin check: browsers always send Origin on POST. Weak alone, free to add. */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host;
    const requestHost = request.headers.get("host");
    if (requestHost && originHost === requestHost) return true;
    // Explicit allow-list for deploys behind differing Host headers (proxies).
    const allowed = process.env.COPILOT_ALLOWED_ORIGIN;
    return Boolean(allowed && originHost === new URL(allowed).host);
  } catch {
    return false;
  }
}

/**
 * Client IP for rate limiting — must come from a TRUSTED source.
 * Never the leftmost x-forwarded-for entry: that's client-supplied, and
 * rotating it would mint a fresh rate-limit bucket per request. Platforms
 * (Vercel, most reverse proxies) overwrite x-real-ip and APPEND the real
 * connecting IP to x-forwarded-for, so trust x-real-ip first, then the
 * RIGHTMOST forwarded entry.
 */
function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip");
  if (real?.trim()) return real.trim();
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return "unknown";
}

/** Strip control characters — defense in depth on top of the client-side
 *  masking pass; applies to every string that reaches the prompt. */
function scrub(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "");
}

/** Serialize the validated context into the delimited data block.
 *  Data lives apart from the question; the system prompt declares
 *  everything inside the block to be data, never instructions. */
function buildUserMessage(question: string, context: ReconContext): string {
  const safeContext: ReconContext = {
    summary: { ...context.summary, periodLabel: scrub(context.summary.periodLabel) },
    items: context.items.map((item) => ({
      ...item,
      description: scrub(item.description),
      reasons: item.reasons.map(scrub),
    })),
    omittedItemCount: context.omittedItemCount,
  };
  return [
    "<reconciliation_data>",
    JSON.stringify(safeContext, null, 2),
    "</reconciliation_data>",
    "",
    "User question: " + scrub(question),
  ].join("\n");
}

type ModelReply = { reply: string; meta: Record<string, unknown> };

/** Production path: Anthropic messages API, system prompt cached. */
async function callAnthropic(apiKey: string, userMessage: string): Promise<ModelReply> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: COPILOT_MODEL,
    max_tokens: COPILOT_MAX_TOKENS,
    system: [
      {
        type: "text",
        text: COPILOT_SYSTEM_PROMPT,
        // Static prefix — cache across requests to cut cost/latency.
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
  });
  const reply = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return {
    reply,
    meta: {
      provider: "anthropic",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      stopReason: response.stop_reason,
    },
  };
}

/** Dev-only path: local Ollama model with the SAME system prompt and walls.
 *  For guardrail-harness testing without an API key — never production. */
async function callOllama(model: string, userMessage: string): Promise<ModelReply> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      messages: [
        { role: "system", content: COPILOT_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      options: { num_predict: COPILOT_MAX_TOKENS },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`ollama status ${res.status}`);
  const body = (await res.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  return {
    reply: (body.message?.content ?? "").trim(),
    meta: {
      provider: `ollama:${model}`,
      inputTokens: body.prompt_eval_count ?? 0,
      outputTokens: body.eval_count ?? 0,
    },
  };
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();

  // -- Wall 1: origin --
  if (!originAllowed(request)) {
    return errorResponse(403, "Requests must come from the Reconly app.");
  }

  // -- Wall 2: size cap (header first, then actual bytes) --
  // Require a believable content-length BEFORE buffering: browsers always
  // send it for fetch() with a string body, and without this check a client
  // omitting the header forces the full body into memory before rejection.
  const declaredHeader = request.headers.get("content-length");
  const declaredLength = Number(declaredHeader);
  if (!declaredHeader || !Number.isFinite(declaredLength) || declaredLength <= 0) {
    return errorResponse(411, "Invalid request.");
  }
  if (declaredLength > MAX_BODY_BYTES) {
    return errorResponse(413, "That reconciliation is too large to send in one question.");
  }
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return errorResponse(400, "Could not read the request.");
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return errorResponse(413, "That reconciliation is too large to send in one question.");
  }

  // -- Wall 3: strict schema --
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "Invalid request.");
  }
  const parsed = copilotRequestSchema.safeParse(json);
  if (!parsed.success) {
    // No issue details in the response — they would map the schema for an attacker.
    return errorResponse(400, "Invalid request.");
  }
  const { question, context, sessionId } = parsed.data;

  // -- Wall 4: rate limits (IP primary, session secondary; fail-closed) --
  const limit = await checkRateLimit(clientIp(request), sessionId);
  if (!limit.allowed) {
    return errorResponse(429, "You've asked a lot of questions in a short time — please try again in a bit.");
  }

  // -- Wall 5: the call itself --
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // Dev-only fallback: a local Ollama model for guardrail testing without an
  // API key. The Anthropic path ALWAYS wins when a key is present, and the
  // fallback never activates in production builds.
  const ollamaModel =
    !apiKey && process.env.NODE_ENV !== "production"
      ? process.env.COPILOT_DEV_OLLAMA_MODEL
      : undefined;
  if (!apiKey && !ollamaModel) {
    console.error("[copilot]", { at: new Date().toISOString(), errorClass: "MissingApiKey" });
    return errorResponse(503, "The assistant isn't available right now.");
  }

  try {
    const userMessage = buildUserMessage(question, context);
    const { reply, meta } = apiKey
      ? await callAnthropic(apiKey, userMessage)
      : await callOllama(ollamaModel!, userMessage);

    // Metadata only — never the payload.
    console.log("[copilot]", {
      at: new Date().toISOString(),
      ms: Date.now() - startedAt,
      ...meta,
    });

    if (!reply) {
      return errorResponse(502, "I couldn't process that just now — please try again.");
    }
    return Response.json({ reply });
  } catch (error) {
    // Log the error CLASS and status only — never the upstream body,
    // which could echo request content.
    const errorClass =
      error instanceof Anthropic.APIError
        ? `AnthropicAPIError:${error.status ?? "network"}`
        : error instanceof Error
          ? error.name
          : "Unknown";
    console.error("[copilot]", {
      at: new Date().toISOString(),
      ms: Date.now() - startedAt,
      errorClass,
    });
    return errorResponse(502, "I couldn't process that just now — please try again.");
  }
}
