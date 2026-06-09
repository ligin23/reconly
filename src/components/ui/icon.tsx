import type { CSSProperties } from "react";

export type IconName =
  | "check"
  | "checkCircle"
  | "x"
  | "upload"
  | "file"
  | "arrowRight"
  | "arrowLeft"
  | "scale"
  | "bank"
  | "book"
  | "sparkle"
  | "search"
  | "trash"
  | "help"
  | "chevR"
  | "dot"
  | "link"
  | "alert"
  | "minus"
  | "history"
  | "save"
  | "download";

type IconProps = {
  name: IconName;
  size?: number;
  stroke?: number;
  style?: CSSProperties;
  className?: string;
};

export function Icon({ name, size = 18, stroke = 1.8, style, className }: IconProps) {
  const p = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style,
    className,
    "aria-hidden": true,
  };
  switch (name) {
    case "check":
      return <svg {...p}><path d="M20 6 9 17l-5-5" /></svg>;
    case "checkCircle":
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 12.2l2.4 2.4 4.6-4.8" /></svg>;
    case "x":
      return <svg {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>;
    case "upload":
      return <svg {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>;
    case "file":
      return <svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>;
    case "arrowRight":
      return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "arrowLeft":
      return <svg {...p}><path d="M19 12H5M11 18l-6-6 6-6" /></svg>;
    case "scale":
      return <svg {...p}><path d="M12 4v16M5 8h14" /><path d="M5 8l-2.5 5a2.5 2.5 0 0 0 5 0L5 8zM19 8l-2.5 5a2.5 2.5 0 0 0 5 0L19 8z" /></svg>;
    case "bank":
      return <svg {...p}><path d="M3 10l9-6 9 6" /><path d="M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18" /></svg>;
    case "book":
      return <svg {...p}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 5v14" /></svg>;
    case "sparkle":
      return <svg {...p}><path d="M12 3l1.8 4.9L18.7 9 13.8 10.8 12 15.7 10.2 10.8 5.3 9l4.9-1.1z" /></svg>;
    case "search":
      return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>;
    case "trash":
      return <svg {...p}><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3" /></svg>;
    case "help":
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7M12 17h.01" /></svg>;
    case "chevR":
      return <svg {...p}><path d="m9 6 6 6-6 6" /></svg>;
    case "dot":
      return <svg {...p}><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /></svg>;
    case "link":
      return <svg {...p}><path d="M9 15l6-6" /><path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1M13 18l-1 1a4 4 0 0 1-6-6l1-1" /></svg>;
    case "alert":
      return <svg {...p}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>;
    case "minus":
      return <svg {...p}><path d="M5 12h14" /></svg>;
    case "history":
      return <svg {...p}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></svg>;
    case "save":
      return <svg {...p}><path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M15 3v5H9V3M9 17h6" /></svg>;
    case "download":
      return <svg {...p}><path d="M12 16V4M7 16l5 5 5-5" /><path d="M4 19v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" /></svg>;
    default:
      return null;
  }
}
