type KpiKind = "matched" | "review" | "problem" | "missing";

type KpiCardProps = {
  label: string;
  value: number | string;
  kind: KpiKind;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
};

export function KpiCard({ label, value, kind, hint, active, onClick }: KpiCardProps) {
  const accentDot =
    kind === "matched"
      ? "var(--good)"
      : kind === "review"
      ? "var(--warn)"
      : kind === "problem"
      ? "var(--bad)"
      : "var(--accent)";
  return (
    <button
      type="button"
      className="kpi"
      onClick={onClick}
      data-active={active ? "" : undefined}
      style={{
        textAlign: "left",
        cursor: onClick ? "pointer" : "default",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        padding: "16px 18px 17px",
        boxShadow: "var(--sh-card)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        transition: "border-color .15s, box-shadow .15s, transform .04s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: 2,
            background: accentDot,
            flex: "none",
          }}
        />
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--ink-2)",
            letterSpacing: "-0.005em",
          }}
        >
          {label}
        </span>
      </div>
      <div
        className="tnum serif"
        style={{
          fontSize: 34,
          fontWeight: 600,
          letterSpacing: "-0.03em",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {hint && <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{hint}</div>}
    </button>
  );
}
