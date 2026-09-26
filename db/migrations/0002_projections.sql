-- Read models built from events. Each table can be deleted and rebuilt from the event store.
-- The projector writes these tables. The API reads them.
SET search_path = strata, public;

CREATE TABLE proj_entity (
  id text PRIMARY KEY,
  type text NOT NULL,
  name text NOT NULL,
  normalised_name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  site_class text,
  watch text NOT NULL DEFAULT 'none',
  status text,
  status_pending text,
  operator_id text,
  district text,
  province text,
  country text,
  lat double precision,
  lon double precision,
  geometry_approximate boolean,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  merged_into text,
  last_signal_at timestamptz,
  last_event_id text,
  updated_at timestamptz NOT NULL
);
CREATE INDEX proj_entity_name_trgm ON proj_entity USING gin (normalised_name gin_trgm_ops);
CREATE INDEX proj_entity_type_idx ON proj_entity (type, watch);

-- One row for each asserted fact. A correction supersedes the old fact. The old fact stays in history.
CREATE TABLE proj_fact (
  event_id text PRIMARY KEY,
  stream_type text NOT NULL,
  stream_id text NOT NULL,
  predicate text NOT NULL,
  value jsonb NOT NULL,
  certainty text,
  evidence_ids text[] NOT NULL,
  superseded_by text,
  retracted boolean NOT NULL DEFAULT false,
  recorded_at timestamptz NOT NULL
);
CREATE INDEX proj_fact_stream_idx ON proj_fact (stream_type, stream_id);

-- Scored items (signals).
CREATE TABLE proj_signal (
  id text PRIMARY KEY,
  source_id text NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  publisher text,
  published_at timestamptz,
  fetched_at timestamptz,
  tier integer NOT NULL,
  tier_rule text,
  score double precision NOT NULL,
  breakdown jsonb NOT NULL,
  sectors text[] NOT NULL DEFAULT '{}',
  geographies text[] NOT NULL DEFAULT '{}',
  themes text[] NOT NULL DEFAULT '{}',
  directions text[] NOT NULL DEFAULT '{}',
  deal_types text[] NOT NULL DEFAULT '{}',
  entity_ids text[] NOT NULL DEFAULT '{}',
  summary jsonb,
  certainty text,
  read_at_source boolean NOT NULL DEFAULT false,
  evidence_ids text[] NOT NULL,
  event_id text NOT NULL,
  recorded_at timestamptz NOT NULL
);
CREATE INDEX proj_signal_time_idx ON proj_signal (coalesce(published_at, recorded_at) DESC);
CREATE INDEX proj_signal_tier_idx ON proj_signal (tier);

-- Market demand drivers. They change diesel demand for all customers.
CREATE TABLE proj_demand_driver (
  event_id text PRIMARY KEY,
  driver_type text NOT NULL,
  title text NOT NULL,
  direction text NOT NULL,
  geography text[] NOT NULL DEFAULT '{}',
  certainty text,
  observed_at timestamptz,
  source_id text,
  evidence_ids text[] NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL
);

-- Alerts with status and telemetry timestamps.
CREATE TABLE proj_alert (
  id text PRIMARY KEY,
  tier integer NOT NULL,
  tier_rule text NOT NULL,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('unconfirmed','confirmed','dismissed','false_positive')),
  stream_type text,
  stream_id text,
  signal_id text,
  source_id text,
  evidence_ids text[] NOT NULL,
  published_at timestamptz,
  fetched_at timestamptz,
  raised_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by text,
  decided_at timestamptz,
  decided_by text,
  decision_reason text,
  updated_at timestamptz NOT NULL
);
CREATE INDEX proj_alert_raised_idx ON proj_alert (raised_at DESC);

-- Projects and their lifecycle.
CREATE TABLE proj_project (
  id text PRIMARY KEY,
  name text NOT NULL,
  site_id text,
  project_type text,
  sector text,
  stage text,
  stage_order integer,
  stage_evidence_ids text[] NOT NULL DEFAULT '{}',
  stage_certainty text,
  stage_changed_at timestamptz,
  in_engagement_window boolean NOT NULL DEFAULT false,
  first_trace_at timestamptz,
  forecast_start date,
  forecast_end date,
  forecast_detail jsonb,
  demand_estimate jsonb,
  updated_at timestamptz NOT NULL
);

-- Opportunities (deals).
CREATE TABLE proj_deal (
  id text PRIMARY KEY,
  title text NOT NULL,
  deal_type text,
  stage text NOT NULL,
  stage_pending text,
  pending_proposal_id text,
  site_id text,
  project_id text,
  organisation_id text,
  buyer_fit double precision,
  confidence double precision,
  lead_time_days integer,
  demand_litres_month double precision,
  has_contact boolean NOT NULL DEFAULT false,
  prequalification_status text,
  next_action jsonb,
  priority_score double precision,
  priority_breakdown jsonb,
  evidence_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

-- Buyer roles and other relationships.
CREATE TABLE proj_relationship (
  event_id text PRIMARY KEY,
  subject_id text NOT NULL,
  predicate text NOT NULL,
  object_id text NOT NULL,
  certainty text,
  evidence_ids text[] NOT NULL,
  superseded_by text,
  recorded_at timestamptz NOT NULL
);
CREATE INDEX proj_relationship_subject_idx ON proj_relationship (subject_id);
CREATE INDEX proj_relationship_object_idx ON proj_relationship (object_id);

-- Engagement work of the team.
CREATE TABLE proj_engagement (
  event_id text PRIMARY KEY,
  deal_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('contact','touchpoint','next_action','prequalification')),
  actor_id text NOT NULL,
  data jsonb NOT NULL,
  recorded_at timestamptz NOT NULL
);
CREATE INDEX proj_engagement_deal_idx ON proj_engagement (deal_id, recorded_at DESC);

-- Projection bookkeeping.
CREATE TABLE proj_checkpoint (
  name text PRIMARY KEY,
  last_event_id text,
  last_recorded_at timestamptz,
  events_applied bigint NOT NULL DEFAULT 0
);
