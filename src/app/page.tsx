import type { Metadata } from "next";
import Image, { getImageProps, type StaticImageData } from "next/image";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";
import { Icon, type IconName } from "@/components/ui/icon";
import { MobileMenu } from "@/components/landing/mobile-menu";
import { TrackedLink } from "@/components/landing/tracked-link";
import { TrackLandingView } from "@/components/landing/track-view";
import { SITE_DESCRIPTION, SITE_TITLE } from "@/lib/site";
// Real screenshots of Reconly, captured from the fictional Advanced Demo.
import resultsShot from "../../public/landing/results-overview.png";
import statusShot from "../../public/landing/results-status.png";
import groupShot from "../../public/landing/review-group-match.png";
import monthsShot from "../../public/landing/financial-review.png";
import duplicatesShot from "../../public/landing/duplicate-review.png";
import pdfShot from "../../public/landing/pdf-report-page.png";

export const metadata: Metadata = {
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Reconly",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
};

/** Shown only when a feedback destination has been configured (see report). */
const FEEDBACK_URL = (() => {
  const raw = process.env.NEXT_PUBLIC_FEEDBACK_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
})();

const DISCLAIMER =
  "Reconly helps you check whether your records match your bank. It is not accounting or tax advice. For decisions about how to record transactions or file taxes, consult a qualified accountant.";

// ---- small building blocks --------------------------------------------

