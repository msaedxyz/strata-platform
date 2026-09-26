# Strata

Strata is an information terminal in the style of Bloomberg for Zambia mining and industrials. It is the second flavour of Infora. It finds commercial opportunities months before tenders open.

Read `CLAUDE.md` and the pack in `docs/` for the specification. Read `reports/progress.md` for the current state of the build.

## Start Strata (ten steps)

1. Install Docker with Compose v2, Node 22 with pnpm 10, and uv.
2. Clone this repository and open a terminal in it.
3. Run `make setup`. This makes `.env` with random secrets.
4. Optional: put your Anthropic key in `ANTHROPIC_API_KEY` in `.env`. Without it, the agents use the deterministic backend.
5. Run `docker compose up -d --build`.
6. Wait until `docker compose ps` shows the services as healthy.
7. Open http://localhost:8088.
8. Log in as `analyst@strata.local`, `approver@strata.local` or `admin@strata.local`. The password is `STRATA_DEV_USER_PASSWORD` in `.env`.
9. Optional: run `make fixtures` to load the fixture data.
10. Run `make test` to run the tests.

## End to end acceptance tests

Run `make e2e`. It builds and starts a separate stack (compose project `strata-e2e`) with the fixture server, runs the scenarios of docs/09 and docs/07 criteria 5 to 7, and writes JUnit results to `test-results/e2e`. See `tests/e2e/README.md`.

## Use Strata

### Roles

| Role | What the role can do |
|---|---|
| Viewer | Read the dashboards, timelines and evidence |
| Analyst | Viewer, plus: move Kanban cards (this makes a proposal), upload documents, acknowledge alerts, add contacts, log touchpoints, set next actions and prequalification status |
| Approver | Analyst, plus: approve, reject or edit and approve proposals, confirm or dismiss Tier 0 alerts. An approver cannot approve an own proposal |
| Admin | Approver, plus: brief versions, source proposals, erasure of a person |

The development users are `viewer`, `analyst`, `analyst2`, `approver`, `approver2` and `admin`, each `@strata.local`. Change them in Keycloak at http://localhost:8080 (user `admin`, password `KEYCLOAK_ADMIN_PASSWORD` in `.env`).

### Workspaces

| Workspace | Panels | Use it to |
|---|---|---|
| Origination | Priority list, procurement calendar, project pipeline, geographic deal map | Find the projects to work on now, and see when their procurement starts |
| Relationships | Kanban stage board, relationship panel, next actions | Move opportunities through the stages, record contacts, touchpoints and next actions |
| Monitoring | Ticker strip, Tier 0 alerts, demand drivers, signal feed, site watch list, source health | Watch the market and the sites. Act on Tier 0 alerts |
| Review | Approval queue, quarantine, alert telemetry | Decide proposals from the agents and the team. Check rejected agent output and the alert metrics |

Press `/` or Ctrl+K for the command input. Press `?` for the keyboard shortcuts. Press `g` then `1` to `4` to change the workspace. See `apps/web/SHORTCUTS.md`.

### Daily flow

1. The worker runs the collectors on the schedule of the active brief (daily at 05:00 and weekly on Monday at 05:00, Africa/Lusaka).
2. The agents classify, extract, resolve, score and summarise each new document. They only write proposals.
3. A Tier 0 alert appears at once with the status Unconfirmed. An approver confirms or dismisses it in the Tier 0 alerts panel.
4. An approver works the approval queue in the Review workspace. Each proposal shows its evidence with the span highlighted and a link to the source.
5. An analyst works the priority list and the Kanban board. A drag to the next stage makes a proposal. The card shows "Pending approval" until an approver decides.
6. Each fact on the screen has a provenance control. Click it to see the evidence.

### Documents and brief

- An analyst uploads a file or a URL with `POST /api/sources/manual`. Use this for the known gaps, for example the Government Gazette. The source health panel lists the known gaps.
- An admin edits the brief in the brief editor, compares versions and activates a version. A new version takes effect on the next collector run.

## Real sources and the Anthropic key

- The collectors need outbound HTTPS to the sources in `config/monitoring-brief/v1.yaml` and to news.google.com. Set `STRATA_CONTACT_EMAIL` in `.env`. It goes into the User-Agent.
- Put the key in `ANTHROPIC_API_KEY` in `.env` and restart the worker. The agents then use the models in `config/models.yaml`. Without the key they use the deterministic backend (rules).
- Until the collectors can reach the sources, the stack loads the research snapshot in `data/snapshots/` (146 real items, titles and links only).

## Replace the provisional design with the Infora design

The design tokens are provisional, because the build could not reach beta.infora.io. To make Strata a 1:1 replica:

1. Set `INFORA_URL`, `INFORA_USERNAME` and `INFORA_PASSWORD` in your shell (never in a file).
2. Run `make audit-install`, then `make audit`. The audit is read only. It writes to `audit/`, which git ignores.
3. Run `pnpm --filter @strata/design-system tokens:sync`. This copies `audit/tokens.json` into the design system.
4. Run `pnpm --filter @strata/design-system test:visual` and `pnpm --filter @strata/web test:e2e`. Fix each difference that the visual tests show.
5. Compare `packages/panel-framework/BEHAVIOUR.md` and `apps/web/SHORTCUTS.md` with `audit/layout-system.md` and `audit/behaviour.md`.

## Deploy Strata

Strata runs as containers on any cloud.

1. Build the images `deploy/docker/python.Dockerfile` (api, worker, migrate) and `deploy/docker/web.Dockerfile` (web), and push them to your registry.
2. Use managed PostgreSQL 16 with PostGIS, pgvector and pg_trgm, or the image `timescale/timescaledb-ha:pg16`.
3. Use S3 compatible object storage. Set `STRATA_S3_ENDPOINT_URL`, `STRATA_S3_BUCKET`, `STRATA_S3_ACCESS_KEY` and `STRATA_S3_SECRET_KEY`.
4. Use an OIDC provider. For Keycloak, import `deploy/keycloak/strata-realm.json`, then turn off "Direct access grants" for the client `strata-web`, remove the development users and set the redirect URIs to your domain. Set `STRATA_OIDC_ISSUER` and `STRATA_PUBLIC_URL`.
5. Keep every secret in the secret store of your platform: the database passwords, `STRATA_MASTER_KEY`, `ANTHROPIC_API_KEY`, the S3 keys and the SMTP settings. Back up `STRATA_MASTER_KEY`. Without it, the personal fields cannot be read.
6. Run the `migrate` job (`python -m services.common.bootstrap`) before each release. Then start `api` (uvicorn, port 8000), `worker` (`python -m services.worker`) and `web` (nginx, port 8088) behind a TLS load balancer.
7. Back up the database. The event store is the record of truth. Projections can be rebuilt with `python -m services.projections.cli rebuild`.
8. Check the hash chain with `python -m services.projections.cli check-chain` and the evidence with `python scripts/check_evidence.py`.

## Parallel run with Argo

Run Strata and Argo together for two weeks (docs/09).

1. Start Strata with network access to the sources and with the Anthropic key.
2. Each day, export the items that Argo reports as JSON Lines or CSV with the fields `title`, `url`, `reported_at` and `source`.
3. At the end, run `docker compose exec api python -m scripts.argo_compare --argo /path/argo.jsonl --from <start> --to <end>`.
4. Read `reports/parallel-run/results.md`. Strata passes when it finds 95 percent or more of the Argo items. The report shows which system found each item first and the reason for each miss.
