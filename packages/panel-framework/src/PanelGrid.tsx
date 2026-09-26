import { Badge, Button, EmptyState, type MenuItem, PanelFrame, useEscape } from "@strata/design-system";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { GridLayout, type Layout, useContainerWidth } from "react-grid-layout";
import { gridSettings } from "./config";
import { PanelPicker } from "./PanelPicker";
import type { PanelRegistry } from "./registry";
import { type PanelDefinition, type Role, roleAtLeast } from "./types";
import type { WorkspaceController } from "./useWorkspace";
import "./PanelGrid.css";

export interface PanelGridProps {
  controller: WorkspaceController;
  registry: PanelRegistry;
  role?: Role | null;
  /** Content at the end of the workspace toolbar. */
  toolbarExtra?: ReactNode;
}

/**
 * The panel grid (react-grid-layout). Drag a panel by its header. Resize it from the right edge, the bottom edge
 * or the corner. Panels snap to the grid. Each panel header has collapse, maximise, close and a menu.
 */
export function PanelGrid({ controller, registry, role, toolbarExtra }: PanelGridProps) {
  const c = controller;
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1280 });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const maxRef = useRef<HTMLDivElement>(null);
  useEscape(c.maximisedId !== null, c.restore);

  const visible = useMemo(
    () =>
      c.layout.panels
        .map((p) => ({ p, def: registry.get(p.i) }))
        .filter((x): x is { p: typeof x.p; def: PanelDefinition } => !!x.def && roleAtLeast(role, x.def.minRole)),
    [c.layout.panels, registry, role],
  );

  const gridLayout: Layout = useMemo(
    () =>
      visible.map(({ p, def }) => {
        const collapsed = p.i in c.layout.collapsed;
        return {
          i: p.i,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          minW: def.minSize?.w ?? 1,
          minH: collapsed ? gridSettings.collapsedRows : (def.minSize?.h ?? 2),
          isResizable: !collapsed,
        };
      }),
    [visible, c.layout.collapsed],
  );

  useEffect(() => {
    if (c.maximisedId) maxRef.current?.querySelector<HTMLButtonElement>('[data-panel-action="maximise"]')?.focus();
  }, [c.maximisedId]);

  const menuFor = (id: string, collapsed: boolean): MenuItem[] => [
    { id: "left", label: "Move left", onSelect: () => c.move(id, -1, 0) },
    { id: "right", label: "Move right", onSelect: () => c.move(id, 1, 0) },
    { id: "up", label: "Move up", onSelect: () => c.move(id, 0, -1) },
    { id: "down", label: "Move down", onSelect: () => c.move(id, 0, 1) },
    { id: "wider", label: "Make wider", onSelect: () => c.resize(id, 1, 0), disabled: collapsed },
    { id: "narrower", label: "Make narrower", onSelect: () => c.resize(id, -1, 0), disabled: collapsed },
    { id: "taller", label: "Make taller", onSelect: () => c.resize(id, 0, 1), disabled: collapsed },
    { id: "shorter", label: "Make shorter", onSelect: () => c.resize(id, 0, -1), disabled: collapsed },
    { id: "close", label: "Close panel", icon: "close", danger: true, onSelect: () => closePanel(id) },
  ];

  const closePanel = (id: string) => {
    c.close(id);
    headingRef.current?.focus();
  };

  const renderPanel = (def: PanelDefinition, maximised: boolean) => {
    const collapsed = !maximised && def.id in c.layout.collapsed;
    const Body = def.component;
    return (
      <PanelFrame
        title={def.title}
        icon={def.icon}
        meta={def.live ? <Badge tone="positive">Live</Badge> : undefined}
        collapsed={collapsed}
        maximised={maximised}
        dragHandle={!maximised}
        onCollapse={maximised ? undefined : () => c.toggleCollapse(def.id)}
        onMaximise={() => c.toggleMaximise(def.id)}
        onClose={() => closePanel(def.id)}
        menuItems={maximised ? undefined : menuFor(def.id, collapsed)}
        flush={def.flush}
        data-panel-frame={def.id}
      >
        <Body moduleId={def.id} maximised={maximised} />
      </PanelFrame>
    );
  };

  const maximisedDef = c.maximisedId ? registry.get(c.maximisedId) : undefined;

  return (
    <div className="spf-workspace" data-workspace-id={c.workspace.id}>
      <div className="spf-toolbar">
        <h1 ref={headingRef} className="spf-toolbar__title" tabIndex={-1}>
          {c.workspace.name}
        </h1>
        {toolbarExtra}
        <Button size="sm" icon="add" onClick={c.openPicker}>
          Add panel
        </Button>
        <Button size="sm" variant="ghost" icon="reset" onClick={c.reset}>
          Reset layout
        </Button>
      </div>
      <div ref={containerRef} className="spf-grid-area">
        {visible.length === 0 && (
          <EmptyState
            title="No panels in this workspace"
            description="Add a panel, or reset the layout."
            action={
              <Button size="sm" icon="add" onClick={c.openPicker}>
                Add panel
              </Button>
            }
          />
        )}
        <div className="spf-grid" aria-hidden={maximisedDef ? true : undefined} inert={maximisedDef ? true : undefined}>
          {mounted && visible.length > 0 && (
            <GridLayout
              width={width}
              layout={gridLayout}
              gridConfig={{
                cols: gridSettings.cols,
                rowHeight: gridSettings.rowHeight,
                margin: gridSettings.margin,
                containerPadding: gridSettings.containerPadding,
              }}
              dragConfig={{
                enabled: true,
                handle: ".sds-panel-header[data-drag-handle]",
                cancel: "[data-no-drag], button, input, select, a",
                threshold: gridSettings.dragThreshold,
              }}
              resizeConfig={{ enabled: true, handles: gridSettings.resizeHandles }}
              onLayoutChange={(l) => c.setGridLayout(l)}
            >
              {visible.map(({ p, def }) => (
                <div key={p.i} className="spf-item" data-panel-id={p.i} data-x={p.x} data-y={p.y} data-w={p.w} data-h={p.h} data-collapsed={p.i in c.layout.collapsed || undefined}>
                  {renderPanel(def, false)}
                </div>
              ))}
            </GridLayout>
          )}
        </div>
        {maximisedDef && (
          <div ref={maxRef} className="spf-maximised" data-maximised-id={maximisedDef.id}>
            {renderPanel(maximisedDef, true)}
          </div>
        )}
      </div>
      <PanelPicker
        open={c.pickerOpen}
        onClose={c.closePicker}
        registry={registry}
        role={role}
        present={c.layout.panels.map((p) => p.i)}
        onAdd={c.add}
      />
    </div>
  );
}
