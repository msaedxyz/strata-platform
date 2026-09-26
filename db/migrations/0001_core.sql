-- Strata core schema. Source: docs/03-data-model.md.
-- The migration runner applies this file as the database superuser.
-- The runner creates the roles strata_owner and strata_app before this file.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS strata AUTHORIZATION strata_owner;
SET search_path = strata, public;

-- Monitoring brief versions. Each version is immutable.
CREATE TABLE monitoring_brief_version (
  id text PRIMARY KEY,
  version integer NOT NULL UNIQUE,
  name text NOT NULL,
  content jsonb NOT NULL,
  yaml text NOT NULL,
  content_hash text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  parent_version_id text REFERENCES monitoring_brief_version(id),
  change_note text
);

-- Activation is a separate insert-only log. The active version is the latest activation.
CREATE TABLE brief_activation (
  id text PRIMARY KEY,
  brief_version_id text NOT NULL REFERENCES monitoring_brief_version(id),
  activated_by text NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE VIEW active_brief AS
  SELECT v.* FROM monitoring_brief_version v
  JOIN LATERAL (SELECT brief_version_id FROM brief_activation ORDER BY activated_at DESC, id DESC LIMIT 1) a
    ON a.brief_version_id = v.id;

-- Collected documents.
CREATE TABLE source (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('rss','web','pdf','manual','google_news','snapshot')),
  url text NOT NULL,
  title text,
  publisher text,
  published_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  licence_code text NOT NULL,
  retention_policy text NOT NULL CHECK (retention_policy IN ('full','verify_then_purge','link_only')),
  brief_version_id text REFERENCES monitoring_brief_version(id),
  brief_source_id text,
  content_hash text NOT NULL,
  simhash bigint,
  duplicate_of text REFERENCES source(id),
  raw_uri text,
  text_uri text,
  text_length integer,
  excerpt text,
  page_map jsonb,
  language text,
  ocr boolean NOT NULL DEFAULT false,
  read_at_source boolean NOT NULL DEFAULT false,
  purge_after timestamptz,
  purged_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX source_content_hash_first ON source (content_hash) WHERE duplicate_of IS NULL;
CREATE INDEX source_published_idx ON source (published_at DESC);
CREATE INDEX source_brief_source_idx ON source (brief_source_id);

-- Each URL where a source was seen. One article in two feeds gives one source and two URLs.
CREATE TABLE source_url (
  id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES source(id),
  url text NOT NULL,
  brief_source_id text,
  seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_id, url)
);
CREATE INDEX source_url_url_idx ON source_url (url);

-- Spans of text that support claims.
CREATE TABLE evidence (
  id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES source(id),
  char_start integer NOT NULL CHECK (char_start >= 0),
  char_end integer NOT NULL,
  quote text NOT NULL CHECK (char_length(quote) <= 500),
  quote_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (char_end > char_start),
  UNIQUE (source_id, char_start, char_end)
);

-- Registry of identities. Attributes come from events.
CREATE TABLE entity (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('organisation','person','site','project','opportunity','location','market')),
  site_class text CHECK (site_class IS NULL OR site_class IN ('mine','exploration','farm','power','industrial','transport','border','fuel_supply')),
  watch text NOT NULL DEFAULT 'none' CHECK (watch IN ('daily','weekly','none')),
  brief_key text,
  geometry geometry(Geometry, 4326),
  geometry_source jsonb,
  external_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX entity_brief_key_idx ON entity (brief_key) WHERE brief_key IS NOT NULL;
CREATE INDEX entity_geometry_idx ON entity USING gist (geometry);

