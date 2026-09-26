import { type ReactNode, type RefObject, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cx, useEscape, useFocusTrap } from "../lib/utils";
import { IconButton } from "./Button";
import "./Overlay.css";

interface DialogFrameProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Hide the title visually. It stays the accessible name. */
  hideTitle?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  kind: "modal" | "drawer";
  size?: "sm" | "md";
  side?: "right" | "left";
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
  /** Render in place instead of in a portal. Stories use this. */
  inline?: boolean;
  placement?: "center" | "top";
}

function DialogFrame({
  open,
  onClose,
  title,
  hideTitle,
  children,
  footer,
  kind,
  size = "md",
  side = "right",
  initialFocus,
  className,
  inline,
  placement = "center",
}: DialogFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, open, initialFocus);
  useEscape(open, onClose);
  if (!open) return null;
  const node = (
    <div className={cx("sds-overlay", `sds-overlay--${kind}`, kind === "modal" && `sds-overlay--${placement}`, inline && "sds-overlay--inline")}>
      <div className="sds-overlay__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(
          kind === "modal" ? "sds-modal" : "sds-drawer",
          kind === "modal" ? `sds-modal--${size}` : `sds-drawer--${side}`,
          className,
        )}
      >
        <header className={cx("sds-dialog__header", hideTitle && "sds-dialog__header--bare")}>
          <h2 id={titleId} className={cx("sds-dialog__title", hideTitle && "sds-visually-hidden")}>
            {title}
          </h2>
          {!hideTitle && <IconButton label="Close" icon="close" size="sm" onClick={onClose} />}
        </header>
        <div className="sds-dialog__body">{children}</div>
        {footer && <footer className="sds-dialog__footer">{footer}</footer>}
      </div>
    </div>
  );
  return inline || typeof document === "undefined" ? node : createPortal(node, document.body);
}

export type ModalProps = Omit<DialogFrameProps, "kind" | "side">;

/** A modal dialog. Focus stays inside. Esc and the backdrop close it. Focus returns to the opener. */
export function Modal(props: ModalProps) {
  return <DialogFrame {...props} kind="modal" />;
}

export type DrawerProps = Omit<DialogFrameProps, "kind" | "size" | "placement">;

/** A side panel for details, for example a site, a deal or the evidence of a fact. */
export function Drawer(props: DrawerProps) {
  return <DialogFrame {...props} kind="drawer" />;
}
