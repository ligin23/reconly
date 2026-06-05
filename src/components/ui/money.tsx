import { money as formatMoney, type TxnType } from "@/lib/sample-data";

type MoneyProps = {
  cents: number; // positive cents; direction comes from `type`
  type: TxnType;
  big?: boolean;
};

export function Money({ cents, type, big }: MoneyProps) {
  const isIn = type === "in";
  const text = formatMoney(isIn ? cents : -cents);
  return (
    <span
      className={`money ${isIn ? "money--in" : "money--out"}`}
      style={big ? { fontWeight: 600 } : undefined}
    >
      {text}
    </span>
  );
}
