// ============================================================
// Rate limiting for /api/copilot — SERVER ONLY.
//
// Primary brake:   per-IP, 20 requests/hour (sessions are free
//                  to mint; IPs are not).
// Secondary brake: per-session, 40 requests/hour.
// Final brake:     GLOBAL daily request budget — caps total spend
//                  even if per-key limits are evaded (rotated IPs,
//                  minted sessions). Independent of any key.
//
// Backend: Upstash Redis via REST when UPSTASH_REDIS_REST_URL /
// UPSTASH_REDIS_REST_TOKEN are set (REQUIRED in production —
// serverless instances don't share memory, so per-instance memory
// counting is no limit at all; production without Upstash fails
// closed). Falls back to an in-process Map in development only.
//
// Fail-closed: if the Redis call errors, the request is denied.
// On a public endpoint holding an API key, an outage of the
// rate limiter must not become an open proxy.
// ============================================================

import "server-only";

export const IP_LIMIT_PER_HOUR = 20;
export const SESSION_LIMIT_PER_HOUR = 40;
/** Total requests/day across ALL clients — the code-level spend backstop.
 *  Sized ~10× expected daily traffic; the Anthropic console spend cap
 *  remains the operational last line. */
export const GLOBAL_LIMIT_PER_DAY = 2000;
const WINDOW_SECONDS = 3600;
const GLOBAL_WINDOW_SECONDS = 86_400;

type LimitResult = { allowed: boolean; remaining: number };

// ---- In-memory fallback (dev / single instance) ----

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

function memoryIncrement(key: string, limit: number): LimitResult {
  const now = Date.now();
  // Opportunistic cleanup so the map doesn't grow unboundedly.
  if (memoryBuckets.size > 10_000) {
    for (const [k, v] of memoryBuckets) {
      if (v.resetAt <= now) memoryBuckets.delete(k);
    }
  }
  const bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + WINDOW_SECONDS * 1000 });
    return { allowed: true, remaining: limit - 1 };
  }
  bucket.count += 1;
  return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count) };
}

// ---- Upstash REST backend ----

async function upstashIncrement(
  url: string,
  token: string,
  key: string,
  limit: number,
  windowSeconds: number = WINDOW_SECONDS
): Promise<LimitResult> {
  // Pipeline: INCR the counter, set its expiry only if not already set.
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, windowSeconds, "NX"],
    ]),
    // A slow limiter shouldn't hang the request; fail closed instead.
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`rate-limit backend status ${res.status}`);
  const results = (await res.json()) as Array<{ result?: number; error?: string }>;
  const count = results[0]?.result;
  if (typeof count !== "number") throw new Error("rate-limit backend bad response");
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

// ---- Public API ----

let warnedMemoryFallback = false;

/** Day-stamped global key: a fixed daily budget, resets at UTC midnight. */
function globalKey(): string {
  return `copilot:global:${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Counts this request against the IP, session, AND global daily windows.
 * Returns { allowed: false } if any limit is exceeded — or if the
 * distributed backend fails (fail-closed). In production without an
 * Upstash configuration this also fails closed: per-instance memory
 * counting on serverless is effectively no rate limit, and this endpoint
 * spends real money.
 */
export async function checkRateLimit(
  ip: string,
  sessionId: string
): Promise<LimitResult> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  const ipKey = `copilot:ip:${ip}`;
  const sessionKey = `copilot:session:${sessionId}`;

  if (url && token) {
    try {
      const [byIp, bySession, byGlobal] = await Promise.all([
        upstashIncrement(url, token, ipKey, IP_LIMIT_PER_HOUR),
        upstashIncrement(url, token, sessionKey, SESSION_LIMIT_PER_HOUR),
        upstashIncrement(url, token, globalKey(), GLOBAL_LIMIT_PER_DAY, GLOBAL_WINDOW_SECONDS),
      ]);
      return {
        allowed: byIp.allowed && bySession.allowed && byGlobal.allowed,
        remaining: Math.min(byIp.remaining, bySession.remaining, byGlobal.remaining),
      };
    } catch {
      // Fail closed — never let a limiter outage open the endpoint.
      return { allowed: false, remaining: 0 };
    }
  }

  if (process.env.NODE_ENV === "production") {
    if (!warnedMemoryFallback) {
      warnedMemoryFallback = true;
      console.error(
        "[copilot] UPSTASH_REDIS_REST_URL not set in production — denying all " +
          "copilot requests (fail-closed). Configure Upstash to enable the assistant."
      );
    }
    return { allowed: false, remaining: 0 };
  }

  const byIp = memoryIncrement(ipKey, IP_LIMIT_PER_HOUR);
  const bySession = memoryIncrement(sessionKey, SESSION_LIMIT_PER_HOUR);
  const byGlobal = memoryIncrement(globalKey(), GLOBAL_LIMIT_PER_DAY);
  return {
    allowed: byIp.allowed && bySession.allowed && byGlobal.allowed,
    remaining: Math.min(byIp.remaining, bySession.remaining, byGlobal.remaining),
  };
}
