import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { Icon, type IconName } from "../icons";
import { cx, nextListIndex } from "../lib/utils";
import { Badge } from "./Badge";
import { Menu, type MenuItem } from "./Menu";
import { LoadingState } from "./States";
import "./Shell.css";

export interface AppShellProps {
  nav: ReactNode;
  topBar: ReactNode;
  ticker?: ReactNode;
  children: ReactNode;
  /** The shell waits for the session. */
  loading?: boolean;
  className?: string;
}

/** The application shell: navigation rail, top bar, ticker strip slot and the main area. */
export function AppShell({ nav, topBar, ticker, children, loading = false, className }: AppShellProps) {
  return (
    <div className={cx("sds-shell", ticker !== undefined && "sds-shell--ticker", className)}>
      <a className="sds-shell__skip" href="#sds-main">
        Skip to content
      </a>
      <div className="sds-shell__nav">{nav}</div>
      <div className="sds-shell__top">{topBar}</div>
      {ticker !== undefined && <div className="sds-shell__ticker">{ticker}</div>}
      <main id="sds-main" className="sds-shell__main" tabIndex={-1}>
        {loading ? <LoadingState label="Loading the session" /> : children}
      </main>
    </div>
  );
}

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  /** Keyboard hint shown in the tooltip, for example "g 1". */
  shortcut?: string;
}

export interface NavRailProps {
  items: NavItem[];
  activeId?: string;
  onSelect: (id: string) => void;
  /** Content at the top of the rail, for example the product mark. */
  brand?: ReactNode;
  footer?: ReactNode;
  label?: string;
}

/** The vertical navigation. Arrow keys move between the items. */
export function NavRail({ items, activeId, onSelect, brand, footer, label = "Workspaces" }: NavRailProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const current = refs.current.findIndex((el) => el === document.activeElement);
    const next = nextListIndex(e.key, current, items.length);
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
  };
  const activeIndex = Math.max(
    0,
    items.findIndex((it) => it.id === activeId),
  );
  return (
    <nav className="sds-nav" aria-label={label}>
      {brand && <div className="sds-nav__brand">{brand}</div>}
      <ul className="sds-nav__list" onKeyDown={onKeyDown}>
        {items.map((it, i) => {
          const active = it.id === activeId;
          return (
            <li key={it.id}>
              <button
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                className={cx("sds-nav__item", active && "sds-nav__item--active")}
                aria-current={active ? "page" : undefined}
                tabIndex={i === activeIndex ? 0 : -1}
                title={it.shortcut ? `${it.label} (${it.shortcut})` : it.label}
                onClick={() => onSelect(it.id)}
                data-nav-id={it.id}
              >
                <Icon name={it.icon} />
                <span className="sds-nav__label">{it.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {footer && <div className="sds-nav__footer">{footer}</div>}
    </nav>
  );
}

export interface TopBarProps {
  title?: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
}

export function TopBar({ title, search, actions }: TopBarProps) {
  return (
    <header className="sds-topbar">
      {title && <div className="sds-topbar__title">{title}</div>}
      <div className="sds-topbar__search">{search}</div>
      <div className="sds-topbar__actions">{actions}</div>
    </header>
  );
}

export interface UserMenuProps {
  name: string;
  email?: string;
  role?: string;
  items: MenuItem[];
  defaultOpen?: boolean;
}

export function UserMenu({ name, email, role, items, defaultOpen }: UserMenuProps) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <Menu
      label={`User menu for ${name}`}
      defaultOpen={defaultOpen}
      trigger={
        <>
          <span className="sds-user__avatar" aria-hidden="true">
            {initials}
          </span>
          <span className="sds-user__name">{name}</span>
          {role && <Badge tone="neutral">{role}</Badge>}
          <Icon name="chevronDown" size="sm" />
        </>
      }
      header={
        <div className="sds-user__header">
          <span className="sds-user__header-name">{name}</span>
          {email && <span className="sds-user__header-email">{email}</span>}
        </div>
      }
      items={items}
    />
  );
}
