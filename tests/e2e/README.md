# End to end acceptance tests

These tests run the scenarios of docs/09-acceptance.md and docs/07 criteria 5 to 7 on the local Docker Compose stack. The stack uses the fixture server. The tests use HTTP and the real Keycloak login.

## Run

1. Run `make setup` once. It makes `.env`.
2. Run `make e2e`.

`make e2e` does these steps:

1. It removes the old e2e stack and its volumes. The e2e stack uses the compose project `strata-e2e`, so it does not touch the data of `make up`.
2. It builds the images and starts the stack with `docker-compose.yml` and `tests/e2e/compose.e2e.yml`, with the compose profile `test` (the fixture server). It waits until each service is healthy.
3. It checks the start-up logs (`tests/e2e/check_logs.py`). The result is in `test-results/e2e/startup-log-check.txt`.
4. It runs the Python suite (`tests/e2e/python`). The JUnit result is `test-results/e2e/python.xml`.
5. It runs the browser suite (`tests/e2e/browser`). The JUnit result is `test-results/e2e/browser.xml`.

Other targets:

| Target | Use |
|---|---|
| `make e2e-up` | Start a new e2e stack only |
| `make e2e-python` | Run the Python suite on the running e2e stack |
| `make e2e-browser` | Run the browser suite on the running e2e stack |
| `make e2e-logs` | Write the logs of the stack to `test-results/e2e/compose.log` |
| `make e2e-down` | Stop the e2e stack. The volumes stay |

The Python suite needs a new database. It activates the acceptance brief and waits until the worker collects each source once. A second run on the same database gives the same result for most tests, but the start state is not the same. Use `make e2e-up` before a full run.

## Sandbox only: an extra compose file

Some build machines cannot pull every image. For example, Docker Hub can refuse the SeaweedFS image with HTTP 429. On such a machine, make your own compose file outside the repository, for example `/path/to/sandbox.yml`. It can disable the `objectstore` service and set the filesystem storage backend (`STRATA_S3_ENDPOINT_URL: ""` and `STRATA_STORAGE_DIR`) for `api`, `worker` and `migrate`. Then build the images yourself and run:

```
make e2e-sandbox COMPOSE_OVERRIDE=/path/to/sandbox.yml
```

`e2e-sandbox` does not build images. Never commit a sandbox file. CI uses the normal compose file.

## What the stack of the tests has

`tests/e2e/compose.e2e.yml` adds these settings:

1. The agents use the deterministic backend.
2. The Google News collector reads the search feeds of the fixture server (`STRATA_GOOGLE_NEWS_BASE_URL`).
3. The Python services send each request for a host outside the stack to a closed port. The real sources of brief v1 fail at once and do not fill the queue.
4. The fixture server publishes port 8765 on 127.0.0.1, and serves the fixture files of the working copy.

## Python suite (tests/e2e/python)

One file for each scenario of docs/09. The tests use the API at http://localhost:8000 with tokens from Keycloak (password grant of the dev users). A test uses `docker compose exec` only where the scenario asks for a SQL result or a command: scenarios 3 (the start-up step), 7 (UPDATE as the app role and as postgres), 9 (rebuild), 10 (hash chain), 11 (gitleaks, `docker run`) and 12 (evidence check).

| Scenario | Test file | Fixture |
|---|---|---|
| 1 | test_s01_brief_activation_tier0_alert.py | feeds/deals.xml |
| 2 | test_s02_rumour_of_a_deal.py | feeds/acceptance.xml |
| 3 | test_s03_one_company_two_names.py | feeds/acceptance.xml, news/copperbelt-earthmoving-fleet.html |
| 4 | test_s04_kanban_stage_move.py (and browser 02) | docs/zppa-haulage-tender.pdf |
| 5 | test_s05_viewer_calls_approve.py | feeds/business.xml |
| 6 | test_s06_creator_cannot_approve.py | gn/kansanshi-mine.xml |
| 7 | test_s07_event_table_rejects_update.py | none |
| 8 | test_s08_instructions_in_a_document.py | feeds/acceptance.xml |
| 9 | test_s09_rebuild_projections.py | all |
| 10 | test_s10_erase_person.py | feeds/business.xml |
| 11 | test_s11_gitleaks.py | the repository |
| 12 | test_s12_facts_have_verified_evidence.py | all |
| 13 | test_s13_suspension_at_daily_watch_mine.py (and browser 03) | feeds/mining.xml |
| 14 | test_s14_fuel_shortage.py | feeds/business.xml |
| 15 | test_s15_google_news_only_item.py | gn/kansanshi-mine.xml |
| 16 | test_s16_zema_notice_new_project.py | notices/zema-eis-kasempa-north.html |
| 17 | test_s17_touchpoint_and_next_action.py (and browser 04) | feeds/business.xml, notices/zema-eis-kasempa-north.html |

The fixture paths are under tests/fixtures/site. All fixture articles are invented test data.

## Browser suite (tests/e2e/browser)

The suite has its own `package.json` with Playwright 1.56.1. Install it with `pnpm --dir tests/e2e/browser install --ignore-workspace`. It is not in the pnpm workspace. The tests run one at a time, in file order, after the Python suite.

| File | Content |
|---|---|
| 01-login.spec.ts | Real Keycloak login, and each workspace loads its modules from the real API. A viewer sees no write controls |
| 02-scenario-04-kanban.spec.ts | Scenario 4: drag a card, "Pending approval", an approver approves in the queue, the timeline, "as of" the previous day |
| 03-scenario-13-site-watch-list.spec.ts | Scenario 13: the pending status in the site watch list |
| 04-scenario-17-relationship.spec.ts | Scenario 17 and stop condition 5: add a contact, log a touchpoint, set a next action |
| 05-live.spec.ts | A Tier 0 alert appears live as Unconfirmed. docs/07 criterion 5 for a Kanban move and for an alert |
| 06-a11y.spec.ts | axe on the four workspaces |
| perf.spec.ts | docs/07 criteria 6 and 7 with 10 000 signals and 500 deals |

`tests/e2e/seed_volume.py` writes the volume data for criteria 6 and 7 through the governance service in the api container. The perf tests run it.

The measurements go to `test-results/e2e` (live-*.json, perf-*.json, a11y-*.json).

## Settings

| Variable | Default |
|---|---|
| E2E_API_URL | http://localhost:8000 |
| E2E_WEB_URL | http://localhost:8088 |
| E2E_KEYCLOAK_URL | http://localhost:8080 |
| E2E_FIXTURE_URL | http://localhost:8765 |
| E2E_MAILPIT_URL | http://localhost:8025 |
| E2E_COMPOSE | the compose command of the e2e stack (the Makefile sets it) |
| E2E_RESULTS_DIR | test-results/e2e |
| E2E_ENV_FILE | .env |

The tests read `STRATA_DEV_USER_PASSWORD` and `STRATA_APP_DB_PASSWORD` from the environment or from `.env`. They never print a value.
