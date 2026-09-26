import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../icons";
import { cx, nextListIndex } from "../lib/utils";
import { Modal } from "./Overlay";
import { LoadingState } from "./States";
import "./CommandPalette.css";

export interface Command {
  id: string;
  label: string;
  group?: string;
  icon?: IconName;
  /** Keyboard hint, for example "g 1". */
  shortcut?: string;
  keywords?: string[];
  disabled?: boolean;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  placeholder?: string;
  /** The query text when the palette opens. */
  initialQuery?: string;
  /** Called on each change of the query. The app can load search results with it. */
  onQueryChange?: (query: string) => void;
  /** More results, for example entities from the search API. They show after the commands. */
  results?: Command[];
  loading?: boolean;
  error?: string;
  inline?: boolean;
}

export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const words = q.split(/\s+/);
  return commands.filter((c) => {
    const text = [c.label, c.group ?? "", ...(c.keywords ?? [])].join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/**
 * The command input. "/" or Ctrl/Cmd+K opens it in the app. Type to filter, arrow keys move, Enter runs, Esc closes.
 */
export function CommandPalette({
  open,
  onClose,
  commands,
  placeholder = "Type a command or search",
  initialQuery = "",
  onQueryChange,
  results = [],
  loading = false,
  error,
  inline,
}: CommandPaletteProps) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setActive(0);
    }
  }, [open, initialQuery]);

  const visible = useMemo(
    () => [...filterCommands(commands, query), ...results].filter((c) => !c.disabled),
    [commands, results, query],
  );
  const safeActive = Math.min(active, Math.max(visible.length - 1, 0));

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const next = nextListIndex(e.key, safeActive, visible.length);
    if (next !== null && e.key !== "Home" && e.key !== "End") {
      e.preventDefault();
      setActive(next);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(visible[safeActive]);
    }
  };

  let lastGroup: string | undefined;
  const optionId = (c: Command) => `${listId}-${c.id}`;
  let body: ReactNode;
  if (error) {
    body = (
      <p className="sds-command__message" role="alert">
        {error}
      </p>
    );
  } else if (visible.length === 0 && !loading) {
    body = <p className="sds-command__message">No command or result matches "{query}"</p>;
  } else {
    body = null;
  }

  return (
    <Modal open={open} onClose={onClose} title="Command input" hideTitle placement="top" initialFocus={input} inline={inline} className="sds-command">
      <div className="sds-command__field">
        <Icon name="search" className="sds-command__icon" />
        <input
          ref={input}
          className="sds-command__input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={visible[safeActive] ? optionId(visible[safeActive]!) : undefined}
          aria-label="Command input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            onQueryChange?.(e.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd className="sds-kbd">Esc</kbd>
      </div>
      <ul id={listId} role="listbox" aria-label="Commands" className="sds-command__list">
        {visible.map((c, i) => {
          const header = c.group && c.group !== lastGroup ? c.group : undefined;
          lastGroup = c.group;
          return (
            <li key={c.id} role="presentation">
              {header && (
                <div className="sds-command__group" role="presentation">
                  {header}
                </div>
              )}
              <div
                id={optionId(c)}
                role="option"
                aria-selected={i === safeActive}
                className={cx("sds-command__option", i === safeActive && "sds-command__option--active")}
                onMouseMove={() => setActive(i)}
                onClick={() => run(c)}
              >
                {c.icon && <Icon name={c.icon} size="sm" />}
                <span className="sds-command__label">{c.label}</span>
                {c.shortcut && <kbd className="sds-kbd">{c.shortcut}</kbd>}
              </div>
            </li>
          );
        })}
      </ul>
      {loading && <LoadingState label="Searching" />}
      {body}
    </Modal>
  );
}
