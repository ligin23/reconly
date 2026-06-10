// ============================================================
// Rate limiting for /api/copilot — SERVER ONLY.
//
// Primary brake:   per-IP, 20 requests/hour (sessions are free
//                  to mint; IPs are not).
// Secondary brake: per-session, 40 requests/hour.
//
// Backend: Upstash Redis via REST when UPSTASH_REDIS_REST_URL /
// UPSTASH_REDIS_REST_TOKEN are set (required for real deploys —
// serverless instances don't share memory). Falls back to an
// in-process Map otherwise, which is correct for local dev and
// single-instance servers only.
//
// Fail-closed: if the Redis call errors, the request is denied.
// On a public endpoint holding an API key, an outage of the
// rate limiter must not become an open proxy.
// ============================================================

import "server-only";

export const IP_LIMIT_PER_HOUR = 20;
export const SESSION_LIMIT_PER_HOUR = 40;
const WINDOW_SECONDS = 3600;

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
  limit: number
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
      ["EXPIRE", key, WINDOW_SECONDS, "NX"],
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

/**
 * Counts this request against both the IP and session windows.
 * Returns { allowed: false } if either limit is exceeded — or if the
 * distributed backend fails (fail-closed).
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
      const [byIp, bySession] = await Promise.all([
        upstashIncrement(url, token, ipKey, IP_LIMIT_PER_HOUR),
        upstashIncrement(url, token, sessionKey, SESSION_LIMIT_PER_HOUR),
      ]);
      return {
        allowed: byIp.allowed && bySession.allowed,
        remaining: Math.min(byIp.remaining, bySession.remaining),
      };
    } catch {
      // Fail closed — never let a limiter outage open the endpoint.
      return { allowed: false, remaining: 0 };
    }
  }

  if (process.env.NODE_ENV === "production" && !warnedMemoryFallback) {
    warnedMemoryFallback = true;
    console.warn(
      "[copilot] UPSTASH_REDIS_REST_URL not set — using in-memory rate limiting. " +
        "This is per-instance only; configure Upstash for multi-instance deploys."
    );
  }

  const byIp = memoryIncrement(ipKey, IP_LIMIT_PER_HOUR);
  const bySession = memoryIncrement(sessionKey, SESSION_LIMIT_PER_HOUR);
  return {
    allowed: byIp.allowed && bySession.allowed,
    remaining: Math.min(byIp.remaining, bySession.remaining),
  };
}
