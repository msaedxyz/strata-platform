// Response types of the read endpoints in services/api/routers/read.py and services/api/routers/sources.py.
// The generated schema (packages/api-client) types these responses as plain objects, so the shapes are here.
// Keep them the same as the SQL columns in db/migrations/0002_projections.sql and the dicts in the routers.

export type Iso = string;
export type Certainty = "stated" | "reported" | "speculative";
export type AlertStatus = "unconfirmed" | "confirmed" | "dismissed" | "false_positive";

export interface CodeName {
  code: string;
  name: string;
}

export interface DealStage extends CodeName {
  order: number;
  terminal: boolean;
}

export interface LifecycleStage extends CodeName {
  order: number;
}

/** GET /api/config/stages */
export interface StagesConfig {
  deal_stages: DealStage[];
  lifecycle_stages: LifecycleStage[];
  restart_path: CodeName[];
  engagement_window: { from: string; to: string };
  procurement_stage: string;
}

export interface Geography extends CodeName {
  level: "country" | "province" | "district" | "corridor";
  parent?: string;
  countries?: string[];
  description?: string;
}

/** GET /api/config/taxonomy */
export interface Taxonomy {
  sectors: CodeName[];
  site_classes: CodeName[];
  geographies: Geography[];
  deal_types: Array<CodeName & { description?: string }>;
}

/** proj_signal */
export interface Signal {
  id: string;
  source_id: string;
  title: string;
  url: string;
  publisher: string | null;
  published_at: Iso | null;
  fetched_at: Iso | null;
  tier: number;
  tier_rule: string | null;
  score: number;
  breakdown: Record<string, unknown>;
  sectors: string[];
  geographies: string[];
  themes: string[];
  directions: string[];
  deal_types: string[];
  entity_ids: string[];
  summary: string[] | string | null;
  certainty: Certainty | null;
  read_at_source: boolean;
  evidence_ids: string[];
  event_id: string;
  recorded_at: Iso;
}

export type TickerSignal = Pick<
  Signal,
  "id" | "title" | "url" | "publisher" | "published_at" | "tier" | "tier_rule" | "score" | "read_at_source" | "evidence_ids" | "recorded_at"
>;

/** GET /api/ticker */
export interface TickerResponse {
  items: TickerSignal[];
  counts: Array<{ tier: number; day: number; week: number; total: number }>;
}

/** GET /api/signals */
export interface SignalsResponse {
  total: number;
  items: Signal[];
}

/** proj_demand_driver with the source link. GET /api/demand-drivers */
export interface DemandDriver {
  event_id: string;
  driver_type: string;
  title: string;
  direction: "demand_up" | "demand_down" | "procurement" | "project_pipeline" | string;
  geography: string[];
  certainty: Certainty | null;
  observed_at: Iso | null;
  source_id: string | null;
  evidence_ids: string[];
  detail: Record<string, unknown>;
  recorded_at: Iso;
  url: string | null;
  publisher: string | null;
  published_at: Iso | null;
}

/** proj_alert with the source link. GET /api/alerts */
export interface Alert {
  id: string;
  tier: number;
  tier_rule: string;
  title: string;
  status: AlertStatus;
  stream_type: string | null;
  stream_id: string | null;
  signal_id: string | null;
  source_id: string | null;
  evidence_ids: string[];
  published_at: Iso | null;
  fetched_at: Iso | null;
  raised_at: Iso;
  acknowledged_at: Iso | null;
  acknowledged_by: string | null;
  decided_at: Iso | null;
  decided_by: string | null;
  decision_reason: string | null;
  updated_at: Iso;
  url: string | null;
  publisher: string | null;
}

/** An attribute of an entity in the fold: the value with its event and evidence. */
export interface Attribute {
  value: unknown;
  event_id: string;
  certainty?: Certainty | null;
  evidence_ids: string[];
}

/** GET /api/sites */
export interface Site {
  id: string;
  name: string;
  aliases: string[];
  site_class: string | null;
  watch: "daily" | "weekly" | "none";
  status: string | null;
  status_pending: string | null;
  district: string | null;
  province: string | null;
  lat: number | null;
  lon: number | null;
  geometry_approximate: boolean | null;
  last_signal_at: Iso | null;
  attributes: Record<string, Attribute>;
  operator_id: string | null;
  operator_name: string | null;
}

export interface MapSite {
  id: string;
  name: string;
  site_class: string | null;
  watch: string;
  status: string | null;
  status_pending: string | null;
  lat: number;
  lon: number;
  geometry_approximate: boolean | null;
  last_signal_at: Iso | null;
  signals_90d: number;
}

