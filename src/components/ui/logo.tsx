export function Logo({ size = 26 }: { size?: number }) {
  return (
    <div className="flex items-center gap-[9px]">
      <span
        className="grid place-items-center rounded-[8px] flex-none"
        style={{
          width: size,
          height: size,
          background: "var(--accent)",
          color: "#fff",
          boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.18)",
        }}
      >
        <svg
          width={size * 0.6}
          height={size * 0.6}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 13l4 4 10-11" />
        </svg>
      </span>
      <span
        className="serif font-semibold"
        style={{
          fontSize: size * 0.74,
          letterSpacing: "-0.02em",
          color: "var(--ink)",
        }}
      >
        Reconly
      </span>
    </div>
  );
}
