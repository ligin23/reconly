"use client";

import { useState } from "react";
import { sampleData, type FileMeta } from "@/lib/sample-data";
import { Icon } from "@/components/ui/icon";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { UploadScreen, type UploadFiles, type UploadSide } from "@/components/screens/upload-screen";
import { ProcessingScreen } from "@/components/screens/processing-screen";
import { DashboardScreen } from "@/components/screens/dashboard-screen";
import { ReviewScreen } from "@/components/screens/review-screen";

type Screen = "upload" | "processing" | "dashboard" | "review";

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
    { key: "upload", n: 1, label: "Upload files", screens: ["upload"] },
    { key: "dashboard", n: 2, label: "Results", screens: ["dashboard"] },
    { key: "review", n: 3, label: "Review", screens: ["review"] },
  ];
  const activeIndex = screen === "upload" ? 0 : screen === "review" ? 2 : 1;

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
        <div
          className="mono"
          style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 3 }}
        >
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

function TopBar({
  screen,
  onStartOver,
}: {
  screen: Screen;
  onStartOver: () => void;
}) {
  const titles: Record<Screen, [string, string]> = {
    upload: ["New reconciliation", sampleData.account.periodRange],
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

export function AppShell() {
  const [screen, setScreen] = useState<Screen>("upload");
  const [analyzed, setAnalyzed] = useState(false);
  const [files, setFiles] = useState<UploadFiles>({ bank: null, ledger: null });
  const [reviewQueue, setReviewQueue] = useState(sampleData.review);

  // Reconciled is derived from the engine output. In Phase 1 the engine isn't
  // wired yet, so we use the sample data's `unexplained` total. When the
  // remaining review queue is empty AND nothing is left unexplained, we're
  // reconciled. (Phase 2 makes this fully driven by the engine.)
  const unexplained = sampleData.unexplained;
  const reconciled = reviewQueue.length === 0 && unexplained === 0;

  const counts = {
    matched: sampleData.counts.matched,
    review: reviewQueue.length,
    missingFromBooks: sampleData.counts.missingFromBooks,
    missingFromBank: sampleData.counts.missingFromBank,
  };

  const pickFile = (side: UploadSide) => {
    const meta: FileMeta = side === "bank" ? sampleData.files.bank : sampleData.files.ledger;
    setFiles((f) => ({ ...f, [side]: meta }));
  };
  const removeFile = (side: UploadSide) =>
    setFiles((f) => ({ ...f, [side]: null }));
  const useSample = () =>
    setFiles({ bank: sampleData.files.bank, ledger: sampleData.files.ledger });
  const startAnalysis = () => setScreen("processing");
  const onProcessed = () => {
    setAnalyzed(true);
    setScreen("dashboard");
  };
  const startOver = () => {
    setFiles({ bank: null, ledger: null });
    setAnalyzed(false);
    setReviewQueue(sampleData.review);
    setScreen("upload");
  };

  const decide = () => setReviewQueue((q) => q.slice(1));

  // COPILOT_MOUNT — a chat panel attaching to the in-memory recon result
  // would mount here in a future phase.

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
            {screen === "processing" && (
              <ProcessingScreen onComplete={onProcessed} />
            )}
            {screen === "dashboard" && (
              <DashboardScreen
                counts={counts}
                reconciled={reconciled}
                unexplained={unexplained}
                reviewItems={reviewQueue}
                onOpenReview={() => setScreen("review")}
              />
            )}
            {screen === "review" && (
              <ReviewScreen
                queue={reviewQueue}
                total={sampleData.review.length}
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
