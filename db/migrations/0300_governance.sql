-- Governance (M4). Source: docs/06-governance.md and docs/03-data-model.md.
SET search_path = strata, public;

-- Personal data. The blind index that finds an existing person lives in the key row.
-- An erasure deletes the key row, so the blind index goes with the key.
ALTER TABLE person_key ADD COLUMN lookup_hash text;
CREATE INDEX person_key_lookup_idx ON person_key (lookup_hash) WHERE lookup_hash IS NOT NULL;

-- Events that need no source evidence although their type is a fact type:
-- 1. DealStageChanged from a human with a reason (docs/03, event types).
-- 2. EntityIdentified of a person that a user of the team adds (docs/03, relationships and engagement:
--    the team is the source). The payload holds the personal fields encrypted only.
CREATE FUNCTION event_evidence_exempt(t text, actor text, p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (t = 'DealStageChanged' AND actor = 'human' AND coalesce(p->>'reason', '') <> '')
      OR (t = 'EntityIdentified' AND actor = 'human' AND p->>'entity_type' = 'person'
          AND jsonb_typeof(p->'personal') = 'object')
$$;

ALTER TABLE event DROP CONSTRAINT event_evidence_required;
ALTER TABLE event ADD CONSTRAINT event_evidence_required CHECK (
  NOT event_needs_evidence(event_type)
  OR cardinality(evidence_ids) > 0
  OR event_evidence_exempt(event_type, actor_type, payload)
);

-- The SQL check of docs/05 criterion 2 uses the same exemption.
CREATE OR REPLACE FUNCTION fact_evidence_problems()
RETURNS TABLE (event_id text, event_type text, evidence_id text, problem text)
LANGUAGE sql STABLE SET search_path = strata, public AS $$
  SELECT e.id, e.event_type, NULL::text, 'no evidence'
    FROM event e
   WHERE event_needs_evidence(e.event_type) AND cardinality(e.evidence_ids) = 0
     AND NOT event_evidence_exempt(e.event_type, e.actor_type, e.payload)
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

-- Alert telemetry: a delivery row for each channel. The frontend channel has a "broadcast" row when the
-- alert is raised and a "delivered" row when the live stream sends it to a connected client.
CREATE INDEX alert_delivery_channel_idx ON alert_delivery (alert_id, channel, status, delivered_at);
CREATE INDEX proj_alert_signal_idx ON proj_alert (signal_id);
CREATE INDEX proj_alert_source_idx ON proj_alert (source_id);
