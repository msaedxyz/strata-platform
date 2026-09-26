-- Collectors (M2). Source: docs/04-ingestion.md.
SET search_path = strata, public;

-- A site and an organisation can have the same id in the brief (for example "tazara").
-- The brief key is unique for each entity type.
DROP INDEX IF EXISTS entity_brief_key_idx;
CREATE UNIQUE INDEX entity_type_brief_key_idx ON entity (type, brief_key) WHERE brief_key IS NOT NULL;

-- Counts for each collector run.
ALTER TABLE collector_run
  ADD COLUMN documents_duplicate integer NOT NULL DEFAULT 0,
  ADD COLUMN documents_failed integer NOT NULL DEFAULT 0,
  ADD COLUMN detail jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Queries for the health view and for the retention purge.
CREATE INDEX collector_run_status_idx ON collector_run (brief_source_id, status, started_at DESC);
CREATE INDEX source_purge_idx ON source (purge_after) WHERE purged_at IS NULL AND purge_after IS NOT NULL;
CREATE INDEX source_fetched_idx ON source (fetched_at DESC);
CREATE INDEX proposal_kind_idx ON proposal (kind, status);
