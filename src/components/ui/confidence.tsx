export function Confidence({ value }: { value: number }) {
  const tone = value >= 90 ? "good" : value >= 80 ? "accent" : "warn";
  const col =
    tone === "good"
      ? "var(--good-ink)"
      : tone === "accent"
      ? "var(--accent-ink)"
      : "var(--warn-ink)";
  const bar =
    tone === "good"
      ? "var(--good)"
      : tone === "accent"
      ? "var(--accent)"
      : "var(--warn)";
  const soft =
    tone === "good"
      ? "var(--good-soft)"
      : tone === "accent"
      ? "var(--accent-soft)"
      : "var(--warn-soft)";
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        padding: "5px 11px 5px 9px",
        borderRadius: "var(--r-pill)",
        background: soft,
      }}
    >
      <span
        style={{
          position: "relative",
          width: 40,
          height: 5,
          borderRadius: 3,
          background: "oklch(1 0 0 / 0.6)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            width: `${value}%`,
            background: bar,
            borderRadius: 3,
          }}
        />
      </span>
      <span
        className="tnum"
        style={{ fontSize: 12.5, fontWeight: 600, color: col }}
      >
        {value}% sure
      </span>
    </div>
  );
}
