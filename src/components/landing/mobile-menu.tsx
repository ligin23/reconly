"use client";

import { useEffect, useId, useRef, useState } from "react";
import { TrackedLink } from "./tracked-link";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];

/**
 * Phone/tablet navigation: a disclosure button that opens a panel under the
 * header. Escape closes it and returns focus to the button; choosing a link
 * closes it too. Hidden from md width up, where the inline nav is shown.
 */
export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("a")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="md:hidden">
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line bg-surface text-ink"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        data-testid="landing-menu-btn"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        data-testid="landing-menu"
        className="absolute inset-x-0 top-full border-b border-line bg-surface px-4 pb-5 pt-2 shadow-md-soft"
      >
        <nav aria-label="Mobile">
          <ul className="flex flex-col">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={close} className="block rounded-md px-2 py-3 text-[16px] font-medium text-ink">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-3 flex flex-col gap-2">
          <TrackedLink href="/app/demo" target="demo" placement="mobile_nav" onNavigate={close} className="btn btn--primary btn--lg w-full">
            Try free demo
          </TrackedLink>
          <TrackedLink href="/app" target="app" placement="mobile_nav" onNavigate={close} className="btn btn--secondary btn--lg w-full">
            Open app
          </TrackedLink>
        </div>
      </div>
    </div>
  );
}
