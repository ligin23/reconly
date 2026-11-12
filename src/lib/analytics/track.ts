// ============================================================
// Reconly — privacy-conscious product analytics (customer validation)
//
// STATUS: prepared, NOT operational. No analytics script is loaded today,
// so `track()` only emits a local DOM event. It forwards to Vercel Web
// Analytics (`window.va`) only if that script is ever added — which needs
// approval: enabling Web Analytics on the Vercel project, and custom events
// require a paid Vercel plan. See docs in the Phase 5 report.
//
// PRIVACY: every event is one of a FIXED set of names, and every field is a
// FIXED enum value. There is deliberately no free-form string, number or
// object field, so no amount, description, account number, file name,
// record id or other user data can ever be sent through this module.
// ============================================================

export type CtaPlacement = "nav" | "mobile_nav" | "hero" | "product" | "final";

export type AnalyticsEvent =
  | { name: "landing_view" }
  | { name: "cta_click"; target: "demo" | "app"; placement: CtaPlacement }
  | { name: "demo_start"; variant: "advanced" | "sample" }
  | { name: "results_view"; source: "advanced_demo" | "sample" | "own_files" };

/** Allowed values per field — anything else is dropped, never sent. */
const ALLOWED: Record<AnalyticsEvent["name"], Record<string, readonly string[]>> = {
  landing_view: {},
  cta_click: {
    target: ["demo", "app"],
    placement: ["nav", "mobile_nav", "hero", "product", "final"],
  },
  demo_start: { variant: ["advanced", "sample"] },
  results_view: { source: ["advanced_demo", "sample", "own_files"] },
};

/** The DOM event name; lets tests (and a future integration) observe events. */
export const ANALYTICS_DOM_EVENT = "reconly:analytics";

type VercelAnalyticsQueue = (cmd: "event", payload: { name: string; data?: Record<string, string> }) => void;

/**
 * Reduce an event to its allow-listed fields. Returns null for an unknown
 * event or a field value outside its enum — such an event is not sent.
 */
export function sanitizeEvent(event: AnalyticsEvent): { name: string; data: Record<string, string> } | null {
  const spec = ALLOWED[event.name as AnalyticsEvent["name"]];
  if (!spec) return null;
  const data: Record<string, string> = {};
  for (const [key, allowed] of Object.entries(spec)) {
    const value = (event as Record<string, unknown>)[key];
    if (typeof value !== "string" || !allowed.includes(value)) return null;
    data[key] = value;
  }
  return { name: event.name, data };
}

/** Record a product event. Never throws; a no-op on the server. */
export function track(event: AnalyticsEvent): void {
  if (typeof window === "undefined") return;
  const clean = sanitizeEvent(event);
  if (!clean) return;
  try {
    window.dispatchEvent(new CustomEvent(ANALYTICS_DOM_EVENT, { detail: clean }));
    const va = (window as unknown as { va?: VercelAnalyticsQueue }).va;
    if (typeof va === "function") {
      va("event", Object.keys(clean.data).length ? clean : { name: clean.name });
    }
  } catch {
    // Analytics must never break the product.
  }
}
