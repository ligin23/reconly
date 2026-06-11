"use client";

import { useMemo, useState } from "react";
import type { CsvColumnMap, CsvInspection } from "@/lib/parser";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

// ---- Field roles the user can assign ---------------------------------

type AmountMode = "single" | "split";

type DraftMap = {
  date: string;
  description: string;
  amountMode: AmountMode;
  amount: string;        // when amountMode === "single"
  debit: string;         // when amountMode === "split"
  credit: string;        // when amountMode === "split"
  reference: string;     // optional — "" means no reference column
};

const NONE = "";

function detectedToDraft(detected: CsvColumnMap): DraftMap {
  const hasSplit = !detected.amount && (detected.debit || detected.credit);
  return {
    date: detected.date ?? NONE,
    description: detected.description ?? NONE,
    amountMode: hasSplit ? "split" : "single",
    amount: detected.amount ?? NONE,
    debit: detected.debit ?? NONE,
    credit: detected.credit ?? NONE,
    reference: detected.reference ?? NONE,
  };
}

function draftToMap(d: DraftMap): CsvColumnMap {
  const base: CsvColumnMap = { date: d.date, description: d.description };
  if (d.amountMode === "single") {
    base.amount = d.amount;
  } else {
    if (d.debit) base.debit = d.debit;
    if (d.credit) base.credit = d.credit;
  }
  if (d.reference) base.reference = d.reference;
  return base;
}

/**
 * Validate a draft against the file's actual headers.
 * Returns null when valid, otherwise a user-facing reason. Non-empty draft
 * strings alone are NOT enough: auto-detection falls back to literal column
 * names ("date"/"amount") that may not exist in this file, and a mapping
 * pointing at a missing column silently parses zero rows.
 */
function draftProblem(d: DraftMap, headers: string[]): string | null {
  const required =
    d.amountMode === "single"
      ? [d.date, d.description, d.amount]
      : [d.date, d.description];
  if (required.some((c) => !c)) return "Pick a column for every required field";
  if (d.amountMode === "split" && !d.debit && !d.credit)
    return "Pick a debit and/or credit column";

  const used = [
    d.date,
    d.description,
    ...(d.amountMode === "single" ? [d.amount] : [d.debit, d.credit]),
    d.reference,
  ].filter(Boolean);

  const have = new Set(headers);
  const missing = used.find((c) => !have.has(c));
  if (missing) return `Column "${missing}" isn't in this file — pick one from the list`;

  if (new Set(used).size !== used.length)
    return "Each column can only be used for one field";

  return null;
}

// ---- Small native <select> styled to match the app -------------------

function Select({
  value,
  onChange,
  options,
  allowNone,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allowNone?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "8px 10px",
        fontSize: 13,
        fontFamily: "var(--font-mono, ui-monospace, monospace)",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-sm, 8px)",
        color: "var(--ink)",
        cursor: "pointer",
      }}
    >
      {allowNone && <option value={NONE}>— none —</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{label}</div>
        {hint && (
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}>{hint}</div>
        )}
      </div>
      {children}
    </div>
  );
}

// ---- Preview table: re-parses the first sample rows under current map

function PreviewTable({ draft, sampleRows }: { draft: DraftMap; sampleRows: Record<string, string>[] }) {
  const parsed = useMemo(() => {
    return sampleRows.map((row) => {
      const date = draft.date ? row[draft.date] ?? "" : "";
      const desc = draft.description ? row[draft.description] ?? "" : "";
      let amount = "";
      if (draft.amountMode === "single" && draft.amount) {
        amount = row[draft.amount] ?? "";
      } else if (draft.amountMode === "split") {
        const d = draft.debit ? row[draft.debit] ?? "" : "";
        const c = draft.credit ? row[draft.credit] ?? "" : "";
        if (d && d.trim() !== "") amount = `−${d.replace(/^-/, "")}`;
        else if (c && c.trim() !== "") amount = c;
      }
      return { date, desc, amount };
    });
  }, [draft, sampleRows]);

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--r-sm, 8px)",
        overflow: "hidden",
        background: "var(--surface-2)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "100px 1fr 100px",
          gap: 12,
          padding: "8px 12px",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--ink-3)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          background: "var(--surface)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div>Date</div>
        <div>Description</div>
        <div style={{ textAlign: "right" }}>Amount</div>
      </div>
      {parsed.map((row, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "100px 1fr 100px",
            gap: 12,
            padding: "8px 12px",
            fontSize: 12.5,
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            color: "var(--ink-2)",
            borderBottom: i < parsed.length - 1 ? "1px solid var(--line)" : undefined,
          }}
        >
          <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.date || "—"}
          </div>
          <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.desc || "—"}
          </div>
          <div style={{ textAlign: "right" }}>{row.amount || "—"}</div>
        </div>
      ))}
    </div>
  );
}

// ---- One side (bank or ledger) --------------------------------------

