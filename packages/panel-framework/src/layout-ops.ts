// Pure layout operations. The grid and the tests use them.
import { LAYOUT_SCHEMA_VERSION } from "./storage";
import type { PanelDefinition, PanelPlacement, WorkspaceDefinition, WorkspaceLayout } from "./types";

export function defaultLayout(ws: WorkspaceDefinition): WorkspaceLayout {
  return { version: LAYOUT_SCHEMA_VERSION, panels: ws.defaultPanels.map((p) => ({ ...p })), collapsed: {} };
}

const bottom = (panels: PanelPlacement[]) => panels.reduce((m, p) => Math.max(m, p.y + p.h), 0);

/** Collapse a panel to its header, or expand it to the height it had. */
export function toggleCollapse(layout: WorkspaceLayout, i: string, collapsedRows: number): WorkspaceLayout {
  const panel = layout.panels.find((p) => p.i === i);
  if (!panel) return layout;
  const collapsed = { ...layout.collapsed };
  let h: number;
  if (i in collapsed) {
    h = collapsed[i]!;
    delete collapsed[i];
  } else {
    collapsed[i] = panel.h;
    h = collapsedRows;
  }
  return { ...layout, collapsed, panels: layout.panels.map((p) => (p.i === i ? { ...p, h } : p)) };
}

export function removePanel(layout: WorkspaceLayout, i: string): WorkspaceLayout {
  const collapsed = { ...layout.collapsed };
  delete collapsed[i];
  return { ...layout, collapsed, panels: layout.panels.filter((p) => p.i !== i) };
}

/** Add a panel at the bottom left. Each module can be in a workspace once. */
export function addPanel(layout: WorkspaceLayout, def: PanelDefinition, cols: number): WorkspaceLayout {
  if (layout.panels.some((p) => p.i === def.id)) return layout;
  const w = Math.min(def.defaultSize.w, cols);
  return { ...layout, panels: [...layout.panels, { i: def.id, x: 0, y: bottom(layout.panels), w, h: def.defaultSize.h }] };
}

/** Take the positions from the grid library. The panel order stays the same. */
export function applyGridLayout(layout: WorkspaceLayout, items: ReadonlyArray<{ i: string; x: number; y: number; w: number; h: number }>): WorkspaceLayout {
  const byId = new Map(items.map((it) => [it.i, it]));
  let changed = false;
  const panels = layout.panels.map((p) => {
    const it = byId.get(p.i);
    if (!it) return p;
    if (it.x === p.x && it.y === p.y && it.w === p.w && it.h === p.h) return p;
    changed = true;
    return { i: p.i, x: it.x, y: it.y, w: it.w, h: it.h };
  });
  return changed ? { ...layout, panels } : layout;
}

/** Move a panel by grid units. Used by the keyboard actions in the panel menu. */
export function movePanel(layout: WorkspaceLayout, i: string, dx: number, dy: number, cols: number): WorkspaceLayout {
  return {
    ...layout,
    panels: layout.panels.map((p) => (p.i === i ? { ...p, x: Math.max(0, Math.min(cols - p.w, p.x + dx)), y: Math.max(0, p.y + dy) } : p)),
  };
}

/** Resize a panel by grid units. Used by the keyboard actions in the panel menu. */
export function resizePanel(layout: WorkspaceLayout, i: string, dw: number, dh: number, cols: number, min: { w: number; h: number }): WorkspaceLayout {
  return {
    ...layout,
    panels: layout.panels.map((p) =>
      p.i === i ? { ...p, w: Math.max(min.w, Math.min(cols - p.x, p.w + dw)), h: Math.max(min.h, p.h + dh) } : p,
    ),
  };
}
