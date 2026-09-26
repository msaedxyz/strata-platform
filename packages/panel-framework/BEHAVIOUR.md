# Panel framework behaviour

This file is the provisional stand-in for /audit/layout-system.md. The build network blocked beta.infora.io on 2026-09-26, so no one could record the Infora behaviour. When the audit exists, compare each item below with the audit. Change the code and this file where they are different.

## Grid

| Item | Provisional value | Source |
|---|---|---|
| Library | react-grid-layout 2 | docs/02 default stack |
| Columns | 12 | src/grid.config.json |
| Row height | The token size.panel-header (24 px) | src/grid.config.json, design token |
| Gutter between panels | The token space.2 (4 px), horizontal and vertical | src/grid.config.json, design token |
| Padding of the grid | The token space.2 (4 px) | src/grid.config.json, design token |
| Compaction | Vertical. Panels move up to fill empty rows | react-grid-layout default |
| Breakpoints | None. The grid has one layout for each workspace | Provisional |

## Panel interactions

| Interaction | How the user does it | Result |
|---|---|---|
| Drag | Press on the panel header and move the pointer. The move starts after 3 px. Buttons in the header do not start a drag | A placeholder shows the target cells. On release, the panel goes to the placeholder |
| Snap | Automatic | The panel position and size are always whole grid cells |
| Resize | Drag the right edge, the bottom edge or the bottom right corner | The panel size changes in whole cells. The minimum size comes from the panel registry |
| Collapse | The collapse button in the panel header | The panel shows its header only. Its height becomes one row. The expand button gives back the previous height |
| Maximise | The maximise button in the panel header | The panel fills the grid area. The other panels are hidden and inert. The restore button or Esc goes back |
| Close | The close button in the panel header, or "Close panel" in the panel menu | The panel goes out of the layout. Focus goes to the workspace heading |
| Add | "Add panel" in the workspace toolbar or in the command input | The panel picker opens. It lists each module that the role can use. A module that is in the workspace already is disabled. The new panel goes to the bottom left with its default size |
| Move with the keyboard | Panel menu: Move left, Move right, Move up, Move down | The panel moves one cell |
| Resize with the keyboard | Panel menu: Make wider, Make narrower, Make taller, Make shorter | The panel size changes by one cell |
| Reset layout | "Reset layout" in the workspace toolbar or in the command input | The saved layout is deleted. The default layout of the workspace comes back |

## Layout storage

1. Infora's method is unknown. The provisional method is localStorage in the browser.
2. The key is `strata.layout.v<schema version>.<user id>.<workspace id>`. Each user has a separate layout on a shared computer.
3. The stored value has the schema version, the panel positions and the collapsed panels with their heights.
4. A stored value with a different schema version is ignored. The store deletes the keys of older versions.
5. The maximised panel is a view state. It is not stored.
6. The grid uses the `LayoutStore` interface. A server store can replace localStorage with no change to the grid.

## Workspaces

The app gives the default layout of each workspace (apps/web/src/config/workspaces.ts). "Reset layout" goes back to it.
