import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";
import { cx, nextListIndex } from "../lib/utils";
import "./Tabs.css";

export interface TabItem {
  id: string;
  label: string;
  content?: ReactNode;
  disabled?: boolean;
  /** A count shown after the label. */
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  label: string;
  className?: string;
}

/** WAI-ARIA tabs. Arrow keys move between tabs. Home and End go to the first and last tab. */
export function Tabs({ items, value, defaultValue, onChange, label, className }: TabsProps) {
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id);
  const active = value ?? inner;
  const baseId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = items.filter((t) => !t.disabled);

  const select = (id: string) => {
    if (value === undefined) setInner(id);
    onChange?.(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = enabled.findIndex((t) => t.id === active);
    const next = nextListIndex(e.key, current, enabled.length, "horizontal");
    if (next === null) return;
    e.preventDefault();
    const target = enabled[next]!;
    select(target.id);
    refs.current[items.indexOf(target)]?.focus();
  };

  const activeItem = items.find((t) => t.id === active);
  return (
    <div className={cx("sds-tabs", className)}>
      <div role="tablist" aria-label={label} className="sds-tabs__list" onKeyDown={onKeyDown}>
        {items.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${baseId}-tab-${t.id}`}
            aria-selected={t.id === active}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={t.id === active ? 0 : -1}
            disabled={t.disabled}
            className="sds-tabs__tab"
            onClick={() => select(t.id)}
          >
            {t.label}
            {t.count !== undefined && <span className="sds-tabs__count sds-num">{t.count}</span>}
          </button>
        ))}
      </div>
      {activeItem?.content !== undefined && (
        <div role="tabpanel" id={`${baseId}-panel-${activeItem.id}`} aria-labelledby={`${baseId}-tab-${activeItem.id}`} className="sds-tabs__panel" tabIndex={0}>
          {activeItem.content}
        </div>
      )}
    </div>
  );
}
