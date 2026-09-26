# Frontend components

This file describes the Strata design system, the panel framework and the application shell from milestone M5. Read it with docs/07-frontend.md.

## Status of the Infora audit

The build network blocked beta.infora.io on 2026-09-26. No Infora audit exists. For this reason, these items are provisional:

1. The token values in packages/design-system/tokens/infora.tokens.json.
2. The structural sizes in packages/design-system/tokens/strata.component.tokens.json.
3. The icon set (lucide-react).
4. The grid settings and the panel behaviour in packages/panel-framework/BEHAVIOUR.md.
5. The layout storage method (localStorage).
6. The keyboard shortcuts in apps/web/SHORTCUTS.md.
7. The component inventory in packages/design-system/src/inventory.ts.

When the audit exists, do the steps in "After the audit" below.

## Packages

| Package | Name | Content |
|---|---|---|
| packages/design-system | @strata/design-system | Tokens, token tools, components, Storybook stories, visual parity test |
| packages/panel-framework | @strata/panel-framework | Panel grid, panel registry, panel picker, workspaces, layout storage |
| packages/eslint-plugin-strata | @strata/eslint-plugin-strata | Lint rule for raw values, shared ESLint and stylelint configuration |
| apps/web | @strata/web | Application shell, OIDC login, workspaces, command input, shortcuts, live updates |

## Design tokens

1. The tokens use the W3C Design Tokens (DTCG) format.
2. `pnpm tokens:build` makes src/tokens.css (CSS custom properties) and src/tokens.ts (typed object). The build, lint, typecheck and test scripts of the design system run it. Git does not keep the two generated files.
3. The CSS variable name comes from the token path. For example, color.bg.surface-1 gives `--color-bg-surface-1`.
4. `tokens.color.bg.base` in TypeScript gives `var(--color-bg-base)`. `tokenValues` gives the resolved values. Use `tokenValues` only where CSS variables cannot work, for example for the grid library that needs numbers.
5. With reduced motion, each duration token becomes 0ms.
6. A component uses only token variables. Stylelint and the ESLint rule check this in the design system too. Only the token files hold raw values.

### Base token groups

color.bg, color.border, color.text, color.focus, color.state, font.family, font.size, font.weight, font.line-height, font.letter-spacing, font.numeric, space, radius, shadow, z, motion.duration, motion.easing.

### Component tokens

border.width (hairline, focus), size.control, size.icon, size.nav-rail, size.top-bar, size.ticker, size.panel-header, size.row, size.overlay, size.kanban-column, size.chart. Each one refers to a base token where a base token fits.

## Components

Each component has a Storybook story for each state. Run `pnpm storybook` to see them. A unit test renders every story and checks that each state in the inventory has a story.

| Component | States with a story |
|---|---|
| AppShell | default, loading, without ticker |
| NavRail | default, focus, interactive |
| TopBar | default, offline |
| SearchInput | default, with value, hover, focus, disabled, loading |
| CommandPalette (command input) | default, filtered, empty, loading, error |
| UserMenu | default, open, viewer |
| Menu | default, open |
| TickerStrip | default, paused, fast, empty, loading, error |
| PanelFrame and PanelHeader | default, focus, collapsed, maximised, loading, empty, error, interactive |
| FeedItem | default, hover, focus, selected, fresh, unconfirmed, reported, with actions, loading |
| DataTable | default, comfortable, sorted, filtered, selected, loading, empty, error |
| Badge and StatusBadge | default, tones, unconfirmed, reported, confirmed, dismissed, pending approval, all statuses |
| Toast | default, positive, warning, error, with provider |
| Modal | default, small, interactive |
| Drawer | default, left, loading |
| Tabs | default, second selected, focus |
| Button | default, primary, ghost, danger, with icon, hover, focus, active, disabled, loading |
| IconButton | default, small, pressed, hover, focus, active, disabled, loading |
| TextInput | default, filled, with hint, hover, focus, disabled, loading, error |
| Select | default, placeholder, hover, focus, disabled, error |
| Checkbox | default, checked, indeterminate, focus, disabled, disabled checked, error |
| DatePicker | default, empty, with range, hover, focus, disabled, error |
| Tooltip | default, open, bottom |
| EmptyState | default, with action, module |
| ErrorState | default, with retry |
| LoadingState | default, skeleton |
| Sparkline | default, positive, negative, flat, empty |
| BarChart | default, percent, loading, empty, error |
| TimelineAxis | default, selectable, twelve months, loading, empty, error |
| MapView | default, selected, loading, error |
| KanbanBoard | default, interactive, read only, empty, loading, error |
| ProvenanceControl | default, single source, open, loading, empty, error |
| Fact | default, multiple sources, open |

