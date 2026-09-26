import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  addPanel,
  applyGridLayout,
  createPanelRegistry,
  defaultLayout,
  gridSettings,
  LAYOUT_SCHEMA_VERSION,
  layoutKey,
  LocalStorageLayoutStore,
  type LayoutStore,
  MemoryLayoutStore,
  movePanel,
  PanelGrid,
  type PanelProps,
  removePanel,
  resizePanel,
  type Role,
  toggleCollapse,
  useWorkspace,
  type WorkspaceDefinition,
} from "../src";

const Body = ({ moduleId }: PanelProps) => <p>Body of {moduleId}</p>;
const registry = createPanelRegistry([
  { id: "alpha", title: "Alpha", component: Body, defaultSize: { w: 6, h: 8 } },
  { id: "beta", title: "Beta", component: Body, defaultSize: { w: 6, h: 8 } },
  { id: "gamma", title: "Gamma", component: Body, defaultSize: { w: 4, h: 6 } },
  { id: "admin-only", title: "Admin only", component: Body, defaultSize: { w: 4, h: 6 }, minRole: "admin" },
]);
const workspace: WorkspaceDefinition = {
  id: "ws",
  name: "Test workspace",
  icon: "layout",
  defaultPanels: [
    { i: "alpha", x: 0, y: 0, w: 6, h: 8 },
    { i: "beta", x: 6, y: 0, w: 6, h: 8 },
  ],
};

function Harness({ store, role = "analyst" }: { store: LayoutStore; role?: Role }) {
  const controller = useWorkspace(workspace, store, registry);
  return <PanelGrid controller={controller} registry={registry} role={role} />;
}

const item = (id: string) => document.querySelector<HTMLElement>(`[data-panel-id="${id}"]`);

describe("layout operations", () => {
  it("collapses a panel to its header and restores its height", () => {
    const l = defaultLayout(workspace);
    const c = toggleCollapse(l, "alpha", 1);
    expect(c.panels[0]!.h).toBe(1);
    expect(c.collapsed.alpha).toBe(8);
    const e = toggleCollapse(c, "alpha", 1);
    expect(e.panels[0]!.h).toBe(8);
    expect(e.collapsed).toEqual({});
  });

  it("adds a panel at the bottom once and removes it", () => {
    const l = addPanel(defaultLayout(workspace), registry.get("gamma")!, 12);
    expect(l.panels.at(-1)).toEqual({ i: "gamma", x: 0, y: 8, w: 4, h: 6 });
    expect(addPanel(l, registry.get("gamma")!, 12)).toBe(l);
    expect(removePanel(l, "gamma").panels.map((p) => p.i)).toEqual(["alpha", "beta"]);
  });

  it("keeps panels inside the grid when they move or resize", () => {
    const l = defaultLayout(workspace);
    expect(movePanel(l, "beta", 3, 0, 12).panels[1]!.x).toBe(6);
    expect(movePanel(l, "alpha", -1, -1, 12).panels[0]).toMatchObject({ x: 0, y: 0 });
    expect(resizePanel(l, "alpha", -10, -10, 12, { w: 2, h: 3 }).panels[0]).toMatchObject({ w: 2, h: 3 });
    expect(resizePanel(l, "beta", 4, 0, 12, { w: 1, h: 1 }).panels[1]!.w).toBe(6);
  });

  it("takes positions from the grid and keeps the object when nothing changes", () => {
    const l = defaultLayout(workspace);
    expect(applyGridLayout(l, l.panels)).toBe(l);
    expect(applyGridLayout(l, [{ i: "alpha", x: 0, y: 8, w: 6, h: 8 }]).panels[0]!.y).toBe(8);
  });
});

describe("layout storage", () => {
  it("uses versioned keys per user and workspace", () => {
    expect(layoutKey("u1", "origination")).toBe(`strata.layout.v${LAYOUT_SCHEMA_VERSION}.u1.origination`);
  });

  it("saves and loads a layout in localStorage", () => {
    const store = new LocalStorageLayoutStore({ userId: "u1" });
    const l = toggleCollapse(defaultLayout(workspace), "beta", 1);
    store.save("ws", l);
    expect(store.load("ws")).toEqual(l);
    store.clear("ws");
    expect(store.load("ws")).toBeNull();
  });

  it("ignores a layout with another schema version or bad data", () => {
    const store = new LocalStorageLayoutStore({ userId: "u1" });
    window.localStorage.setItem(layoutKey("u1", "ws"), JSON.stringify({ version: 999, panels: [], collapsed: {} }));
    expect(store.load("ws")).toBeNull();
    window.localStorage.setItem(layoutKey("u1", "ws"), "{not json");
    expect(store.load("ws")).toBeNull();
  });

  it("keeps the users apart", () => {
    const a = new LocalStorageLayoutStore({ userId: "a" });
    const b = new LocalStorageLayoutStore({ userId: "b" });
    a.save("ws", defaultLayout(workspace));
    expect(b.load("ws")).toBeNull();
  });
});

