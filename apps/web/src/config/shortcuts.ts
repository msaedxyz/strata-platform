// The keyboard shortcut map. PROVISIONAL until audit/behaviour.md records the Infora shortcuts.
// This is the only place that defines shortcuts. SHORTCUTS.md documents them. Each shortcut has an end to end test.
// The file has no browser or Vite dependency, so the Playwright tests can import it.

export interface KeyBinding {
  /** KeyboardEvent.key, for example "/", "k", "?", "Escape". */
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDefinition {
  id: string;
  description: string;
  group: "General" | "Workspaces" | "Lists and overlays";
  /** Any one of the bindings starts the action. */
  bindings?: KeyBinding[];
  /** Keys pressed one after the other, for example ["g", "1"]. */
  sequence?: string[];
  /** Text for the help and the command input, for example "Ctrl K". */
  display: string[];
  /**
   * "app": the app shell handles the key. "component": a design system component handles it
   * (overlays close on Escape, lists move with the arrow keys).
   */
  scope: "app" | "component";
}

export const shortcuts: ShortcutDefinition[] = [
  {
    id: "command.open",
    description: "Open the command input",
    group: "General",
    bindings: [{ key: "/" }, { key: "k", ctrl: true }, { key: "k", meta: true }],
    display: ["/", "Ctrl K", "⌘ K"],
    scope: "app",
  },
  {
    id: "help.open",
    description: "Show the keyboard shortcuts",
    group: "General",
    bindings: [{ key: "?" }],
    display: ["?"],
    scope: "app",
  },
  { id: "workspace.1", description: "Go to Origination", group: "Workspaces", sequence: ["g", "1"], display: ["g 1"], scope: "app" },
  { id: "workspace.2", description: "Go to Relationships", group: "Workspaces", sequence: ["g", "2"], display: ["g 2"], scope: "app" },
  { id: "workspace.3", description: "Go to Monitoring", group: "Workspaces", sequence: ["g", "3"], display: ["g 3"], scope: "app" },
  { id: "workspace.4", description: "Go to Review", group: "Workspaces", sequence: ["g", "4"], display: ["g 4"], scope: "app" },
  {
    id: "overlay.close",
    description: "Close the open overlay (command input, help, dialog, drawer, menu) or restore a maximised panel",
    group: "Lists and overlays",
    bindings: [{ key: "Escape" }],
    display: ["Esc"],
    scope: "component",
  },
  {
    id: "list.move",
    description: "Move in a list (navigation, command results, menus, table rows, panel picker)",
    group: "Lists and overlays",
    bindings: [{ key: "ArrowUp" }, { key: "ArrowDown" }],
    display: ["↑", "↓"],
    scope: "component",
  },
];

/** The workspace for each "g <n>" sequence, in the order of the navigation. */
export const WORKSPACE_SHORTCUTS: Record<string, string> = {
  "workspace.1": "origination",
  "workspace.2": "relationships",
  "workspace.3": "monitoring",
  "workspace.4": "review",
};

export function shortcutById(id: string): ShortcutDefinition | undefined {
  return shortcuts.find((s) => s.id === id);
}

/** True when the key event matches the binding. Modifier keys must match exactly, except Shift for printable keys. */
export function matchesBinding(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">, b: KeyBinding): boolean {
  if (e.key.toLowerCase() !== b.key.toLowerCase()) return false;
  if (!!b.ctrl !== e.ctrlKey || !!b.meta !== e.metaKey || !!b.alt !== e.altKey) return false;
  if (b.shift !== undefined && b.shift !== e.shiftKey) return false;
  return true;
}
