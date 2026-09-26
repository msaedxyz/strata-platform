// The four default workspaces (docs/07 "Default workspaces") and their default layouts, in grid units.
// Grid: 12 columns. One row is the panel header height.
import type { WorkspaceDefinition } from "@strata/panel-framework";

export const workspaces: WorkspaceDefinition[] = [
  {
    id: "origination",
    name: "Origination",
    icon: "target",
    defaultPanels: [
      { i: "priority-list", x: 0, y: 0, w: 6, h: 18 },
      { i: "procurement-calendar", x: 6, y: 0, w: 6, h: 18 },
      { i: "project-pipeline", x: 0, y: 18, w: 6, h: 16 },
      { i: "deal-map", x: 6, y: 18, w: 6, h: 16 },
    ],
  },
  {
    id: "relationships",
    name: "Relationships",
    icon: "users",
    defaultPanels: [
      { i: "kanban", x: 0, y: 0, w: 12, h: 18 },
      { i: "relationship-panel", x: 0, y: 18, w: 7, h: 16 },
      { i: "next-actions", x: 7, y: 18, w: 5, h: 16 },
    ],
  },
  {
    id: "monitoring",
    name: "Monitoring",
    icon: "activity",
    defaultPanels: [
      { i: "ticker", x: 0, y: 0, w: 12, h: 3 },
      { i: "tier0-alerts", x: 0, y: 3, w: 4, h: 16 },
      { i: "demand-drivers", x: 4, y: 3, w: 4, h: 16 },
      { i: "signal-feed", x: 8, y: 3, w: 4, h: 32 },
      { i: "site-watch-list", x: 0, y: 19, w: 5, h: 16 },
      { i: "source-health", x: 5, y: 19, w: 3, h: 16 },
    ],
  },
  {
    id: "review",
    name: "Review",
    icon: "review",
    defaultPanels: [
      { i: "approval-queue", x: 0, y: 0, w: 8, h: 34 },
      { i: "quarantine", x: 8, y: 0, w: 4, h: 17 },
      { i: "alert-telemetry", x: 8, y: 17, w: 4, h: 17 },
    ],
  },
];

export function workspaceById(id: string): WorkspaceDefinition | undefined {
  return workspaces.find((w) => w.id === id);
}
