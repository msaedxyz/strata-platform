// The read endpoints of docs/api-contract.md. The path and the query of each call are checked at compile time
// against the generated OpenAPI schema (packages/api-client). The response types are in ./types.
import type { paths } from "@strata/api-client";
import type { Http, Query } from "./http";
import type {
  Alert,
  BriefDiff,
  BriefList,
  BriefVersion,
  CalendarResponse,
  DealDetail,
  Deal,
  DemandDriver,
  EntityDetail,
  EvidenceItem,
  KnownGapsResponse,
  MapResponse,
  PriorityItem,
  Project,
  ProjectDetail,
  RelationshipResponse,
  Site,
  SignalsResponse,
  SourceHealthResponse,
  StagesConfig,
  Taxonomy,
  TickerResponse,
  TimelineResponse,
} from "./types";

type GetPath = { [P in keyof paths]: paths[P] extends { get: unknown } ? P : never }[keyof paths];
type QueryOf<P extends GetPath> = paths[P] extends { get: { parameters: { query?: infer Q } } } ? NonNullable<Q> : never;

/** Fill the {name} parts of a schema path. */
function fill(path: string, params: Record<string, string | number> = {}): string {
  return path.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(params[k] ?? "")));
}

export function createReads(http: Http) {
  const get = <T, P extends GetPath>(path: P, query?: QueryOf<P>, params?: Record<string, string | number>) =>
    http.get<T>(fill(path, params), query as Query | undefined);

  return {
    stages: () => get<StagesConfig, "/api/config/stages">("/api/config/stages"),
    taxonomy: () => get<Taxonomy, "/api/config/taxonomy">("/api/config/taxonomy"),
    ticker: (limit: number) => get<TickerResponse, "/api/ticker">("/api/ticker", { limit }),
    signals: (q: QueryOf<"/api/signals">) => get<SignalsResponse, "/api/signals">("/api/signals", q),
    demandDrivers: (limit: number) => get<{ items: DemandDriver[] }, "/api/demand-drivers">("/api/demand-drivers", { limit }),
    alerts: (q: QueryOf<"/api/alerts">) => get<{ items: Alert[] }, "/api/alerts">("/api/alerts", q),
    sites: (q: QueryOf<"/api/sites">) => get<{ items: Site[] }, "/api/sites">("/api/sites", q),
    entity: (id: string, asOf?: string) => get<EntityDetail, "/api/entities/{entity_id}">("/api/entities/{entity_id}", { as_of: asOf ?? null }, { entity_id: id }),
    map: (q: QueryOf<"/api/map">) => get<MapResponse, "/api/map">("/api/map", q),
    projects: () => get<{ items: Project[] }, "/api/projects">("/api/projects"),
    project: (id: string, asOf?: string) =>
      get<ProjectDetail, "/api/projects/{project_id}">("/api/projects/{project_id}", { as_of: asOf ?? null }, { project_id: id }),
    calendar: (months: number) => get<CalendarResponse, "/api/calendar">("/api/calendar", { months }),
    deals: () => get<{ items: Deal[] }, "/api/deals">("/api/deals"),
    deal: (id: string, asOf?: string) => get<DealDetail, "/api/deals/{deal_id}">("/api/deals/{deal_id}", { as_of: asOf ?? null }, { deal_id: id }),
    priority: (limit: number) => get<{ items: PriorityItem[] }, "/api/priority">("/api/priority", { limit }),
    relationship: (id: string) => get<RelationshipResponse, "/api/deals/{deal_id}/relationship">("/api/deals/{deal_id}/relationship", undefined, { deal_id: id }),
    timeline: (streamType: string, streamId: string, asOf?: string) =>
      get<TimelineResponse, "/api/timeline">("/api/timeline", { stream_type: streamType, stream_id: streamId, as_of: asOf ?? null }),
    evidence: (ids: readonly string[]) => get<{ items: EvidenceItem[] }, "/api/evidence">("/api/evidence", { ids: [...ids] }),
    sourceHealth: () => get<SourceHealthResponse, "/api/sources/health">("/api/sources/health"),
    knownGaps: () => get<KnownGapsResponse, "/api/sources/known-gaps">("/api/sources/known-gaps"),
    briefs: () => get<BriefList, "/api/briefs">("/api/briefs"),
    brief: (version: number) => get<BriefVersion, "/api/briefs/{version}">("/api/briefs/{version}", undefined, { version }),
    briefDiff: (from: number, to: number) => get<BriefDiff, "/api/briefs/diff">("/api/briefs/diff", { from, to }),
  };
}

export type Reads = ReturnType<typeof createReads>;
