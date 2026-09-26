-- Enrichment (M3). Source: docs/05-enrichment.md and docs/06-governance.md.
SET search_path = strata, public;

-- One row for each enrichment run of a source: the status and the status and time of each agent.
CREATE TABLE enrichment_run (
  id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES source(id),
  status text NOT NULL CHECK (status IN ('running', 'in_scope', 'out_of_scope', 'quarantined', 'skipped', 'failed', 'already_enriched')),
  backend text,
  rules_version text,
  agent_statuses jsonb NOT NULL DEFAULT '{}'::jsonb,
  timings jsonb NOT NULL DEFAULT '{}'::jsonb,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  tier integer,
  tier_rule text,
  error text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz
);
CREATE INDEX enrichment_run_source_idx ON enrichment_run (source_id, started_at DESC);
CREATE INDEX enrichment_run_status_idx ON enrichment_run (status);

-- A second run of a source does not duplicate a proposal: each proposal of an agent has a key.
ALTER TABLE proposal ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX proposal_idempotency_idx ON proposal (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX proposal_source_idx ON proposal (source_id);

-- Link the call log and the quarantine to the source and the run.
ALTER TABLE agent_call_log ADD COLUMN source_id text, ADD COLUMN run_id text;
CREATE INDEX agent_call_log_source_idx ON agent_call_log (source_id, created_at);
ALTER TABLE quarantine ADD COLUMN run_id text;
CREATE INDEX quarantine_source_idx ON quarantine (source_id, created_at DESC);

-- One Tier 0 alert for each source and tier rule.
CREATE UNIQUE INDEX event_alert_source_rule_idx ON event ((payload->>'source_id'), (payload->>'tier_rule'))
  WHERE event_type = 'AlertRaised' AND payload->>'source_id' IS NOT NULL;

-- docs/05 criterion 2 and docs/09 scenario 12: canonical facts without verified evidence.
-- A fact event is an event whose type needs evidence (event_needs_evidence). A problem is one of:
-- no evidence, an evidence id that does not exist, evidence that is not verified, a quote_hash that is
-- not the SHA-256 of the quote, or a quote whose length differs from its span.
-- scripts/check_evidence.py adds the check of each quote against the stored source text.
CREATE FUNCTION fact_evidence_problems()
RETURNS TABLE (event_id text, event_type text, evidence_id text, problem text)
LANGUAGE sql STABLE SET search_path = strata, public AS $$
  SELECT e.id, e.event_type, NULL::text, 'no evidence'
    FROM event e
   WHERE event_needs_evidence(e.event_type) AND cardinality(e.evidence_ids) = 0
     AND NOT (e.event_type = 'DealStageChanged' AND e.actor_type = 'human' AND coalesce(e.payload->>'reason', '') <> '')
  UNION ALL
  SELECT e.id, e.event_type, x.id,
         CASE WHEN v.id IS NULL THEN 'missing evidence'
              WHEN NOT v.verified THEN 'not verified'
              WHEN v.quote_hash <> encode(digest(convert_to(v.quote, 'UTF8'), 'sha256'), 'hex') THEN 'quote hash mismatch'
              ELSE 'span length mismatch' END
    FROM event e
    CROSS JOIN LATERAL unnest(e.evidence_ids) AS x(id)
    LEFT JOIN evidence v ON v.id = x.id
   WHERE event_needs_evidence(e.event_type)
     AND (v.id IS NULL OR NOT v.verified
          OR v.quote_hash <> encode(digest(convert_to(v.quote, 'UTF8'), 'sha256'), 'hex')
          OR char_length(v.quote) <> v.char_end - v.char_start)
$$;

CREATE VIEW fact_evidence_problem AS SELECT * FROM fact_evidence_problems();

-- The number of canonical fact events with at least one evidence problem. It must be zero.
CREATE FUNCTION count_facts_without_verified_evidence() RETURNS bigint
LANGUAGE sql STABLE SET search_path = strata, public AS $$
  SELECT count(DISTINCT event_id) FROM fact_evidence_problems()
$$;
