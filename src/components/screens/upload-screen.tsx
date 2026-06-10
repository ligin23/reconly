"use client";

import { useRef, useState } from "react";
import type { FileMeta } from "@/lib/sample-data";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

export type UploadSide = "bank" | "ledger";
export type UploadFiles = { bank: FileMeta | null; ledger: FileMeta | null };

function UploadCard({
  side,
  file,
  onPick,
  onRemove,
  testIdInput,
}: {
  side: UploadSide;
  file: FileMeta | null;
  /** Called with the selected File when the user picks or drops a CSV. */
  onPick: (file: File) => void;
  onRemove: () => void;
  testIdInput?: string;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isBank = side === "bank";
  const title = isBank ? "Bank statement" : "Ledger";
  const subtitle = isBank
    ? "The list of money in and out, from your bank."
    : "Your own record of what you earned and spent.";
  const icon = isBank ? "bank" : "book";

  if (file) {
    return (
      <div
        className="card"
        style={{
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          borderColor: "oklch(0.88 0.05 158)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                background: "var(--surface-2)",
                color: "var(--ink-2)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Icon name={icon} size={17} />
            </span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{subtitle}</div>
            </div>
          </div>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "var(--good)",
              color: "#fff",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Icon name="check" size={15} stroke={2.6} />
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "13px 14px",
            background: "var(--good-soft)",
            borderRadius: "var(--r-md)",
            border: "1px solid oklch(0.88 0.05 158)",
          }}
        >
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "var(--surface)",
              color: "var(--good-ink)",
              display: "grid",
              placeItems: "center",
              flex: "none",
            }}
          >
            <Icon name="file" size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: "var(--ink)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {file.name}
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--good-ink)" }}>
              {file.size}{file.rows > 0 ? ` · ${file.rows} rows` : ""} · ready
            </div>
          </div>
          <button
            type="button"
            onClick={onRemove}
            title="Remove file"
            style={{
              flex: "none",
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "1px solid transparent",
              background: "transparent",
              color: "var(--ink-3)",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface)";
              e.currentTarget.style.color = "var(--bad-ink)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--ink-3)";
            }}
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="card"
      style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "var(--surface-2)",
              color: "var(--ink-2)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Icon name={icon} size={17} />
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{subtitle}</div>
          </div>
        </div>
        <span className="chip">CSV</span>
      </div>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onPick(file);
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: "34px 20px",
          borderRadius: "var(--r-md)",
          cursor: "pointer",
          border: `1.5px dashed ${drag ? "var(--accent)" : "var(--line)"}`,
          background: drag ? "var(--accent-soft)" : "var(--surface-2)",
          transition: "background .15s, border-color .15s",
        }}
      >
        <span
          style={{
            width: 42,
            height: 42,
            borderRadius: "50%",
            background: "var(--surface)",
            border: "1px solid var(--line)",
            color: drag ? "var(--accent)" : "var(--ink-3)",
            display: "grid",
            placeItems: "center",
            transition: "color .15s",
          }}
        >
          <Icon name="upload" size={20} />
        </span>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
            Drop your CSV here
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>
            or <span style={{ color: "var(--accent-ink)", fontWeight: 600 }}>browse files</span>
          </div>
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        style={{ display: "none" }}
        data-testid={testIdInput}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          // Reset so the same file can be re-selected
          e.target.value = "";
        }}
      />
    </div>
  );
}

type UploadScreenProps = {
  files: UploadFiles;
  /** Current-month label, e.g. "June 2026". Empty until known (first client render). */
  periodLabel: string;
  /** Called with the actual File object when the user selects or drops a CSV. */
  onPick: (side: UploadSide, file: File) => void;
  onRemove: (side: UploadSide) => void;
  /** Load the built-in sample CSV pair. */
  onSample: () => void;
  onStart: () => void;
};

export function UploadScreen({ files, periodLabel, onPick, onRemove, onSample, onStart }: UploadScreenProps) {
  const ready = Boolean(files.bank && files.ledger);
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "12px 8px 40px" }}>
      <div style={{ textAlign: "center", marginBottom: 30 }}>
        <span className="eyebrow" style={{ color: "var(--accent-ink)" }}>
          New reconciliation{periodLabel ? ` · ${periodLabel}` : ""}
        </span>
        <h1
          className="serif"
          style={{
            fontSize: 38,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            margin: "12px 0 10px",
            lineHeight: 1.08,
          }}
        >
          Let&apos;s match your books to your bank.
        </h1>
        <p
          style={{
            fontSize: 16,
            color: "var(--ink-2)",
            maxWidth: 460,
            margin: "0 auto",
            textWrap: "pretty",
          }}
        >
          Drop in two files and we&apos;ll find what&apos;s different — in plain English, no
          accounting know-how needed.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <UploadCard
          side="bank"
          file={files.bank}
          onPick={(file) => onPick("bank", file)}
          onRemove={() => onRemove("bank")}
          testIdInput="bank-file-input"
        />
        <UploadCard
          side="ledger"
          file={files.ledger}
          onPick={(file) => onPick("ledger", file)}
          onRemove={() => onRemove("ledger")}
          testIdInput="ledger-file-input"
        />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          marginTop: 28,
        }}
      >
        <Button
          variant="primary"
          size="lg"
          disabled={!ready}
          iconRight="arrowRight"
          onClick={onStart}
          style={{ minWidth: 210 }}
          data-testid="start-analysis-btn"
        >
          Start analysis
        </Button>
        <button
          type="button"
          onClick={onSample}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 13.5,
            color: "var(--ink-2)",
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="sparkle" size={14} />
          {ready ? "Replace with sample data" : "Try with sample data"}
        </button>
        {!ready && (
          <div
            style={{
              fontSize: 12.5,
              color: "var(--ink-3)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="dot" size={8} style={{ color: "var(--warn)" }} />
            Add both files to begin
          </div>
        )}
      </div>
    </div>
  );
}
