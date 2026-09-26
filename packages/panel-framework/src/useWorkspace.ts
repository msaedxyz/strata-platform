import { useCallback, useEffect, useMemo, useState } from "react";
import { gridSettings } from "./config";
import { addPanel, applyGridLayout, defaultLayout, movePanel, removePanel, resizePanel, toggleCollapse } from "./layout-ops";
import type { PanelRegistry } from "./registry";
import type { LayoutStore } from "./storage";
import type { WorkspaceDefinition, WorkspaceLayout } from "./types";

export interface WorkspaceController {
  workspace: WorkspaceDefinition;
  layout: WorkspaceLayout;
  maximisedId: string | null;
  pickerOpen: boolean;
  setGridLayout: (items: ReadonlyArray<{ i: string; x: number; y: number; w: number; h: number }>) => void;
  toggleCollapse: (id: string) => void;
  toggleMaximise: (id: string) => void;
  restore: () => void;
  close: (id: string) => void;
  add: (moduleId: string) => void;
  move: (id: string, dx: number, dy: number) => void;
  resize: (id: string, dw: number, dh: number) => void;
  reset: () => void;
  openPicker: () => void;
  closePicker: () => void;
}

/** The state of one workspace: its layout (saved in the store), the maximised panel and the panel picker. */
export function useWorkspace(workspace: WorkspaceDefinition, store: LayoutStore, registry: PanelRegistry): WorkspaceController {
  // One state object for all workspaces. Each update names its workspace, so an update that arrives
  // after a workspace change can never write one workspace's layout into another.
  const [layouts, setLayouts] = useState<Record<string, WorkspaceLayout>>(() => ({
    [workspace.id]: store.load(workspace.id) ?? defaultLayout(workspace),
  }));
  const [maximisedId, setMaximisedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const wsId = workspace.id;
  const stored = layouts[wsId];
  const layout = stored ?? store.load(wsId) ?? defaultLayout(workspace);

  useEffect(() => {
    // A workspace that is not in the state yet comes from the store.
    if (!stored) setLayouts((all) => (all[wsId] ? all : { ...all, [wsId]: layout }));
    setMaximisedId(null);
    setPickerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  useEffect(() => {
    if (stored) store.save(wsId, stored);
  }, [stored, store, wsId]);

  const { cols, collapsedRows } = gridSettings;

  const setLayout = useCallback(
    (fn: (l: WorkspaceLayout) => WorkspaceLayout) =>
      setLayouts((all) => {
        const current = all[wsId] ?? store.load(wsId) ?? defaultLayout(workspace);
        const next = fn(current);
        return next === all[wsId] ? all : { ...all, [wsId]: next };
      }),
    [wsId, store, workspace],
  );

  const setGridLayout = useCallback<WorkspaceController["setGridLayout"]>((items) => setLayout((l) => applyGridLayout(l, items)), [setLayout]);
  const collapse = useCallback((id: string) => setLayout((l) => toggleCollapse(l, id, collapsedRows)), [setLayout, collapsedRows]);
  const toggleMaximise = useCallback((id: string) => setMaximisedId((m) => (m === id ? null : id)), []);
  const restore = useCallback(() => setMaximisedId(null), []);
  const close = useCallback((id: string) => {
    setMaximisedId((m) => (m === id ? null : m));
    setLayout((l) => removePanel(l, id));
  }, [setLayout]);
  const add = useCallback(
    (moduleId: string) => {
      const def = registry.get(moduleId);
      if (def) setLayout((l) => addPanel(l, def, cols));
    },
    [registry, cols, setLayout],
  );
  const move = useCallback((id: string, dx: number, dy: number) => setLayout((l) => movePanel(l, id, dx, dy, cols)), [cols, setLayout]);
  const resize = useCallback(
    (id: string, dw: number, dh: number) => {
      const min = registry.get(id)?.minSize ?? { w: 1, h: 2 };
      setLayout((l) => (id in l.collapsed ? l : resizePanel(l, id, dw, dh, cols, min)));
    },
    [registry, cols, setLayout],
  );
  const reset = useCallback(() => {
    store.clear(wsId);
    setMaximisedId(null);
    setLayout(() => defaultLayout(workspace));
  }, [store, wsId, workspace, setLayout]);

  return useMemo(
    () => ({
      workspace,
      layout,
      maximisedId,
      pickerOpen,
      setGridLayout,
      toggleCollapse: collapse,
      toggleMaximise,
      restore,
      close,
      add,
      move,
      resize,
      reset,
      openPicker: () => setPickerOpen(true),
      closePicker: () => setPickerOpen(false),
    }),
    [workspace, layout, maximisedId, pickerOpen, setGridLayout, collapse, toggleMaximise, restore, close, add, move, resize, reset],
  );
}
