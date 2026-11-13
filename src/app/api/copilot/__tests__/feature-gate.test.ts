/**
 * The AI copilot is on hold (Phase 6A). /api/copilot must refuse every
 * request before reading the body, contacting Upstash or calling Anthropic,
 * whatever else is configured — unless COPILOT_ENABLED is exactly "true".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const anthropicCtor = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  class Anthropic {
    static APIError = APIError;
    messages = { create: vi.fn() };
    constructor(...args: unknown[]) {
      anthropicCtor(...args);
    }
  }
  return { default: Anthropic };
});

import { isCopilotServerEnabled, COPILOT_UI_ENABLED } from "@/lib/copilot/feature-gate";

const ENV_KEYS = [
  "COPILOT_ENABLED",
  "ANTHROPIC_API_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "COPILOT_DEV_OLLAMA_MODEL",
] as const;

const validBody = JSON.stringify({
  question: "Why doesn't my account balance?",
  sessionId: "session-12345678",
  context: {
    summary: {
      periodLabel: "Jun 1 – Jun 30, 2026",
      reconciled: false,
      bankNetChange: "$100.00",
      ledgerNetChange: "$90.00",
      clearedSum: "$90.00",
      unexplainedDifference: "$10.00",
      counts: {
        exactMatches: 1, nearMatches: 0, fuzzyMatches: 0, compositeMatches: 0,
        missingFromBooks: 1, missingFromBank: 0, userAdded: 0, duplicatesSetAside: 0,
      },
    },
    items: [{ source: "bank", date: "2026-06-03", description: "ACME 123456789012", amount: "$10.00", bucket: "missing-from-books", reasons: [] }],
    omittedItemCount: 0,
  },
});

function request(body = validBody) {
  return new Request("http://localhost:3000/api/copilot", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      host: "localhost:3000",
      "content-type": "application/json",
      "content-length": String(body.length),
      "x-real-ip": "203.0.113.7",
    },
    body,
  });
}

let saved: Record<string, string | undefined>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  fetchSpy = vi.fn(() => Promise.reject(new Error("network must not be used")));
  vi.stubGlobal("fetch", fetchSpy);
  anthropicCtor.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("copilot feature gate", () => {
  it("is disabled by default and for any value other than exactly \"true\"", () => {
    expect(isCopilotServerEnabled({})).toBe(false);
    for (const v of ["", "1", "TRUE", "yes", "on", " true", "true ", "enabled", "false"]) {
      expect(isCopilotServerEnabled({ COPILOT_ENABLED: v })).toBe(false);
    }
    expect(isCopilotServerEnabled({ COPILOT_ENABLED: "true" })).toBe(true);
  });

  it("keeps the assistant UI switched off in code", () => {
    expect(COPILOT_UI_ENABLED).toBe(false);
  });

  it("rejects a valid request with 503 and contacts nothing, even with every credential set", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    process.env.UPSTASH_REDIS_REST_URL = "https://upstash.invalid";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token-not-real";
    const { POST } = await import("../route");
    const req = request();
    const textSpy = vi.spyOn(req, "text");
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "The assistant is not available." });
    expect(JSON.stringify(body)).not.toMatch(/key|upstash|anthropic|env|token/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(fetchSpy).not.toHaveBeenCalled(); // no Upstash, no Anthropic, no Ollama
    expect(anthropicCtor).not.toHaveBeenCalled();
    expect(textSpy).not.toHaveBeenCalled(); // the financial context is never read
  });

  it("returns 503 — never a rate-limit 429 — when nothing is configured", async () => {
    const { POST } = await import("../route");
    for (const body of [validBody, "{}", "not json"]) {
      const res = await POST(request(body));
      expect(res.status).toBe(503);
      expect((await res.json()).error).not.toMatch(/a lot of questions/i);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid gate values the same way", async () => {
    const { POST } = await import("../route");
    for (const v of ["1", "TRUE", "yes"]) {
      process.env.COPILOT_ENABLED = v;
      expect((await POST(request())).status).toBe(503);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("when explicitly enabled, the preserved pipeline runs again (proves the gate is the only change)", async () => {
    process.env.COPILOT_ENABLED = "true";
    const { POST } = await import("../route");
    // Not production and no Upstash → in-memory limiter; no key and no Ollama → 503 MissingApiKey.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(request());
    err.mockRestore();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("The assistant isn't available right now.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
