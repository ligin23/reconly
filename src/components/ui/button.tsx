import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

type ButtonVariant = "primary" | "secondary" | "ghost" | "accept" | "reject";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  disabled?: boolean;
  icon?: IconName;
  iconRight?: IconName;
  children?: ReactNode;
  onClick?: () => void;
  style?: CSSProperties;
  title?: string;
  "data-testid"?: string;
};

export function Button({
  variant = "secondary",
  size = "md",
  block,
  disabled,
  icon,
  iconRight,
  children,
  onClick,
  style,
  title,
  "data-testid": testId,
}: ButtonProps) {
  const cls = [
    "btn",
    disabled ? "btn--disabled" : `btn--${variant}`,
    size === "lg" ? "btn--lg" : size === "sm" ? "btn--sm" : "",
    block ? "btn--block" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const iconSize = size === "sm" ? 15 : 17;
  return (
    <button
      className={cls}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={style}
      title={title}
      type="button"
      data-testid={testId}
    >
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconRight && <Icon name={iconRight} size={iconSize} />}
    </button>
  );
}
