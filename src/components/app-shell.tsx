"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { sampleData, type FileMeta } from "@/lib/sample-data";
import { parseCsv, inspectCsv, type CsvColumnMap, type CsvInspection } from "@/lib/parser";
import { reconcile } from "@/lib/recon";
import { buildDashboardData, unexplainedCents } from "@/lib/recon/adapter";
import type { Match, Txn, BalanceProof, MatchStatus } from "@/lib/recon/types";
import { Icon } from "@/components/ui/icon";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import {
  UploadScreen,
  type UploadFiles,
  type UploadSide,
} from "@/components/screens/upload-screen";
import { MappingScreen } from "@/components/screens/mapping-screen";
import { ProcessingScreen } from "@/components/screens/processing-screen";
import { DashboardScreen } from "@/components/screens/dashboard-screen";
import { ReviewScreen, type ReviewDecision } from "@/components/screens/review-screen";

type Screen = "upload" | "mapping" | "processing" | "dashboard" | "review";

// ---- Engine output held after a successful run -----------------------
type EngineOutput = {
  bankTxns: Txn[];
  ledgerTxns: Txn[];
  baseMissingFromBooks: Txn[];
  baseMissingFromBank: Txn[];
  balanceProof: BalanceProof;
};

// ---- File size formatter -------------------------------------------
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- Sidebar ---------------------------------------------------------
function Sidebar({
  screen,
  analyzed,
  go,
}: {
  screen: Screen;
  analyzed: boolean;
  go: (s: Screen) => void;
}) {
  const steps: { key: Screen; n: number; label: string; screens: Screen[] }[] = [
    { key: "upload", n: 1, label: "Upload files", screens: ["upload", "mapping"] },
    { key: "dashboard", n: 2, label: "Results", screens: ["dashboard"] },
    { key: "review", n: 3, label: "Review", screens: ["review"] },
  ];
  const activeIndex = screen === "upload" || screen === "mapping" ? 0 : screen === "review" ? 2 : 1;

  return (
    <aside
      style={{
        width: 260,
        flex: "none",
        borderRight: "1px solid var(--line)",
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        padding: "20px 16px",
      }}
    >
      <div style={{ padding: "4px 6px 22px" }}>
        <Logo />
      </div>

      <div
        style={{
          padding: "13px 14px",
          borderRadius: "var(--r-md)",
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
          {sampleData.account.name}
        </div>
        <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 3 }}>
          {sampleData.account.bank} ·••{sampleData.account.last4}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 9,
            fontSize: 12,
            color: "var(--ink-2)",
          }}
        >
          <Icon name="dot" size={7} style={{ color: "var(--accent)" }} />
          {sampleData.account.period}
        </div>
      </div>

      <div className="eyebrow" style={{ padding: "0 8px 10px" }}>
        This reconciliation
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {steps.map((s, i) => {
          const done = analyzed && i < activeIndex;
          const active = s.screens.includes(screen);
          const disabled = !analyzed && i > 0;
          return (
            <button
              type="button"
              key={s.key}
              className="navitem"
              data-active={active ? "" : undefined}
              data-done={done ? "" : undefined}
              disabled={disabled}
              style={disabled ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
              onClick={() => !disabled && go(s.key)}
            >
              <span className="navstep">
                {done ? <Icon name="check" size={13} stroke={3} /> : s.n}
              </span>
              <span style={{ flex: 1 }}>{s.label}</span>
              {active && (
                <Icon name="chevR" size={15} style={{ color: "var(--ink-3)" }} />
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      <button type="button" className="navitem" style={{ marginBottom: 4 }}>
        <span
          style={{
            width: 22,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-3)",
          }}
        >
          <Icon name="help" size={17} />
        </span>
        <span>How matching works</span>
      </button>
      <div
        style={{
          padding: "11px 12px",
          borderRadius: 10,
          background: "var(--accent-soft)",
          border: "1px solid oklch(0.90 0.03 256)",
          marginTop: 6,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--accent-ink)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="sparkle" size={13} /> Sample workspace
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--ink-2)",
            marginTop: 3,
            lineHeight: 1.45,
          }}
        >
          You&apos;re exploring with example data. Nothing here is real.
        </div>
      </div>
    </aside>
  );
}

// ---- TopBar ----------------------------------------------------------
function TopBar({
  screen,
  onStartOver,
}: {
  screen: Screen;
  onStartOver: () => void;
}) {
  const titles: Record<Screen, [string, string]> = {
    upload: ["New reconciliation", sampleData.account.periodRange],
    mapping: ["Confirm columns", "Tell us what each column means"],
    processing: ["Working…", sampleData.account.periodRange],
    dashboard: [
      "Results",
      `${sampleData.account.name} · ${sampleData.account.periodRange}`,
    ],
    review: ["Review", "Items we weren't sure about"],
  };
  const [title, sub] = titles[screen];

  return (
    <header
      style={{
        height: 64,
        flex: "none",
        borderBottom: "1px solid var(--line)",
        background: "oklch(1 0 0 / 0.8)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 28px",
        position: "sticky",
        top: 0,
        zIndex: 20,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          className="serif"
          style={{
            fontSize: 19,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--ink-3)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {sub}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {screen !== "upload" && screen !== "processing" && (
          <Button variant="ghost" size="sm" onClick={onStartOver}>
            Start over
          </Button>
        )}
      </div>
    </header>
  );
}

// ---- AppShell --------------------------------------------------------
export function AppShell() {
  const [screen, setScreen] = useState<Screen>("upload");
  const [analyzed, setAnalyzed] = useState(false);
  const [files, setFiles] = useState<UploadFiles>({ bank: null, ledger: null });

  // CSV text contents — held in a ref (not state) so onProcessed reads the
  // current value without stale-closure issues from the ProcessingScreen.
  const fileContentsRef = useRef<{ bank: string | null; ledger: string | null }>({
    bank: null,
    ledger: null,
  });

  // ---- Engine output (immutable once set per run) -------------------
  const [engineOutput, setEngineOutput] = useState<EngineOutput | null>(null);

  // ---- Column-mapping state ----------------------------------------
  // Inspections are produced when the user clicks "Start analysis" and shown
  // on the mapping screen. Confirmed maps are passed into parseCsv on the
  // processing step. Both reset on Start over / Remove file.
  const [inspections, setInspections] = useState<{
    bank: CsvInspection;
    ledger: CsvInspection;
  } | null>(null);
  const confirmedMapsRef = useRef<{ bank: CsvColumnMap; ledger: CsvColumnMap } | null>(null);

  // ---- Mutable match statuses (Accept / Reject / Manual) -----------
  const [matches, setMatches] = useState<Match[]>([]);

  // ---- Derived dashboard data (recomputed whenever matches change) --
  const dashboardData = useMemo(() => {
    if (!engineOutput) return null;
    return buildDashboardData(
      matches,
      engineOutput.bankTxns,
      engineOutput.ledgerTxns,
      engineOutput.baseMissingFromBooks,
      engineOutput.baseMissingFromBank
    );
  }, [matches, engineOutput]);

  const reconciled = engineOutput
    ? engineOutput.balanceProof.unexplainedDifference === 0
    : false;

  const unexplained = engineOutput
    ? unexplainedCents(engineOutput.balanceProof)
    : sampleData.unexplained;

  // ---- Upload handlers ------------------------------------------------
  const pickFile = (side: UploadSide, file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = (e.target?.result as string) ?? "";
      fileContentsRef.current = { ...fileContentsRef.current, [side]: content };
      const meta: FileMeta = {
        name: file.name,
        size: formatFileSize(file.size),
        rows: 0, // updated after parse in onProcessed
      };
      setFiles((f) => ({ ...f, [side]: meta }));
    };
    reader.readAsText(file);
  };

  const removeFile = (side: UploadSide) => {
    fileContentsRef.current = { ...fileContentsRef.current, [side]: null };
    setFiles((f) => ({ ...f, [side]: null }));
  };

  const useSample = () => {
    Promise.all([
      fetch("/samples/bank-march2026.csv").then((r) => r.text()),
      fetch("/samples/ledger-march2026.csv").then((r) => r.text()),
    ])
      .then(([bankContent, ledgerContent]) => {
        fileContentsRef.current = { bank: bankContent, ledger: ledgerContent };
        setFiles({ bank: sampleData.files.bank, ledger: sampleData.files.ledger });
      })
      .catch(console.error);
  };

  const startAnalysis = () => {
    const { bank: bankContent, ledger: ledgerContent } = fileContentsRef.current;
    if (!bankContent || !ledgerContent) return;
    setInspections({
      bank: inspectCsv(bankContent),
      ledger: inspectCsv(ledgerContent),
    });
    setScreen("mapping");
  };

  const confirmMapping = (maps: { bank: CsvColumnMap; ledger: CsvColumnMap }) => {
    confirmedMapsRef.current = maps;
    setScreen("processing");
  };

  // useCallback with empty deps — reads from ref, not state, so no stale closure.
  const onProcessed = useCallback(() => {
    const { bank: bankContent, ledger: ledgerContent } = fileContentsRef.current;
    if (!bankContent || !ledgerContent) {
      // Shouldn't happen; defensive fallback.
      setAnalyzed(true);
      setScreen("dashboard");
      return;
    }

    const maps = confirmedMapsRef.current;
    const bankTxns = parseCsv(bankContent, "bank", maps?.bank);
    const ledgerTxns = parseCsv(ledgerContent, "ledger", maps?.ledger);
    const result = reconcile(bankTxns, ledgerTxns);

    // Update the file metadata with real row counts.
    setFiles((f) => ({
      bank: f.bank ? { ...f.bank, rows: bankTxns.length } : null,
      ledger: f.ledger ? { ...f.ledger, rows: ledgerTxns.length } : null,
    }));

    setEngineOutput({
      bankTxns,
      ledgerTxns,
      baseMissingFromBooks: result.missingFromBooks,
      baseMissingFromBank: result.missingFromBank,
      balanceProof: result.balanceProof,
    });
    setMatches(result.matches);
    setAnalyzed(true);
    setScreen("dashboard");
  }, []); // stable reference — reads ref, not state

  const startOver = () => {
    fileContentsRef.current = { bank: null, ledger: null };
    confirmedMapsRef.current = null;
    setFiles({ bank: null, ledger: null });
    setInspections(null);
    setEngineOutput(null);
    setMatches([]);
    setAnalyzed(false);
    setScreen("upload");
  };

  // ---- Review decision handler -------------------------------------
  // The review screen always operates on reviewItems[0]. We update the
  // corresponding match's status, which re-derives reviewItems via useMemo.
  const decide = (decision: ReviewDecision) => {
    const currentReviewItems = dashboardData?.reviewItems ?? [];
    const currentItemId = currentReviewItems[0]?.id;
    if (!currentItemId) return;

    const newStatus: MatchStatus =
      decision === "accept"
        ? "accepted"
        : decision === "reject"
        ? "rejected"
        : "manual"; // "manual" treated as accepted for now

    setMatches((ms) =>
      ms.map((m) => (m.id === currentItemId ? { ...m, status: newStatus } : m))
    );
  };

  // COPILOT_MOUNT — a chat panel attaching to the in-memory recon result
  // (matches, engineOutput) would be mounted here in a future phase.

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {screen !== "processing" && (
        <Sidebar screen={screen} analyzed={analyzed} go={setScreen} />
      )}

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        {screen !== "processing" && (
          <TopBar screen={screen} onStartOver={startOver} />
        )}

        <main style={{ flex: 1, overflowY: "auto" }}>
          <div
            style={{
              maxWidth: screen === "dashboard" ? 980 : 1040,
              margin: "0 auto",
              padding: screen === "processing" ? 0 : "26px 28px 60px",
            }}
          >
            {screen === "upload" && (
              <UploadScreen
                files={files}
                onPick={pickFile}
                onRemove={removeFile}
                onSample={useSample}
                onStart={startAnalysis}
              />
            )}

            {screen === "mapping" && inspections && (
              <MappingScreen
                bank={inspections.bank}
                ledger={inspections.ledger}
                onBack={() => setScreen("upload")}
                onConfirm={confirmMapping}
              />
            )}

            {screen === "processing" && (
              <ProcessingScreen onComplete={onProcessed} />
            )}

            {screen === "dashboard" && dashboardData && (
              <DashboardScreen
                counts={dashboardData.counts}
                reconciled={reconciled}
                unexplained={unexplained}
                balanceProof={engineOutput?.balanceProof}
                reviewItems={dashboardData.reviewItems}
                matched={dashboardData.matched}
                matchedExtraCount={dashboardData.matchedExtraCount}
                missingFromBooks={dashboardData.missingFromBooks}
                missingFromBank={dashboardData.missingFromBank}
                onOpenReview={() => setScreen("review")}
              />
            )}

            {screen === "review" && dashboardData && (
              <ReviewScreen
                queue={dashboardData.reviewItems}
                total={matches.filter((m) => m.type === "near").length}
                onDecide={decide}
                onBack={() => setScreen("dashboard")}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
