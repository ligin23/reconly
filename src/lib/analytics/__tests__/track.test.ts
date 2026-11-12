/**
 * Analytics privacy guard: only fixed event names with fixed enum values can
 * ever leave the browser. Anything else — amounts, descriptions, file names,
 * ids, extra fields — is dropped.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { sanitizeEvent, track, ANALYTICS_DOM_EVENT, type AnalyticsEvent } from "@/lib/analytics/track";

describe("sanitizeEvent", () => {
  it("passes the allow-listed events through unchanged", () => {
    expect(sanitizeEvent({ name: "landing_view" })).toEqual({ name: "landing_view", data: {} });
    expect(sanitizeEvent({ name: "cta_click", target: "demo", placement: "hero" })).toEqual({
      name: "cta_click",
      data: { target: "demo", placement: "hero" },
    });
    expect(sanitizeEvent({ name: "demo_start", variant: "advanced" })).toEqual({ name: "demo_start", data: { variant: "advanced" } });
    expect(sanitizeEvent({ name: "results_view", source: "own_files" })).toEqual({ name: "results_view", data: { source: "own_files" } });
  });

  it("drops extra fields — no financial or personal data can ride along", () => {
    const leaky = {
      name: "results_view",
      source: "own_files",
      amount: -130954,
      description: "ACME PAYROLL 12345678",
      fileName: "bank-march.csv",
      accountNumber: "12345678",
    } as unknown as AnalyticsEvent;
    expect(sanitizeEvent(leaky)).toEqual({ name: "results_view", data: { source: "own_files" } });
  });

  it("refuses an unknown event or a value outside its enum", () => {
    expect(sanitizeEvent({ name: "upload" } as unknown as AnalyticsEvent)).toBeNull();
    expect(sanitizeEvent({ name: "cta_click", target: "bank-march.csv", placement: "hero" } as unknown as AnalyticsEvent)).toBeNull();
    expect(sanitizeEvent({ name: "demo_start", variant: 42 } as unknown as AnalyticsEvent)).toBeNull();
    expect(sanitizeEvent({ name: "results_view" } as unknown as AnalyticsEvent)).toBeNull();
  });
});

describe("track", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a no-op on the server", () => {
    expect(() => track({ name: "landing_view" })).not.toThrow();
  });

  it("emits the sanitized event locally and forwards it to Vercel Analytics only when present", () => {
    const events: unknown[] = [];
    const target = new EventTarget();
    target.addEventListener(ANALYTICS_DOM_EVENT, (e) => events.push((e as CustomEvent).detail));
    const va = vi.fn();
    vi.stubGlobal("window", Object.assign(target, { va }));
    vi.stubGlobal("CustomEvent", class extends Event {
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        super(type);
        this.detail = init?.detail;
      }
    });

    track({ name: "cta_click", target: "app", placement: "nav" });
    track({ name: "landing_view" });
    track({ name: "cta_click", target: "elsewhere", placement: "nav" } as unknown as AnalyticsEvent);

    expect(events).toEqual([
      { name: "cta_click", data: { target: "app", placement: "nav" } },
      { name: "landing_view", data: {} },
    ]);
    expect(va).toHaveBeenCalledTimes(2);
    expect(va).toHaveBeenNthCalledWith(1, "event", { name: "cta_click", data: { target: "app", placement: "nav" } });
    expect(va).toHaveBeenNthCalledWith(2, "event", { name: "landing_view" });
  });

  it("never throws, even if the analytics script misbehaves", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", Object.assign(target, { va: () => { throw new Error("boom"); } }));
    vi.stubGlobal("CustomEvent", class extends Event {});
    expect(() => track({ name: "landing_view" })).not.toThrow();
  });
});
