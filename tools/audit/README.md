# @strata/audit

This package runs the read-only audit of the Infora dashboard (docs/01-audit.md, milestone M0).
One command logs in, crawls the navigation, captures each view, extracts the design tokens, records
the components, the layout system and the behaviour, runs axe, logs the network, logs out and scans
the output with gitleaks.

## Safety model

1. The tool reads the credentials from the environment variables `INFORA_URL`, `INFORA_USERNAME` and `INFORA_PASSWORD` only.
2. The tool never writes a credential to a file, a log or a screenshot:
   - Each text output goes through a scrubber. The scrubber replaces the credential values, their encoded forms, e-mail addresses, tokens and keys.
   - Each screenshot masks password fields, e-mail fields, the user name and text that looks like an e-mail address.
   - The tool never logs request bodies. It removes query values from URLs.
3. The browser blocks each request that is not GET or HEAD (`page.route` on the context). Two exceptions exist:
   - During the login step, the tool allows a request that carries the credentials or that goes to a login endpoint.
   - During the final log out step, the tool allows a request to a log out endpoint.
   The tool records each blocked request in `audit/network.md`.
4. WebSocket frames from the page pass through a filter. The filter blocks a frame whose action name matches the deny list (for example `update_layout`) and each GraphQL mutation.
5. The crawler clicks a control only when `classifyControl()` in `src/safety.ts` allows it:
   - The deny list always wins. It covers save, delete, submit, send, publish, create, update, remove, apply, confirm, buy, sell, order, log out, settings and more (see `config/audit.config.json`).
   - The allow list has navigation links, menu openers in navigation areas, tabs and panel header view controls. Layout work can also use "close panel" in a panel header and "add panel".
   - The tool never clicks a form control, a submit button, a toggle or a link to another site.
   - For the "active" state, the tool presses the mouse button on a safe control and reloads the view before it releases the button. No click event fires.
6. The tool never presses Enter in an input. It types harmless queries only.
7. The tool skips each page whose URL or content suggests credentials, API keys, billing or personal data. It records the page name only, in `audit/gaps.md`.
8. The browser state goes to a temporary directory outside the repository. The tool deletes it at the end, also after an error.
9. The tool logs out at the end of the session.
10. The tool stops (exit code 3) if git does not ignore the output directory. The root `.gitignore` has `/audit`.

## Prerequisites

- Node 22 and pnpm 10.
- Chromium for Playwright 1.56.1. In the Strata build image, set `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Elsewhere, run `pnpm exec playwright install chromium` once.
- For criterion 5: a `gitleaks` binary on `PATH`, `GITLEAKS_BIN`, or Docker with the image `zricethezav/gitleaks`.

## Run the audit

Install the package on its own:

```bash
cd tools/audit
pnpm install --ignore-workspace
```

Set the credentials in the shell. `read` keeps the values out of the shell history. Do not put them in a file.

```bash
export INFORA_URL=https://beta.infora.io/dashboard
read -r -p 'Infora user name: ' INFORA_USERNAME; export INFORA_USERNAME
read -r -s -p 'Infora password: ' INFORA_PASSWORD; echo; export INFORA_PASSWORD
```

Run the audit with one command:

```bash
pnpm --filter @strata/audit audit      # from the repository root, when the pnpm workspace exists
make audit                             # from the repository root, with tools/audit/Makefile.fragment merged
pnpm --dir tools/audit audit           # without a workspace
```

The output goes to `<repository>/audit`. Set `AUDIT_OUT_DIR` to use another directory.

To run criterion 2 again after a change to `tokens.json`:

```bash
pnpm --filter @strata/audit check-tokens
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Criteria 1 to 7 of docs/01-audit.md pass |
| 1 | A criterion fails. See `audit/summary.md` |
| 2 | The audit did not start: a variable is missing or the login failed |
| 3 | git does not ignore the output directory |

## Outputs

