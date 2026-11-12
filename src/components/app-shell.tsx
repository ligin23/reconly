"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sampleData, type FileMeta, type MissingTxn, type UserAddedEntry } from "@/lib/sample-data";
import { inspectCsv } from "@/lib/parser";
import { reconcile } from "@/lib/recon";
import { buildDashboardData, unexplainedCents } from "@/lib/recon/adapter";
import {
  decideCompositeOnce,
  decideMatchOnce,
  undoCompositeDecision,
  undoMatchDecision,
  restoreComposites,
  restoreMatches,
  reviewProgress,
} from "@/lib/recon/decisions";
import type {
  Match,
  Txn,
  BalanceProof,
  AnyCompositeMatch,
  ReconResult,
} from "@/lib/recon/types";
import { Icon } from "@/components/ui/icon";
import { track } from "@/lib/analytics/track";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import {
  UploadScreen,
  type UploadFiles,
  type UploadSide,
} from "@/components/screens/upload-screen";
import {
  MappingScreen,
  type FileImportConfig,
  type MappingFile,
} from "@/components/screens/mapping-screen";
import { combineFiles, type CombinedImport, type ImportedFile } from "@/lib/import/combine";
import { checkFileStructure } from "@/lib/import/validate-file";
import {
  EMPTY_DUPLICATE_STATE,
  activeTxns,
  detectDuplicates,
  dismissGroup,
  fileOverlaps,
  initialDuplicateState,
  restoreRows,
  sanitizeDuplicateState,
  setAsideRows,
  unresolvedGroupCount,
  type DuplicateState,
} from "@/lib/import/duplicates";
import { deriveVerdict } from "@/lib/recon/verdict";
import { buildMonthReview } from "@/lib/review/months";
import { possibleAmountDifferences } from "@/lib/review/amount-hints";
import { signedDollars } from "@/lib/review/net-difference";
import { sourceLabel } from "@/lib/import/provenance";
import { verifyStatements } from "@/lib/review/statements";
import { ProcessingScreen, type ReconCounts } from "@/components/screens/processing-screen";
import { DashboardScreen } from "@/components/screens/dashboard-screen";
import { ReviewScreen, type ReviewDecision, type ReviewMeta } from "@/components/screens/review-screen";
import { HistoryScreen } from "@/components/screens/history-screen";
import { repository } from "@/lib/data/indexeddb-repository";
import type { ReconciliationRecord, SourceFileInfo } from "@/lib/data/repository";
import { generateId, inferPeriod, formatPeriod, deriveStatus } from "@/lib/data/utils";
import { downloadPdfReport } from "@/lib/export/pdf-report";
import { downloadExcelWorksheet } from "@/lib/export/excel-worksheet";
import { CopilotPanel } from "@/components/copilot-panel";
import { DemoBanner, DemoTourPanel } from "@/components/demo-tour-panel";
import {
  ADVANCED_DEMO_ACCOUNT_LABEL,
  ADVANCED_DEMO_BASE_PATH,
  ADVANCED_DEMO_FILES,
} from "@/lib/demo/advanced-demo";
import { buildReconContext } from "@/lib/copilot/context-builder";

type Screen = "upload" | "mapping" | "processing" | "dashboard" | "review" | "history";

// ---- Engine output held after a successful run -----------------------
type EngineOutput = {
  bankTxns: Txn[];
  ledgerTxns: Txn[];
  baseMissingFromBooks: Txn[];
  baseMissingFromBank: Txn[];
  balanceProof: BalanceProof;
};

// ---- Save dialog -----------------------------------------------------

type SaveFormValues = {
  accountName: string;
  periodStart: string;
  periodEnd: string;
  openingBalance: string; // dollars, converted to cents on save
};

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  fontSize: 14,
  fontFamily: "inherit",
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-sm)",
  color: "var(--ink)",
  outline: "none",
};

function SaveDialog({
  open,
  initialValues,
  onSave,
  onCancel,
  sampleData = false,
}: {
  open: boolean;
  initialValues: SaveFormValues;
  onSave: (values: SaveFormValues) => void;
  onCancel: () => void;
  /** The advanced demo is open: the record is saved and labelled as sample data. */
  sampleData?: boolean;
}) {
  const [values, setValues] = useState<SaveFormValues>(initialValues);

  // Re-sync form whenever the dialog opens so it shows fresh inferred values.
  useEffect(() => {
    if (open) setValues(initialValues);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const valid = Boolean(
    values.accountName.trim() && values.periodStart && values.periodEnd
  );

  const set = (key: keyof SaveFormValues) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => setValues((v) => ({ ...v, [key]: e.target.value }));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "oklch(0.2 0.01 264 / 0.45)",
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(2px)",
      }}
      onClick={onCancel}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: 480,
          padding: "28px 30px",
          boxShadow: "var(--sh-lg)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          className="serif"
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            marginBottom: 22,
          }}
        >
          Save reconciliation
        </h2>

        {sampleData && (
          <div
            data-testid="save-sample-note"
            style={{
              fontSize: 13,
              color: "var(--accent-ink)",
              background: "var(--accent-soft)",
              borderRadius: "var(--r-sm)",
              padding: "8px 12px",
              margin: "-8px 0 18px",
            }}
          >
            This is the fictional demo. It will be saved and labelled as sample data.
          </div>
        )}

        {/* Account name */}
        <label style={{ display: "block", marginBottom: 16 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink-2)",
              display: "block",
              marginBottom: 6,
            }}
          >
            Account name
          </span>
          <input
            type="text"
            value={values.accountName}
            onChange={set("accountName")}
            placeholder="e.g. Business Checking"
            style={INPUT_STYLE}
            autoFocus
            data-testid="save-account-name"
          />
        </label>

        {/* Period */}
        <div style={{ marginBottom: 16 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink-2)",
              display: "block",
              marginBottom: 6,
            }}
          >
            Period
          </span>
          <div className="m-stack" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input
              type="date"
              value={values.periodStart}
              onChange={set("periodStart")}
              style={INPUT_STYLE}
            />
            <input
              type="date"
              value={values.periodEnd}
              onChange={set("periodEnd")}
              style={INPUT_STYLE}
            />
          </div>
        </div>

        {/* Opening balance */}
        <label style={{ display: "block", marginBottom: 26 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink-2)",
              display: "block",
              marginBottom: 6,
            }}
          >
            Opening balance
          </span>
          <div style={{ position: "relative" }}>
            <span
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 14,
                color: "var(--ink-3)",
                pointerEvents: "none",
              }}
            >
              $
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={values.openingBalance}
              onChange={set("openingBalance")}
              placeholder="0.00"
              style={{ ...INPUT_STYLE, paddingLeft: 24 }}
            />
          </div>
        </label>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={() => onSave(values)}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- File size formatter -------------------------------------------
/** Every imported row per side, in import order (set-aside rows included). */
type ImportedRows = { bank: Txn[]; ledger: Txn[] };

/** An uploaded file held in memory for this session. */
type LoadedFile = { id: string; name: string; content: string; sample?: boolean };

/** Upper bound on files per side (3 years of monthly exports). */
const MAX_FILES_PER_SIDE = 36;

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
  historyCount,
  accountName,
  periodLabel,
  showSampleBanner,
  sampleBannerText,
  open,
  onClose,
}: {
  /** Phone widths only: whether the drawer is showing. Ignored on desktop,
   *  where the sidebar is always visible. */
  open: boolean;
  onClose: () => void;
  screen: Screen;
  analyzed: boolean;
  go: (s: Screen) => void;
  historyCount: number;
  /** Saved record's account name; null while the session is unsaved. */
  accountName: string | null;
  periodLabel: string;
  showSampleBanner: boolean;
  /** Overrides the banner's body text (the advanced demo uses its own). */
  sampleBannerText?: string;
}) {
  const steps: { key: Screen; n: number; label: string; screens: Screen[] }[] = [
    { key: "upload", n: 1, label: "Upload files", screens: ["upload", "mapping"] },
    { key: "dashboard", n: 2, label: "Results", screens: ["dashboard"] },
    { key: "review", n: 3, label: "Review", screens: ["review"] },
  ];
  const activeIndex =
    screen === "upload" || screen === "mapping"
      ? 0
      : screen === "review"
      ? 2
      : 1;

  return (
    <>
    <button
      type="button"
      className="app-sidebar-backdrop"
      data-open={open ? "" : undefined}
      data-testid="sidebar-backdrop"
      aria-label="Close menu"
      tabIndex={-1}
      onClick={onClose}
    />
    <aside
      id="app-sidebar"
      className="app-sidebar"
      data-open={open ? "" : undefined}
      data-testid="sidebar"
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
      <div style={{ padding: "4px 6px 22px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Logo />
        <button
          type="button"
          className="app-menu-btn"
          data-testid="sidebar-close"
          aria-label="Close menu"
          onClick={onClose}
        >
          <Icon name="x" size={18} />
        </button>
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
          {accountName ?? "New reconciliation"}
        </div>
        {!accountName && (
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 3 }}>
            Not saved yet
          </div>
        )}
        {periodLabel && (
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
            {periodLabel}
          </div>
        )}
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

      {/* History nav */}
      <div className="eyebrow" style={{ padding: "18px 8px 10px" }}>
        History
      </div>
      <button
        type="button"
        className="navitem"
        data-active={screen === "history" ? "" : undefined}
        data-testid="nav-history"
        onClick={() => go("history")}
      >
        <span
          style={{
            width: 22,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-3)",
          }}
        >
          <Icon name="history" size={17} />
        </span>
        <span style={{ flex: 1 }}>Past reconciliations</span>
        {historyCount > 0 && (
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--accent-ink)",
              background: "var(--accent-soft)",
              borderRadius: 999,
              padding: "1px 7px",
              minWidth: 20,
              textAlign: "center",
            }}
          >
            {historyCount}
          </span>
        )}
      </button>

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
      {showSampleBanner && (
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
          <Icon name="sparkle" size={13} /> {sampleBannerText ? "Demo workspace" : "Sample workspace"}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--ink-2)",
            marginTop: 3,
            lineHeight: 1.45,
          }}
        >
          {sampleBannerText ?? "You're exploring with example data. Nothing here is real."}
        </div>
      </div>
      )}
    </aside>
    </>
  );
}

