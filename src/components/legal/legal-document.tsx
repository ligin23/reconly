import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";
import { SiteFooter } from "@/components/landing/site-footer";

// ============================================================
// Draft legal documents (/privacy, /terms).
//
// PUBLICATION SAFETY: these pages are DRAFTS awaiting legal review.
// They carry a visible draft banner, visible owner placeholders and
// attorney-review flags, are excluded from search indexing and are
// not in the sitemap. Do not remove any of that until the owner has
// supplied the missing information and counsel has approved the text.
// ============================================================

/** Shared metadata: drafts are never indexed or followed. */
export function draftMetadata(title: string, description: string, path: string): Metadata {
  return {
    title: { absolute: `${title} (draft) — Reconly` },
    description,
    alternates: { canonical: path },
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  };
}

/** Information only the owner can supply. Rendered conspicuously on purpose. */
export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <mark
      data-testid="placeholder"
      className="rounded-[4px] bg-[oklch(0.93_0.09_90)] px-1 py-[1px] font-semibold text-[oklch(0.35_0.08_70)]"
    >
      [OWNER: {children}]
    </mark>
  );
}

/** Marks a clause that must be reviewed by an attorney before publication. */
export function ReviewFlag({ children = "Requires attorney review" }: { children?: ReactNode }) {
  return (
    <p
      data-testid="review-flag"
      className="mt-3 inline-flex items-center gap-2 rounded-md border border-[oklch(0.85_0.06_25)] bg-[oklch(0.97_0.02_25)] px-2.5 py-1 text-[12.5px] font-semibold text-[oklch(0.45_0.12_25)]"
    >
      <span aria-hidden="true">⚖</span>
      {children}
    </p>
  );
}

export type LegalSection = { id: string; title: string; body: ReactNode };

export function LegalDocument({
  title,
  intro,
  sections,
  other,
}: {
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
  other: { href: "/privacy" | "/terms"; label: string };
}) {
  return (
    <div className="landing min-h-full bg-bg text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-md-soft">
        Skip to content
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="/" aria-label="Reconly home" className="rounded-md">
            <Logo size={28} />
          </a>
          <nav aria-label="Legal">
            <ul className="flex items-center gap-1 text-[14px] sm:text-[15px]">
              <li>
                <a href="/" className="rounded-md px-2 py-2 font-medium text-ink-2 hover:text-ink sm:px-3" data-testid="legal-home">
                  <span aria-hidden="true">← </span>Home
                </a>
              </li>
              <li>
                <a href={other.href} className="rounded-md px-2 py-2 font-medium text-ink-2 hover:text-ink sm:px-3" data-testid="legal-other">
                  {other.label}
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </header>

      <main id="main" className="px-4 py-10 sm:px-6 md:py-14">
        <article className="mx-auto max-w-3xl">
          <div
            role="note"
            aria-label="Draft notice"
            data-testid="draft-banner"
            className="rounded-xl border-2 border-dashed border-[oklch(0.75_0.12_70)] bg-[oklch(0.97_0.04_90)] p-5 text-[14.5px] leading-relaxed text-[oklch(0.32_0.06_70)]"
          >
            <p className="font-semibold uppercase tracking-[0.06em] text-[13px]">Draft — not in effect</p>
            <p className="mt-1">
              This document is a working draft prepared for review by a qualified attorney. It is not a final policy and has no
              effective date yet. Highlighted <strong>[OWNER: …]</strong> items still have to be supplied, and clauses marked
              “Requires attorney review” have not been reviewed.
            </p>
          </div>

          <h1 className="serif mt-8 text-[34px] font-semibold leading-[1.1] tracking-[-0.02em] text-navy md:text-[44px]">{title}</h1>
          <p className="mt-3 text-[14px] text-ink-2" data-testid="effective-date">
            Effective date: <Placeholder>effective date — set only when the reviewed version is published</Placeholder>
          </p>
          <div className="mt-6 space-y-4 text-[16px] leading-relaxed text-ink-2">{intro}</div>

          <nav aria-labelledby="toc-title" className="mt-8 rounded-xl border border-line bg-surface p-5">
            <h2 id="toc-title" className="text-[15px] font-semibold text-ink">Contents</h2>
            <ol className="mt-3 grid list-decimal gap-x-8 gap-y-1.5 pl-5 text-[14.5px] sm:grid-cols-2">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-accent-ink underline-offset-2 hover:underline">{s.title}</a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="legal-body mt-10 space-y-10">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-6" data-testid="legal-section">
                <h2 id={`${s.id}-title`} className="serif text-[24px] leading-tight tracking-[-0.01em] text-navy md:text-[27px]">
                  {i + 1}. {s.title}
                </h2>
                <div className="mt-4 space-y-4 text-[16px] leading-relaxed text-ink-2">{s.body}</div>
              </section>
            ))}
          </div>

          <p className="mt-12 border-t border-line pt-6 text-[14px] text-ink-2">
            See also: <a href={other.href} className="font-medium text-accent-ink underline underline-offset-2">{other.label}</a>
            {" · "}
            <a href="/" className="font-medium text-accent-ink underline underline-offset-2">Back to the Reconly home page</a>
          </p>
        </article>
      </main>
      <SiteFooter sectionBase="/" />
    </div>
  );
}

/** A bulleted list styled for the legal body. */
export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-6">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** A sub-heading inside a section (h3 — keeps the heading order). */
export function Sub({ children }: { children: ReactNode }) {
  return <h3 className="pt-2 text-[17px] font-semibold text-ink">{children}</h3>;
}
