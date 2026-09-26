import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "../icons";
import { cx, nextListIndex, useEscape, useOutsideClick } from "../lib/utils";
import "./Button.css";
import "./Menu.css";

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Keyboard hint, for example "g 1". */
  shortcut?: string;
}

export interface MenuProps {
  items: MenuItem[];
  /** The accessible name of the trigger button. */
  label: string;
  /** The trigger content. When there is none, the trigger is an icon button. */
  trigger?: ReactNode;
  icon?: IconName;
  align?: "start" | "end";
  className?: string;
  defaultOpen?: boolean;
  /** Header content inside the menu, above the items. */
  header?: ReactNode;
}

/** A menu button (WAI-ARIA menu). Arrow keys move, Enter selects, Esc closes and returns focus to the trigger. */
export function Menu({ items, label, trigger, icon = "more", align = "end", className, defaultOpen = false, header }: MenuProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  const close = (refocus = true) => {
    setOpen(false);
    setActive(-1);
    if (refocus) button.current?.focus();
  };
  useEscape(open, () => close());
  useOutsideClick(root, open, () => close(false));

  useEffect(() => {
    if (open && active >= 0) itemRefs.current[active]?.focus();
  }, [open, active]);

  const openMenu = (start: "first" | "last") => {
    setOpen(true);
    setActive(start === "first" ? (enabled[0] ?? -1) : (enabled[enabled.length - 1] ?? -1));
  };

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu("first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openMenu("last");
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const pos = enabled.indexOf(active);
    const next = nextListIndex(e.key, pos, enabled.length);
    if (next !== null) {
      e.preventDefault();
      setActive(enabled[next]!);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <div ref={root} className={cx("sds-menu", className)}>
      <button
        ref={button}
        type="button"
        className={cx(trigger ? "sds-menu__trigger" : "sds-icon-button sds-icon-button--md")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={trigger ? undefined : label}
        title={trigger ? undefined : label}
        onClick={() => (open ? close() : openMenu("first"))}
        onKeyDown={onTriggerKey}
      >
        {trigger ?? <Icon name={icon} />}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} className={cx("sds-menu__list", `sds-menu__list--${align}`)} onKeyDown={onMenuKey}>
          {header && <div className="sds-menu__header">{header}</div>}
          {items.map((it, i) => (
            <button
              key={it.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={i === active ? 0 : -1}
              disabled={it.disabled}
              className={cx("sds-menu__item", it.danger && "sds-menu__item--danger")}
              onClick={() => {
                close();
                it.onSelect();
              }}
              onMouseEnter={() => !it.disabled && setActive(i)}
            >
              {it.icon && <Icon name={it.icon} size="sm" />}
              <span className="sds-menu__label">{it.label}</span>
              {it.shortcut && <kbd className="sds-kbd">{it.shortcut}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