export interface MapDeal {
  id: string;
  title: string;
  stage: string;
  stage_pending: string | null;
  deal_type: string | null;
  site_id: string;
  priority_score: number | null;
}

export interface MapProject {
  id: string;
  name: string;
  site_id: string;
  stage: string | null;
  sector: string | null;
  in_engagement_window: boolean;
  forecast_start: string | null;
  forecast_end: string | null;
}

/** GET /api/map */
export interface MapResponse {
  sites: MapSite[];
  deals: MapDeal[];
  projects: MapProject[];
}

/** One interval of the window forecast (docs/05 window forecaster). */
export interface ForecastInterval {
  from: string;
  to: string;
  median_days: number;
  min_days?: number;
  max_days?: number;
  n_projects: number;
  projects: string[];
}

export interface ForecastDetail {
  current_stage: string;
  start: string | null;
  end: string | null;
  intervals: ForecastInterval[];
  shift_months_nearer?: number | null;
  event_id: string;
  evidence_ids: string[];
}

export interface DemandEstimate {
  formula_id: string;
  expression: string;
  inputs: Record<string, { value: unknown; evidence_ids: string[] }>;
  value: number;
  unit: string;
  label: "estimate";
  event_id: string;
}

/** proj_project with the site. GET /api/projects */
export interface Project {
  id: string;
  name: string;
  site_id: string | null;
  project_type: string | null;
  sector: string | null;
  stage: string | null;
  stage_order: number | null;
  stage_evidence_ids: string[];
  stage_certainty: Certainty | null;
  stage_changed_at: Iso | null;
  in_engagement_window: boolean;
  first_trace_at: Iso | null;
  forecast_start: string | null;
  forecast_end: string | null;
  forecast_detail: ForecastDetail | null;
  demand_estimate: DemandEstimate | null;
  updated_at: Iso;
  site_name: string | null;
  site_class: string | null;
}

/** GET /api/calendar */
export interface CalendarResponse {
  months: number;
  items: Array<
    Pick<Project, "id" | "name" | "stage" | "stage_order" | "in_engagement_window" | "forecast_start" | "forecast_end" | "forecast_detail" | "site_id" | "site_name">
  >;
}

export interface NextAction {
  action: string;
  owner_user_id: string;
  due_date: string;
  event_id?: string;
}

/** proj_deal with the site and the organisation. GET /api/deals */
export interface Deal {
  id: string;
  title: string;
  deal_type: string | null;
  stage: string;
  stage_pending: string | null;
  pending_proposal_id: string | null;
  site_id: string | null;
  project_id: string | null;
  organisation_id: string | null;
  buyer_fit: number | null;
  confidence: number | null;
  lead_time_days: number | null;
  demand_litres_month: number | null;
  has_contact: boolean;
  prequalification_status: string | null;
  next_action: NextAction | null;
  priority_score: number | null;
  priority_breakdown: Record<string, unknown> | null;
  evidence_ids: string[];
  created_at: Iso;
  updated_at: Iso;
  site_name?: string | null;
  organisation_name?: string | null;
}

/** GET /api/priority */
export type PriorityItem = Pick<
  Deal,
  | "id"
  | "title"
  | "deal_type"
  | "stage"
  | "stage_pending"
  | "site_id"
  | "project_id"
  | "lead_time_days"
  | "demand_litres_month"
  | "confidence"
  | "buyer_fit"
  | "has_contact"
  | "priority_score"
  | "priority_breakdown"
  | "evidence_ids"
> & { site_name: string | null };

/** proj_relationship */
export interface Relationship {
  event_id: string;
  subject_id: string;
  predicate: string;
  object_id: string;
  certainty: Certainty | null;
  evidence_ids: string[];
  superseded_by: string | null;
  recorded_at: Iso;
  organisation_name?: string | null;
  subject_name?: string | null;
  object_name?: string | null;
}

/** proj_engagement. The team is the source, so these rows have no evidence (docs/03). */
export interface Engagement {
  event_id: string;
  deal_id: string;
  kind: "contact" | "touchpoint" | "next_action" | "prequalification";
  actor_id: string;
  data: Record<string, unknown>;
  recorded_at: Iso;
}

/** GET /api/deals/{id}/relationship */
export interface RelationshipResponse {
  deal: Deal;
  buyer_roles: Relationship[];
  contacts: Engagement[];
  touchpoints: Engagement[];
  next_action: Engagement | null;
  prequalification: Engagement[];
}

/** GET /api/deals/{id}?as_of= */
export interface DealDetail {
  deal: Deal & {
    attributes: Record<string, Attribute>;
    stage_history: Array<{ from: string | null; to: string; event_id: string; at: Iso }>;
    touchpoints: number;
  };
  as_of: Iso | null;
}

