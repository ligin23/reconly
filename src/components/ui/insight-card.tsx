import { Icon } from "./icon";

export function InsightCard({ insights }: { insights: string[] }) {
  return (
    <div
      className="card"
      style={{
        padding: "20px 22px",
        background:
          "linear-gradient(180deg, var(--accent-soft), var(--surface) 70%)",
        borderColor: "oklch(0.90 0.03 256)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          marginBottom: 14,
        }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: "var(--accent)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            flex: "none",
          }}
        >
          <Icon name="sparkle" size={15} stroke={2} />
        </span>
        <span className="eyebrow" style={{ color: "var(--accent-ink)" }}>
          What we found
        </span>
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 11,
        }}
      >
        {insights.map((t, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              gap: 11,
              alignItems: "flex-start",
              fontSize: 15,
              lineHeight: 1.5,
              color: "var(--ink)",
            }}
          >
            <span
              style={{
                marginTop: 7,
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--accent)",
                flex: "none",
              }}
            />
            <span style={{ textWrap: "pretty" }}>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
