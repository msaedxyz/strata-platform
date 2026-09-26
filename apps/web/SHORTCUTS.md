# Keyboard shortcuts

These shortcuts are provisional. The build network blocked beta.infora.io on 2026-09-26, so no one could record the Infora shortcuts in /audit/behaviour.md. When the audit exists, compare the table with the audit and change src/config/shortcuts.ts. That file is the only place that defines a shortcut. The shortcut help ("?") shows the same list.

| Id | Keys | Action | Handled by |
|---|---|---|---|
| command.open | `/`, `Ctrl K`, `⌘ K` | Open the command input. Type to filter the commands. The arrow keys move. Enter runs the command | App shell |
| help.open | `?` | Show the keyboard shortcuts | App shell |
| workspace.1 | `g` then `1` | Go to Origination | App shell |
| workspace.2 | `g` then `2` | Go to Relationships | App shell |
| workspace.3 | `g` then `3` | Go to Monitoring | App shell |
| workspace.4 | `g` then `4` | Go to Review | App shell |
| overlay.close | `Esc` | Close the open overlay: command input, shortcut help, dialog, drawer or menu. Restore a maximised panel | Design system components |
| list.move | `↑`, `↓` | Move in a list: navigation, command results, menus, table rows, panel picker. `Home` and `End` go to the first and the last item | Design system components |

## Rules

1. The app shell ignores its shortcuts while the focus is in a text field.
2. The app shell ignores its shortcuts while an overlay is open. The overlay gets the keys.
3. `Esc` closes only the top overlay.
4. The second key of a sequence such as `g 1` must come within 1200 ms (src/config/app.config.ts).
5. The search field in the top bar opens the command input. A letter typed in the field goes to the command input.

## Tests

apps/web/e2e/shortcuts.spec.ts has one end to end test for each shortcut in src/config/shortcuts.ts. A test fails when a shortcut in the map has no test.
