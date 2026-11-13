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

/** The financial disclaimer shown on the landing page, its FAQ and every footer. */
export const DISCLAIMER =
  "Reconly helps you check whether your records match your bank. It is not accounting or tax advice. For decisions about how to record transactions or file taxes, consult a qualified accountant.";
