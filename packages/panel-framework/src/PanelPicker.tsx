import { Button, Icon, Modal, nextListIndex } from "@strata/design-system";
import { type KeyboardEvent, useRef } from "react";
import type { PanelRegistry } from "./registry";
import type { Role } from "./types";

export interface PanelPickerProps {
  open: boolean;
  onClose: () => void;
  registry: PanelRegistry;
  role?: Role | null;
  /** Panels in the workspace now. They cannot be added again. */
  present: string[];
  onAdd: (moduleId: string) => void;
}

/** The panel picker: a list of the modules that the role can add. Arrow keys move, Enter adds. */
export function PanelPicker({ open, onClose, registry, role, present, onAdd }: PanelPickerProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const defs = registry.list(role);
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const current = refs.current.findIndex((el) => el === document.activeElement);
    const next = nextListIndex(e.key, current, defs.length);
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add panel" footer={<Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <ul className="spf-picker" aria-label="Panels" onKeyDown={onKeyDown}>
        {defs.map((d, i) => {
          const added = present.includes(d.id);
          return (
            <li key={d.id}>
              <button
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                className="spf-picker__item"
                disabled={added}
                data-module-id={d.id}
                onClick={() => {
                  onAdd(d.id);
                  onClose();
                }}
              >
                {d.icon && <Icon name={d.icon} size="sm" />}
                <span className="spf-picker__title">{d.title}</span>
                {d.description && <span className="spf-picker__description">{d.description}</span>}
                {added && <span className="spf-picker__state">In this workspace</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