function SideCard({
  side,
  inspection,
  draft,
  onChange,
}: {
  side: "bank" | "ledger";
  inspection: CsvInspection;
  draft: DraftMap;
  onChange: (d: DraftMap) => void;
}) {
  const title = side === "bank" ? "Bank statement" : "Ledger";
  const icon = side === "bank" ? "bank" : "book";
  const headers = inspection.headers;

  return (
    <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
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
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {headers.length} columns detected
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <FieldRow label="Date column">
          <Select
            value={draft.date}
            onChange={(v) => onChange({ ...draft, date: v })}
            options={headers}
          />
        </FieldRow>

        <FieldRow label="Description">
          <Select
            value={draft.description}
            onChange={(v) => onChange({ ...draft, description: v })}
            options={headers}
          />
        </FieldRow>

        <FieldRow label="Amount style" hint="One signed column, or split debit/credit">
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => onChange({ ...draft, amountMode: "single" })}
              style={{
                flex: 1,
                padding: "7px 10px",
                fontSize: 12.5,
                fontWeight: 600,
                borderRadius: 8,
                cursor: "pointer",
                border: "1px solid var(--line)",
                background: draft.amountMode === "single" ? "var(--accent-soft)" : "var(--surface)",
                color: draft.amountMode === "single" ? "var(--accent-ink)" : "var(--ink-2)",
              }}
            >
              Single amount
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...draft, amountMode: "split" })}
              style={{
                flex: 1,
                padding: "7px 10px",
                fontSize: 12.5,
                fontWeight: 600,
                borderRadius: 8,
                cursor: "pointer",
                border: "1px solid var(--line)",
                background: draft.amountMode === "split" ? "var(--accent-soft)" : "var(--surface)",
                color: draft.amountMode === "split" ? "var(--accent-ink)" : "var(--ink-2)",
              }}
            >
              Debit + Credit
            </button>
          </div>
        </FieldRow>

        {draft.amountMode === "single" ? (
          <FieldRow label="Amount column">
            <Select
              value={draft.amount}
              onChange={(v) => onChange({ ...draft, amount: v })}
              options={headers}
            />
          </FieldRow>
        ) : (
          <>
            <FieldRow label="Debit column" hint="Money going out (positive value)">
              <Select
                value={draft.debit}
                onChange={(v) => onChange({ ...draft, debit: v })}
                options={headers}
                allowNone
              />
            </FieldRow>
            <FieldRow label="Credit column" hint="Money coming in (positive value)">
              <Select
                value={draft.credit}
                onChange={(v) => onChange({ ...draft, credit: v })}
                options={headers}
                allowNone
              />
            </FieldRow>
          </>
        )}

        <FieldRow label="Reference" hint="Check #, invoice #, etc. (optional)">
          <Select
            value={draft.reference}
            onChange={(v) => onChange({ ...draft, reference: v })}
            options={headers}
            allowNone
          />
        </FieldRow>
      </div>

      <div>
        <div
          className="eyebrow"
          style={{ color: "var(--ink-3)", marginBottom: 6 }}
        >
          Preview · first {inspection.sampleRows.length} rows
        </div>
        <PreviewTable draft={draft} sampleRows={inspection.sampleRows} />
      </div>
    </div>
  );
}

// ---- Screen ---------------------------------------------------------

export type MappingScreenProps = {
  bank: CsvInspection;
  ledger: CsvInspection;
  onBack: () => void;
  onConfirm: (maps: { bank: CsvColumnMap; ledger: CsvColumnMap }) => void;
  /** Parse failure from the previous confirm attempt (e.g. zero rows parsed). */
  errorMessage?: string | null;
};

export function MappingScreen({ bank, ledger, onBack, onConfirm, errorMessage }: MappingScreenProps) {
  const [bankDraft, setBankDraft] = useState<DraftMap>(() => detectedToDraft(bank.detected));
  const [ledgerDraft, setLedgerDraft] = useState<DraftMap>(() => detectedToDraft(ledger.detected));

  const bankProblem = draftProblem(bankDraft, bank.headers);
  const ledgerProblem = draftProblem(ledgerDraft, ledger.headers);
  const problem = bankProblem
    ? `Bank statement: ${bankProblem}`
    : ledgerProblem
      ? `Ledger: ${ledgerProblem}`
      : null;
  const ready = problem === null;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "12px 8px 40px" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <span className="eyebrow" style={{ color: "var(--accent-ink)" }}>
          Step 2 · Confirm columns
        </span>
        <h1
          className="serif"
          style={{
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: "10px 0 8px",
            lineHeight: 1.15,
          }}
        >
          Does this look right?
        </h1>
        <p
          style={{
            fontSize: 14.5,
            color: "var(--ink-2)",
            maxWidth: 540,
            margin: "0 auto",
            textWrap: "pretty",
          }}
        >
          We&apos;ve guessed which columns mean what. If anything looks off, fix it here —
          this is the only step where wrong assumptions can silently hide errors later.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <SideCard side="bank" inspection={bank} draft={bankDraft} onChange={setBankDraft} />
        <SideCard side="ledger" inspection={ledger} draft={ledgerDraft} onChange={setLedgerDraft} />
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginTop: 24,
        }}
      >
        <Button variant="ghost" size="md" icon="arrowLeft" onClick={onBack}>
          Back
        </Button>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {!ready && (
            <span style={{ fontSize: 12.5, color: "var(--ink-3)" }} data-testid="mapping-problem">
              {problem}
            </span>
          )}
          {ready && errorMessage && (
            <span
              style={{ fontSize: 12.5, color: "var(--bad, #b3261e)", maxWidth: 380 }}
              data-testid="mapping-error"
            >
              {errorMessage}
            </span>
          )}
          <Button
            variant="primary"
            size="lg"
            disabled={!ready}
            iconRight="arrowRight"
            data-testid="confirm-mapping-btn"
            onClick={() =>
              onConfirm({
                bank: draftToMap(bankDraft),
                ledger: draftToMap(ledgerDraft),
              })
            }
          >
            Looks good — continue
          </Button>
        </div>
      </div>
    </div>
  );
}