### Rules that the components enforce

1. Fact: the TypeScript type of `evidenceIds` is `readonly [string, ...string[]]`. A fact without evidence does not compile (docs/07 rule 2). packages/design-system/src/components/Fact.test-d.tsx proves it. `pnpm typecheck` checks it.
2. ProvenanceControl opens a drawer with each evidence quote. The span is highlighted. A link opens the source (docs/07 rule 1).
3. StatusBadge gives unconfirmed and reported items the same style (docs/07 rule 4). The label of each status is the same in every module (docs/07 rule 5).
4. KanbanBoard calls `onMove`. The app makes a DealStageChanged proposal and shows "Pending approval" on the card (docs/07 rule 3). A card moves with the pointer or with the keyboard (Space, arrow keys, Space).
5. Each control has a visible focus ring (token color.focus.ring).
6. Motion obeys the reduced motion setting.
7. MapView loads MapLibre only when a map shows. Without a style URL, it uses an empty style and loads no tiles.

## Panel framework

See packages/panel-framework/BEHAVIOUR.md. It is the provisional stand-in for audit/layout-system.md.

## Application shell

1. Login: OIDC authorisation code flow with PKCE (S256) through Keycloak. The issuer comes from VITE_OIDC_ISSUER (default http://localhost:8080/realms/strata). The client id is strata-web.
2. After login, the app calls POST /api/session/login. Then it calls GET /api/me to get the role.
3. Silent renew runs through /auth/silent. The tokens stay in sessionStorage.
4. Logout calls POST /api/session/logout, then the Keycloak end-session endpoint.
5. Live updates: an EventSource to /api/live?access_token=... . The connection reconnects with a growing delay and a fresh token. `useLive(type, handler)` gives each event to the subscribers of its type.
6. The frontend hides the controls that the role cannot use. The API enforces each permission (docs/06).
7. The E2E tests use a test-only auth driver. The build puts it in the bundle only when VITE_E2E_AUTH=mock. `pnpm --filter @strata/web build` fails when a production bundle contains it.

## Lint rule for raw values

1. `strata/no-raw-values` (ESLint) reports hex colours, colour functions, named colours in style contexts, and px, rem and em values in strings and style objects.
2. The stylelint configuration reports the same values in CSS.
3. `pnpm lint` runs both in every package. The result must be zero findings.

## Tests

| Test | Command | Content |
|---|---|---|
| Unit tests | `pnpm test` | Tokens, token sync, stories, component behaviour, panel framework, shell, lint rule |
| Type test | `pnpm typecheck` | Fact without evidence does not compile |
| End to end | `pnpm test:e2e` | Panel behaviour, keyboard shortcuts, session, roles, axe |
| Visual parity | `pnpm test:visual` | Storybook stories against the audit screenshots. Skipped with "blocked: no Infora audit (beta.infora.io unreachable)" while no audit exists |

## After the audit

1. Run `pnpm tokens:sync`. It validates audit/tokens.json, copies it to tokens/infora.tokens.json and removes the provisional flag. If a token name that the components use is missing, the command stops and lists the names.
2. Compare strata.component.tokens.json with audit/components.md. Change the sizes.
3. Map the Infora component names to the Storybook titles in packages/design-system/visual/component-map.json.
4. Run `pnpm test:visual`. Fix each difference above 1 percent.
5. Compare packages/panel-framework/BEHAVIOUR.md with audit/layout-system.md, and apps/web/SHORTCUTS.md with audit/behaviour.md. Change the code and the end to end tests.
6. Replace the icons in packages/design-system/src/icons.tsx with the Infora icon set.
7. Replace the LocalStorageLayoutStore if Infora keeps layouts on the server.