export interface Fact {
  event_id: string;
  stream_type: string;
  stream_id: string;
  predicate: string;
  value: unknown;
  certainty: Certainty | null;
  evidence_ids: string[];
  superseded_by: string | null;
  retracted: boolean;
  recorded_at: Iso;
}

/** GET /api/entities/{id}?as_of= */
export interface EntityDetail {
  entity: {
    id: string;
    type: string;
    name: string;
    aliases: string[];
    site_class: string | null;
    watch: string;
    status: string | null;
    status_pending: string | null;
    district: string | null;
    province: string | null;
    attributes: Record<string, Attribute>;
  };
  registry: { geometry_source: unknown; external_ids: Record<string, unknown> } | null;
  facts: Fact[];
  relationships: Relationship[];
  signals: Array<Pick<Signal, "id" | "title" | "url" | "publisher" | "published_at" | "tier" | "score" | "evidence_ids">>;
  as_of: Iso | null;
}

/** GET /api/projects/{id}?as_of= */
export interface ProjectDetail {
  project: Project & { stage_history: Array<{ from: string | null; to: string; event_id: string; at: Iso }> };
  relationships: Relationship[];
  as_of: Iso | null;
}

export interface TimelineEvent {
  id: string;
  sequence: number;
  event_type: string;
  payload: Record<string, unknown>;
  evidence_ids: string[];
  certainty: Certainty | null;
  actor_type: "agent" | "human" | "system";
  actor_id: string;
  proposal_id: string | null;
  supersedes_event_id: string | null;
  occurred_at: Iso | null;
  recorded_at: Iso;
}

/** GET /api/timeline */
export interface TimelineResponse {
  items: TimelineEvent[];
  proposals: Array<{ id: string; title: string; status: string; created_at: Iso; decided_at: Iso | null; decided_by: string | null }>;
  state: Record<string, unknown> | null;
  as_of: Iso | null;
}

/** GET /api/evidence?ids= */
export interface EvidenceItem {
  id: string;
  source_id: string;
  char_start: number;
  char_end: number;
  quote: string;
  verified: boolean;
  url: string;
  title: string | null;
  publisher: string | null;
  published_at: Iso | null;
  retention_policy: "full" | "verify_then_purge" | "link_only";
  read_at_source: boolean;
  excerpt: string | null;
  type: string;
  context: string | null;
}

/** GET /api/sources/health */
export interface SourceHealth {
  id: string;
  name: string;
  kind: string;
  section: string | null;
  source_type: string | null;
  url: string | null;
  schedule: string;
  licence_code: string | null;
  retention_policy: string | null;
  last_success_at: Iso | null;
  last_run_at: Iso | null;
  last_status: "success" | "failed" | null;
  runs: number;
  error_rate: number | null;
  documents_per_run: number | null;
  new_per_run: number | null;
  last_documents_found: number | null;
  last_error: string | null;
  last_error_at: Iso | null;
  next_run_at: Iso;
}

export interface KnownGap {
  name: string;
  reason: string;
  workaround?: string;
}

export interface SourceHealthResponse {
  brief_version: number | null;
  brief_version_id?: string;
  sources: SourceHealth[];
  known_gaps: KnownGap[];
}

export interface KnownGapsResponse {
  brief_version: number | null;
  known_gaps: KnownGap[];
}

export interface BriefSummary {
  id: string;
  version: number;
  name: string;
  created_by: string;
  created_at: Iso;
  parent_version_id: string | null;
  change_note: string | null;
  content_hash: string;
  active: boolean;
}

/** GET /api/briefs */
export interface BriefList {
  active_version: number | null;
  versions: BriefSummary[];
}

/** GET /api/briefs/{version} */
export interface BriefVersion extends BriefSummary {
  content: Record<string, unknown>;
  yaml: string;
}

export interface BriefChange {
  path: string;
  op: "added" | "removed" | "changed";
  from?: unknown;
  to?: unknown;
  added?: unknown[];
  removed?: unknown[];
}

/** GET /api/briefs/diff */
export interface BriefDiff {
  from: number;
  to: number;
  changes: BriefChange[];
}

/** One row of the quarantine table (db/migrations/0001_core.sql). GET /api/quarantine (M3). */
export interface QuarantineItem {
  id: string;
  source_id: string | null;
  agent: string;
  reason_code: string;
  detail: Record<string, unknown>;
  output: unknown;
  model_id: string | null;
  prompt_version: string | null;
  created_at: Iso;
}

export interface QuarantineResponse {
  items: QuarantineItem[];
}

/** A live message: one event insert (db trigger event_notify). */
export interface LiveMessage {
  id?: string;
  stream_type?: string;
  stream_id?: string;
  event_type?: string;
  channel?: string;
}
