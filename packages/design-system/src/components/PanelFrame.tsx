import { forwardRef, type HTMLAttributes, type ReactNode, useId } from "react";
import { Icon, type IconName } from "../icons";
import { cx } from "../lib/utils";
import { IconButton } from "./Button";
import { Menu, type MenuItem } from "./Menu";
import { ErrorState, LoadingState } from "./States";
import "./PanelFrame.css";

export interface PanelHeaderProps {
  title: string;
  titleId?: string;
  icon?: IconName;
  /** Content after the title, for example a live badge or a count. */
  meta?: ReactNode;
  collapsed?: boolean;
  maximised?: boolean;
  onCollapse?: () => void;
  onMaximise?: () => void;
  onClose?: () => void;
  menuItems?: MenuItem[];
  /** The header is the drag handle in the panel grid. */
  dragHandle?: boolean;
}

/** The panel header with the collapse, maximise, close and menu controls. */
export function PanelHeader({
  title,
  titleId,
  icon,
  meta,
  collapsed = false,
  maximised = false,
  onCollapse,
  onMaximise,
  onClose,
  menuItems,
  dragHandle = false,
}: PanelHeaderProps) {
  return (
    <header className={cx("sds-panel-header", dragHandle && "sds-panel-header--draggable")} data-drag-handle={dragHandle || undefined}>
      {dragHandle && <Icon name="grip" size="sm" className="sds-panel-header__grip" />}
      {icon && <Icon name={icon} size="sm" className="sds-panel-header__icon" />}
      <h2 id={titleId} className="sds-panel-header__title">
        {title}
      </h2>
      {meta && <div className="sds-panel-header__meta">{meta}</div>}
      <div className="sds-panel-header__controls" data-no-drag>
        {menuItems && menuItems.length > 0 && <Menu label={`${title} panel menu`} items={menuItems} />}
        {onCollapse && (
          <IconButton
            size="sm"
            icon={collapsed ? "chevronDown" : "collapse"}
            label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            aria-expanded={!collapsed}
            onClick={onCollapse}
            data-panel-action="collapse"
          />
        )}
        {onMaximise && (
          <IconButton
            size="sm"
            icon={maximised ? "restore" : "maximise"}
            label={maximised ? `Restore ${title}` : `Maximise ${title}`}
            pressed={maximised}
            onClick={onMaximise}
            data-panel-action="maximise"
          />
        )}
        {onClose && <IconButton size="sm" icon="close" label={`Close ${title}`} onClick={onClose} data-panel-action="close" />}
      </div>
    </header>
  );
}

export interface PanelFrameProps extends Omit<HTMLAttributes<HTMLElement>, "title">, Omit<PanelHeaderProps, "titleId"> {
  children?: ReactNode;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  /** The body has no padding, for tables and maps. */
  flush?: boolean;
}

/** A panel: the header and a body that scrolls. The panel grid places it. */
export const PanelFrame = forwardRef<HTMLElement, PanelFrameProps>(function PanelFrame(
  {
    title,
    icon,
    meta,
    collapsed = false,
    maximised = false,
    onCollapse,
    onMaximise,
    onClose,
    menuItems,
    dragHandle,
    children,
    loading = false,
    error,
    onRetry,
    flush = false,
    className,
    ...rest
  },
  ref,
) {
  const titleId = useId();
  let body = children;
  if (error) body = <ErrorState description={error} onRetry={onRetry} />;
  else if (loading) body = <LoadingState rows={4} label={`Loading ${title}`} />;
  return (
    <section
      ref={ref}
      aria-labelledby={titleId}
      className={cx("sds-panel", collapsed && "sds-panel--collapsed", maximised && "sds-panel--maximised", className)}
      {...rest}
    >
      <PanelHeader
        title={title}
        titleId={titleId}
        icon={icon}
        meta={meta}
        collapsed={collapsed}
        maximised={maximised}
        onCollapse={onCollapse}
        onMaximise={onMaximise}
        onClose={onClose}
        menuItems={menuItems}
        dragHandle={dragHandle}
      />
      {!collapsed && (
        // The body scrolls. tabIndex 0 lets a keyboard user scroll it (axe rule scrollable-region-focusable).
        <div className={cx("sds-panel__body", flush && "sds-panel__body--flush")} tabIndex={0}>
          {body}
        </div>
      )}
    </section>
  );
});
