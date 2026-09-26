import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { cx } from "../lib/utils";
import "./Button.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: IconName;
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading = false, disabled, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("sds-button", `sds-button--${variant}`, `sds-button--${size}`, loading && "sds-button--loading", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="sds-spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size="sm" /> : null}
      {children !== undefined && <span className="sds-button__label">{children}</span>}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** The accessible name. It is also the tooltip text. */
  label: string;
  icon: IconName;
  size?: "sm" | "md";
  /** A toggle control that is on. */
  pressed?: boolean;
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = "md", pressed, loading = false, disabled, className, type = "button", title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cx("sds-icon-button", `sds-icon-button--${size}`, pressed && "sds-icon-button--pressed", className)}
      {...rest}
    >
      {loading ? <span className="sds-spinner" aria-hidden="true" /> : <Icon name={icon} size={size === "sm" ? "sm" : "md"} />}
    </button>
  );
});
