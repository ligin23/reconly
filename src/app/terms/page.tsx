import { Bullets, LegalDocument, Placeholder, ReviewFlag, draftMetadata, type LegalSection } from "@/components/legal/legal-document";

// DRAFT terms of service. Original wording written for Reconly — not
// adapted from another company's terms. Clauses marked with ReviewFlag
// must be reviewed by an attorney before publication.

export const metadata = draftMetadata(
  "Terms of Service",
  "Draft Terms of Service for Reconly, pending legal review.",
  "/terms"
);

const a = "font-medium text-accent-ink underline underline-offset-2";

const sections: LegalSection[] = [
  {
    id: "acceptance",
    title: "Acceptance of these terms",
    body: (
      <>
        <p>
          These Terms of Service (“Terms”) are an agreement between you and <Placeholder>legal name of the operator</Placeholder>{" "}
          (“Reconly”, “we”, “us”) for your use of the Reconly website and web application (the “Service”). By using the Service you
          agree to these Terms. If you use the Service on behalf of a business, you confirm you are authorised to accept these Terms for
          it. If you do not agree, do not use the Service.
        </p>
        <ReviewFlag>Requires attorney review — method of acceptance (browse-wrap) and its enforceability</ReviewFlag>
      </>
    ),
  },
  {
    id: "description",
    title: "Description of Reconly",
    body: (
      <>
        <p>
          Reconly is a reconciliation tool that helps you compare bank and ledger transactions. You provide CSV exports of bank transactions
          and of your own records; Reconly reads them in your browser, identifies transactions that appear to match, suggests possible
          matches it is less certain about, flags possible duplicates, checks statement balances where the files contain them, and lists
          possible discrepancies that remain unmatched. You can save reconciliations in your browser and export the results as PDF and
          Excel files.
        </p>
        <p>
          Reconly is not an accounting system, bookkeeping service or bank connection: it does not keep your books, change your records or
          connect to your bank. It does not currently provide an active AI assistant. The Service is currently offered free of charge,
          without user accounts, and may change over time (see “Changes to the Service and these Terms”).
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Eligibility",
    body: (
      <p>
        You must be at least <Placeholder>minimum age, e.g. 18</Placeholder> and able to form a binding contract to use the Service. The
        Service is intended for managing business or personal finances, not for use by children.
      </p>
    ),
  },
  {
    id: "permitted-use",
    title: "Permitted use",
    body: (
      <>
        <p>You may use the Service for lawful purposes in reconciling financial records you are entitled to use. You agree not to:</p>
        <Bullets
          items={[
            "use the Service in violation of any law, or to process data you have no right to process;",
            "attempt to disrupt, overload, probe or bypass the security or usage limits of the Service;",
            "copy, resell or offer the Service as part of another product except as allowed by law; or",
            "use automated means to access the Service in a way that places an unreasonable load on it.",
          ]}
        />
      </>
    ),
  },
  {
    id: "user-responsibilities",
    title: "Your responsibilities",
    body: (
      <Bullets
        items={[
          "Choose the right files and check that Reconly has read the columns correctly before relying on the results.",
          "Review suggested matches, duplicate flags and unmatched items, and make your own decisions about them.",
          "Keep your device, browser profile and downloaded reports secure, and keep your own copies of important records.",
          "Make sure you are permitted to process any personal information about other people that your files contain.",
        ]}
      />
    ),
  },
  {
    id: "financial-information",
    title: "Your financial information",
    body: (
      <>
        <p>
          You keep all rights in the files and information you use with the Service. The files you choose are processed in your browser and
          are not uploaded to Reconly. You are responsible for the accuracy and completeness of the files you provide. How information is
          handled is described in the <a href="/privacy" className={a}>Privacy Policy (draft)</a>.
        </p>
        <p>
          Because processing happens in your browser, Reconly does not receive your financial information in order to provide the
          reconciliation features.
        </p>
      </>
    ),
  },
  {
    id: "accuracy",
    title: "Accuracy and reconciliation limitations",
    body: (
      <>
        <p>Reconly is a tool to help you compare records. Please understand that:</p>
        <Bullets
          items={[
            "Results depend on the files you provide. Missing, incomplete, duplicated or incorrectly formatted data will affect them.",
            "Possible matches and discrepancies are findings for you to review. Suggested matches require your judgment, and accepting or rejecting them is your decision.",
            "Statement verification depends on the evidence in your files. When a file does not state opening and closing balances, Reconly cannot verify them, and says so.",
            "Unmatched transactions may have many causes — timing, errors, missing records or fraud — and may require your own investigation.",
            "A zero difference does not by itself prove that your records are complete or correct.",
            "Reconly does not guarantee a complete or error-free reconciliation, or that every discrepancy will be identified, explained or resolved, and it does not change your accounting records.",
          ]}
        />
        <p>You remain responsible for verifying your financial records and for any decisions you make based on the Service.</p>
      </>
    ),
  },
  {
    id: "no-advice",
    title: "No professional advice",
    body: (
      <p>
        The Service, including its results and reports, is provided for information only. It is not accounting, tax, audit, legal,
        investment or other financial advice, does not replace an accountant or other financial professional, and using it does not create
        a professional relationship with Reconly. For decisions about how to record transactions, file taxes or manage your finances,
        consult a qualified professional.
      </p>
    ),
  },
  {
    id: "ai",
    title: "AI features",
    body: (
      <>
        <p>
          Reconly does not currently provide an active AI assistant or other AI-generated content; its matching follows fixed rules. If AI
          features are offered in the future, they will be described in updated Terms and Privacy Policy before they are made available,
          including that AI-generated information is informational and may be inaccurate.
        </p>
        <ReviewFlag>Requires attorney review — AI-specific terms needed before any reactivation</ReviewFlag>
      </>
    ),
  },
  {
    id: "ip",
    title: "Intellectual property",
    body: (
      <p>
        The Service, including its software, design, text and graphics (other than your own information), is owned by or licensed to
        Reconly and protected by intellectual-property laws. We grant you a limited, non-exclusive, non-transferable, revocable permission
        to use the Service in line with these Terms. Reports you generate from your own data are yours to use. Sample data in the demo is
        fictional.
      </p>
    ),
  },
  {
    id: "third-parties",
    title: "Third-party services",
    body: (
      <p>
        The Service relies on third-party providers, including its hosting provider (Vercel). Their services are subject to their own
        terms, and we are not responsible for their acts or omissions to the extent permitted by law. <Placeholder>list any other providers</Placeholder>
      </p>
    ),
  },
  {
    id: "availability",
    title: "Service availability",
    body: (
      <p>
        We aim to keep the Service available but do not promise that it will be uninterrupted, error-free or available at any particular
        time. We may suspend all or part of the Service for maintenance, security, cost or other reasons.
      </p>
    ),
  },
  {
    id: "local-storage",
    title: "Local browser storage and risk of data loss",
    body: (
      <p>
        Saved reconciliations are stored only in your browser on your device. They are not synchronised to other devices, and Reconly does
        not keep a copy and cannot recover them. They can be lost if you clear your browser data, use a private window, change browser or
        device, or if your browser removes stored website data. Anyone with access to your browser profile may be able to view them.
        Export reports and keep your own copies of anything you need.
      </p>
    ),
  },
  {
    id: "deletion",
    title: "Deleting saved data",
    body: (
      <p>
        You can delete an individual saved reconciliation from <em>Past reconciliations</em> in the app after confirming, or remove all
        Reconly data in a browser by clearing its site data. Deletion cannot be undone. Reconly cannot delete copies outside its browser
        storage, such as device backups or files you downloaded.
      </p>
    ),
  },
  {
    id: "exports",
    title: "Report exports",
    body: (
      <p>
        PDF and Excel reports are generated in your browser and saved to your device. They contain financial details from your files and
        your decisions. You are responsible for checking them before relying on or sharing them, and for keeping them secure.
      </p>
    ),
  },
  {
    id: "warranties",
    title: "Disclaimer of warranties",
    body: (
      <>
        <p>
          To the fullest extent permitted by law, the Service is provided “as is” and “as available”, without warranties of any kind,
          whether express or implied, including implied warranties of merchantability, fitness for a particular purpose, accuracy and
          non-infringement. Some jurisdictions do not allow certain warranty exclusions, so some of these may not apply to you.
        </p>
        <ReviewFlag />
      </>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <>
        <p>
          To the fullest extent permitted by law, Reconly will not be liable for any indirect, incidental, special, consequential or
          punitive damages, or for loss of data, profits, revenue or business opportunities, arising from your use of or inability to use
          the Service, including reliance on reconciliation results. Reconly’s total liability for any claim
          relating to the Service is limited to <Placeholder>cap — e.g. the amount you paid in the prior 12 months, or a fixed amount</Placeholder>.
          Nothing in these Terms limits liability that cannot be limited by law.
        </p>
        <ReviewFlag />
      </>
    ),
  },
  {
    id: "indemnification",
    title: "Indemnification",
    body: (
      <>
        <p>
          To the extent permitted by law, you agree to indemnify Reconly against claims, losses and costs arising from your misuse of the
          Service, your violation of these Terms, or your processing of data you had no right to process.
        </p>
        <ReviewFlag>Requires attorney review — whether to include this clause for a free consumer/small-business service</ReviewFlag>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to the Service and these Terms",
    body: (
      <p>
        We may change, add or remove features. We may update these Terms; the updated version will be posted on this page with a new
        effective date, and continuing to use the Service after that means you accept the updated Terms. Because there are no accounts, we
        cannot notify you individually. <Placeholder>confirm notification approach for material changes</Placeholder>
      </p>
    ),
  },
  {
    id: "termination",
    title: "Termination or discontinuation",
    body: (
      <p>
        You may stop using the Service at any time. We may restrict access to the Service for anyone who violates these
        Terms, and we may discontinue the Service. Because your saved data is in your browser, it is not deleted by us if the Service is
        discontinued, but you may no longer be able to open it in Reconly — keep exported reports.
      </p>
    ),
  },
  {
    id: "governing-law",
    title: "Governing law and dispute resolution",
    body: (
      <>
        <p>
          These Terms are governed by the laws of <Placeholder>governing jurisdiction</Placeholder>. Disputes will be resolved{" "}
          <Placeholder>forum / method, e.g. courts of a named location or arbitration</Placeholder>, except where applicable law gives you
          the right to bring a claim elsewhere.
        </p>
        <ReviewFlag />
      </>
    ),
  },
  {
    id: "contact",
    title: "Contact information",
    body: (
      <p>
        Questions about these Terms: <Placeholder>business contact email</Placeholder>
        {" · "}
        <Placeholder>postal address, if required</Placeholder>
      </p>
    ),
  },
  {
    id: "effective-date",
    title: "Effective date",
    body: (
      <p>
        These Terms have no effective date yet: they are a draft. <Placeholder>effective date</Placeholder> will be set when the reviewed
        version is published. See also the <a href="/privacy" className={a}>Privacy Policy (draft)</a>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      other={{ href: "/privacy", label: "Privacy Policy" }}
      intro={
        <p>
          These Terms explain the rules for using Reconly and its limits. In short: Reconly helps you compare your bank transactions with
          your records, but you remain responsible for checking the results and for your financial decisions, and Reconly is not
          accounting, tax or financial advice.
        </p>
      }
      sections={sections}
    />
  );
}
