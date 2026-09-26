// @strata/panel-framework: the panel grid, the panel registry, workspaces and layout storage.
export { PanelGrid, type PanelGridProps } from "./PanelGrid";
export { PanelPicker, type PanelPickerProps } from "./PanelPicker";
export { useWorkspace, type WorkspaceController } from "./useWorkspace";
export { createPanelRegistry, type PanelRegistry } from "./registry";
export { LocalStorageLayoutStore, MemoryLayoutStore, layoutKey, LAYOUT_SCHEMA_VERSION, type LayoutStore, type LocalStorageLayoutStoreOptions } from "./storage";
export { addPanel, applyGridLayout, defaultLayout, movePanel, removePanel, resizePanel, toggleCollapse } from "./layout-ops";
export { gridSettings, tokenPx, type GridSettings } from "./config";
export {
  ROLE_ORDER,
  roleAtLeast,
  type PanelDefinition,
  type PanelPlacement,
  type PanelProps,
  type PanelSize,
  type Role,
  type WorkspaceDefinition,
  type WorkspaceLayout,
} from "./types";