| Path | Content |
|---|---|
| audit/views.md, views.json | One section for each view: URL, title, purpose (a guess), panels, screenshots |
| audit/screenshots/<view>/<viewport>.png | 1920x1080, 1440x900 and 1280x800 |
| audit/raw-values.json | Raw computed values with counts |
| audit/tokens.json | Design tokens in the DTCG 2025.10 format |
| audit/tokens.md | Named tokens, missing named tokens, fonts, icon set |
| audit/check-tokens.json, check-tokens.md | Criterion 2 result |
| audit/components.md, components.json | Component inventory with states |
| audit/components/<component>/<state>.png | State screenshots |
| audit/layout-system.md, layout-system.json | Grid, default layouts, breakpoints, interactions, persistence |
| audit/layout/<interaction>/NN.png | Screenshot sequence for each interaction |
| audit/behaviour.md, behaviour.json | Keys, command input, search, focus order, live updates, value-change effect, formats, ticker |
| audit/stack.md, stack.json | Frontend stack and versions |
| audit/a11y.md, a11y.json | axe results (the baseline for docs/07-frontend.md) |
| audit/network.md, network.json | Each non-GET request with endpoint, purpose and outcome. Criterion 6 |
| audit/gaps.md, gaps.json | What the audit did not capture, with the reason |
| audit/summary.md, summary.json | Criteria status, log out and state deletion |

## Configuration

`config/audit.config.json` holds all thresholds, patterns and heuristics (CLAUDE.md rule 11).
These environment variables change a run:

| Variable | Effect |
|---|---|
| AUDIT_OUT_DIR | Output directory. The default is `<repository>/audit` |
| AUDIT_CONFIG_FILE | Another configuration file |
| AUDIT_CONFIG_OVERRIDES | A JSON object that is merged over the configuration (tests use it for short waits) |
| AUDIT_TOKENS_FILE | The token file for `check-tokens` |
| AUDIT_GITLEAKS | `docker` to force the Docker image, `off` to skip the scan |
| GITLEAKS_BIN | Path of the gitleaks binary |
| AUDIT_REQUIRE_GITLEAKS | `0` lets the run pass when gitleaks cannot run |
| AUDIT_HEADED | `1` shows the browser window |

## Rules for criterion 2

`src/inpage/collect-styles.js` collects the values. `tokens.ts` and `check-tokens.ts` use the same collector.

1. The collector skips elements without a box (`display: none`) for colour, font and spacing values.
2. `color` and font values count only for elements with their own text, and for form controls.
3. Border and outline colours count only when the border or outline is drawn.
4. `fill` and `stroke` count only for SVG shape elements.
5. `::before` and `::after` count for colours when they have content.
6. An element in a running colour transition or animation is skipped for colours. Its value is between two states.
7. Spacing values above `tokens.spacingMaxPx` (200px) are layout results, for example `margin: auto`. They are skipped.
8. Colours are normalised to `rgb(r, g, b)` or `rgba(r, g, b, a)`. Lengths are normalised to px with two decimals.
9. Each value that has no named role becomes an extra token with the name `x-<value>`. So each collected value maps to a token.

## Tests

The tests use a local mock site in `tests/mock-site/`. The mock site has a login form, a navigation with a hover menu,
panels in a grid, a ticker, a table, a modal, a form with Save and Delete buttons that send POST requests, live updates
(Server-Sent Events and polling) and pages that the audit must skip.

```bash
cd tools/audit
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm test          # all tests, about 5 minutes
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm test:fast     # unit and guard tests, about 15 seconds
```

| File | What it proves |
|---|---|
| tests/unit.spec.ts | Deny list and allow list, sensitive pages, WebSocket filter, redaction, colour normalisation, DTCG validator, token clustering, value mapping, grid estimate |
| tests/guard.spec.ts | With the real session code: the login request passes, other non-GET requests are blocked, the click guard refuses Save, Delete and Log out, the state is deleted after log out |
| tests/audit-e2e.spec.ts | The one-command audit on the mock site: exit code 0, Save and Delete never clicked, only login and log out reach the server, all outputs written, valid DTCG, check-tokens passes and fails when a token is missing, no credential in any output or log |

The tests make fake credentials at run time. No credential value is in a file.

To look at the mock site in a browser, run `pnpm mock-site` and open http://127.0.0.1:4173/dashboard.

## Limits

- The tool blocks POST requests that only read data, for example GraphQL queries. If Infora uses them, some panels stay empty. `network.md` shows each blocked request.
- A login with single sign-on through another site, a CAPTCHA or a second factor needs a person. The tool then stops with exit code 2.
- The grid estimate can fit more than one row height. `layout-system.md` lists all candidates and the values found in the bundles.
- Heuristics find components by class names and ARIA roles. A component drawn on a canvas can be missing from `components.md`.
