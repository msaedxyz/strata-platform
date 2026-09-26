-- Strata modules (M6). Source: docs/07-frontend.md rule 1 (each fact on the screen shows its evidence),
-- docs/05-enrichment.md (scorer rules 5 and 6, window forecaster) and docs/03-data-model.md (demand estimate).
SET search_path = strata, public;

-- Provenance of the facts that the modules show (docs/07 rule 1). The folds fill these columns.
-- Site: the evidence of the identity (first EntityIdentified) and of the last SiteStatusChanged.
ALTER TABLE proj_entity ADD COLUMN identity_evidence_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE proj_entity ADD COLUMN status_event_id text;
ALTER TABLE proj_entity ADD COLUMN status_evidence_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE proj_entity ADD COLUMN status_certainty text;
-- The last DemandEstimated of a site (a project keeps its estimate in proj_project.demand_estimate).
ALTER TABLE proj_entity ADD COLUMN demand_estimate jsonb;

-- Deal: the event, the evidence and the reason of the current stage.
ALTER TABLE proj_deal ADD COLUMN stage_event_id text;
ALTER TABLE proj_deal ADD COLUMN stage_evidence_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE proj_deal ADD COLUMN stage_reason text;
ALTER TABLE proj_deal ADD COLUMN stage_actor_type text;
ALTER TABLE proj_deal ADD COLUMN certainty text;

-- Project: the event of the current stage.
ALTER TABLE proj_project ADD COLUMN stage_event_id text;

-- The priority list reads the deals of a project or a site.
CREATE INDEX proj_deal_project_idx ON proj_deal (project_id);
CREATE INDEX proj_deal_site_idx ON proj_deal (site_id);
CREATE INDEX proj_deal_org_idx ON proj_deal (organisation_id);
