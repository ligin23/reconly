// ============================================================
// AI copilot feature gate — the assistant is ON HOLD (Phase 6A).
//
// Two independent switches, BOTH required to reactivate:
//
//   1. COPILOT_UI_ENABLED (this file, code constant) — mounts the
//      assistant panel in the app. A code change + review, never an
//      environment toggle, so the UI cannot reappear by accident.
//   2. COPILOT_ENABLED=true (server environment variable, NOT set
//      anywhere today) — lets /api/copilot do any work at all.
//      Missing, empty or any other value → disabled (fail closed).
//
// The server gate is checked FIRST in the route, before the body is
// read and before Anthropic or Upstash could be contacted. Enabling
// the UI alone does nothing: the server still refuses.
//
// Reactivation also needs: ANTHROPIC_API_KEY, UPSTASH_REDIS_REST_URL
// and UPSTASH_REDIS_REST_TOKEN configured, verified provider terms, and
// updated privacy disclosures — see the Phase 6A audit.
// ============================================================

/** Client-side: whether the assistant panel is shown. Off while on hold. */
export const COPILOT_UI_ENABLED: boolean = false;

/** The only value of COPILOT_ENABLED that turns the server route on. */
export const COPILOT_ENABLED_VALUE = "true";

/** Server-side: is /api/copilot allowed to process requests? Fails closed. */
export function isCopilotServerEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.COPILOT_ENABLED === COPILOT_ENABLED_VALUE;
}

/** Response body while disabled — fixed text, no configuration details. */
export const COPILOT_UNAVAILABLE_MESSAGE = "The assistant is not available.";
