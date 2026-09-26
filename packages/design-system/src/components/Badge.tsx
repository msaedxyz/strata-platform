import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/utils";
import "./Badge.css";

export type BadgeTone = "neutral" | "positive" | "negative" | "warning" | "accent" | "unverified";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** A solid badge is filled. An outline badge has a border only. */
  appearance?: "solid" | "outline";
  children: ReactNode;
}

export function Badge({ tone = "neutral", appearance = "outline", className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx("sds-badge", `sds-badge--${tone}`, `sds-badge--${appearance}`, className)} {...rest}>
      {children}
    </span>
  );
}

/** The status values from docs/06 (alerts) and docs/07 rule 3 (pending approval). */
export type Status = "unconfirmed" | "reported" | "confirmed" | "dismissed" | "pending_approval";

/**
 * One visual style per status. Unconfirmed and reported items share ONE style in every module (docs/07 rule 4).
 * The label is the same word in every module (docs/07 rule 5).
 */
export const STATUS_STYLE: Record<Status, { tone: BadgeTone; label: string }> = {
  unconfirmed: { tone: "unverified", label: "Unconfirmed" },
  reported: { tone: "unverified", label: "Reported" },
  confirmed: { tone: "positive", label: "Confirmed" },
  dismissed: { tone: "neutral", label: "Dismissed" },
  pending_approval: { tone: "warning", label: "Pending approval" },
};

export interface StatusBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  status: Status;
}

export function StatusBadge({ status, className, ...rest }: StatusBadgeProps) {
  const style = STATUS_STYLE[status];
  return (
    <Badge tone={style.tone} className={cx("sds-status-badge", className)} data-status={status} {...rest}>
      {style.label}
    </Badge>
  );
}
