# Strata developer commands. Run `make help`.
SHELL := /bin/bash
.DEFAULT_GOAL := help

help: ## Show the commands
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

setup: ## Make .env with random secrets (keeps an existing .env)
	@uv run python scripts/setup_env.py

up: ## Start the stack
	docker compose up -d --build

down: ## Stop the stack
	docker compose down

fixtures: ## Load the fixture data into the running stack
	docker compose --profile test up -d fixtures
	docker compose exec api python -m scripts.load_fixtures

test: ## Run the Python and frontend tests
	uv run pytest -q
	pnpm test

lint: ## Run the linters
	uv run ruff check services tests scripts
	pnpm lint

api-client: ## Build the typed API client from the OpenAPI schema
	pnpm api-client

gitleaks: ## Scan the repository and its history for secrets
	docker run --rm -v "$$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --config /repo/.gitleaks.toml --redact

check-chain: ## Check the hash chain of every event stream
	docker compose exec api python -m services.projections.cli check-chain

rebuild-projections: ## Delete and rebuild all projections
	docker compose exec api python -m services.projections.cli rebuild

PLAYWRIGHT_BROWSERS_PATH ?= /opt/pw-browsers
export PLAYWRIGHT_BROWSERS_PATH

audit-install: ## Install the audit tool on its own
	pnpm --dir tools/audit install --ignore-workspace --frozen-lockfile

audit: ## Run the read-only Infora audit into ./audit (needs INFORA_URL, INFORA_USERNAME, INFORA_PASSWORD)
	pnpm --dir tools/audit audit

audit-check-tokens: ## Check that each computed value maps to a token in audit/tokens.json
	pnpm --dir tools/audit check-tokens

audit-test: ## Run the audit tool tests against the local mock site
	pnpm --dir tools/audit test

# ---------- end to end acceptance tests (docs/09, tests/e2e/README.md) ----------
# The tests run on their own compose project (E2E_PROJECT), so they never touch the data of `make up`.
# COMPOSE_OVERRIDE=/path/file.yml adds one more compose file (for example a sandbox without SeaweedFS).
E2E_PROJECT ?= strata-e2e
COMPOSE_OVERRIDE ?=
E2E_BUILD ?= --build
E2E_RESULTS := $(CURDIR)/test-results/e2e
E2E_COMPOSE = docker compose -p $(E2E_PROJECT) -f docker-compose.yml -f tests/e2e/compose.e2e.yml $(if $(COMPOSE_OVERRIDE),-f $(COMPOSE_OVERRIDE)) --profile test
E2E_ENV = E2E_COMPOSE="$(E2E_COMPOSE)" E2E_RESULTS_DIR="$(E2E_RESULTS)"

e2e: ## Run the end to end acceptance tests on a new local stack (build, start, both suites, JUnit in test-results/e2e)
	@$(MAKE) --no-print-directory e2e-up
	@py=0; br=0; \
	$(MAKE) --no-print-directory e2e-python || py=$$?; \
	$(MAKE) --no-print-directory e2e-browser || br=$$?; \
	echo "e2e: python suite exit $$py, browser suite exit $$br. Results in test-results/e2e"; \
	test $$py -eq 0 -a $$br -eq 0

e2e-sandbox: ## Like e2e, with the images that exist and COMPOSE_OVERRIDE (sandbox only, see tests/e2e/README.md)
	@test -n "$(COMPOSE_OVERRIDE)" || { echo "Set COMPOSE_OVERRIDE=/path/to/override.yml"; exit 2; }
	@$(MAKE) --no-print-directory e2e E2E_BUILD=--no-build

e2e-up: setup ## Start a new end to end stack: remove the old e2e volumes, build, start, wait for health
	@mkdir -p $(E2E_RESULTS)
	$(E2E_COMPOSE) down -v --remove-orphans
	$(E2E_COMPOSE) up -d $(E2E_BUILD) --wait --wait-timeout 600
	$(E2E_COMPOSE) ps
	-$(E2E_ENV) uv run python tests/e2e/check_logs.py --out $(E2E_RESULTS)/startup-log-check.txt

e2e-python: ## Run the Python end to end suite on the running e2e stack
	@mkdir -p $(E2E_RESULTS)
	$(E2E_ENV) uv run pytest tests/e2e/python -p no:cacheprovider -o junit_family=xunit2 --junitxml=$(E2E_RESULTS)/python.xml -rfE

e2e-browser: ## Run the browser end to end suite on the running e2e stack
	pnpm --dir tests/e2e/browser install --ignore-workspace --frozen-lockfile
	@st=0; pf=0; \
	$(E2E_ENV) E2E_BROWSER_REPORT=browser pnpm --dir tests/e2e/browser exec playwright test --project=stack || st=$$?; \
	$(E2E_ENV) E2E_BROWSER_REPORT=browser-perf pnpm --dir tests/e2e/browser exec playwright test --project=perf || pf=$$?; \
	echo "browser: scenarios exit $$st, performance exit $$pf"; test $$st -eq 0 -a $$pf -eq 0

e2e-logs: ## Write the logs of the e2e stack to test-results/e2e/compose.log
	@mkdir -p $(E2E_RESULTS)
	$(E2E_COMPOSE) logs --no-color --timestamps > $(E2E_RESULTS)/compose.log

e2e-down: ## Stop the e2e stack (keeps its volumes)
	$(E2E_COMPOSE) down