// ---- ExportMenu (dropdown) ------------------------------------------
// Self-contained: manages its own open/generating state.
// Receives async callbacks — shows "Generating…" while they run.
function ExportMenu({
  onPdf,
  onExcel,
}: {
  onPdf: () => Promise<void>;
  onExcel: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState<"idle" | "pdf" | "excel">("idle");
  const [failed, setFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const run = async (kind: "pdf" | "excel") => {
    setOpen(false);
    setGenerating(kind);
    setFailed(false);
    try {
      await (kind === "pdf" ? onPdf() : onExcel());
    } catch (err) {
      // A failed export must be visible — otherwise the button just resets
      // and the user assumes a file was downloaded.
      console.error(err);
      setFailed(true);
    } finally {
      setGenerating("idle");
    }
  };

  const busy = generating !== "idle";
  const label = generating === "pdf"
    ? "Generating PDF…"
    : generating === "excel"
    ? "Generating…"
    : failed
    ? "Export failed — try again"
    : "Export";

  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <Button
        variant="ghost"
        size="sm"
        icon={busy ? undefined : "download"}
        iconRight={busy ? undefined : "chevR"}
        onClick={() => !busy && setOpen((o) => !o)}
        disabled={busy}
        style={{ opacity: busy ? 0.65 : 1 }}
        data-testid="export-menu-btn"
      >
        {label}
      </Button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 210,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-md)",
            boxShadow: "var(--sh-lg)",
            zIndex: 40,
            overflow: "hidden",
          }}
        >
          {/* Menu header */}
          <div
            style={{
              padding: "9px 14px 7px",
              fontSize: 10.5,
              fontWeight: 600,
              color: "var(--ink-3)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              borderBottom: "1px solid var(--line-2)",
            }}
          >
            Download
          </div>

          {/* PDF item */}
          <button
            type="button"
            data-testid="export-pdf-btn"
            onClick={() => run("pdf")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "11px 14px",
              background: "none",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              color: "var(--ink)",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--surface-2)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "none")
            }
          >
            <Icon name="download" size={15} style={{ color: "var(--ink-3)", flex: "none" }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
                Report (PDF)
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 1 }}>
                Keep or share — summary &amp; full detail
              </div>
            </div>
          </button>

          {/* Divider */}
          <div style={{ height: 1, background: "var(--line-2)", margin: "0 10px" }} />

          {/* Excel item */}
          <button
            type="button"
            data-testid="export-excel-btn"
            onClick={() => run("excel")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "11px 14px",
              background: "none",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
              color: "var(--ink)",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--surface-2)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "none")
            }
          >
            <Icon name="download" size={15} style={{ color: "var(--ink-3)", flex: "none" }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
                Worksheet (Excel)
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 1 }}>
                Act on it — all transactions laid out
              </div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

