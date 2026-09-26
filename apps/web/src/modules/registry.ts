// The Strata modules in the panel registry. Each module is a panel in the Infora panel framework (docs/07).
import { createPanelRegistry, type PanelProps } from "@strata/panel-framework";
import type { ComponentType } from "react";
import { AlertsModule } from "./AlertsModule";
import { AlertTelemetryModule } from "./AlertTelemetryModule";
import { ApprovalQueueModule } from "./ApprovalQueueModule";
import { BriefEditorModule } from "./BriefEditorModule";
import { DealMapModule } from "./DealMapModule";
import { DemandDriversModule } from "./DemandDriversModule";
import { KanbanModule } from "./KanbanModule";
import { NextActionsModule } from "./NextActionsModule";
import { PriorityListModule } from "./PriorityListModule";
import { ProcurementCalendarModule } from "./ProcurementCalendarModule";
import { ProjectPipelineModule } from "./ProjectPipelineModule";
import { QuarantineModule } from "./QuarantineModule";
import { RelationshipPanelModule } from "./RelationshipPanelModule";
import { SignalFeedModule } from "./SignalFeedModule";
import { SiteWatchListModule } from "./SiteWatchListModule";
import { SourceHealthModule } from "./SourceHealthModule";
import { MODULES } from "./specs";
import { TickerModule } from "./TickerModule";
import { TimelineModule } from "./TimelineModule";

export { MODULES, MODULE_IDS, type ModuleSpec } from "./specs";

/** The component of each module. A test checks that each module id has one. */
export const MODULE_COMPONENTS: Record<string, ComponentType<PanelProps>> = {
  ticker: TickerModule,
  "tier0-alerts": AlertsModule,
  "demand-drivers": DemandDriversModule,
  "site-watch-list": SiteWatchListModule,
  "signal-feed": SignalFeedModule,
  "deal-map": DealMapModule,
  kanban: KanbanModule,
  "priority-list": PriorityListModule,
  "project-pipeline": ProjectPipelineModule,
  "procurement-calendar": ProcurementCalendarModule,
  "relationship-panel": RelationshipPanelModule,
  timeline: TimelineModule,
  "approval-queue": ApprovalQueueModule,
  quarantine: QuarantineModule,
  "source-health": SourceHealthModule,
  "brief-editor": BriefEditorModule,
  "alert-telemetry": AlertTelemetryModule,
  "next-actions": NextActionsModule,
};

export const moduleRegistry = createPanelRegistry(
  MODULES.map((m) => {
    const component = MODULE_COMPONENTS[m.id];
    if (!component) throw new Error(`module registry: no component for ${m.id}`);
    return { ...m, component };
  }),
);
