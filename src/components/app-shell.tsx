"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sampleData, type FileMeta, type MissingTxn, type UserAddedEntry } from "@/lib/sample-data";
import { parseCsv, inspectCsv, type CsvColumnMap, type CsvInspection } from "@/lib/parser";
import { reconcile } from "@/lib/recon";
import { buildDashboardData, unexplainedCents } from "@/lib/recon/adapter";
import type {
  Match,
  Txn,
  BalanceProof,
  MatchStatus,
  AnyCompositeMatch,
  ReconResult,
} from "@/lib/recon/types";
import { Icon } from "@/components/ui/icon";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import {
  UploadScreen,
  type UploadFiles,
  type UploadSide,
} from "@/components/screens/upload-screen";
import { MappingScreen } from "@/components/screens/mapping-screen";
import { ProcessingScreen, type ReconCounts } from "@/components/screens/processing-screen";
import { DashboardScreen } from "@/components/screens/dashboard-screen";
import { ReviewScreen, type ReviewDecision, type ReviewMeta } from "@/components/screens/review-screen";
import { HistoryScreen } from "@/components/screens/history-screen";
import { repository } from "@/lib/data/indexeddb-repository";
import type { ReconciliationRecord } from "@/lib/data/repository";
import { generateId, inferPeriod, formatPeriod, deriveStatus } from "@/lib/data/utils";
import { downloadPdfReport } from "@/lib/export/pdf-report";
import { downloadExcelWorksheet } from "@/lib/export/excel-worksheet";

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
}: {
  open: boolean;
  initialValues: SaveFormValues;
  onSave: (values: SaveFormValues) => void;
  onCancel: () => void;
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
}: {
  screen: Screen;
  analyzed: boolean;
  go: (s: Screen) => void;
  historyCount: number;
  /** Saved record's account name; null while the session is unsaved. */
  accountName: string | null;
  periodLabel: string;
  showSampleBanner: boolean;
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
      )}
    </aside>
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
    try {
      await (kind === "pdf" ? onPdf() : onExcel());
    } finally {
      setGenerating("idle");
    }
  };

  const busy = generating !== "idle";
  const label = generating === "pdf"
    ? "Generating PDF…"
    : generating === "excel"
    ? "Generating…"
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
}: {
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
          {subtitle}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
export function AppShell() {
  const [screen, setScreen] = useState<Screen>("upload");
  const [analyzed, setAnalyzed] = useState(false);
  const [files, setFiles] = useState<UploadFiles>({ bank: null, ledger: null });

  const fileContentsRef = useRef<{ bank: string | null; ledger: string | null }>({
    bank: null,
    ledger: null,
  });

  const [engineOutput, setEngineOutput] = useState<EngineOutput | null>(null);

  const [inspections, setInspections] = useState<{
    bank: CsvInspection;
    ledger: CsvInspection;
  } | null>(null);
  const confirmedMapsRef = useRef<{ bank: CsvColumnMap; ledger: CsvColumnMap } | null>(null);
  const reconCacheRef = useRef<{ bankTxns: Txn[]; ledgerTxns: Txn[]; result: ReconResult } | null>(null);
  const [reconCounts, setReconCounts] = useState<ReconCounts | null>(null);

  const [matches, setMatches] = useState<Match[]>([]);
  const [compositeMatches, setCompositeMatches] = useState<AnyCompositeMatch[]>([]);
  const [userAddedEntries, setUserAddedEntries] = useState<UserAddedEntry[]>([]);
  const [acknowledgedBankIds, setAcknowledgedBankIds] = useState<string[]>([]);

  // True only while the built-in sample CSVs are loaded — gates the
  // "Sample workspace" disclaimer so it never shows over real uploads.
  const [usingSampleData, setUsingSampleData] = useState(false);

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
    // Each user-added entry explains part of the gap. Use absolute amounts so
    // adding any missing item (inflow or outflow) always shrinks the stated gap.
    const addedAbsSum = userAddedEntries.reduce((s, e) => s + Math.abs(e.amount), 0);
    const engineGap = engineOutput.balanceProof.unexplainedDifference;
    const gapSign = engineGap < 0 ? -1 : 1;
    const newUnexplained = gapSign * Math.max(0, Math.abs(engineGap) - addedAbsSum);
    return {
      ...engineOutput.balanceProof,
      clearedSum: oneToOneCleared + compositeCleared,
      unexplainedDifference: newUnexplained,
    };
  }, [matches, compositeMatches, userAddedEntries, engineOutput]);

  const reconciled = liveBalanceProof
    ? Math.abs(liveBalanceProof.unexplainedDifference) < 1
    : false;

  const unexplained = liveBalanceProof
    ? unexplainedCents(liveBalanceProof)
    : sampleData.unexplained;

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
      // No fake prefill — the user names their own account
      accountName: currentRecord?.accountName ?? "",
      periodStart: period?.start ?? "",
      periodEnd: period?.end ?? "",
      openingBalance: "0.00",
    };
  }, [engineOutput, currentRecord]);

  // ---- Upload handlers ------------------------------------------------
  const pickFile = (side: UploadSide, file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = (e.target?.result as string) ?? "";
      fileContentsRef.current = { ...fileContentsRef.current, [side]: content };
      const meta: FileMeta = { name: file.name, size: formatFileSize(file.size), rows: 0 };
      setFiles((f) => ({ ...f, [side]: meta }));
      setUsingSampleData(false); // a real file replaces the sample pair
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
        setUsingSampleData(true);
      })
      .catch(console.error);
  };

  const startAnalysis = () => {
    const { bank: bankContent, ledger: ledgerContent } = fileContentsRef.current;
    if (!bankContent || !ledgerContent) return;
    setInspections({ bank: inspectCsv(bankContent), ledger: inspectCsv(ledgerContent) });
    setScreen("mapping");
  };

  const confirmMapping = (maps: { bank: CsvColumnMap; ledger: CsvColumnMap }) => {
    confirmedMapsRef.current = maps;
    const { bank: bankContent, ledger: ledgerContent } = fileContentsRef.current;
    if (bankContent && ledgerContent) {
      const bankTxns = parseCsv(bankContent, "bank", maps.bank);
      const ledgerTxns = parseCsv(ledgerContent, "ledger", maps.ledger);
      const result = reconcile(bankTxns, ledgerTxns);
      reconCacheRef.current = { bankTxns, ledgerTxns, result };
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
    const { bankTxns, ledgerTxns, result } = cached;

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
  }, []);

  const startOver = () => {
    fileContentsRef.current = { bank: null, ledger: null };
    confirmedMapsRef.current = null;
    reconCacheRef.current = null;
    setReconCounts(null);
    setFiles({ bank: null, ledger: null });
    setInspections(null);
    setEngineOutput(null);
    setMatches([]);
    setCompositeMatches([]);
    setUserAddedEntries([]);
    setAcknowledgedBankIds([]);
    setAnalyzed(false);
    setCurrentRecordId(null);
    setSaveStatus("idle");
    setUsingSampleData(false);
    setScreen("upload");
  };

  // ---- Review decision handler (one-to-one + composite) ---------------
  const decide = (decision: ReviewDecision, meta?: ReviewMeta) => {
    const currentReviewItems = dashboardData?.reviewItems ?? [];
    const current = currentReviewItems[0];
    if (!current) return;
    // Route composite items to the composite handler
    if ("matchType" in current && current.matchType === "composite") {
      if (decision === "manual") return; // composites don't support manual
      decideComposite(current.id, decision, meta?.pickedCombination);
      return;
    }
    const newStatus: MatchStatus =
      decision === "accept" ? "accepted" : decision === "reject" ? "rejected" : "manual";
    setMatches((ms) =>
      ms.map((m) => (m.id === current.id ? { ...m, status: newStatus } : m))
    );
  };

  // ---- Composite review decision handler ---------------------------
  // Called by the composite review UI (Phase 3). For unambiguous composites,
  // accept/reject works like one-to-one. Ambiguous accept additionally requires
  // a pickedCombination to resolve which ledger IDs are confirmed.
  const decideComposite = (
    compositeId: string,
    decision: "accept" | "reject",
    pickedCombination?: string[] // required when accepting an ambiguous composite
  ) => {
    setCompositeMatches((cs) =>
      cs.map((c): AnyCompositeMatch => {
        if (c.id !== compositeId) return c;
        if (decision === "reject") return { ...c, status: "rejected" } as AnyCompositeMatch;
        // Accepting: if ambiguous and a combination was picked, narrow ledgerTxnIds
        if (c.ambiguous && pickedCombination) {
          return {
            ...c,
            status: "accepted",
            ledgerTxnIds: pickedCombination,
            ambiguous: false,
            allCombinations: null,
          } as AnyCompositeMatch;
        }
        return { ...c, status: "accepted" } as AnyCompositeMatch;
      })
    );
  };

  // ---- Missing-item resolution handlers ----------------------------

  const handleAddToBooks = (tx: MissingTxn) => {
    if (!engineOutput) return;
    const original = engineOutput.baseMissingFromBooks.find((t) => t.id === tx.txnId);
    if (!original) return;
    setUserAddedEntries((prev) => [
      ...prev,
      {
        id: generateId(),
        txnId: original.id,
        date: original.date,
        description: original.description,
        amount: original.amount,
      },
    ]);
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

  // ---- Persistence handlers ----------------------------------------

  /** Re-open a saved reconciliation: restore engine state and show dashboard. */
  const openFromHistory = (record: ReconciliationRecord) => {
    // Re-run the deterministic engine to get the base unmatched lists,
    // then overlay the saved match statuses on top.
    const result = reconcile(record.bankTxns, record.ledgerTxns);
    const restoredMatches = result.matches.map((m) => {
      const saved = record.matches.find((s) => s.id === m.id);
      return saved ? { ...m, status: saved.status } : m;
    });
    setEngineOutput({
      bankTxns: record.bankTxns,
      ledgerTxns: record.ledgerTxns,
      baseMissingFromBooks: result.missingFromBooks,
      baseMissingFromBank: result.missingFromBank,
      balanceProof: result.balanceProof,
    });
    setMatches(restoredMatches);
    // Restore saved composite decisions if available; otherwise use fresh engine output.
    const savedComposites = record.compositeMatches ?? [];
    const restoredComposites = result.compositeMatches.map((c): AnyCompositeMatch => {
      const saved = savedComposites.find((s) => s.id === c.id);
      return saved ? ({ ...c, status: saved.status } as AnyCompositeMatch) : c;
    });
    setCompositeMatches(restoredComposites);
    setUserAddedEntries(record.userAddedEntries ?? []);
    setAcknowledgedBankIds(record.acknowledgedBankIds ?? []);
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
    const record: ReconciliationRecord = {
      id,
      createdAt: now,
      updatedAt: now,
      accountName: values.accountName.trim(),
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
      openingBalance,
      closingBalance: openingBalance + engineOutput.balanceProof.bankNetChange,
      status: deriveStatus(engineOutput.balanceProof.unexplainedDifference, matches, compositeMatches),
      unexplainedDifference: engineOutput.balanceProof.unexplainedDifference,
      bankTxns: engineOutput.bankTxns,
      ledgerTxns: engineOutput.ledgerTxns,
      matches,
      compositeMatches,
      userAddedEntries,
      acknowledgedBankIds,
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
      status: deriveStatus(engineOutput.balanceProof.unexplainedDifference, matches, compositeMatches),
      unexplainedDifference: engineOutput.balanceProof.unexplainedDifference,
      bankTxns: engineOutput.bankTxns,
      ledgerTxns: engineOutput.ledgerTxns,
      matches,
      compositeMatches,
      userAddedEntries,
      acknowledgedBankIds,
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
      accountName: currentRecord?.accountName ?? "Unsaved reconciliation",
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
    if (s === "upload" && analyzed) {
      startOver();
    } else {
      setScreen(s);
    }
  };

  // COPILOT_MOUNT — a chat panel attaching to the in-memory recon result
  // (matches, engineOutput) would be mounted here in a future phase.

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
          showSampleBanner={usingSampleData}
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
            onStartOver={startOver}
            onSave={handleSaveClick}
            onExportPdf={handleExportPdf}
            onExportExcel={handleExportExcel}
          />
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
                periodLabel={todayLabel}
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
              <ProcessingScreen onComplete={onProcessed} counts={reconCounts} />
            )}

            {screen === "dashboard" && dashboardData && (
              <DashboardScreen
                counts={dashboardData.counts}
                reconciled={reconciled}
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
              />
            )}

            {screen === "review" && dashboardData && (
              <ReviewScreen
                queue={dashboardData.reviewItems}
                total={
                  matches.filter((m) => m.type === "near" || m.type === "fuzzy")
                    .length +
                  compositeMatches.filter((c) => c.status === "suggested").length
                }
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
      />
    </div>
  );
}
