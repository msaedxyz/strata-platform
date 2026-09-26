import { cloneElement, type ReactElement, useEffect, useId, useRef, useState } from "react";
import { cx } from "../lib/utils";
import "./Tooltip.css";

export interface TooltipProps {
  content: string;
  /** One focusable element. The tooltip describes it (aria-describedby). */
  children: ReactElement<Record<string, unknown>>;
  placement?: "top" | "bottom";
  /** Delay before the tooltip shows, in milliseconds. Behaviour, not a visual value. */
  delay?: number;
  /** Show the tooltip at once. Stories and tests use this. */
  defaultOpen?: boolean;
}

export function Tooltip({ content, children, placement = "top", delay = 400, defaultOpen = false }: TooltipProps) {
  const [open, setOpen] = useState(defaultOpen);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span className="sds-tooltip-anchor" onMouseEnter={show} onMouseLeave={hide} onFocus={() => setOpen(true)} onBlur={hide}>
      {cloneElement(children, { "aria-describedby": open ? id : undefined })}
      {open && (
        <span role="tooltip" id={id} className={cx("sds-tooltip", `sds-tooltip--${placement}`)}>
          {content}
        </span>
      )}
    </span>
  );
}
