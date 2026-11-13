import { Logo } from "@/components/ui/logo";
import { TrackedLink } from "@/components/landing/tracked-link";
import { DISCLAIMER } from "@/lib/site";

/**
 * Site footer shared by the landing page and the legal pages. `sectionBase`
 * is "" on the landing page (in-page anchors) and "/" elsewhere, so the
 * section links always lead to the landing page's sections.
 */
export function SiteFooter({ sectionBase = "" }: { sectionBase?: "" | "/" }) {
  const link = "text-ink-2 hover:text-ink underline-offset-2 hover:underline";
  return (
    <footer className="border-t border-line bg-surface px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xl">
          <Logo size={24} />
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2" data-testid="footer-disclaimer">{DISCLAIMER}</p>
        </div>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[14px]">
            <li><a href={`${sectionBase}#features`} className={link}>Features</a></li>
            <li><a href={`${sectionBase}#how-it-works`} className={link}>How it works</a></li>
            <li><a href={`${sectionBase}#privacy`} className={link}>Privacy and your data</a></li>
            <li><a href={`${sectionBase}#faq`} className={link}>FAQ</a></li>
            <li>
              <TrackedLink href="/app" target="app" placement="final" className={link}>
                Open app
              </TrackedLink>
            </li>
            <li><a href="/privacy" className={link} data-testid="footer-privacy">Privacy Policy</a></li>
            <li><a href="/terms" className={link} data-testid="footer-terms">Terms of Service</a></li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
