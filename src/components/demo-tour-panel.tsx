"use client";

// Advanced demo only: the "this is fictional" banner and a compact,
// dismissible "Explore features" panel whose links go to the REAL sections
// of the Results screen (no separate demo screens).

import { Icon } from "@/components/ui/icon";
import {
  ADVANCED_DEMO_BUSINESS,
  ADVANCED_DEMO_NOTICE,
  ADVANCED_DEMO_PERIOD,
  ADVANCED_DEMO_TOUR,
  type DemoTourStep,
} from "@/lib/demo/advanced-demo";

/** Scroll a Results-screen section into view and briefly outline it. */
function focusSection(testId: string) {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.setAttribute("data-demo-highlight", "");
  window.setTimeout(() => el.removeAttribute("data-demo-highlight"), 1800);
}

export function DemoBanner({
  tourHidden,
  onShowTour,
}: {
  tourHidden: boolean;
  onShowTour: () => void;
}) {
  return (
    <div
      data-testid="demo-banner"
      role="note"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "9px 14px",
        marginBottom: 16,
        fontSize: 13,
        color: "var(--accent-ink)",
        background: "var(--accent-soft)",
        border: "1px solid oklch(0.90 0.03 256)",
        borderRadius: "var(--r-md, 10px)",
      }}
    >
      <Icon name="sparkle" size={14} style={{ flexShrink: 0 }} />
      <span style={{ fontWeight: 600 }}>{ADVANCED_DEMO_NOTICE}</span>
      <span style={{ color: "var(--ink-2)" }}>
        {ADVANCED_DEMO_BUSINESS} · {ADVANCED_DEMO_PERIOD}
      </span>
      {tourHidden && (
        <button
          type="button"
          onClick={onShowTour}
          data-testid="demo-show-tour"
          style={{
            marginLeft: "auto",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--accent-ink)",
            fontFamily: "inherit",
          }}
        >
          Explore features
        </button>
      )}
    </div>
  );
}

export function DemoTourPanel({
  onDismiss,
  onOpenReview,
}: {
  onDismiss: () => void;
  onOpenReview: () => void;
}) {
  const go = (step: DemoTourStep) => {
    const t = step.target;
    if (t.kind === "review") return onOpenReview();
    if (t.kind === "export") {
      const btn = document.querySelector<HTMLElement>('[data-testid="export-menu-btn"]');
      btn?.scrollIntoView({ block: "nearest" });
      btn?.click();
      return;
    }
    if (t.kind === "tab") {
      document.querySelector<HTMLElement>(`[data-testid="${t.testId}"]`)?.click();
    }
    focusSection(t.testId);
  };

  return (
    <section
      className="card m-pad"
      data-testid="demo-tour"
      aria-label="Explore features"
      style={{ padding: "16px 18px", marginBottom: 18 }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Explore features</div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>
            Three months of a small studio&apos;s books, with a few problems planted for you to find.
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Hide feature tour"
          data-testid="demo-tour-dismiss"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", padding: 2 }}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      <ol
        className="m-grid-2"
        style={{
          listStyle: "none",
          margin: "12px 0 0",
          padding: 0,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
        }}
      >
        {ADVANCED_DEMO_TOUR.map((step, i) => (
          <li
            key={step.id}
            data-testid="demo-tour-step"
            data-step={step.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "10px 12px",
              border: "1px solid var(--line-2, var(--line))",
              borderRadius: "var(--r-sm, 8px)",
              background: "var(--surface-2, var(--surface))",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              <span style={{ color: "var(--accent-ink)" }}>{i + 1}.</span> {step.title}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.45, flex: 1 }}>{step.text}</div>
            <button
              type="button"
              onClick={() => go(step)}
              data-testid={`demo-tour-go-${step.id}`}
              style={{
                alignSelf: "flex-start",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--accent-ink)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontFamily: "inherit",
              }}
            >
              {step.action} <Icon name="chevR" size={11} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
