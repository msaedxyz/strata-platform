# 01. Audit of Infora

## Purpose

The audit makes an exact record of the Infora dashboard. Strata uses this record to replicate the design tokens, the layout system, the components and the interaction behaviour.

## Source code first

1. Check the environment variable INFORA_REPO_PATH.
2. If it points to the Infora source, read the source before you open the browser.
3. Use the source as the primary reference for tokens and components.
4. Use the browser audit to confirm the source and to record live behaviour.

## Access and safety

1. Get the login details from INFORA_URL, INFORA_USERNAME and INFORA_PASSWORD.
2. Use Playwright for all browser work.
3. Add /audit to .gitignore before the first capture. Screenshots can show live data.
4. Do read actions only.
5. Do not click a control that saves, deletes, submits, sends, publishes or changes a setting.
6. If a view needs a write action to open, record its name in /audit/gaps.md and skip it.
7. Do not capture pages that show credentials, API keys, billing data or personal data of users. Record the page name only.
8. Log out at the end of each session.
9. Delete the stored browser state after the audit.

## What to capture

### Views

For each route, record the URL, the title, the purpose and the list of panels. Take screenshots at 1920x1080, 1440x900 and 1280x800.

### Design tokens

Get these values from the computed styles in the DOM:

- Colours for backgrounds, surface levels, borders, text levels, focus rings, and the positive, negative, neutral and accent states.
- Fonts, with family, size, weight, line height, letter spacing and numeric figure style.
- The spacing scale, border radii, shadows and z-index layers.
- Animation durations and easing curves.
- The icon set and its source.
- The source and licence of each font file.

### Layout system

Record the grid columns, row height, gutters and breakpoints. Record how a user drags, resizes, snaps, collapses, maximises, closes and adds a panel. Record how Infora keeps a layout, for example in local storage or on the server. Record the default layout of each view.

### Components

For each component, record the name, the views that use it, its variants and its DOM structure. Capture each state that you can see: default, hover, focus, active, disabled, loading, empty and error.

Include at least these components:

- Application shell, navigation, top bar, search and user menu.
- Ticker strip.
- Panel frame and panel header controls.
- Feed item.
- Data table, with sort, filter, column resize and density.
- Charts and maps.
- Badges, toasts, modals, drawers, tabs and form controls.

### Keyboard and command behaviour

Record every keyboard shortcut, any command or function input, the focus order in each view, and the behaviour of search.

### Live behaviour

1. Inspect the network traffic to find how feeds update, for example WebSocket, SSE or polling.
2. Record the visual effect when a value changes, for example a colour flash.
3. Record the formats of timestamps, numbers and currency.
4. Record the scroll speed and the pause behaviour of the ticker strip.

### Stack

From the network log and the bundles, record the framework, state library, chart library, map library, grid layout library and live update protocol. Record versions where you can see them.

### Accessibility baseline

Run axe on each view. Record the results.

## Outputs

| Path | Content |
|---|---|
| /audit/views.md | One section for each view |
| /audit/tokens.json | Design tokens in the W3C Design Tokens format |
| /audit/components.md | Component inventory with states |
| /audit/layout-system.md | Panel and grid behaviour |
| /audit/behaviour.md | Live update and format behaviour |
| /audit/stack.md | Frontend stack and versions |
| /audit/network.md | Each request that is not GET, with endpoint and purpose |
| /audit/a11y.md | Axe results for each view |
| /audit/gaps.md | Views or states that you could not capture, with the reason |
| /audit/screenshots/ | Screenshots, in folders by view and viewport |
| /audit/components/ | Screenshots, in folders by component and state |

## Completion criteria

1. Each route that the navigation can reach appears in views.md or in gaps.md.
2. A script collects all computed colour, font size and spacing values from the audited views. Each value maps to a token in tokens.json.
3. components.md lists each component with all the states that you observed.
4. layout-system.md describes each panel interaction with a sequence of screenshots.
5. A gitleaks scan of /audit gives zero findings.
6. network.md shows no request that changes data, other than the login request.
7. Keyboard shortcuts, command input and focus order appear in behaviour.md for each view.
8. The M0 progress report summarises the audit and gaps.md.
