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
  const [layout, setLayout] = useState<WorkspaceLayout>(() => store.load(workspace.id) ?? defaultLayout(workspace));
  const [loadedFor, setLoadedFor] = useState(workspace.id);
  const [maximisedId, setMaximisedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // A new workspace loads its own layout.
  if (loadedFor !== workspace.id) {
    setLoadedFor(workspace.id);
    setLayout(store.load(workspace.id) ?? defaultLayout(workspace));
    setMaximisedId(null);
    setPickerOpen(false);
  }

  useEffect(() => {
    if (loadedFor === workspace.id) store.save(workspace.id, layout);
  }, [layout, loadedFor, store, workspace.id]);

  const { cols, collapsedRows } = gridSettings;

  const setGridLayout = useCallback<WorkspaceController["setGridLayout"]>((items) => setLayout((l) => applyGridLayout(l, items)), []);
  const collapse = useCallback((id: string) => setLayout((l) => toggleCollapse(l, id, collapsedRows)), [collapsedRows]);
  const toggleMaximise = useCallback((id: string) => setMaximisedId((m) => (m === id ? null : id)), []);
  const restore = useCallback(() => setMaximisedId(null), []);
  const close = useCallback((id: string) => {
    setMaximisedId((m) => (m === id ? null : m));
    setLayout((l) => removePanel(l, id));
  }, []);
  const add = useCallback(
    (moduleId: string) => {
      const def = registry.get(moduleId);
      if (def) setLayout((l) => addPanel(l, def, cols));
    },
    [registry, cols],
  );
  const move = useCallback((id: string, dx: number, dy: number) => setLayout((l) => movePanel(l, id, dx, dy, cols)), [cols]);
  const resize = useCallback(
    (id: string, dw: number, dh: number) => {
      const min = registry.get(id)?.minSize ?? { w: 1, h: 2 };
      setLayout((l) => (id in l.collapsed ? l : resizePanel(l, id, dw, dh, cols, min)));
    },
    [registry, cols],
  );
  const reset = useCallback(() => {
    store.clear(workspace.id);
    setMaximisedId(null);
    setLayout(defaultLayout(workspace));
  }, [store, workspace]);

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
