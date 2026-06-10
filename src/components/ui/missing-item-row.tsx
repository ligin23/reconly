"use client";

import type { ReactNode } from "react";
import type { TxnType } from "@/lib/sample-data";
import { Money } from "./money";
import { Button } from "./button";
import type { IconName } from "./icon";

type MissingItemRowTxn = {
  date: string;
  desc: string;
  amount: number;
  type: TxnType;
};

type MissingItemRowProps = {
  tx: MissingItemRowTxn;
  hint: string;
  actionLabel: string;
  actionIcon?: IconName;
  onAction?: () => void;
  /** Slot for a resolved-state chip shown after the action is taken (Phase 2+). */
  resolvedNode?: ReactNode;
};

export function MissingItemRow({
  tx,
  hint,
  actionLabel,
  actionIcon,
  onAction,
  resolvedNode,
}: MissingItemRowProps) {
  return (
    <div
      className="txn"
      style={{
        display: "grid",
        gridTemplateColumns: "64px 1fr auto auto",
        alignItems: "center",
        gap: 16,
        padding: "13px 18px",
        borderTop: "1px solid var(--line-2)",
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
        <span style={{ display: "block", fontSize: 12, color: "var(--ink-3)" }}>
          {hint}
        </span>
      </span>

      <span style={{ fontSize: 14.5, textAlign: "right" }}>
        <Money cents={tx.amount} type={tx.type} />
      </span>

      <span style={{ display: "flex", justifyContent: "flex-end", flex: "none" }}>
        {resolvedNode ?? (
          <Button
            variant="secondary"
            size="sm"
            icon={actionIcon}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        )}
      </span>
    </div>
  );
}
