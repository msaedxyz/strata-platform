import type { IconName } from "@strata/design-system";
import type { ComponentType } from "react";

/** Roles from docs/06-governance.md, lowest first. */
export type Role = "viewer" | "analyst" | "approver" | "admin";
export const ROLE_ORDER: Role[] = ["viewer", "analyst", "approver", "admin"];

export function roleAtLeast(role: Role | null | undefined, needed: Role | undefined): boolean {
  if (!needed) return true;
  if (!role) return false;
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(needed);
}

export interface PanelSize {
  w: number;
  h: number;
}

/** Props that the grid gives to each panel component. */
export interface PanelProps {
  moduleId: string;
  maximised: boolean;
}

/** A module that can be a panel. The app registers each module in the panel registry. */
export interface PanelDefinition {
  id: string;
  title: string;
  description?: string;
  icon?: IconName;
  component: ComponentType<PanelProps>;
  defaultSize: PanelSize;
  minSize?: PanelSize;
  /** The lowest role that can add and see the panel. Default: viewer. */
  minRole?: Role;
  /** The panel shows live data. */
  live?: boolean;
  /** The body has no padding, for tables and maps. */
  flush?: boolean;
}

/** One panel in a layout, in grid units. The panel id is the module id. */
export interface PanelPlacement {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A saved workspace layout. */
export interface WorkspaceLayout {
  version: number;
  panels: PanelPlacement[];
  /** Collapsed panels, with the height to restore on expand. */
  collapsed: Record<string, number>;
}

export interface WorkspaceDefinition {
  id: string;
  name: string;
  icon: IconName;
  /** The default layout. Reset layout goes back to it. */
  defaultPanels: PanelPlacement[];
}
