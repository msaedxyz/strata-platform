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

More sections follow as the build continues: use, deployment and the parallel run with Argo.