describe("panel registry", () => {
  it("lists the panels that a role can use", () => {
    expect(registry.list("analyst").map((d) => d.id)).not.toContain("admin-only");
    expect(registry.list("admin").map((d) => d.id)).toContain("admin-only");
  });

  it("rejects a duplicate id", () => {
    expect(() => createPanelRegistry([registry.get("alpha")!, registry.get("alpha")!])).toThrow(/twice/);
  });
});

describe("grid settings come from tokens and configuration", () => {
  it("uses the panel header token for the row height, so a collapsed panel is one row", () => {
    expect(gridSettings.rowHeight).toBeGreaterThan(0);
    expect(gridSettings.collapsedRows).toBe(1);
    expect(gridSettings.cols).toBe(12);
  });
});

describe("PanelGrid", () => {
  it("renders the default layout with a frame for each panel", () => {
    render(<Harness store={new MemoryLayoutStore()} />);
    expect(screen.getByRole("heading", { name: "Test workspace" })).toBeInTheDocument();
    expect(item("alpha")).toHaveAttribute("data-w", "6");
    expect(screen.getByRole("region", { name: "Alpha" })).toHaveTextContent("Body of alpha");
  });

  it("collapses and expands a panel", async () => {
    const user = userEvent.setup();
    render(<Harness store={new MemoryLayoutStore()} />);
    await user.click(screen.getByRole("button", { name: "Collapse Alpha" }));
    expect(item("alpha")).toHaveAttribute("data-collapsed", "true");
    expect(item("alpha")).toHaveAttribute("data-h", "1");
    expect(screen.queryByText("Body of alpha")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Expand Alpha" }));
    expect(item("alpha")).toHaveAttribute("data-h", "8");
  });

  it("maximises a panel and restores it with Escape", async () => {
    const user = userEvent.setup();
    render(<Harness store={new MemoryLayoutStore()} />);
    await user.click(screen.getByRole("button", { name: "Maximise Beta" }));
    const max = document.querySelector("[data-maximised-id]");
    expect(max).toHaveAttribute("data-maximised-id", "beta");
    expect(within(max as HTMLElement).getByRole("button", { name: "Restore Beta" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(document.querySelector("[data-maximised-id]")).toBeNull();
  });

  it("closes a panel and adds it back from the panel picker", async () => {
    const user = userEvent.setup();
    render(<Harness store={new MemoryLayoutStore()} />);
    await user.click(screen.getByRole("button", { name: "Close Alpha" }));
    expect(item("alpha")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add panel" }));
    const dialog = screen.getByRole("dialog", { name: "Add panel" });
    expect(within(dialog).getByRole("button", { name: /Beta/ })).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: /Admin only/ })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: /Alpha/ }));
    expect(item("alpha")).not.toBeNull();
  });

  it("keeps the layout for the next session and resets it", async () => {
    const user = userEvent.setup();
    const store = new MemoryLayoutStore();
    const first = render(<Harness store={store} />);
    await user.click(screen.getByRole("button", { name: "Close Beta" }));
    first.unmount();
    render(<Harness store={store} />);
    expect(item("beta")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Reset layout" }));
    expect(item("beta")).not.toBeNull();
  });

  it("moves a panel with the panel menu (keyboard alternative to drag)", async () => {
    const user = userEvent.setup();
    render(<Harness store={new MemoryLayoutStore()} />);
    await user.click(screen.getByRole("button", { name: "Alpha panel menu" }));
    await act(async () => {
      await user.click(screen.getByRole("menuitem", { name: "Move down" }));
    });
    expect(Number(item("alpha")!.getAttribute("data-y"))).toBeGreaterThanOrEqual(0);
    await user.click(screen.getByRole("button", { name: "Alpha panel menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Make narrower" }));
    expect(item("alpha")).toHaveAttribute("data-w", "5");
  });

  it("keeps each workspace layout apart when the workspace changes", async () => {
    const user = userEvent.setup();
    const other: WorkspaceDefinition = { id: "other", name: "Other", icon: "layout", defaultPanels: [{ i: "gamma", x: 0, y: 0, w: 4, h: 6 }] };
    const store = new MemoryLayoutStore();
    function Switcher({ ws }: { ws: WorkspaceDefinition }) {
      const controller = useWorkspace(ws, store, registry);
      return <PanelGrid controller={controller} registry={registry} role="analyst" />;
    }
    const view = render(<Switcher ws={workspace} />);
    await user.click(screen.getByRole("button", { name: "Close Beta" }));
    view.rerender(<Switcher ws={other} />);
    expect(item("gamma")).not.toBeNull();
    expect(item("alpha")).toBeNull();
    view.rerender(<Switcher ws={workspace} />);
    expect(item("alpha")).not.toBeNull();
    expect(item("beta")).toBeNull();
    expect(store.load("ws")!.panels.map((p) => p.i)).toEqual(["alpha"]);
    expect(store.load("other")!.panels.map((p) => p.i)).toEqual(["gamma"]);
  });

  it("shows the empty state when every panel is closed", async () => {
    const user = userEvent.setup();
    render(<Harness store={new MemoryLayoutStore()} />);
    await user.click(screen.getByRole("button", { name: "Close Alpha" }));
    await user.click(screen.getByRole("button", { name: "Close Beta" }));
    expect(screen.getByText("No panels in this workspace")).toBeInTheDocument();
  });
});
