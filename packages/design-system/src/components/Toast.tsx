import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "../icons";
import { cx } from "../lib/utils";
import { IconButton } from "./Button";
import "./Toast.css";

export type ToastTone = "neutral" | "positive" | "negative" | "warning";

export interface ToastData {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
}

const TONE_ICON: Record<ToastTone, IconName> = {
  neutral: "info",
  positive: "check",
  negative: "error",
  warning: "alert",
};

export interface ToastProps extends Omit<ToastData, "id"> {
  onDismiss?: () => void;
  className?: string;
}

/** One toast message. Use the same action word as the button: "Approve" gives "Approved" (docs/07 rule 5). */
export function Toast({ title, description, tone = "neutral", onDismiss, className }: ToastProps) {
  return (
    <div className={cx("sds-toast", `sds-toast--${tone}`, className)} role={tone === "negative" ? "alert" : "status"}>
      <Icon name={TONE_ICON[tone]} className="sds-toast__icon" />
      <div className="sds-toast__text">
        <p className="sds-toast__title">{title}</p>
        {description && <p className="sds-toast__description">{description}</p>}
      </div>
      {onDismiss && <IconButton label="Dismiss message" icon="close" size="sm" onClick={onDismiss} />}
    </div>
  );
}

interface ToastContextValue {
  show: (toast: Omit<ToastData, "id">) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export interface ToastProviderProps {
  children: ReactNode;
  /** Time before a toast closes, in milliseconds. Behaviour, not a visual value. */
  duration?: number;
}

export function ToastProvider({ children, duration = 5000 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (toast: Omit<ToastData, "id">) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      setToasts((list) => [...list, { ...toast, id }]);
      if (duration > 0) timers.current.set(id, setTimeout(() => dismiss(id), duration));
      return id;
    },
    [dismiss, duration],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  const region = (
    <div className="sds-toast-region" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} title={t.title} description={t.description} tone={t.tone} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document === "undefined" ? region : createPortal(region, document.body)}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast needs a ToastProvider");
  return ctx;
}