// ---- TopBar ----------------------------------------------------------
function TopBar({
  screen,
  title,
  subtitle,
  analyzed,
  hasSavedRecord,
  saveStatus,
  onStartOver,
  onSave,
  onExportPdf,
  onExportExcel,
  menuOpen,
  onOpenMenu,
}: {
  menuOpen: boolean;
  /** Opens the navigation drawer (the button only shows at phone widths). */
  onOpenMenu: () => void;
  screen: Screen;
  title: string;
  subtitle: string;
  analyzed: boolean;
  hasSavedRecord: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  onStartOver: () => void;
  onSave: () => void;
  onExportPdf: () => Promise<void>;
  onExportExcel: () => Promise<void>;
}) {
  const showActions =
    analyzed &&
    screen !== "upload" &&
    screen !== "processing" &&
    screen !== "history";

  return (
    <header
      className="app-topbar"
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
      <button
        type="button"
        className="app-menu-btn"
        data-testid="menu-btn"
        aria-label="Open menu"
        aria-controls="app-sidebar"
        aria-expanded={menuOpen}
        onClick={onOpenMenu}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <div className="app-topbar-title" style={{ minWidth: 0 }}>
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
          {subtitle}
        </div>
      </div>
      <div className="app-topbar-actions" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {showActions && (
          <>
            <ExportMenu onPdf={onExportPdf} onExcel={onExportExcel} />
            <Button
              variant="secondary"
              size="sm"
              icon={saveStatus === "saved" ? "check" : "save"}
              onClick={onSave}
              disabled={saveStatus === "saving"}
              data-testid="save-btn"
            >
              {saveStatus === "saving"
                ? "Saving…"
                : saveStatus === "saved"
                ? "Saved"
                : saveStatus === "error"
                ? "Couldn't save — try again"
                : hasSavedRecord
                ? "Save changes"
                : "Save reconciliation"}
            </Button>
          </>
        )}
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
/**
 * `autoStart="advanced-demo"` (used by /app/demo) launches the existing
 * Advanced Demo once on first load — the same code path as the "Explore
 * advanced demo" button, in this one app instance.
 */
export function AppShell({ autoStart }: { autoStart?: "advanced-demo" } = {}) {
  const [screen, setScreen] = useState<Screen>("upload");
  // Navigation drawer (phone widths only; the sidebar is always visible on desktop).
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Browser Back on the Review screen returns to Results instead of leaving
  // the app (which would discard the whole in-memory reconciliation).
  // Entering Review pushes one history entry (same URL); the browser's Back
  // pops it and we switch to Results. Leaving Review any other way pops our
  // entry ourselves so the history stack never fills with dead entries.
  // Review decisions are already committed on click, so leaving mid-animation
  // by either route keeps them.
  const screenRef = useRef(screen);
  const selfBackRef = useRef(false);
  useEffect(() => {
    screenRef.current = screen;
    const onReviewEntry = () => window.history.state?.reconlyReview === true;
    if (screen === "review") {
      if (!onReviewEntry()) {
        window.history.pushState({ ...(window.history.state ?? {}), reconlyReview: true }, "");
      }
    } else if (onReviewEntry()) {
      selfBackRef.current = true;
      window.history.back();
    }
  }, [screen]);
  useEffect(() => {
    const onPop = () => {
      const onReviewEntry = window.history.state?.reconlyReview === true;
      if (selfBackRef.current) {
        // Our own back() after leaving Review in-app. If the user re-entered
        // Review before it landed, put the entry back.
        selfBackRef.current = false;
        if (screenRef.current === "review" && !onReviewEntry) {
          window.history.pushState({ ...(window.history.state ?? {}), reconlyReview: true }, "");
        }
        return;
      }
      if (screenRef.current === "review" && !onReviewEntry) setScreen("dashboard");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [analyzed, setAnalyzed] = useState(false);
  // Several files per side are allowed (e.g. one bank export per month).
  const [files, setFiles] = useState<UploadFiles>({ bank: [], ledger: [] });

  // File text lives in a ref (it can be megabytes — not render state).
  const fileContentsRef = useRef<Record<UploadSide, LoadedFile[]>>({
    bank: [],
    ledger: [],
  });

  const [engineOutput, setEngineOutput] = useState<EngineOutput | null>(null);

  // Bumped whenever a different reconciliation is loaded (fresh run or
  // history open). Keys the copilot panel so its conversation — which is
  // in-memory only — never carries over between reconciliations.
  const [copilotRunId, setCopilotRunId] = useState(0);

  const [mappingFiles, setMappingFiles] = useState<MappingFile[] | null>(null);
  const reconCacheRef = useRef<{
    bankTxns: Txn[];
    ledgerTxns: Txn[];
    result: ReconResult;
    sourceFiles: SourceFileInfo[];
    imported: ImportedRows;
    duplicateState: DuplicateState;
  } | null>(null);
  // Every row the user imported — including rows set aside as repeated.
  // `engineOutput.bankTxns / ledgerTxns` are only the rows IN USE.
  const [imported, setImported] = useState<ImportedRows | null>(null);
  const [duplicateState, setDuplicateState] = useState<DuplicateState>(EMPTY_DUPLICATE_STATE);
  // The files the CURRENT reconciliation was built from (persisted on save).
  const [sourceFiles, setSourceFiles] = useState<SourceFileInfo[]>([]);
  const [reconCounts, setReconCounts] = useState<ReconCounts | null>(null);

  const [matches, setMatches] = useState<Match[]>([]);
  const [compositeMatches, setCompositeMatches] = useState<AnyCompositeMatch[]>([]);
  const [userAddedEntries, setUserAddedEntries] = useState<UserAddedEntry[]>([]);
  const [acknowledgedBankIds, setAcknowledgedBankIds] = useState<string[]>([]);

  // True only while the built-in sample CSVs are loaded — gates the
  // "Sample workspace" disclaimer so it never shows over real uploads.
  const [usingSampleData, setUsingSampleData] = useState(false);
  // True while the advanced demo (three months of fictional files) is the
  // current reconciliation — gates the demo banner, the feature tour and the
  // "sample data" labelling on save and export.
  const [usingAdvancedDemo, setUsingAdvancedDemo] = useState(false);
  const [advancedDemoLoading, setAdvancedDemoLoading] = useState(false);
  const [demoTourHidden, setDemoTourHidden] = useState(false);

  // Rejected/failed file pick (wrong type, too large, read failure).
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Parse failure on the mapping screen (e.g. the mapping yields zero rows).
  const [mappingError, setMappingError] = useState<string | null>(null);
  // Non-fatal parse diagnostics (skipped rows, format warnings) carried to
  // the dashboard — silently dropping rows is never acceptable here.
  const [parseNotices, setParseNotices] = useState<string[]>([]);

  // Current-month label ("June 2026") for fresh sessions with no data yet.
  // Set in an effect so the statically prerendered HTML (built at a possibly
  // different time) never mismatches on hydration.
  const [todayLabel, setTodayLabel] = useState("");
  useEffect(() => {
    setTodayLabel(
      new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })
    );
  }, []);

  // ---- Persistence state --------------------------------------------
  const [currentRecordId, setCurrentRecordId] = useState<string | null>(null);
  const [savedRecords, setSavedRecords] = useState<ReconciliationRecord[]>([]);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  // Save-button feedback: the IndexedDB write is async, so surface its state
  // instead of failing silently — "saving" while in flight, a brief "saved"
  // flash on success, "error" (with retry via the same button) on failure.
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashSaved = () => {
    setSaveStatus("saved");
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    saveStatusTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
  };

  // Load history on mount (IndexedDB is browser-only; safe inside useEffect).
  useEffect(() => {
    repository
      .listReconciliations()
      .then(setSavedRecords)
      .catch(console.error);
  }, []);

  // ---- Derived values -----------------------------------------------
  const dashboardData = useMemo(() => {
    if (!engineOutput) return null;
    return buildDashboardData(
      matches,
      compositeMatches,
      engineOutput.bankTxns,
      engineOutput.ledgerTxns,
      engineOutput.baseMissingFromBooks,
      engineOutput.baseMissingFromBank,
      new Set(userAddedEntries.map((e) => e.txnId)),
      new Set(acknowledgedBankIds)
    );
  }, [matches, compositeMatches, userAddedEntries, acknowledgedBankIds, engineOutput]);

  // "Possible amount difference" notes for unmatched rows — informational
  // only: nothing is matched, set aside or re-totalled because of them.
  const amountHints = useMemo(() => {
    if (!engineOutput || !dashboardData) return undefined;
    const bankById = new Map(engineOutput.bankTxns.map((t) => [t.id, t]));
    const ledgerById = new Map(engineOutput.ledgerTxns.map((t) => [t.id, t]));
    const pick = (list: MissingTxn[], byId: Map<string, Txn>) =>
      list.map((m) => byId.get(m.txnId)).filter((t): t is Txn => Boolean(t));
    const hints = possibleAmountDifferences(
      pick(dashboardData.missingFromBooks, bankById),
      pick(dashboardData.missingFromBank, ledgerById)
    );
    const out: Record<string, string> = {};
    for (const h of hints) {
      const bank = bankById.get(h.bankTxnId)!;
      const ledger = ledgerById.get(h.ledgerTxnId)!;
      const gap = signedDollars(Math.abs(h.difference));
      const from = (t: Txn) => (sourceLabel(t) ? ` (${sourceLabel(t)})` : "");
      const tail = "Not matched automatically; totals are unchanged.";
      out[bank.id] = `Possible amount difference: your records have the same description on the same date for ${signedDollars(ledger.amount)}${from(ledger)} — ${gap} apart. ${tail}`;
      out[ledger.id] = `Possible amount difference: the bank shows the same description on the same date for ${signedDollars(bank.amount)}${from(bank)} — ${gap} apart. ${tail}`;
    }
    return out;
  }, [engineOutput, dashboardData]);

  // Duplicate review — recomputed from the imported rows (deterministic),
  // never from bank-vs-ledger: each side is checked on its own.
  const duplicateGroups = useMemo(
    () =>
      imported
        ? [...detectDuplicates("bank", imported.bank), ...detectDuplicates("ledger", imported.ledger)]
        : [],
    [imported]
  );
  const importOverlaps = useMemo(
    () =>
      imported
        ? [...fileOverlaps("bank", imported.bank), ...fileOverlaps("ledger", imported.ledger)]
        : [],
    [imported]
  );

  // Live balance proof: clearedSum updates as users accept/reject matches.
  // unexplainedDifference is immutable (bank total − ledger total), but
  // clearedSum tracks what's been confirmed so far.
  const liveBalanceProof = useMemo((): BalanceProof | null => {
    if (!engineOutput) return null;
    const oneToOneCleared = matches
      .filter((m) => m.status === "accepted" || m.status === "manual")
      .reduce((s, m) => {
        const t = engineOutput.bankTxns.find((b) => b.id === m.bankTxnId);
        return s + (t?.amount ?? 0);
      }, 0);
    const compositeCleared = compositeMatches
      .filter((c) => c.status === "accepted")
      .reduce((s, c) => {
        const t = engineOutput.bankTxns.find((b) => b.id === c.bankTxnId);
        return s + (t?.amount ?? 0);
      }, 0);
    // Each user-added entry will be recorded in the books, raising the ledger
    // net by its SIGNED amount: unexplained = bankNet − (ledgerNet + added).
    // Signed, never clamped — absolute-value math showed the gap shrinking
    // when it actually grew, and clamping faked a $0 on overshoot.
    const addedSum = userAddedEntries.reduce((s, e) => s + e.amount, 0);
    const engineGap = engineOutput.balanceProof.unexplainedDifference;
    const newUnexplained = engineGap - addedSum;
    return {
      ...engineOutput.balanceProof,
      clearedSum: oneToOneCleared + compositeCleared,
      unexplainedDifference: newUnexplained,
    };
  }, [matches, compositeMatches, userAddedEntries, engineOutput]);

  // Open items the user still has to deal with: unresolved missing items
  // plus suggestions awaiting review. "Reconciled" requires a zero difference
  // AND none of these — offsetting unmatched items netting to zero is not a
  // reconciled period.
  const openItemCount = dashboardData
    ? dashboardData.counts.missingFromBooks +
      dashboardData.counts.missingFromBank +
      dashboardData.counts.review
    : 0;

  // Statement balance verification: each bank file against its own stated
  // balances, using EVERY imported row (set-aside rows included — the
  // duplicate review must not change what the original statement proves).
  const statementReview = useMemo(
    () => (engineOutput ? verifyStatements(imported?.bank ?? engineOutput.bankTxns, sourceFiles) : null),
    [engineOutput, imported, sourceFiles]
  );

  // The verdict keeps two things apart: whether the money agrees
  // (financial) and whether possible duplicates still await a decision
  // (data quality). "Fully reconciled" needs both; a flagged duplicate
  // never changes a total or a confirmed match.
  const unresolvedDuplicateGroups = useMemo(
    () => unresolvedGroupCount(duplicateGroups, duplicateState),
    [duplicateGroups, duplicateState]
  );
  const verdict = liveBalanceProof
    ? deriveVerdict({
        unexplainedDifference: liveBalanceProof.unexplainedDifference,
        openItemCount,
        unresolvedDuplicateGroups,
        statements: statementReview?.counts,
      })
    : null;
  const reconciled = verdict?.reconciled ?? false;

  const unexplained = liveBalanceProof
    ? unexplainedCents(liveBalanceProof)
    : sampleData.unexplained;

  // Month-by-month findings: a grouping of the ONE full-range
  // reconciliation above — the engine is never run per month.
  const monthReview = useMemo(() => {
    if (!engineOutput) return null;
    return buildMonthReview({
      statementReview: statementReview ?? undefined,
      imported: imported ?? { bank: engineOutput.bankTxns, ledger: engineOutput.ledgerTxns },
      bankTxns: engineOutput.bankTxns,
      ledgerTxns: engineOutput.ledgerTxns,
      matches,
      compositeMatches,
      addedBankIds: new Set(userAddedEntries.map((e) => e.txnId)),
      acknowledgedLedgerIds: new Set(acknowledgedBankIds),
      duplicateGroups,
      duplicateState,
      sourceFiles,
    });
  }, [
    engineOutput,
    imported,
    matches,
    compositeMatches,
    userAddedEntries,
    acknowledgedBankIds,
    duplicateGroups,
    duplicateState,
    sourceFiles,
    statementReview,
  ]);

  // Current record (if this session has a saved record)
  const currentRecord = savedRecords.find((r) => r.id === currentRecordId) ?? null;

  // Labels for TopBar/Sidebar — never fabricated. Priority: the saved
  // record's own values > a period inferred from the actual transactions >
  // the current month (fresh session, nothing uploaded yet).
  const inferredPeriodLabel = useMemo(() => {
    if (!engineOutput) return null;
    const period = inferPeriod([
      ...engineOutput.bankTxns,
      ...engineOutput.ledgerTxns,
    ]);
    return period ? formatPeriod(period.start, period.end) : null;
  }, [engineOutput]);

  const accountLabel = currentRecord?.accountName ?? "Not saved yet";
  const periodLabel = currentRecord
    ? formatPeriod(currentRecord.periodStart, currentRecord.periodEnd)
    : inferredPeriodLabel ?? todayLabel;

  const topBarTitle = ((): string => {
    switch (screen) {
      case "upload":     return "New reconciliation";
      case "mapping":    return "Confirm columns";
      case "processing": return "Working…";
      case "dashboard":  return "Results";
      case "review":     return "Review";
      case "history":    return "History";
    }
  })();

  const topBarSubtitle = ((): string => {
    switch (screen) {
      case "upload":     return todayLabel;
      case "mapping":    return "Tell us what each column means";
      case "processing": return periodLabel;
      case "dashboard":  return `${accountLabel} · ${periodLabel}`;
      case "review":     return "Items we weren't sure about";
      case "history":    return "Past reconciliations";
    }
  })();

  // Pre-fill values for the save dialog (inferred from current engine output)
  const saveDialogInitialValues: SaveFormValues = useMemo(() => {
    if (!engineOutput) {
      return { accountName: "", periodStart: "", periodEnd: "", openingBalance: "0.00" };
    }
    const allTxns = [...engineOutput.bankTxns, ...engineOutput.ledgerTxns];
    const period = inferPeriod(allTxns);
    return {
      // No fake prefill — the user names their own account. (The demo's
      // fictional account is the one exception, and is labelled as such.)
      accountName:
        currentRecord?.accountName ?? (usingAdvancedDemo ? ADVANCED_DEMO_ACCOUNT_LABEL : ""),
      periodStart: period?.start ?? "",
      periodEnd: period?.end ?? "",
      openingBalance: "0.00",
    };
  }, [engineOutput, currentRecord, usingAdvancedDemo]);

  // ---- Upload handlers ------------------------------------------------

  // Whole files are read into memory and parsed synchronously; beyond this
  // size the tab freezes, so reject early with a clear message instead.
  const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

  const pickFile = (side: UploadSide, file: File) => {
    // The picker's accept=".csv" doesn't constrain drag-and-drop — anything
    // can be dropped, so validate here (the single entry point for both).
    const csvByName = /\.(csv|txt)$/i.test(file.name);
    const csvByType =
      file.type === "" ||
      ["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"].includes(file.type);
    if (!csvByName || !csvByType) {
      setUploadError(
        /\.(xlsx|xlsm|xls)$/i.test(file.name)
          ? `"${file.name}" is an Excel workbook. Save it as CSV first — see "Have an Excel file?" below.`
          : `"${file.name}" doesn't look like a CSV file. Export your data as CSV and try again.`
      );
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(
        `"${file.name}" is ${formatFileSize(file.size)} — too large to process here (limit ${formatFileSize(MAX_UPLOAD_BYTES)}).`
      );
      return;
    }
    setUploadError(null);
    const reader = new FileReader();
    reader.onerror = () => {
      setUploadError(`Couldn't read "${file.name}". Check the file and try again.`);
    };
    reader.onload = (e) => {
      const content = (e.target?.result as string) ?? "";
      // Real files replace the sample pair rather than joining it.
      const existing = fileContentsRef.current[side].filter((f) => !f.sample);
      const sideLabel = side === "bank" ? "bank statement" : "ledger";

      // A file that cannot hold a table of transactions (empty, plain text,
      // column titles with nothing under them) is refused here, with the
      // reason — not passed on to a column-mapping screen that cannot fix
      // it. Files already added are untouched; the user just picks another.
      const problem = checkFileStructure(content);
      if (problem) {
        setUploadError(
          `"${file.name}" wasn't added — ${problem.message} Choose a different file for the ${sideLabel} side.`
        );
        return;
      }

      if (existing.length >= MAX_FILES_PER_SIDE) {
        setUploadError(
          `"${file.name}" wasn't added — the ${sideLabel} side already has ${MAX_FILES_PER_SIDE} files, the most Reconly handles at once.`
        );
        return;
      }
      // The very same file picked twice is refused out loud. (Files that
      // merely overlap in dates are NOT refused or trimmed — they are all
      // kept, and the overlap is reported on the results screen.)
      if (existing.some((f) => f.content === content)) {
        setUploadError(
          `"${file.name}" wasn't added — a file with exactly the same contents is already on the ${sideLabel} side.`
        );
        return;
      }
      // Two different files can share a name (downloads from different
      // folders). Keep both, but give the second a distinct label so every
      // transaction can still be traced to the right file.
      let name = file.name;
      for (let n = 2; existing.some((f) => f.name === name); n++) {
        name = file.name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
      }
      const loaded: LoadedFile = { id: generateId(), name, content };
      fileContentsRef.current = { ...fileContentsRef.current, [side]: [...existing, loaded] };
      const meta: FileMeta = { id: loaded.id, name, size: formatFileSize(file.size), rows: 0 };
      setFiles((f) => ({
        ...f,
        [side]: [...f[side].filter((m) => existing.some((x) => x.id === m.id)), meta],
      }));
      // A real file on one side means the other side's sample file goes too.
      const other: UploadSide = side === "bank" ? "ledger" : "bank";
      if (fileContentsRef.current[other].some((f) => f.sample)) {
        fileContentsRef.current = { ...fileContentsRef.current, [other]: [] };
        setFiles((f) => ({ ...f, [other]: [] }));
      }
      setUsingSampleData(false);
      setUsingAdvancedDemo(false);
    };
    reader.readAsText(file);
  };

  const removeFile = (side: UploadSide, file: FileMeta) => {
    fileContentsRef.current = {
      ...fileContentsRef.current,
      [side]: fileContentsRef.current[side].filter((f) => f.id !== file.id),
    };
    setFiles((f) => ({ ...f, [side]: f[side].filter((m) => m.id !== file.id) }));
    setUploadError(null);
  };

  const useSample = () => {
    track({ name: "demo_start", variant: "sample" });
    Promise.all([
      fetch("/samples/bank-june2026.csv").then((r) => r.text()),
      fetch("/samples/ledger-june2026.csv").then((r) => r.text()),
    ])
      .then(([bankContent, ledgerContent]) => {
        const bank: LoadedFile = { id: "sample-bank", name: sampleData.files.bank.name, content: bankContent, sample: true };
        const ledger: LoadedFile = { id: "sample-ledger", name: sampleData.files.ledger.name, content: ledgerContent, sample: true };
        fileContentsRef.current = { bank: [bank], ledger: [ledger] };
        setFiles({
          bank: [{ ...sampleData.files.bank, id: bank.id }],
          ledger: [{ ...sampleData.files.ledger, id: ledger.id }],
        });
        setUploadError(null);
        setUsingSampleData(true);
        setUsingAdvancedDemo(false);
      })
      .catch(console.error);
  };

  /**
   * Advanced demo: load the fictional three-month files and run them through
   * the normal import (confirmMapping → processing → results). The column
   * mappings are the ones Reconly's own detection picks for these files, so
   * the mapping screen is skipped — nothing else is.
   */
  const useAdvancedDemo = () => {
    if (advancedDemoLoading) return;
    track({ name: "demo_start", variant: "advanced" });
    setAdvancedDemoLoading(true);
    setUploadError(null);
    Promise.all(
      ADVANCED_DEMO_FILES.map((f) =>
        fetch(ADVANCED_DEMO_BASE_PATH + f.name).then((r) => {
          if (!r.ok) throw new Error(`${f.name}: HTTP ${r.status}`);
          return r.text();
        })
      )
    )
      .then((contents) => {
        const loaded = ADVANCED_DEMO_FILES.map((f, i) => ({
          side: f.side,
          file: { id: `demo-${f.name}`, name: f.name, content: contents[i], sample: true } as LoadedFile,
        }));
        const pick = (side: UploadSide) => loaded.filter((l) => l.side === side).map((l) => l.file);
        fileContentsRef.current = { bank: pick("bank"), ledger: pick("ledger") };
        const meta = (f: LoadedFile): FileMeta => ({
          id: f.id,
          name: f.name,
          size: formatFileSize(new Blob([f.content]).size),
          rows: 0,
        });
        setFiles({ bank: pick("bank").map(meta), ledger: pick("ledger").map(meta) });
        setUsingSampleData(false);
        setUsingAdvancedDemo(true);
        setDemoTourHidden(false);
        confirmMapping(
          ADVANCED_DEMO_FILES.map((f) => ({ fileId: `demo-${f.name}`, map: f.map, headerRow: f.headerRow }))
        );
      })
      .catch((err) => {
        console.error(err);
        setUploadError("The demo files couldn't be loaded. Check your connection and try again.");
      })
      .finally(() => setAdvancedDemoLoading(false));
  };

  const startAnalysis = () => {
    const { bank, ledger } = fileContentsRef.current;
    if (bank.length === 0 || ledger.length === 0) return;
    setMappingError(null);
    const inspect = (side: UploadSide) => (f: LoadedFile): MappingFile => ({
      id: f.id,
      side,
      name: f.name,
      inspection: inspectCsv(f.content),
    });
    setMappingFiles([...bank.map(inspect("bank")), ...ledger.map(inspect("ledger"))]);
    setScreen("mapping");
  };

  /** The user picked a different header row for one file — re-read its titles. */
  const changeHeaderRow = (fileId: string, headerRow: number) => {
    const loaded = [...fileContentsRef.current.bank, ...fileContentsRef.current.ledger].find(
      (f) => f.id === fileId
    );
    if (!loaded) return;
    setMappingError(null);
    setMappingFiles((prev) =>
      prev
        ? prev.map((f) =>
            f.id === fileId
              ? { ...f, inspection: inspectCsv(loaded.content, 3, { headerRow }) }
              : f
          )
        : prev
    );
  };

  /** Zero parsed rows means the mapping or file is wrong — explain why. */
  const describeParseFailure = (label: string, file: ImportedFile): string | null => {
    if (file.rowCount > 0) return null;
    const d = file.diagnostics;
    const detail =
      d.csvErrors[0] ??
      d.warnings[0] ??
      d.issues[0]?.reason ??
      (d.totalDataRows === 0 ? "the file has no data rows" : "no rows could be read");
    return `No transactions could be read from the ${label} (${detail}). Check the column mapping and the file.`;
  };

  /** Non-fatal diagnostics the user must see before trusting the results. */
  const collectParseNotices = (label: string, file: ImportedFile): string[] => {
    const d = file.diagnostics;
    const notices: string[] = [];
    if (d.issueCount > 0) {
      const examples = d.issues
        .slice(0, 3)
        .map((i) => `line ${i.line}: ${i.reason}`)
        .join("; ");
      notices.push(
        `${label}: ${d.issueCount} row${d.issueCount === 1 ? "" : "s"} skipped (${examples}${d.issueCount > 3 ? "; …" : ""}). These transactions are NOT included.`
      );
    }
    if (d.csvErrors.length > 0) {
      notices.push(`${label}: file structure problems — ${d.csvErrors[0]}`);
    }
    for (const w of d.warnings) notices.push(`${label}: ${w}`);
    if (d.dateOrder === "day-first") {
      notices.push(`${label}: dates read as day-first (DD/MM/YYYY).`);
    }
    if (d.decimalStyle === "comma") {
      notices.push(`${label}: amounts read with European decimal commas (1.234,56).`);
    }
    return notices;
  };

  const confirmMapping = (configs: FileImportConfig[]) => {
    const importSide = (side: UploadSide): CombinedImport | null => {
      const loaded = fileContentsRef.current[side];
      const inputs = loaded.flatMap((f) => {
        const c = configs.find((x) => x.fileId === f.id);
        return c ? [{ name: f.name, content: f.content, map: c.map, headerRow: c.headerRow }] : [];
      });
      // Every uploaded file must have a confirmed mapping — never drop one.
      if (inputs.length === 0 || inputs.length !== loaded.length) return null;
      return combineFiles(side, inputs);
    };
    const bankImport = importSide("bank");
    const ledgerImport = importSide("ledger");
    if (bankImport && ledgerImport) {
      // With one file per side the wording is exactly what it always was;
      // with several, every message names the file it is about.
      const sideName = { bank: "bank statement", ledger: "ledger" } as const;
      const sideTitle = { bank: "Bank statement", ledger: "Ledger" } as const;
      const all = [bankImport, ledgerImport];
      const failureLabel = (imp: CombinedImport, f: ImportedFile) =>
        imp.files.length > 1 ? `${sideName[f.side]} file "${f.name}"` : sideName[f.side];
      const noticeLabel = (imp: CombinedImport, f: ImportedFile) =>
        imp.files.length > 1 ? `${sideTitle[f.side]} · ${f.name}` : sideTitle[f.side];

      // A file that yields zero transactions must never flow into the
      // engine — reconcile([], []) reports "fully reconciled" over nothing,
      // and with several files a silently-empty month would look like a
      // clean one.
      let failure: string | null = null;
      for (const imp of all) {
        for (const f of imp.files) {
          failure = failure ?? describeParseFailure(failureLabel(imp, f), f);
        }
      }
      if (failure) {
        setMappingError(failure);
        return; // stay on the mapping screen
      }
      setMappingError(null);

      const notices: string[] = [];
      for (const imp of all) {
        for (const f of imp.files) notices.push(...collectParseNotices(noticeLabel(imp, f), f));
        for (const o of imp.overlaps) {
          const range =
            o.start === o.end ? formatPeriod(o.start, o.end).split(" – ")[1] : formatPeriod(o.start, o.end);
          notices.push(
            `${sideTitle[o.side]}: "${o.fileA}" and "${o.fileB}" both cover ${range}. Nothing was removed — rows that appear in both files are listed under "Repeated rows in your files", where you can see which were set aside and which need your decision.`
          );
        }
      }

      // Duplicate detection runs per side, on everything imported. Only
      // copies the files themselves prove (transaction ID, running balance,
      // or reference + description) are set aside; they stay in the import
      // and can be restored. The engine then sees the rows in use.
      const importedRows: ImportedRows = { bank: bankImport.txns, ledger: ledgerImport.txns };
      const groups = [
        ...detectDuplicates("bank", importedRows.bank),
        ...detectDuplicates("ledger", importedRows.ledger),
      ];
      const dupState = initialDuplicateState(groups, new Date().toISOString());
      if (dupState.setAside.length > 0) {
        const n = dupState.setAside.length;
        notices.push(
          `${n} repeated ${n === 1 ? "row was" : "rows were"} set aside automatically because your files prove ${n === 1 ? "it is a copy" : "they are copies"} of ${n === 1 ? "a row" : "rows"} already imported. ${n === 1 ? "It is" : "They are"} not counted below; see "Repeated rows in your files" to review or restore ${n === 1 ? "it" : "them"}.`
        );
      }
      setParseNotices(notices);

      const bankTxns = activeTxns(importedRows.bank, dupState);
      const ledgerTxns = activeTxns(importedRows.ledger, dupState);
      const result = reconcile(bankTxns, ledgerTxns);
      const importedFiles: SourceFileInfo[] = all.flatMap((imp) =>
        imp.files.map((f) => ({
          side: f.side,
          name: f.name,
          rows: f.rowCount,
          headerRow: f.headerRow,
          periodStart: f.coverage?.start ?? null,
          periodEnd: f.coverage?.end ?? null,
          statementStart: f.diagnostics.statementPeriod?.start ?? null,
          statementEnd: f.diagnostics.statementPeriod?.end ?? null,
          skippedRows: f.diagnostics.issueCount,
          invalidDateRows: f.diagnostics.invalidDateRows,
          statementOpening: f.diagnostics.statement.opening,
          statementClosing: f.diagnostics.statement.closing,
          statementAmbiguities: f.diagnostics.statement.ambiguities,
          ...(f.diagnostics.statement.owedIndication
            ? { statementOwedIndication: f.diagnostics.statement.owedIndication }
            : {}),
        }))
      );
      reconCacheRef.current = {
        bankTxns,
        ledgerTxns,
        result,
        sourceFiles: importedFiles,
        imported: importedRows,
        duplicateState: dupState,
      };
      const autoMatched = result.matches.filter((m) => m.status === "accepted").length;
      const differences =
        result.missingFromBooks.length +
        result.missingFromBank.length +
        result.matches.filter((m) => m.status === "suggested").length +
        result.compositeMatches.length;
      setReconCounts({ totalTxns: bankTxns.length + ledgerTxns.length, autoMatched, differences });
    }
    setScreen("processing");
  };

  const onProcessed = useCallback(() => {
    const cached = reconCacheRef.current;
    if (!cached) {
      // Sample data path: no uploaded files, jump straight to dashboard.
      setAnalyzed(true);
      setScreen("dashboard");
      return;
    }
    const { bankTxns, ledgerTxns, result, sourceFiles: imported } = cached;

    const withRows = (side: UploadSide) => (m: FileMeta): FileMeta => ({
      ...m,
      rows: imported.find((f) => f.side === side && f.name === m.name)?.rows ?? m.rows,
    });
    setFiles((f) => ({ bank: f.bank.map(withRows("bank")), ledger: f.ledger.map(withRows("ledger")) }));
    setSourceFiles(imported);
    setImported(cached.imported);
    setDuplicateState(cached.duplicateState);
    setEngineOutput({
      bankTxns,
      ledgerTxns,
      baseMissingFromBooks: result.missingFromBooks,
      baseMissingFromBank: result.missingFromBank,
      balanceProof: result.balanceProof,
    });
    setCopilotRunId((n) => n + 1);
    setMatches(result.matches);
    setCompositeMatches(result.compositeMatches);
    if (result.compositeMatches.length > 0) {
      console.log(
        `[Reconly] ${result.compositeMatches.length} composite match(es) found:`,
        result.compositeMatches
      );
    }
    setAnalyzed(true);
    // A fresh engine run from uploaded files is ALWAYS a new reconciliation —
    // never leave it bound to a record that happened to be open before (which
    // would make "Save changes" silently overwrite that record and show its
    // account/period label over this new data).
    setCurrentRecordId(null);
    setScreen("dashboard");
    // Customer-validation signal: a reconciliation reached Results. Only an
    // enum leaves this line (see lib/analytics) — never file names or data.
    const loadedFiles = [...fileContentsRef.current.bank, ...fileContentsRef.current.ledger];
    track({
      name: "results_view",
      source: loadedFiles.some((f) => f.id.startsWith("demo-"))
        ? "advanced_demo"
        : loadedFiles.length > 0 && loadedFiles.every((f) => f.sample)
          ? "sample"
          : "own_files",
    });
  }, []);

  const startOver = () => {
    fileContentsRef.current = { bank: [], ledger: [] };
    reconCacheRef.current = null;
    setReconCounts(null);
    setFiles({ bank: [], ledger: [] });
    setMappingFiles(null);
    setSourceFiles([]);
    setImported(null);
    setDuplicateState(EMPTY_DUPLICATE_STATE);
    setEngineOutput(null);
    setMatches([]);
    setCompositeMatches([]);
    setUserAddedEntries([]);
    setAcknowledgedBankIds([]);
    setAnalyzed(false);
    setCurrentRecordId(null);
    setSaveStatus("idle");
    setUsingSampleData(false);
    setUsingAdvancedDemo(false);
    setUploadError(null);
    setMappingError(null);
    setParseNotices([]);
    setScreen("upload");
  };

  // ---- Review decision handler (one-to-one + composite) ---------------
  // The decision logic itself lives in lib/recon/decisions (pure, tested).
  // `itemId` is the item the user was looking at when they clicked; the
  // review card animates out before this fires, so acting on "whatever is
  // first in the queue now" could apply the decision to a different item.
  // The Review screen calls this synchronously on click — before any exit
  // animation — so the decision is in authoritative state even if the user
  // navigates away (Results, browser Back) a moment later. The *Once
  // helpers ignore an item that is no longer pending, so a double-click or
  // a stale handler can never record a second, different decision.
  const decide = (decision: ReviewDecision, meta?: ReviewMeta, itemId?: string) => {
    const currentReviewItems = dashboardData?.reviewItems ?? [];
    const current = itemId
      ? currentReviewItems.find((i) => i.id === itemId)
      : currentReviewItems[0];
    if (!current) return;
    if ("matchType" in current && current.matchType === "composite") {
      setCompositeMatches((cs) =>
        decideCompositeOnce(cs, current.id, decision, meta?.pickedCombination)
      );
      return;
    }
    setMatches((ms) => decideMatchOnce(ms, current.id, decision));
  };

  /**
   * Take back a review decision: the suggestion returns to the review
   * queue. Nothing is re-matched differently — for a grouped match the
   * unchanged engine is re-run over the same rows only to recover the
   * original suggestion (including options that were not picked).
   */
  const undoDecision = (id: string) => {
    if (!engineOutput) return;
    const bankIds = new Set<string>();
    const ledgerIds = new Set<string>();
    const composite = compositeMatches.find((c) => c.id === id);
    if (composite) {
      const fresh = reconcile(engineOutput.bankTxns, engineOutput.ledgerTxns).compositeMatches;
      const next = undoCompositeDecision(compositeMatches, id, fresh);
      const restored = next.find((c) => c.id === id);
      bankIds.add(composite.bankTxnId);
      for (const l of [...composite.ledgerTxnIds, ...(restored?.ledgerTxnIds ?? [])]) ledgerIds.add(l);
      setCompositeMatches(next);
    } else {
      const match = matches.find((m) => m.id === id);
      if (!match) return;
      bankIds.add(match.bankTxnId);
      ledgerIds.add(match.ledgerTxnId);
      setMatches((ms) => undoMatchDecision(ms, id));
    }
    // A row that is back in a pending suggestion cannot also be "added to
    // the reconciliation" or "marked as expected" — that would count it twice.
    setUserAddedEntries((prev) => prev.filter((e) => !bankIds.has(e.txnId)));
    setAcknowledgedBankIds((prev) => prev.filter((x) => !ledgerIds.has(x)));
  };

  // ---- Missing-item resolution handlers ----------------------------

  const handleAddToBooks = (tx: MissingTxn) => {
    if (!engineOutput) return;
    // Look up in ALL bank txns, not just the engine's base missing list —
    // the "Not in your records" list also contains bank txns from matches
    // the user rejected, and those must be addable too.
    const original = engineOutput.bankTxns.find((t) => t.id === tx.txnId);
    if (!original) return;
    setUserAddedEntries((prev) =>
      prev.some((e) => e.txnId === original.id)
        ? prev // already added — never double-count
        : [
            ...prev,
            {
              id: generateId(),
              txnId: original.id,
              date: original.date,
              description: original.description,
              amount: original.amount,
            },
          ]
    );
  };

  const handleRemoveAdded = (txnId: string) => {
    setUserAddedEntries((prev) => prev.filter((e) => e.txnId !== txnId));
  };

  const handleAcknowledgeBank = (tx: MissingTxn) => {
    setAcknowledgedBankIds((prev) =>
      prev.includes(tx.txnId) ? prev : [...prev, tx.txnId]
    );
  };

  const handleUnacknowledgeBank = (txnId: string) => {
    setAcknowledgedBankIds((prev) => prev.filter((id) => id !== txnId));
  };

  // ---- Duplicate review handlers ------------------------------------
  // Setting a row aside or restoring it changes which rows are in use, so
  // the (unchanged) engine is run again over the rows in use. Decisions the
  // user already made are kept wherever the same pairing still exists.
  const applyDuplicateState = (next: DuplicateState) => {
    if (!imported || next === duplicateState) return;
    const bankTxns = activeTxns(imported.bank, next);
    const ledgerTxns = activeTxns(imported.ledger, next);
    if (bankTxns.length === 0 || ledgerTxns.length === 0) return; // never empty a side
    const result = reconcile(bankTxns, ledgerTxns);
    const bankIds = new Set(bankTxns.map((t) => t.id));
    const ledgerIds = new Set(ledgerTxns.map((t) => t.id));
    setEngineOutput({
      bankTxns,
      ledgerTxns,
      baseMissingFromBooks: result.missingFromBooks,
      baseMissingFromBank: result.missingFromBank,
      balanceProof: result.balanceProof,
    });
    setMatches((current) => restoreMatches(result.matches, current));
    setCompositeMatches((current) => restoreComposites(result.compositeMatches, current));
    setUserAddedEntries((prev) => prev.filter((e) => bankIds.has(e.txnId)));
    setAcknowledgedBankIds((prev) => prev.filter((id) => ledgerIds.has(id)));
    setDuplicateState(next);
  };

  const handleSetAsideDuplicates = (txnIds: string[]) =>
    applyDuplicateState(setAsideRows(duplicateState, txnIds, "user", new Date().toISOString()));
  const handleRestoreDuplicates = (txnIds: string[]) =>
    applyDuplicateState(restoreRows(duplicateState, txnIds, new Date().toISOString()));
  // "They're separate" changes no totals — it only records the decision.
  const handleDismissDuplicateGroup = (groupId: string, dismissed: boolean) =>
    setDuplicateState((s) => dismissGroup(s, groupId, dismissed, new Date().toISOString()));

  // ---- Persistence handlers ----------------------------------------

  /** Re-open a saved reconciliation: restore engine state and show dashboard. */
  const openFromHistory = (record: ReconciliationRecord) => {
    // Re-run the deterministic engine to get the base unmatched lists,
    // then overlay the saved match statuses on top.
    // A record stores EVERY imported row plus which were set aside. Records
    // saved before duplicate detection existed have no duplicate state, so
    // nothing is set aside on open — a saved reconciliation's totals never
    // change just because it was reopened in a newer version.
    const importedRows: ImportedRows = { bank: record.bankTxns, ledger: record.ledgerTxns };
    const dupState = sanitizeDuplicateState(
      record.duplicateState,
      new Set([...record.bankTxns, ...record.ledgerTxns].map((t) => t.id))
    );
    const activeBank = activeTxns(importedRows.bank, dupState);
    const activeLedger = activeTxns(importedRows.ledger, dupState);
    const result = reconcile(activeBank, activeLedger);
    const restoredMatches = restoreMatches(result.matches, record.matches);
    setImported(importedRows);
    setDuplicateState(dupState);
    setEngineOutput({
      bankTxns: activeBank,
      ledgerTxns: activeLedger,
      baseMissingFromBooks: result.missingFromBooks,
      baseMissingFromBank: result.missingFromBank,
      balanceProof: result.balanceProof,
    });
    setCopilotRunId((n) => n + 1);
    setMatches(restoredMatches);
    // Restore saved composite decisions if available; otherwise use fresh engine output.
    setCompositeMatches(
      restoreComposites(result.compositeMatches, record.compositeMatches ?? [])
    );
    setUserAddedEntries(record.userAddedEntries ?? []);
    setAcknowledgedBankIds(record.acknowledgedBankIds ?? []);
    setSourceFiles(record.sourceFiles ?? []);
    // A saved copy of the demo stays labelled as fictional when reopened.
    setUsingAdvancedDemo(record.sampleData === true);
    setUsingSampleData(false);
    setParseNotices([]);
    setCurrentRecordId(record.id);
    setAnalyzed(true);
    setScreen("dashboard");
  };

  /** Save a brand-new reconciliation (called from SaveDialog). */
  const handleSaveFromDialog = (values: SaveFormValues) => {
    if (!engineOutput) return;
    const id = generateId();
    const now = new Date().toISOString();
    const openingBalance = Math.round((parseFloat(values.openingBalance) || 0) * 100);
    // Demo data is always saved under a name that says it is sample data.
    const typedName = values.accountName.trim();
    const accountName =
      usingAdvancedDemo && !/^sample data\b/i.test(typedName)
        ? `Sample data — ${typedName}`
        : typedName;
    const record: ReconciliationRecord = {
      id,
      createdAt: now,
      updatedAt: now,
      accountName,
      ...(usingAdvancedDemo ? { sampleData: true } : {}),
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
      openingBalance,
      closingBalance: openingBalance + engineOutput.balanceProof.bankNetChange,
      // Persist what the user SEES (live, decision-adjusted values), not the
      // raw first-pass engine output — History must agree with the dashboard.
      status: deriveStatus(
        liveBalanceProof?.unexplainedDifference ?? engineOutput.balanceProof.unexplainedDifference,
        matches,
        compositeMatches,
        openItemCount,
        unresolvedDuplicateGroups,
        verdict?.statementFilesNeedingReview ?? 0
      ),
      unexplainedDifference:
        liveBalanceProof?.unexplainedDifference ?? engineOutput.balanceProof.unexplainedDifference,
      // Every imported row is stored; `duplicateState` says which are set aside.
      bankTxns: imported?.bank ?? engineOutput.bankTxns,
      ledgerTxns: imported?.ledger ?? engineOutput.ledgerTxns,
      matches,
      compositeMatches,
      userAddedEntries,
      acknowledgedBankIds,
      sourceFiles,
      duplicateState,
    };
    setSaveStatus("saving");
    repository
      .saveReconciliation(record)
      .then(() => {
        setCurrentRecordId(id);
        return repository.listReconciliations();
      })
      .then((records) => {
        setSavedRecords(records);
        flashSaved();
      })
      .catch((err) => {
        console.error(err);
        setSaveStatus("error");
      });
    setSaveDialogOpen(false);
  };

  /** Update an already-saved reconciliation with the current working state. */
  const saveCurrentChanges = () => {
    if (!engineOutput || !currentRecordId) return;
    const existing = savedRecords.find((r) => r.id === currentRecordId);
    if (!existing) return;
    const now = new Date().toISOString();
    const record: ReconciliationRecord = {
      ...existing,
      updatedAt: now,
      closingBalance: existing.openingBalance + engineOutput.balanceProof.bankNetChange,
      // Live values, same as handleSaveFromDialog — see comment there.
      status: deriveStatus(
        liveBalanceProof?.unexplainedDifference ?? engineOutput.balanceProof.unexplainedDifference,
        matches,
        compositeMatches,
        openItemCount,
        unresolvedDuplicateGroups,
        verdict?.statementFilesNeedingReview ?? 0
      ),
      unexplainedDifference:
        liveBalanceProof?.unexplainedDifference ?? engineOutput.balanceProof.unexplainedDifference,
      // Every imported row is stored; `duplicateState` says which are set aside.
      bankTxns: imported?.bank ?? engineOutput.bankTxns,
      ledgerTxns: imported?.ledger ?? engineOutput.ledgerTxns,
      matches,
      compositeMatches,
      userAddedEntries,
      acknowledgedBankIds,
      sourceFiles,
      duplicateState,
    };
    setSaveStatus("saving");
    repository
      .saveReconciliation(record)
      .then(() => repository.listReconciliations())
      .then((records) => {
        setSavedRecords(records);
        flashSaved();
      })
      .catch((err) => {
        console.error(err);
        setSaveStatus("error");
      });
  };

  /** Called from TopBar save button. */
  const handleSaveClick = () => {
    if (currentRecordId) {
      saveCurrentChanges();
    } else {
      setSaveDialogOpen(true);
    }
  };

  /** Build the shared export context from current in-memory state. */
  const buildExportContext = () => {
    if (!engineOutput) return null;
    const allTxns = [...engineOutput.bankTxns, ...engineOutput.ledgerTxns];
    const period = inferPeriod(allTxns);
    return {
      accountName:
        currentRecord?.accountName ??
        (usingAdvancedDemo ? ADVANCED_DEMO_ACCOUNT_LABEL : "Unsaved reconciliation"),
      periodStart: currentRecord?.periodStart ?? period?.start ?? "",
      periodEnd:   currentRecord?.periodEnd   ?? period?.end   ?? "",
      openingBalance: currentRecord?.openingBalance ?? null,
      closingBalance: currentRecord?.closingBalance ?? null,
      reconciled,
      unexplainedDifference: liveBalanceProof?.unexplainedDifference ?? engineOutput.balanceProof.unexplainedDifference,
      bankTxns:  engineOutput.bankTxns,
      ledgerTxns: engineOutput.ledgerTxns,
      matches,
      compositeMatches,
      userAddedEntries,
      acknowledgedBankIds,
      ...(monthReview && statementReview
        ? { review: { months: monthReview, statements: statementReview } }
        : {}),
      ...(imported
        ? {
            duplicates: {
              allBankTxns: imported.bank,
              allLedgerTxns: imported.ledger,
              groups: duplicateGroups,
              state: duplicateState,
            },
          }
        : {}),
    };
  };

  /** Trigger PDF download from current in-memory state. Returns a promise for ExportMenu. */
  const handleExportPdf = (): Promise<void> => {
    const ctx = buildExportContext();
    if (!ctx) return Promise.resolve();
    return downloadPdfReport(ctx);
  };

  /** Trigger Excel download from current in-memory state. Returns a promise for ExportMenu. */
  const handleExportExcel = (): Promise<void> => {
    const ctx = buildExportContext();
    if (!ctx) return Promise.resolve();
    return downloadExcelWorksheet(ctx);
  };

  // ---- Sidebar navigation ------------------------------------------
  // Clicking the "Upload files" step once a reconciliation is already loaded
  // means "start a new one" — give a clean slate instead of dropping the user
  // back into the previous reconciliation's files and review progress. Other
  // steps (Results / Review / History) just switch screens.
  const navigate = (s: Screen) => {
    setMenuOpen(false); // choosing a destination closes the phone drawer
    if (s === "upload" && analyzed) {
      startOver();
    } else {
      setScreen(s);
    }
  };

  // COPILOT_MOUNT — explain-only chat panel over the in-memory recon result.
  // Context is rebuilt from live state on every question, so the copilot
  // always reflects the latest accept/reject decisions. The builder masks
  // descriptions and whitelists fields before anything leaves the browser.
  const getCopilotContext = useCallback(() => {
    if (!engineOutput || !liveBalanceProof) return null;
    return buildReconContext({
      matches,
      compositeMatches,
      bankTxns: engineOutput.bankTxns,
      ledgerTxns: engineOutput.ledgerTxns,
      baseMissingFromBooks: engineOutput.baseMissingFromBooks,
      baseMissingFromBank: engineOutput.baseMissingFromBank,
      userAddedEntries,
      acknowledgedBankIds,
      balanceProof: liveBalanceProof,
      reconciled,
      periodLabel,
      duplicatesSetAside: duplicateState.setAside.length,
      verdict: verdict ?? undefined,
      duplicateGroupCount: duplicateGroups.length,
    });
  }, [
    engineOutput,
    liveBalanceProof,
    matches,
    compositeMatches,
    userAddedEntries,
    acknowledgedBankIds,
    reconciled,
    periodLabel,
    duplicateState,
    verdict,
    duplicateGroups,
  ]);

  // Shown only on the results screens (dashboard/review) of an analyzed run.
  const copilotVisible =
    analyzed && engineOutput !== null && (screen === "dashboard" || screen === "review");

  // /app/demo: start the Advanced Demo once. The ref keeps it to a single
  // run (React may re-run effects in development); the demo then behaves
  // exactly as if the "Explore advanced demo" button had been pressed.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStart !== "advanced-demo" || autoStartedRef.current) return;
    autoStartedRef.current = true;
    useAdvancedDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {screen !== "processing" && (
        <Sidebar
          screen={screen}
          analyzed={analyzed}
          go={navigate}
          historyCount={savedRecords.length}
          accountName={currentRecord?.accountName ?? null}
          periodLabel={periodLabel}
          showSampleBanner={usingSampleData || usingAdvancedDemo}
          sampleBannerText={
            usingAdvancedDemo
              ? "All financial data here is fictional. Nothing is saved unless you choose to."
              : undefined
          }
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
        />
      )}

      <div
        style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        {screen !== "processing" && (
          <TopBar
            screen={screen}
            title={topBarTitle}
            subtitle={topBarSubtitle}
            analyzed={analyzed}
            hasSavedRecord={Boolean(currentRecordId)}
            saveStatus={saveStatus}
            menuOpen={menuOpen}
            onOpenMenu={() => setMenuOpen(true)}
            onStartOver={startOver}
            onSave={handleSaveClick}
            onExportPdf={handleExportPdf}
            onExportExcel={handleExportExcel}
          />
        )}

        <main style={{ flex: 1, overflowY: "auto" }}>
          <div
            className="app-main-inner"
            style={{
              maxWidth: screen === "dashboard" ? 980 : 1040,
              margin: "0 auto",
              padding: screen === "processing" ? 0 : "26px 28px 60px",
            }}
          >
            {screen === "upload" && (
              <UploadScreen
                files={files}
                periodLabel={todayLabel}
                onPick={pickFile}
                onRemove={removeFile}
                onSample={useSample}
                onAdvancedDemo={useAdvancedDemo}
                advancedDemoLoading={advancedDemoLoading}
                onStart={startAnalysis}
                errorMessage={uploadError}
              />
            )}

            {screen === "mapping" && mappingFiles && (
              <MappingScreen
                files={mappingFiles}
                onHeaderRowChange={changeHeaderRow}
                onBack={() => setScreen("upload")}
                onConfirm={confirmMapping}
                errorMessage={mappingError}
              />
            )}

            {screen === "processing" && (
              <ProcessingScreen onComplete={onProcessed} counts={reconCounts} />
            )}

            {usingAdvancedDemo && dashboardData && (screen === "dashboard" || screen === "review") && (
              <DemoBanner tourHidden={demoTourHidden} onShowTour={() => { setDemoTourHidden(false); setScreen("dashboard"); }} />
            )}

            {usingAdvancedDemo && screen === "dashboard" && dashboardData && !demoTourHidden && (
              <DemoTourPanel onDismiss={() => setDemoTourHidden(true)} onOpenReview={() => setScreen("review")} />
            )}

            {screen === "dashboard" && dashboardData && parseNotices.length > 0 && (
              <div
                data-testid="parse-notices"
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  padding: "12px 16px",
                  marginBottom: 18,
                  fontSize: 13,
                  color: "var(--warn-ink, #7a5b00)",
                  background: "var(--warn-soft, #fdf6e3)",
                  border: "1px solid var(--warn, #e7d39a)",
                  borderRadius: "var(--r-md, 10px)",
                }}
              >
                <Icon name="alert" size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>
                    Check your files — some rows couldn&apos;t be read or needed assumptions
                  </div>
                  {parseNotices.map((n, i) => (
                    <div key={i}>{n}</div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setParseNotices([])}
                  aria-label="Dismiss"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "inherit",
                    padding: 2,
                  }}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            )}

            {screen === "dashboard" && dashboardData && (
              <DashboardScreen
                counts={dashboardData.counts}
                reconciled={reconciled}
                verdict={verdict ?? undefined}
                monthReview={monthReview ?? undefined}
                statementReview={statementReview ?? undefined}
                unexplained={unexplained}
                balanceProof={liveBalanceProof ?? undefined}
                reviewItems={dashboardData.reviewItems}
                matched={dashboardData.matched}
                matchedExtraCount={dashboardData.matchedExtraCount}
                missingFromBooks={dashboardData.missingFromBooks}
                addedToReconciliation={dashboardData.addedToReconciliation}
                missingFromBank={dashboardData.missingFromBank}
                acknowledgedBank={dashboardData.acknowledgedBank}
                onOpenReview={() => setScreen("review")}
                onAddToBooks={handleAddToBooks}
                onRemoveAdded={handleRemoveAdded}
                onAcknowledgeMissingBank={handleAcknowledgeBank}
                onUnacknowledgeMissingBank={handleUnacknowledgeBank}
                amountHints={amountHints}
                decided={dashboardData.decided}
                onUndoDecision={undoDecision}
                duplicates={
                  imported
                    ? {
                        groups: duplicateGroups,
                        state: duplicateState,
                        imported,
                        overlaps: importOverlaps,
                        onSetAside: handleSetAsideDuplicates,
                        onRestore: handleRestoreDuplicates,
                        onDismiss: handleDismissDuplicateGroup,
                      }
                    : undefined
                }
              />
            )}

            {screen === "review" && dashboardData && (
              <ReviewScreen
                queue={dashboardData.reviewItems}
                total={reviewProgress(matches, compositeMatches).total}
                onDecide={decide}
                onBack={() => setScreen("dashboard")}
              />
            )}

            {screen === "history" && (
              <HistoryScreen
                records={savedRecords}
                onOpen={openFromHistory}
              />
            )}
          </div>
        </main>
      </div>

      <SaveDialog
        open={saveDialogOpen}
        initialValues={saveDialogInitialValues}
        onSave={handleSaveFromDialog}
        onCancel={() => setSaveDialogOpen(false)}
        sampleData={usingAdvancedDemo}
      />

      {copilotVisible && (
        <CopilotPanel key={copilotRunId} getContext={getCopilotContext} />
      )}
    </div>
  );
}
