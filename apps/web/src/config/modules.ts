// Module settings: which live event types each module listens to, how it batches them, page sizes and refresh rules.
// Values here are behaviour, not visual values. Visual values come from the design tokens.
// The event types are the event_type values of the event store (config/event-schemas.yaml). The live stream
// (/api/live) sends one message for each event insert, with the event type as the SSE event name.

/** How long a module collects live events before it reloads once. Keeps each update short (docs/07 criterion 7). */
export const LIVE_BATCH_MS = 200;

const PROPOSAL_EVENTS = ["ProposalCreated", "ProposalApproved", "ProposalRejected", "ProposalEditedApproved"] as const;
const DEAL_EVENTS = ["DealIdentified", "DealStageChanged", "DealAttributeAsserted", ...PROPOSAL_EVENTS] as const;
const ENGAGEMENT_EVENTS = ["ContactAdded", "TouchpointLogged", "NextActionSet", "PrequalificationStatusChanged"] as const;
const ALERT_EVENTS = ["AlertRaised", "AlertAcknowledged", "AlertConfirmed", "AlertDismissed"] as const;
const PROJECT_EVENTS = ["ProjectStageChanged", "ProcurementWindowForecast", "DemandEstimated", "EntityIdentified", "RelationshipAsserted"] as const;

export interface LiveRule {
  /** Event types that make the module reload or patch its data. */
  events: readonly string[];
  batchMs: number;
}

export const moduleConfig = {
  ticker: {
    live: { events: ["SignalScored", "AlertRaised"], batchMs: LIVE_BATCH_MS },
    /** Items in the ticker. */
    limit: 40,
  },
  "tier0-alerts": {
    live: { events: ALERT_EVENTS, batchMs: LIVE_BATCH_MS },
    /** The module shows alerts of this tier. */
    tier: 0,
    limit: 100,
  },
  "demand-drivers": {
    live: { events: ["DemandDriverObserved"], batchMs: LIVE_BATCH_MS },
    limit: 100,
    estimateItemPx: 88,
  },
  "site-watch-list": {
    live: {
      events: ["SiteStatusChanged", "EntityIdentified", "EntityAttributeAsserted", "RelationshipAsserted", "SignalScored", "EntityMerged", ...PROPOSAL_EVENTS],
      batchMs: LIVE_BATCH_MS,
    },
    /** Tables with more rows than this render only the rows in view. */
    virtualizeAbove: 100,
  },
  "signal-feed": {
    live: { events: ["SignalScored"], batchMs: LIVE_BATCH_MS },
    /** Signals in one page of the feed. The next page loads near the end of the list. */
    pageSize: 200,
    /** On a live event, the feed reads this many of the newest signals and adds the new ones at the top. */
    livePatchSize: 50,
    /** Wait after the last key press before the text filter queries the API. */
    searchDebounceMs: 300,
    estimateItemPx: 96,
  },
  "deal-map": {
    live: { events: ["EntityIdentified", "SiteStatusChanged", "SignalScored", ...DEAL_EVENTS, ...PROJECT_EVENTS], batchMs: LIVE_BATCH_MS },
    /** Start view: Zambia and its neighbours (west south, east north). */
    bounds: [
      [21.5, -18.5],
      [34, -8],
    ] as [[number, number], [number, number]],
    center: [27.85, -13.13] as [number, number],
    zoom: 4.6,
    /** World-atlas dataset (Natural Earth, public domain) and the ISO 3166-1 numeric codes of the countries to draw. */
    atlas: "countries-50m" as const,
    focusCountry: "894",
    countries: ["894", "180", "024", "834", "716", "072", "454", "516", "508"],
  },
  kanban: {
    live: { events: DEAL_EVENTS, batchMs: LIVE_BATCH_MS },
  },
  "priority-list": {
    live: { events: [...DEAL_EVENTS, ...ENGAGEMENT_EVENTS, "DemandEstimated", "ProcurementWindowForecast"], batchMs: LIVE_BATCH_MS },
    limit: 500,
    virtualizeAbove: 100,
  },
  "project-pipeline": {
    live: { events: PROJECT_EVENTS, batchMs: LIVE_BATCH_MS },
    virtualizeAbove: 100,
  },
  "procurement-calendar": {
    live: { events: PROJECT_EVENTS, batchMs: LIVE_BATCH_MS },
    months: 24,
  },
  "relationship-panel": {
    live: { events: [...ENGAGEMENT_EVENTS, "RelationshipAsserted", "DealStageChanged", ...PROPOSAL_EVENTS], batchMs: LIVE_BATCH_MS },
  },
  "next-actions": {
    live: { events: ["NextActionSet", ...DEAL_EVENTS], batchMs: LIVE_BATCH_MS },
    virtualizeAbove: 100,
  },
  timeline: {
    /** Not live (docs/07). The user reloads or changes the "as of" date. */
    live: null,
  },
  "approval-queue": {
    live: { events: PROPOSAL_EVENTS, batchMs: LIVE_BATCH_MS },
    status: "pending",
  },
  quarantine: {
    live: null,
    limit: 200,
  },
  "source-health": {
    live: { events: ["BriefVersionActivated", "collector_run"], batchMs: LIVE_BATCH_MS },
    /** Collector runs are not events, so the module also reloads on this interval. */
    refreshMs: 60_000,
  },
  "brief-editor": {
    live: null,
  },
  "alert-telemetry": {
    live: { events: ALERT_EVENTS, batchMs: LIVE_BATCH_MS },
  },
} as const satisfies Record<string, { live: LiveRule | null } & Record<string, unknown>>;

export type ModuleId = keyof typeof moduleConfig;

/** The live event types of a module, or an empty list for a module that is not live. */
export function liveEvents(id: ModuleId): readonly string[] {
  return moduleConfig[id].live?.events ?? [];
}