function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  className = "",
}: {
  id: string;
  eyebrow?: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-20 px-4 py-16 sm:px-6 md:py-24 ${className}`}>
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          {eyebrow && <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent-ink">{eyebrow}</p>}
          <h2 id={`${id}-title`} className="serif mt-2 text-[30px] leading-[1.15] tracking-[-0.02em] text-navy md:text-[38px]">
            {title}
          </h2>
          {intro && <p className="mt-4 text-[17px] leading-relaxed text-ink-2">{intro}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

function Shot({
  src,
  alt,
  caption,
  sizes,
  preload = false,
  testId,
}: {
  src: StaticImageData;
  alt: string;
  caption?: string;
  sizes: string;
  preload?: boolean;
  testId?: string;
}) {
  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-lg-soft">
        <Image
          src={src}
          alt={alt}
          sizes={sizes}
          placeholder="blur"
          preload={preload}
          fetchPriority={preload ? "high" : undefined}
          data-testid={testId}
          className="block h-auto w-full"
        />
      </div>
      {caption && <figcaption className="mt-3 text-[13.5px] leading-snug text-ink-2">{caption}</figcaption>}
    </figure>
  );
}

/**
 * Hero visual with art direction: the full app window from tablet width up,
 * and on phones a tighter (equally real) crop of the same Results screen so
 * the text stays legible. Only the image for the current width downloads.
 */
function HeroShot() {
  const alt =
    "Reconly's Results screen for the fictional Advanced Demo: a $1,309.54 net difference explained as bank-only and records-only totals, with status cards for transaction matching, duplicate review and statement verification.";
  const {
    props: { srcSet: desktop },
  } = getImageProps({ src: resultsShot, alt, sizes: "(max-width: 1100px) 100vw, 1024px" });
  const {
    props: { srcSet: mobile, ...rest },
  } = getImageProps({ src: statusShot, alt, sizes: "100vw", fetchPriority: "high", loading: "eager" });
  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-lg-soft">
        <picture>
          <source media="(min-width: 768px)" srcSet={desktop} />
          <source srcSet={mobile} />
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          {/* The box keeps each image's own aspect ratio so nothing shifts while it loads. */}
          <img {...rest} data-testid="hero-shot" className="block aspect-[1848/846] h-auto w-full md:aspect-[2880/1720]" />
        </picture>
      </div>
      <figcaption className="mt-3 text-[13.5px] leading-snug text-ink-2">
        The real Results screen, showing the Advanced Demo&apos;s fictional three-month data.
      </figcaption>
    </figure>
  );
}

function IconBadge({ name }: { name: IconName }) {
  return (
    <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-accent-soft text-accent-ink">
      <Icon name={name} size={20} />
    </span>
  );
}

// ---- content ----------------------------------------------------------

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "upload", title: "Upload your files", text: "Add CSV exports of your bank transactions and of your own records — a spreadsheet, a ledger or accounting-software export. Several files per side are fine, such as one bank export per month." },
  { icon: "link", title: "Review suggested matches", text: "Reconly lines up transactions that clearly match and suggests the ones it is less sure about. You answer each suggestion with a simple yes or no, and can undo a decision." },
  { icon: "search", title: "Investigate differences", text: "See what is only on your bank statement, what is only in your records, rows that may have been imported twice, and statement balances that don't add up — each with the file and row it came from." },
  { icon: "download", title: "Export your results", text: "Download a PDF or Excel report of the reconciliation, with transaction details and source references, to keep or share with whoever helps with your books." },
];

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "check", title: "Automatic transaction matching", text: "Fixed, deterministic rules compare dates, amounts and descriptions. Exact matches are lined up for you; anything less certain is shown as a suggestion for you to confirm." },
  { icon: "scale", title: "Composite matching", text: "One bank deposit can be several entries in your records — a card payout covering three invoices, for example. Reconly shows the group and its total for you to review." },
  { icon: "history", title: "Cross-month reconciliation", text: "A payment recorded on Jan 30 that clears on Feb 2 still matches. Transactions are matched across the whole period first, then grouped by month." },
  { icon: "file", title: "Duplicate detection", text: "Overlapping exports often repeat rows. Reconly flags them, sets a copy aside only when the files prove it is a repeat, explains why, and lets you restore any row." },
  { icon: "bank", title: "Statement verification", text: "Where a bank file states opening and closing balances or a running balance, Reconly checks them against the transactions in that file and tells you what it could and couldn't verify." },
  { icon: "book", title: "Multi-month financial review", text: "A month-by-month summary of rows, unmatched items, questions to review and statement findings across everything you upload." },
  { icon: "download", title: "PDF and Excel reports", text: "Export your findings with transaction details and the source file and row of each line. Excel amounts are real numbers you can sum." },
];

const AUDIENCES: { icon: IconName; title: string; text: string }[] = [
  { icon: "file", title: "Freelancers", text: "You track income and expenses in a spreadsheet and want to know whether it agrees with what actually went through your bank account." },
  { icon: "bank", title: "Small-business owners", text: "You need to compare bank activity against your own records — invoices, payouts, card fees — and find what is missing on either side." },
  { icon: "book", title: "Bookkeepers", text: "You work with bank and ledger exports from different systems and want a clear, documented list of what matches and what needs a follow-up." },
];

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "What is Reconly?",
    a: "Reconly is a web app for bank reconciliation: it compares the transactions in your bank exports with the entries in your own records, lines up the ones that match, and shows you what doesn't — so you know what needs attention.",
  },
  {
    q: "What files can I upload?",
    a: "CSV files — one or more for your bank transactions and one or more for your records. Columns can be separated by commas, semicolons, tabs or the | character, and each file can be up to 20 MB. Reconly shows you how it read the columns before it reconciles. Excel files (.xlsx) can't be uploaded directly yet; save them as CSV first.",
  },
  {
    q: "Do I need accounting experience?",
    a: "No. Reconly explains each result in plain English — for example “On your bank, not in your records” — and asks simple yes-or-no questions about the matches it isn't sure of.",
  },
  {
    q: "Can I try Reconly without creating an account?",
    a: "Yes. There are no accounts. The free demo uses fictional sample data, and you can also open the app and use your own files right away.",
  },
  {
    q: "Where is my data stored?",
    a: (
      <>
        Your files are read and reconciled in your browser; they are not uploaded to Reconly. If you choose to save a reconciliation, it is
        stored in this browser on this device. The optional AI assistant is the exception: when you ask it a question, details of the
        current reconciliation are sent to an AI service. See <a href="#privacy" className="font-medium text-accent-ink underline underline-offset-2">Privacy and your data</a> for the details.
      </>
    ),
  },
  {
    q: "Can I export reconciliation results?",
    a: "Yes. You can download a PDF report and an Excel workbook. Both list matched and unmatched transactions with the file and row each one came from, and both are created in your browser.",
  },
  {
    q: "Does Reconly automatically fix discrepancies?",
    a: "No. Reconly finds and explains differences — missing entries, possible duplicates, statement balances that don't agree — but it doesn't change your records. You decide what each item means and what to do about it.",
  },
  {
    q: "Does Reconly replace an accountant?",
    a: `No. ${DISCLAIMER}`,
  },
];

// ---- page ---------------------------------------------------------------

export default function LandingPage() {
  return (
    <div className="landing min-h-full bg-surface text-ink">
      <TrackLandingView />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-md-soft">
        Skip to content
      </a>

      {/* ---- Navigation ---- */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="#top" aria-label="Reconly — back to top" className="rounded-md">
            <Logo size={28} />
          </a>
          <nav aria-label="Main" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {[
                ["#features", "Features"],
                ["#how-it-works", "How it works"],
                ["#faq", "FAQ"],
              ].map(([href, label]) => (
                <li key={href}>
                  <a href={href} className="rounded-md px-3 py-2 text-[15px] font-medium text-ink-2 hover:text-ink">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <TrackedLink href="/app" target="app" placement="nav" className="btn btn--secondary" testId="nav-open-app">
              Open app
            </TrackedLink>
            <TrackedLink href="/app/demo" target="demo" placement="nav" className="btn btn--primary" testId="nav-try-demo">
              Try free demo
            </TrackedLink>
          </div>
          <MobileMenu />
        </div>
      </header>

      <main id="main">
        {/* ---- Hero ---- */}
        <section id="top" aria-labelledby="hero-title" className="overflow-hidden border-b border-line bg-[linear-gradient(180deg,var(--surface)_0%,var(--bg)_100%)] px-4 pb-16 pt-12 sm:px-6 md:pb-24 md:pt-20">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-4xl text-center">
              <p className="inline-flex items-center gap-2 rounded-pill border border-line bg-surface px-3 py-1 text-[13px] font-medium text-ink-2">
                <span className="h-1.5 w-1.5 rounded-full bg-good" aria-hidden="true" />
                Free demo with fictional data · No account needed
              </p>
              <h1 id="hero-title" className="serif mt-6 text-[38px] font-semibold leading-[1.08] tracking-[-0.03em] text-navy sm:text-[46px] md:text-[56px]">
                Bank reconciliation, without the accounting headache.
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-ink-2 md:text-[19px]">
                Upload your bank transactions and financial records. Reconly helps you match transactions, identify differences, and understand what needs attention.
              </p>
              <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                <TrackedLink href="/app/demo" target="demo" placement="hero" className="btn btn--primary btn--lg" testId="hero-try-demo">
                  Try free demo
                  <Icon name="arrowRight" size={17} />
                </TrackedLink>
                <a href="#how-it-works" className="btn btn--secondary btn--lg" data-testid="hero-how-it-works">
                  See how it works
                </a>
              </div>
            </div>
            <div className="mx-auto mt-12 max-w-5xl md:mt-16">
              <HeroShot />
            </div>
          </div>
        </section>

        {/* ---- How it works ---- */}
        <Section
          id="how-it-works"
          eyebrow="How it works"
          title="From two exports to a clear answer in four steps"
          intro="You don't need to know accounting terms. Reconly does the comparing; you stay in charge of every decision."
        >
          <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-xl border border-line bg-surface p-6 shadow-card">
                <div className="flex items-center justify-between">
                  <IconBadge name={s.icon} />
                  <span className="serif text-[34px] leading-none text-line" aria-hidden="true">
                    {i + 1}
                  </span>
                </div>
                <h3 className="mt-5 text-[17px] font-semibold text-ink">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{s.text}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* ---- Features ---- */}
        <Section
          id="features"
          eyebrow="Features"
          title="Built for the messy exports real businesses have"
          intro="Everything below is in the app today — open the demo to try each one with fictional data."
          className="bg-bg"
        >
          <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="rounded-xl border border-line bg-surface p-6 shadow-card">
                <IconBadge name={f.icon} />
                <h3 className="mt-4 text-[17px] font-semibold text-ink">{f.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{f.text}</p>
              </li>
            ))}
            <li className="flex flex-col justify-center rounded-xl border border-dashed border-line bg-transparent p-6 sm:col-span-2 lg:col-span-2">
              <p className="text-[15px] leading-relaxed text-ink-2">
                Reconly points out what doesn't agree and explains why. It doesn't guarantee that a period is complete — it tells you exactly what it could and couldn't check.
              </p>
            </li>
          </ul>
        </Section>

        {/* ---- Product preview ---- */}
        <Section
          id="product"
          eyebrow="Product preview"
          title="See the real interface"
          intro="These are screenshots of the app running the Advanced Demo — a fictional design studio with three months of bank and ledger exports."
        >
          <div className="mt-12 grid items-start gap-10 lg:grid-cols-2">
            <Shot
              src={groupShot}
              sizes="(max-width: 1024px) 100vw, 560px"
              testId="preview-shot"
              alt="A group-match review card: a $4,750.00 Stripe payout on the bank side and three invoices from the records that add up to exactly $4,750.00, with the reasons for the grouping and Yes, they match / Not a match buttons."
              caption="Review a suggested group match: one payout, three invoices, and why they were grouped."
            />
            <div className="grid gap-10">
              <Shot
                src={monthsShot}
                sizes="(max-width: 1024px) 100vw, 560px"
                testId="preview-shot"
                alt="The Financial Review panel for January to March 2026: months analyzed, unmatched transactions, statement balance results per month, and cross-month matches."
                caption="A month-by-month Financial Review, including statement balance checks."
              />
              <Shot
                src={duplicatesShot}
                sizes="(max-width: 1024px) 100vw, 560px"
                testId="preview-shot"
                alt="The duplicate review panel: files covering the same dates, and a possible duplicate with why it was flagged, the automatic step, your decision and its current status."
                caption="Possible duplicates, with what was detected and what you decided."
              />
            </div>
          </div>
          <div className="mt-14 grid items-center gap-10 rounded-2xl border border-line bg-bg p-6 sm:p-10 lg:grid-cols-[1fr_320px]">
            <div>
              <h3 className="serif text-[26px] leading-tight tracking-[-0.01em] text-navy">Reports you can keep</h3>
              <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-ink-2">
                Export a PDF summary and an Excel workbook of the reconciliation. Each line shows the file and row it came from, so anyone reading the report can trace it back. Both files are created in your browser.
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <TrackedLink href="/app/demo" target="demo" placement="product" className="btn btn--primary btn--lg" testId="product-try-demo">
                  Explore the Advanced Demo
                  <Icon name="arrowRight" size={17} />
                </TrackedLink>
              </div>
            </div>
            <div className="mx-auto w-full max-w-[320px]">
              <Shot
                src={pdfShot}
                sizes="320px"
                testId="preview-shot"
                alt="First page of the PDF report for the Advanced Demo: the account name, the $1,309.54 difference, and an executive summary table."
                caption="Page 1 of the Advanced Demo's PDF report."
              />
            </div>
          </div>
        </Section>

        {/* ---- Audiences ---- */}
        <Section id="who-its-for" eyebrow="Who it's for" title="For anyone who has to make two sets of numbers agree" className="bg-bg">
          <ul className="mt-12 grid gap-5 md:grid-cols-3">
            {AUDIENCES.map((a) => (
              <li key={a.title} className="rounded-xl border border-line bg-surface p-6 shadow-card">
                <IconBadge name={a.icon} />
                <h3 className="mt-4 text-[17px] font-semibold text-ink">{a.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{a.text}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* ---- Privacy ---- */}
        <Section
          id="privacy"
          eyebrow="Privacy and your data"
          title="What happens to your financial data"
          intro="Financial records are sensitive, so here is exactly how Reconly handles them today."
        >
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {[
              {
                title: "Your files are processed in your browser",
                text: "The CSV files you choose are read, matched and summarised by code running in your browser. They are not uploaded to Reconly's server.",
              },
              {
                title: "Saved reconciliations stay in this browser",
                text: "If you save a reconciliation, it is stored in your browser's own storage (IndexedDB) on this device. Reconly doesn't keep a copy, so it isn't available on other devices or browsers, and clearing your browser's site data deletes it. Anyone who can use this browser profile can open it.",
              },
              {
                title: "Reports are created on your device",
                text: "PDF and Excel exports are generated in your browser and downloaded directly; they are not sent anywhere.",
              },
              {
                title: "The AI assistant is optional — and does send data",
                text: "If you ask the assistant a question, your question and details of the current reconciliation — transaction dates, descriptions and amounts — are sent through Reconly's server to Anthropic's AI service to write the answer. Long digit sequences that could be account or card numbers are shortened to their last four digits first. Reconly's server doesn't store your question or the transaction details. To limit abuse, your IP address is kept in a usage counter for up to an hour. Don't use the assistant if you'd rather your data stayed on your device.",
              },
            ].map((c) => (
              <div key={c.title} className="rounded-xl border border-line bg-surface p-6 shadow-card">
                <h3 className="text-[17px] font-semibold text-ink">{c.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{c.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-3xl text-[14px] leading-relaxed text-ink-2">
            Like any website, Reconly is served by a hosting provider (Vercel), which receives standard request information such as your IP address when you load a page. There are no user accounts, and this page doesn't use advertising or tracking cookies.
          </p>
        </Section>

        {/* ---- FAQ ---- */}
        <Section id="faq" eyebrow="FAQ" title="Frequently asked questions" className="bg-bg">
          <div className="mt-10 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" data-testid="faq">
            {FAQS.map((f) => (
              <details key={f.q} className="group" data-testid="faq-item">
                <summary className="flex items-center justify-between gap-4 px-5 py-5 text-[16px] font-semibold text-ink sm:px-6">
                  <span>{f.q}</span>
                  <span className="faq-chevron flex-none text-ink-2">
                    <Icon name="chevR" size={18} />
                  </span>
                </summary>
                <div className="px-5 pb-6 text-[15px] leading-relaxed text-ink-2 sm:px-6">{f.a}</div>
              </details>
            ))}
          </div>
        </Section>

        {/* ---- Feedback (only when a destination is configured) ---- */}
        {FEEDBACK_URL && (
          <Section id="feedback" eyebrow="Feedback" title="Tell us what you think" intro="Reconly is early. If you tried the demo, a few words about what worked and what didn't helps us decide what to build next.">
            <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer" className="btn btn--secondary btn--lg mt-8" data-testid="feedback-link">
              Share feedback (opens a form)
            </a>
          </Section>
        )}

        {/* ---- Final CTA ---- */}
        <section aria-labelledby="final-cta-title" className="on-dark bg-navy px-4 py-16 sm:px-6 md:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="final-cta-title" className="serif text-[30px] leading-[1.15] tracking-[-0.02em] text-white md:text-[40px]">
              Ready to make reconciliation easier?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[17px] leading-relaxed text-[oklch(0.86_0.03_262)]">
              Explore Reconly using fictional sample data and see how transaction matching and financial review work.
            </p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <TrackedLink href="/app/demo" target="demo" placement="final" className="btn btn--lg btn--on-dark-primary" testId="final-try-demo">
                Explore the free demo
              </TrackedLink>
              <TrackedLink href="/app" target="app" placement="final" className="btn btn--lg btn--on-dark-secondary" testId="final-open-app">
                Open Reconly
              </TrackedLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xl">
            <Logo size={24} />
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">{DISCLAIMER}</p>
          </div>
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[14px]">
              <li><a href="#features" className="text-ink-2 hover:text-ink">Features</a></li>
              <li><a href="#how-it-works" className="text-ink-2 hover:text-ink">How it works</a></li>
              <li><a href="#privacy" className="text-ink-2 hover:text-ink">Privacy and your data</a></li>
              <li><a href="#faq" className="text-ink-2 hover:text-ink">FAQ</a></li>
              <li>
                <TrackedLink href="/app" target="app" placement="final" className="text-ink-2 hover:text-ink">
                  Open app
                </TrackedLink>
              </li>
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
