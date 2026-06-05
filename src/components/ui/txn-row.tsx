import type { ReactNode } from "react";
import type { TxnType } from "@/lib/sample-data";
import { Money } from "./money";

type TxnRowTxn = {
  date: string;
  desc: string;
  amount: number;
  type: TxnType;
};

type TxnRowProps = {
  tx: TxnRowTxn;
  pill?: ReactNode;
  sub?: string;
  onClick?: () => void;
};

export function TxnRow({ tx, pill, sub, onClick }: TxnRowProps) {
  return (
    <div
      className="txn"
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "64px 1fr auto 132px",
        alignItems: "center",
        gap: 16,
        padding: "13px 18px",
        borderTop: "1px solid var(--line-2)",
        cursor: onClick ? "pointer" : "default",
        transition: "background .12s",
      }}
    >
      <span
        className="mono"
        style={{ fontSize: 12, color: "var(--ink-3)", letterSpacing: "0.01em" }}
      >
        {tx.date}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 14,
            fontWeight: 500,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {tx.desc}
        </span>
        {sub && (
          <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)" }}>
            {sub}
          </span>
        )}
      </span>
      <span style={{ fontSize: 14.5, textAlign: "right" }}>
        <Money cents={tx.amount} type={tx.type} />
      </span>
      <span style={{ display: "flex", justifyContent: "flex-end" }}>{pill}</span>
    </div>
  );
}
