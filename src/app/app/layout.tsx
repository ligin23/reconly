import type { Metadata } from "next";

// The reconciliation app. Everything here runs in the visitor's browser;
// the public landing page at "/" is the page meant for search engines.
export const metadata: Metadata = {
  title: "Reconly app — match your books to your bank",
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
