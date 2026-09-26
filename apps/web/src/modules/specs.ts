// The Strata modules (docs/07 "Strata modules"). Each module is a panel in the Infora panel framework.
import type { PanelDefinition } from "@strata/panel-framework";

export type ModuleSpec = Omit<PanelDefinition, "component">;

export const MODULES: ModuleSpec[] = [
  { id: "ticker", title: "Ticker strip", description: "Latest Tier 0 and Tier 1 signals, and counts by tier", icon: "live", defaultSize: { w: 12, h: 3 }, minSize: { w: 4, h: 2 }, live: true },
  { id: "tier0-alerts", title: "Tier 0 alerts", description: "Alert feed with status, acknowledge, confirm and dismiss", icon: "alert", defaultSize: { w: 4, h: 16 }, live: true },
  { id: "demand-drivers", title: "Demand drivers", description: "Market events that change diesel demand for all customers", icon: "activity", defaultSize: { w: 4, h: 16 }, live: true },
  { id: "site-watch-list", title: "Site watch list", description: "Sites in the active brief, with status, operator and last signal", icon: "target", defaultSize: { w: 5, h: 16 }, live: true, flush: true },
  { id: "signal-feed", title: "Signal feed", description: "All in scope items, with filters by sector, geography and tier", icon: "activity", defaultSize: { w: 4, h: 32 }, live: true, flush: true },
  { id: "deal-map", title: "Geographic deal map", description: "Zambia and the corridors, with sites, opportunities and signals", icon: "target", defaultSize: { w: 6, h: 16 }, live: true, flush: true },
  { id: "kanban", title: "Kanban stage board", description: "One column for each deal stage", icon: "layout", defaultSize: { w: 12, h: 18 }, live: true },
  { id: "priority-list", title: "Priority list", description: "Opportunities ranked by lead time, demand, confidence and buyer fit", icon: "sort", defaultSize: { w: 6, h: 18 }, live: true, flush: true },
  { id: "project-pipeline", title: "Project pipeline", description: "Projects by lifecycle stage, with the engagement window", icon: "layout", defaultSize: { w: 6, h: 16 }, live: true },
  { id: "procurement-calendar", title: "Procurement calendar", description: "Forecast procurement windows on a 24 month axis", icon: "calendar", defaultSize: { w: 6, h: 18 }, live: true, flush: true },
  { id: "relationship-panel", title: "Relationship panel", description: "Buyer roles, contacts, touchpoints, next action and prequalification", icon: "users", defaultSize: { w: 7, h: 16 }, live: true },
  { id: "timeline", title: "Timeline", description: "Events for an entity or a deal, with evidence and an as of date", icon: "calendar", defaultSize: { w: 6, h: 14 } },
  { id: "approval-queue", title: "Approval queue", description: "Proposals with evidence", icon: "review", defaultSize: { w: 8, h: 34 }, live: true },
  { id: "quarantine", title: "Quarantine", description: "Rejected agent output with reason codes", icon: "error", defaultSize: { w: 4, h: 17 } },
  { id: "source-health", title: "Source health", description: "Status of each source", icon: "live", defaultSize: { w: 3, h: 16 }, live: true, flush: true },
  { id: "brief-editor", title: "Brief editor", description: "Edit the brief, compare versions and activate a version", icon: "evidence", defaultSize: { w: 8, h: 20 }, minRole: "admin" },
  { id: "alert-telemetry", title: "Alert telemetry", description: "Latency, time to acknowledgement and false positive rates", icon: "activity", defaultSize: { w: 4, h: 17 }, live: true },
  { id: "next-actions", title: "Next actions", description: "Next action for each opportunity, by due date", icon: "check", defaultSize: { w: 5, h: 16 }, live: true },
];

export const MODULE_IDS = MODULES.map((m) => m.id);
