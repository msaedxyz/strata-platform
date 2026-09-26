import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { cx } from "../lib/utils";
import { Button } from "./Button";
import "./States.css";

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon = "empty", action, className }: EmptyStateProps) {
  return (
    <div className={cx("sds-state", "sds-state--empty", className)}>
      <Icon name={icon} className="sds-state__icon" />
      <p className="sds-state__title">{title}</p>
      {description && <p className="sds-state__description">{description}</p>}
      {action && <div className="sds-state__action">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({ title = "The data did not load", description, onRetry, retryLabel = "Retry", className }: ErrorStateProps) {
  return (
    <div className={cx("sds-state", "sds-state--error", className)} role="alert">
      <Icon name="error" className="sds-state__icon" />
      <p className="sds-state__title">{title}</p>
      {description && <p className="sds-state__description">{description}</p>}
      {onRetry && (
        <div className="sds-state__action">
          <Button size="sm" icon="reset" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

export interface LoadingStateProps {
  label?: string;
  /** Skeleton rows instead of a spinner. */
  rows?: number;
  className?: string;
}

export function LoadingState({ label = "Loading", rows, className }: LoadingStateProps) {
  return (
    <div className={cx("sds-state", "sds-state--loading", rows !== undefined && "sds-state--skeleton", className)} role="status" aria-busy="true">
      {rows !== undefined ? (
        <>
          {Array.from({ length: rows }, (_, i) => (
            <span key={i} className="sds-skeleton" aria-hidden="true" />
          ))}
          <span className="sds-visually-hidden">{label}</span>
        </>
      ) : (
        <>
          <span className="sds-spinner" aria-hidden="true" />
          <p className="sds-state__description">{label}</p>
        </>
      )}
    </div>
  );
}