-- Event types that need evidence. Source: docs/03-data-model.md.
CREATE FUNCTION event_needs_evidence(t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT t IN ('EntityIdentified','EntityAttributeAsserted','EntityMerged','EntitySplit',
               'RelationshipAsserted','DealIdentified','DealAttributeAsserted','DealStageChanged',
               'SignalScored','DemandDriverObserved','ProjectStageChanged','ProcurementWindowForecast',
               'DemandEstimated','SiteStatusChanged','AlertRaised','AlertConfirmed','AlertDismissed')
$$;

CREATE FUNCTION event_is_engagement(t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT t IN ('ContactAdded','TouchpointLogged','NextActionSet','PrequalificationStatusChanged')
$$;

-- Each input of a DemandEstimated event must have evidence ids.
CREATE FUNCTION demand_inputs_have_evidence(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p->'inputs') = 'object'
     AND (SELECT count(*) FROM jsonb_object_keys(p->'inputs')) > 0
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each(p->'inputs') AS i(k, v)
       WHERE jsonb_typeof(v->'evidence_ids') IS DISTINCT FROM 'array'
          OR jsonb_array_length(v->'evidence_ids') = 0)
$$;

-- The append-only event store.
CREATE TABLE event (
  id text PRIMARY KEY,
  stream_type text NOT NULL,
  stream_id text NOT NULL,
  sequence integer NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  evidence_ids text[] NOT NULL DEFAULT '{}',
  certainty text CHECK (certainty IS NULL OR certainty IN ('stated','reported','speculative')),
  actor_type text NOT NULL CHECK (actor_type IN ('agent','human','system')),
  actor_id text NOT NULL,
  model_id text,
  prompt_version text,
  proposal_id text,
  brief_version_id text,
  supersedes_event_id text REFERENCES event(id),
  occurred_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  prev_hash text,
  hash text NOT NULL,
  UNIQUE (stream_type, stream_id, sequence),
  -- Fact events need at least one evidence id. DealStageChanged can carry a reason from a human approver instead.
  CONSTRAINT event_evidence_required CHECK (
    NOT event_needs_evidence(event_type)
    OR cardinality(evidence_ids) > 0
    OR (event_type = 'DealStageChanged' AND actor_type = 'human' AND coalesce(payload->>'reason','') <> '')
  ),
  -- Engagement events come from a human user only.
  CONSTRAINT event_engagement_human CHECK (NOT event_is_engagement(event_type) OR actor_type = 'human'),
  CONSTRAINT event_retraction_reason CHECK (event_type <> 'ClaimRetracted' OR coalesce(payload->>'reason','') <> ''),
  CONSTRAINT event_demand_inputs CHECK (event_type <> 'DemandEstimated' OR demand_inputs_have_evidence(payload)),
  CONSTRAINT event_agent_model CHECK (actor_type <> 'agent' OR (model_id IS NOT NULL AND prompt_version IS NOT NULL))
);
CREATE INDEX event_stream_idx ON event (stream_type, stream_id, sequence);
CREATE INDEX event_type_idx ON event (event_type);
CREATE INDEX event_recorded_idx ON event (recorded_at, id);
CREATE INDEX event_evidence_idx ON event USING gin (evidence_ids);

-- The content hash of one event. The chain check uses the same function.
CREATE FUNCTION event_content_hash(
  p_prev_hash text, p_id text, p_stream_type text, p_stream_id text, p_sequence integer,
  p_event_type text, p_payload jsonb, p_evidence_ids text[], p_certainty text,
  p_actor_type text, p_actor_id text, p_proposal_id text, p_supersedes text, p_recorded_at timestamptz
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(digest(convert_to(concat_ws('|',
    coalesce(p_prev_hash, ''), p_id, p_stream_type, p_stream_id, p_sequence::text, p_event_type,
    p_payload::text, array_to_string(p_evidence_ids, ','), coalesce(p_certainty, ''),
    p_actor_type, p_actor_id, coalesce(p_proposal_id, ''), coalesce(p_supersedes, ''),
    to_char(p_recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')), 'UTF8'), 'sha256'), 'hex')
$$;

-- Assign sequence and hash chain, and check the evidence ids.
CREATE FUNCTION event_before_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = strata, public AS $$
DECLARE
  last_seq integer;
  last_hash text;
  missing integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.stream_type || ':' || NEW.stream_id, 0));
  SELECT sequence, hash INTO last_seq, last_hash FROM event
    WHERE stream_type = NEW.stream_type AND stream_id = NEW.stream_id
    ORDER BY sequence DESC LIMIT 1;
  NEW.sequence := coalesce(last_seq, 0) + 1;
  NEW.prev_hash := last_hash;
  NEW.recorded_at := clock_timestamp();
  IF cardinality(NEW.evidence_ids) > 0 THEN
    SELECT count(*) INTO missing FROM unnest(NEW.evidence_ids) AS e(id)
      WHERE NOT EXISTS (SELECT 1 FROM evidence v WHERE v.id = e.id AND v.verified);
    IF missing > 0 THEN
      RAISE EXCEPTION 'event % cites % evidence ids that do not exist or are not verified', NEW.id, missing
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.hash := event_content_hash(NEW.prev_hash, NEW.id, NEW.stream_type, NEW.stream_id, NEW.sequence,
    NEW.event_type, NEW.payload, NEW.evidence_ids, NEW.certainty, NEW.actor_type, NEW.actor_id,
    NEW.proposal_id, NEW.supersedes_event_id, NEW.recorded_at);
  RETURN NEW;
END $$;

CREATE TRIGGER event_before_insert BEFORE INSERT ON event
  FOR EACH ROW EXECUTE FUNCTION event_before_insert();

-- The event store accepts inserts only. This applies to every role, the owner included.
CREATE FUNCTION reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is not permitted: the table accepts inserts only', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER event_no_update BEFORE UPDATE OR DELETE ON event
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER event_no_truncate BEFORE TRUNCATE ON event
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change();

-- Tell listeners about each new event. The API sends it to the browser.
CREATE FUNCTION event_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('strata_event', json_build_object(
    'id', NEW.id, 'stream_type', NEW.stream_type, 'stream_id', NEW.stream_id,
    'event_type', NEW.event_type)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER event_after_insert AFTER INSERT ON event
  FOR EACH ROW EXECUTE FUNCTION event_notify();

-- Hash chain check for every stream. Returns one row for each break.
CREATE FUNCTION check_hash_chain() RETURNS TABLE (event_id text, stream_type text, stream_id text, sequence integer, problem text)
LANGUAGE sql STABLE AS $$
  WITH ordered AS (
    SELECT e.*, lag(e.hash) OVER (PARTITION BY e.stream_type, e.stream_id ORDER BY e.sequence) AS expected_prev,
           row_number() OVER (PARTITION BY e.stream_type, e.stream_id ORDER BY e.sequence) AS rn
    FROM event e)
  SELECT id, stream_type, stream_id, sequence, 'sequence gap' FROM ordered WHERE sequence <> rn
  UNION ALL
  SELECT id, stream_type, stream_id, sequence, 'prev_hash mismatch' FROM ordered WHERE prev_hash IS DISTINCT FROM expected_prev
  UNION ALL
  SELECT id, stream_type, stream_id, sequence, 'hash mismatch' FROM ordered
   WHERE hash <> event_content_hash(prev_hash, id, stream_type, stream_id, sequence, event_type, payload,
     evidence_ids, certainty, actor_type, actor_id, proposal_id, supersedes_event_id, recorded_at)
$$;

-- Proposals from agents and analysts. The lifecycle is also written as events in stream 'proposal'.
CREATE TABLE proposal (
  id text PRIMARY KEY,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','edited_approved','auto_approved')),
  policy text NOT NULL CHECK (policy IN ('automatic','review','admin_review')),
  created_by_type text NOT NULL CHECK (created_by_type IN ('agent','human','system')),
  created_by text NOT NULL,
  model_id text,
  prompt_version text,
  source_id text REFERENCES source(id),
  stream_type text,
  stream_id text,
  title text NOT NULL,
  summary text,
  events jsonb NOT NULL,
  evidence_ids text[] NOT NULL DEFAULT '{}',
  tier integer,
  brief_version_id text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_by text,
  decided_at timestamptz,
  decision_reason text,
  edited_events jsonb
);
CREATE INDEX proposal_status_idx ON proposal (status, created_at DESC);

-- Agent output that failed a guardrail.
CREATE TABLE quarantine (
  id text PRIMARY KEY,
  source_id text REFERENCES source(id),
  agent text NOT NULL,
  reason_code text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  model_id text,
  prompt_version text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX quarantine_reason_idx ON quarantine (reason_code);

-- Log of each model call.
CREATE TABLE agent_call_log (
  id text PRIMARY KEY,
  agent text NOT NULL,
  backend text NOT NULL,
  model_id text NOT NULL,
  prompt_version text NOT NULL,
  input_hash text NOT NULL,
  output jsonb,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  status text NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Users from OIDC and the security log.
CREATE TABLE app_user (
  id text PRIMARY KEY,
  email text,
  name text,
  roles text[] NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz
);

CREATE TABLE security_log (
  id text PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  user_id text,
  action text NOT NULL CHECK (action IN ('login','logout','permission_change','access_denied','erasure')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TRIGGER security_log_no_update BEFORE UPDATE OR DELETE ON security_log
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER security_log_no_truncate BEFORE TRUNCATE ON security_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_change();

-- Keys for personal fields. To erase a person, delete the key.
CREATE TABLE person_key (
  entity_id text PRIMARY KEY REFERENCES entity(id),
  wrapped_key bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Collector runs and health.
CREATE TABLE collector_run (
  id text PRIMARY KEY,
  brief_version_id text REFERENCES monitoring_brief_version(id),
  brief_source_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed','skipped')),
  attempts integer NOT NULL DEFAULT 1,
  documents_found integer NOT NULL DEFAULT 0,
  documents_new integer NOT NULL DEFAULT 0,
  error text
);
CREATE INDEX collector_run_source_idx ON collector_run (brief_source_id, started_at DESC);

CREATE TABLE dead_letter (
  id text PRIMARY KEY,
  job text NOT NULL,
  payload jsonb NOT NULL,
  error text NOT NULL,
  attempts integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Conditional GET state for each URL.
CREATE TABLE fetch_state (
  url text PRIMARY KEY,
  etag text,
  last_modified text,
  last_status integer,
  last_fetched_at timestamptz
);

-- Alert delivery telemetry. Operational data, not canonical facts.
CREATE TABLE alert_delivery (
  id text PRIMARY KEY,
  alert_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('frontend','email')),
  delivered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL DEFAULT 'delivered',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX alert_delivery_alert_idx ON alert_delivery (alert_id);
