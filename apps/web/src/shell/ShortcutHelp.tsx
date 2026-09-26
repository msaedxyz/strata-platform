import { Modal } from "@strata/design-system";
import { shortcuts } from "../config/shortcuts";

const GROUPS = ["General", "Workspaces", "Lists and overlays"] as const;

/** The keyboard shortcut help ("?"). It lists the map from config/shortcuts.ts. */
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      {GROUPS.map((g) => (
        <section key={g} className="app-shortcuts__group" aria-labelledby={`shortcut-group-${g}`}>
          <h3 id={`shortcut-group-${g}`} className="app-shortcuts__heading">
            {g}
          </h3>
          <dl className="app-shortcuts__list">
            {shortcuts
              .filter((s) => s.group === g)
              .map((s) => (
                <div key={s.id} className="app-shortcuts__row" data-shortcut-id={s.id}>
                  <dt className="app-shortcuts__keys">
                    {s.display.map((k) => (
                      <kbd key={k} className="sds-kbd">
                        {k}
                      </kbd>
                    ))}
                  </dt>
                  <dd className="app-shortcuts__description">{s.description}</dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
    </Modal>
  );
}
