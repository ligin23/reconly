import { Bullets, LegalDocument, Placeholder, ReviewFlag, Sub, draftMetadata, type LegalSection } from "@/components/legal/legal-document";

// DRAFT privacy policy. Every factual statement below is backed by the
// Phase 6A data-handling audit of the code. If the code changes (what is
// stored, AI features reactivated, new services), update this page.

export const metadata = draftMetadata(
  "Privacy Policy",
  "Draft Privacy Policy for Reconly, pending legal review.",
  "/privacy"
);

const a = "font-medium text-accent-ink underline underline-offset-2";

const sections: LegalSection[] = [
  {
    id: "scope",
    title: "Introduction and scope",
    body: (
      <>
        <p>
          This Privacy Policy explains how information is handled when you use Reconly, a web application that helps you compare your
          bank transactions with your own financial records (the “Service”), available at reconly-eta.vercel.app and any successor domain{" "}
          <Placeholder>confirm the domain(s) covered</Placeholder>.
        </p>
        <p>
          Reconly is designed so that the financial files you choose are processed in your web browser rather than on Reconly’s servers.
          That design reduces, but does not remove, Reconly’s privacy responsibilities: not everything stays on your device — for example,
          the standard request information every website receives reaches our hosting provider. This policy describes what is processed
          where.
        </p>
      </>
    ),
  },
  {
    id: "operator",
    title: "Who operates Reconly",
    body: (
      <>
        <p>
          Reconly is operated by <Placeholder>legal name of the individual or entity</Placeholder>, a{" "}
          <Placeholder>sole proprietor / company type</Placeholder> based in <Placeholder>country / state of residence or registration</Placeholder>{" "}
          (“Reconly”, “we”, “us”). You can contact us as described in “Contact information” below.
        </p>
        <ReviewFlag>Requires attorney review — whether the operator acts as a “controller”, “business” or equivalent depends on applicable law</ReviewFlag>
      </>
    ),
  },
  {
    id: "categories",
    title: "Categories of information processed",
    body: (
      <>
        <p>Depending on how you use the Service, the following information may be processed:</p>
        <Bullets
          items={[
            <><strong>Financial file contents</strong> — everything in the CSV files you choose, including transaction dates, descriptions, amounts, references and balances, and any other columns the files contain (for example account numbers or memo fields).</>,
            <><strong>File details</strong> — the names of the files you choose and the row each transaction came from.</>,
            <><strong>Your reconciliation work</strong> — the account label and period you enter, and your decisions (accepting or rejecting suggested matches, duplicate decisions, items you add or mark as expected).</>,
            <><strong>Technical information</strong> — your IP address, browser type, the pages and files requested, and timestamps, received by our hosting provider.</>,
          ]}
        />
        <p>
          Reconly has no user accounts and does not ask for your name, email address or payment details. Reconly does not knowingly
          request sensitive personal information; however, your financial files may contain names of people or businesses and other
          personal information about you or third parties.
        </p>
      </>
    ),
  },
  {
    id: "csv-uploads",
    title: "CSV uploads",
    body: (
      <>
        <p>
          When you choose CSV files in Reconly, they are read, matched and summarised by code running in your browser. The file contents
          are <strong>not uploaded to Reconly’s servers</strong>: Reconly provides no way to upload files to a server and does not keep a
          copy of your files.
        </p>
        <p>
          Each file is read in full once, in your browser, to find the column titles, dates, amounts and any stated balances. After that,
          Reconly keeps from each row only the columns it uses:
        </p>
        <Bullets
          items={[
            "the columns you map: date, description, amount (or money in / money out) and reference;",
            "a running-balance column, if the file has one;",
            "columns used to detect repeated rows and check statements, even if you didn’t map them: transaction IDs, reference or check numbers, balance columns and account columns (such as an account number or account name).",
          ]}
        />
        <p>
          Other columns in your files — for example memo, notes, category, card number or address columns — are not kept for newly
          imported files. Note that account columns, if your file has them, are kept in full. While you work, the kept data — and the text of the
          files you chose, so you can change how columns are read — is held in your browser’s memory and is never saved; it is discarded
          when you start over or close or reload the tab.
        </p>
      </>
    ),
  },
  {
    id: "browser-storage",
    title: "Browser-local storage",
    body: (
      <>
        <p>Reconly uses your browser’s own storage on your device, and only for features you use:</p>
        <Bullets
          items={[
            <><strong>Saved reconciliations (IndexedDB)</strong> — only when you choose <em>Save</em>; see the next section.</>,
            <><strong>A notice flag (localStorage)</strong> — a single “1” remembering that a data notice was acknowledged, from when the AI assistant was available. It contains no financial information.</>,
          ]}
        />
        <p>Please be aware that:</p>
        <Bullets
          items={[
            "This storage is on your device. It is not sent to Reconly and is not synchronised to your other devices or browsers. We cannot recover it for you.",
            "Anyone who can use the same browser profile on your device may be able to open saved information. Reconly does not add a password or its own encryption to this storage.",
            "Using a private or incognito window means stored data is discarded when the window closes.",
            "Browsers may delete stored website data on their own, for example when the device is low on storage. Keep your own copies of anything important, such as exported reports.",
          ]}
        />
      </>
    ),
  },
  {
    id: "saved-reconciliations",
    title: "Saved reconciliations",
    body: (
      <>
      <p>
        When you choose <em>Save</em>, the working state of that reconciliation is stored in your browser so you can reopen it later:
        every imported row with the columns described in section 4, the file names and row numbers, the account label and period you
        enter, the results and your decisions (such as accepted or rejected matches and duplicate decisions). Nothing is saved unless you
        choose to save. Saved reconciliations stay in your browser until you delete them or your browser removes them.
      </p>
      <p>
        <strong>Reconciliations saved before this change</strong> may contain every column of the files they were created from. Reconly
        does not rewrite or trim them automatically — they stay exactly as saved, including if you reopen and save them again. To remove
        that data, delete those saved reconciliations (section 7) and, if you wish, import the files again.
      </p>
      </>
    ),
  },
  {
    id: "deletion",
    title: "Data deletion",
    body: (
      <>
        <Bullets
          items={[
            <><strong>One saved reconciliation:</strong> open <em>Past reconciliations</em> (History) in the app, choose <em>Delete</em> next to it and confirm. Only that reconciliation is removed from Reconly’s storage in your browser; other saved reconciliations are kept. If it is open on screen at the time, it stays visible until you start over but is no longer saved.</>,
            <><strong>Everything at once:</strong> clear the site data for Reconly in your browser settings. This removes all saved reconciliations and any other information Reconly stored in that browser, and cannot be undone. The exact steps vary by browser.</>,
            <><strong>Unsaved work:</strong> close or reload the tab, or choose <em>Start over</em>.</>,
            <><strong>Downloaded reports:</strong> these are files on your device; delete them as you would any other file.</>,
          ]}
        />
        <p>
          Deletion removes the data from the browser storage Reconly uses. Reconly cannot control copies outside that storage — such as
          device backups, synced browser profiles or the browser’s internal handling of deleted data — and does not promise that deleted
          data is permanently erased from every such location. Because Reconly does not hold your files or saved reconciliations, we cannot
          access, export or delete them for you.
        </p>
      </>
    ),
  },
  {
    id: "exports",
    title: "Report exports",
    body: (
      <p>
        PDF and Excel reports are generated in your browser and downloaded directly to your device; they are not sent to Reconly. They
        contain the account label and period, transaction dates, descriptions and amounts, the names of your source files and row
        numbers, your decisions and the reconciliation results. Once downloaded, you are responsible for storing and sharing those files
        securely.
      </p>
    ),
  },
  {
    id: "ai-status",
    title: "AI functionality status",
    body: (
      <>
        <p>
          Reconly previously offered an optional AI assistant that explained reconciliation results. <strong>It is currently
          disabled.</strong> The assistant is not shown in the app, and Reconly’s server refuses any request to the assistant’s endpoint
          without reading it or forwarding it. While the assistant is disabled, no reconciliation data, questions or other financial
          information are sent to an AI provider or to the assistant’s rate-limiting service.
        </p>
        <p>
          Reconly’s matching does not use AI: it follows fixed rules in your browser. If AI features are offered again in the future, this
          policy will be updated before they are reactivated to describe what would be sent, to whom, and how it would be handled.
        </p>
      </>
    ),
  },
  {
    id: "service-providers",
    title: "Third-party service providers",
    body: (
      <>
        <p>
          Reconly is hosted by <strong>Vercel</strong>, which serves the website and receives technical request information for every page
          and file you load (see the next section). <Placeholder>confirm Vercel plan, data locations and DPA</Placeholder>
        </p>
        <p>
          While AI features are disabled, no AI provider (such as Anthropic) or rate-limiting service (such as Upstash) receives information
          from Reconly. Reconly does not sell your information and does not share it with advertisers or data brokers.{" "}
          <Placeholder>list any other providers, e.g. domain, email or support tools</Placeholder>
        </p>
        <ReviewFlag>Requires attorney review — “sale”/“sharing” definitions and processor-contract requirements vary by law</ReviewFlag>
      </>
    ),
  },
  {
    id: "hosting-logs",
    title: "Hosting and technical logs",
    body: (
      <p>
        Like any website, when you load Reconly your browser sends standard request information — such as your IP address, browser and
        device type, the address requested, the referring page if any, and the time — to our hosting provider, Vercel, which may keep
        it in its logs for operating and securing the service. These logs do not contain your financial files, because the files are not
        sent to the server. Retention of these logs is governed by Vercel: <Placeholder>log retention period for the plan in use</Placeholder>.
      </p>
    ),
  },
  {
    id: "cookies",
    title: "Analytics and cookies",
    body: (
      <>
        <p>
          Reconly does not currently use analytics, advertising or tracking tools, and does not set cookies. The browser storage described
          in section 5 is used only to provide the features you choose.
        </p>
        <p>If analytics or a feedback form are added in the future, this policy will be updated before they are introduced.</p>
        <ReviewFlag>Requires attorney review — whether local storage requires consent depends on jurisdiction (e.g. ePrivacy rules)</ReviewFlag>
      </>
    ),
  },
  {
    id: "purposes",
    title: "Purposes for processing information",
    body: (
      <>
        <Bullets
          items={[
            "To provide the reconciliation features you use, in your browser.",
            "To save and reopen reconciliations, when you choose to save them.",
            "To operate, secure and prevent abuse of the Service (hosting logs).",
          ]}
        />
        <p>
          Legal basis, where required: <Placeholder>e.g. performance of a contract / legitimate interests / consent — to be determined by counsel for each purpose</Placeholder>
        </p>
        <ReviewFlag />
      </>
    ),
  },
  {
    id: "retention",
    title: "Data retention",
    body: (
      <Bullets
        items={[
          "Unsaved reconciliation data: kept in your browser’s memory only until you close or reload the tab.",
          "Saved reconciliations: kept in your browser until you delete them (section 7), clear site data, or your browser removes them. Reconly has no copy.",
          "Notice flag in localStorage: kept until you clear site data.",
          "AI assistant data: none is collected while the assistant is disabled (section 9).",
          <>Hosting logs: retained by Vercel according to its terms. <Placeholder>retention period</Placeholder></>,
        ]}
      />
    ),
  },
  {
    id: "security",
    title: "Security measures and limitations",
    body: (
      <>
        <p>Measures in place include:</p>
        <Bullets
          items={[
            "All connections use HTTPS.",
            "A content security policy that only lets the page’s code connect to Reconly’s own server, and prevents other sites from embedding Reconly.",
            "Deleting a saved reconciliation asks for confirmation first and removes only the one you chose.",
            "The disabled AI assistant’s server endpoint refuses every request before reading it.",
          ]}
        />
        <p>
          No method of transmission or storage is completely secure. Data saved in your browser is protected only by the security of your
          device and browser profile. Reconly does not claim any security certification.
        </p>
      </>
    ),
  },
  {
    id: "international",
    title: "International processing",
    body: (
      <>
        <p>
          Our service providers may process information in countries other than where you live, including the United States.{" "}
          <Placeholder>confirm provider processing locations and any transfer safeguards</Placeholder>
        </p>
        <ReviewFlag>Requires attorney review — cross-border transfer requirements depend on where customers are located</ReviewFlag>
      </>
    ),
  },
  {
    id: "rights",
    title: "Privacy rights and requests",
    body: (
      <>
        <p>
          Depending on where you live, you may have rights over personal information about you, such as to access, correct or delete it,
          or to object to or restrict its processing. Which rights apply depends on applicable law, which depends on facts not yet settled
          (<Placeholder>intended customer geography</Placeholder>).
        </p>
        <p>
          Because Reconly does not keep your financial files or saved reconciliations, most of that information is under your direct
          control in your browser (section 7). For other requests — for example about hosting logs — contact
          us at <Placeholder>privacy contact method</Placeholder>. We may need to ask for information to verify a request.
        </p>
        <ReviewFlag>Requires attorney review — applicable laws (e.g. GDPR/UK GDPR, CCPA/CPRA, other US state laws, PIPEDA), response deadlines and complaint rights</ReviewFlag>
      </>
    ),
  },
  {
    id: "children",
    title: "Children’s privacy",
    body: (
      <p>
        Reconly is intended for adults managing business or personal finances and is not directed to children. We do not knowingly
        collect personal information from children under <Placeholder>age threshold, e.g. 13 / 16 / 18</Placeholder>. If you believe a
        child has provided personal information through the Service, contact us.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        We may update this policy, for example when features change. The updated version will be posted on this page with a new effective
        date. Because Reconly has no accounts, we cannot notify you individually; please review this page periodically.{" "}
        <Placeholder>confirm notification approach for material changes</Placeholder>
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact information",
    body: (
      <p>
        Questions or requests about this policy: <Placeholder>business contact email</Placeholder>
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
        This policy has no effective date yet: it is a draft. <Placeholder>effective date</Placeholder> will be set when the reviewed version
        is published. See also the <a href="/terms" className={a}>Terms of Service (draft)</a>.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      other={{ href: "/terms", label: "Terms of Service" }}
      intro={
        <p>
          In short: your financial files are processed in your browser and are not uploaded to Reconly. If you save a reconciliation, it is
          stored in your browser on your device, and you can delete it at any time. The AI assistant Reconly used to offer is currently
          disabled, so no reconciliation data is sent to an AI provider. Our hosting provider still receives standard technical request
          information.
        </p>
      }
      sections={sections}
    />
  );
}
