/**
 * Public base URL, used for canonical/Open Graph URLs, robots and the
 * sitemap. Vercel provides the production domain at build time; the
 * fallback is the current production URL.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "https://reconly-eta.vercel.app");

export const SITE_TITLE = "Reconly — Bank reconciliation, without the accounting headache";
export const SITE_DESCRIPTION =
  "Upload your bank transactions and financial records. Reconly helps you match transactions, identify differences, and understand what needs attention. Try the free demo with fictional data — no account needed.";
