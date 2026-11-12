"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { track, type CtaPlacement } from "@/lib/analytics/track";

/**
 * A call-to-action link that records which CTA was used (an enum only).
 * `prefetch={false}`: the app bundle is not downloaded until a visitor
 * actually chooses to open it, keeping the landing page light.
 */
export function TrackedLink({
  href,
  target,
  placement,
  className,
  children,
  testId,
  onNavigate,
}: {
  href: "/app" | "/app/demo";
  target: "demo" | "app";
  placement: CtaPlacement;
  className?: string;
  children: ReactNode;
  testId?: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={className}
      data-testid={testId}
      onClick={() => {
        track({ name: "cta_click", target, placement });
        onNavigate?.();
      }}
    >
      {children}
    </Link>
  );
}
