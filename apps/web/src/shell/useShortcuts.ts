import { overlayOpen } from "@strata/design-system";
import { useEffect, useLayoutEffect, useRef } from "react";
import { appConfig } from "../config/app.config";
import { matchesBinding, shortcuts } from "../config/shortcuts";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(target.type) && !target.readOnly;
  }
  return false;
}

/**
 * The global keyboard shortcuts of the app shell. The map is in config/shortcuts.ts.
 * The shell ignores the keys while the user types in a field or while an overlay is open.
 */
export function useShortcuts(actions: Record<string, () => void>) {
  const saved = useRef(actions);
  useLayoutEffect(() => {
    saved.current = actions;
  });

  useEffect(() => {
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const appShortcuts = shortcuts.filter((s) => s.scope === "app");

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || isEditable(e.target) || overlayOpen()) return;
      if (pending !== null) {
        const first = pending;
        pending = null;
        clearTimeout(timer);
        const hit = appShortcuts.find((s) => s.sequence?.[0] === first && s.sequence[1] === e.key);
        if (hit) {
          e.preventDefault();
          saved.current[hit.id]?.();
          return;
        }
      }
      for (const s of appShortcuts) {
        if (s.bindings?.some((b) => matchesBinding(e, b))) {
          e.preventDefault();
          saved.current[s.id]?.();
          return;
        }
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && appShortcuts.some((s) => s.sequence?.[0] === e.key)) {
        pending = e.key;
        timer = setTimeout(() => {
          pending = null;
        }, appConfig.shortcuts.sequenceTimeoutMs);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, []);
}
