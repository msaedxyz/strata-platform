# Strata developer commands. Run `make help`.
SHELL := /bin/bash
.DEFAULT_GOAL := help

help: ## Show the commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

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

audit: ## Run the Infora audit (needs INFORA_URL, INFORA_USERNAME, INFORA_PASSWORD)
	pnpm --filter @strata/audit audit
