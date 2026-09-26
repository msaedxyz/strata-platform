import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Join class names. False, null and undefined are skipped. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** The state that a story or a visual test can force on a component root (data-force-state). */
export type ForcedState = "hover" | "focus" | "active";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("inert"));
}

/**
 * Keep keyboard focus inside the element while it is active, and give the focus back when it closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, initialFocus?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return undefined;
    const root = ref.current;
    if (!root) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const first = initialFocus?.current ?? focusableIn(root)[0] ?? root;
    first.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusableIn(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      if (previous && typeof previous.focus === "function") previous.focus();
    };
  }, [active, ref, initialFocus]);
}

// Escape closes the top overlay only. Each open overlay pushes its handler on this stack.
const escapeStack: Array<{ current: () => void }> = [];
let escapeListening = false;

function onEscapeKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || escapeStack.length === 0) return;
  e.preventDefault();
  e.stopPropagation();
  escapeStack[escapeStack.length - 1]!.current();
}

/** True when an overlay (modal, drawer, menu, palette) is open. */
export function overlayOpen(): boolean {
  return escapeStack.length > 0;
}

/** Call the handler when the Escape key is pressed while active. Only the most recent overlay gets the key. */
export function useEscape(active: boolean, handler: () => void) {
  const saved = useRef(handler);
  useLayoutEffect(() => {
    saved.current = handler;
  });
  useEffect(() => {
    if (!active) return undefined;
    const entry = saved;
    escapeStack.push(entry);
    if (!escapeListening) {
      document.addEventListener("keydown", onEscapeKey, true);
      escapeListening = true;
    }
    return () => {
      const i = escapeStack.lastIndexOf(entry);
      if (i >= 0) escapeStack.splice(i, 1);
    };
  }, [active]);
}

/** True when the user asks for reduced motion. */
export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/**
 * Arrow key movement in a list (docs/07 shortcut "arrow keys move in lists").
 * Returns the index to move to, or null when the key is not a list key.
 */
export function nextListIndex(key: string, current: number, count: number, orientation: "vertical" | "horizontal" = "vertical"): number | null {
  if (count === 0) return null;
  const prev = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
  const next = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
  if (key === next) return current < 0 ? 0 : (current + 1) % count;
  if (key === prev) return current < 0 ? count - 1 : (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** Close a popup when the user clicks outside it. */
export function useOutsideClick(ref: RefObject<HTMLElement | null>, active: boolean, handler: () => void) {
  const saved = useRef(handler);
  useLayoutEffect(() => {
    saved.current = handler;
  });
  useEffect(() => {
    if (!active) return undefined;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) saved.current();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [active, ref]);
}
