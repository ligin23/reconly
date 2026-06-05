import { Icon, type IconName } from "./icon";

type EmptyStateProps = {
  icon?: IconName;
  title: string;
  body?: string;
  tone?: "good" | "muted";
};

export function EmptyState({
  icon = "checkCircle",
  title,
  body,
  tone = "good",
}: EmptyStateProps) {
  const col = tone === "good" ? "var(--good)" : "var(--ink-3)";
  const soft = tone === "good" ? "var(--good-soft)" : "var(--surface-2)";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        padding: "44px 24px",
        gap: 6,
      }}
    >
      <span
        style={{
          width: 46,
          height: 46,
          borderRadius: 13,
          background: soft,
          color: col,
          display: "grid",
          placeItems: "center",
          marginBottom: 6,
        }}
      >
        <Icon name={icon} size={24} stroke={2} />
      </span>
      <div style={{ fontSize: 15.5, fontWeight: 600, color: "var(--ink)" }}>
        {title}
      </div>
      {body && (
        <div
          style={{
            fontSize: 13.5,
            color: "var(--ink-3)",
            maxWidth: 320,
            textWrap: "pretty",
          }}
        >
          {body}
        </div>
      )}
    </div>
  );
}
