import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Baseline CSP for a financial app holding reconciliation data client-side.
// 'unsafe-inline' is required: the UI uses inline style attributes throughout
// and Next.js inlines its bootstrap scripts (a nonce-based CSP would need
// middleware — worthwhile follow-up). Dev additionally needs 'unsafe-eval'
// and websockets for HMR. The load-bearing directives are frame-ancestors
// (clickjacking) and connect-src (no exfiltration targets).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Prevents Turbopack from opening its SQLite-backed filesystem cache,
  // which fails with EPERM on FUSE-mounted volumes (the Cowork sandbox).
  // (Formerly experimental.turbo.persistentCaching, renamed in Next 16.)
  experimental: {
    turbopackFileSystemCacheForDev: false,
    turbopackFileSystemCacheForBuild: false,
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
