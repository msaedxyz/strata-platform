import { describe, expect, it } from "vitest";
import { matchesBinding, shortcuts, WORKSPACE_SHORTCUTS } from "../src/config/shortcuts";
import { workspaces } from "../src/config/workspaces";
import { MODULE_IDS, moduleRegistry } from "../src/modules/registry";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("module registry", () => {
  it("has exactly the Strata module ids", () => {
    expect([...MODULE_IDS].sort()).toEqual(
      [
        "ticker",
        "tier0-alerts",
        "demand-drivers",
        "site-watch-list",
        "signal-feed",
        "deal-map",
        "kanban",
        "priority-list",
        "project-pipeline",
        "procurement-calendar",
        "relationship-panel",
        "timeline",
        "approval-queue",
        "quarantine",
        "source-health",
        "brief-editor",
        "alert-telemetry",
        "next-actions",
      ].sort(),
    );
  });

  it("keeps the brief editor for admins", () => {
    expect(moduleRegistry.list("approver").map((d) => d.id)).not.toContain("brief-editor");
    expect(moduleRegistry.list("admin").map((d) => d.id)).toContain("brief-editor");
  });
});

describe("default workspaces (docs/07)", () => {
  it("has the four workspaces with the docs/07 panels", () => {
    const panels = Object.fromEntries(workspaces.map((w) => [w.id, w.defaultPanels.map((p) => p.i).sort()]));
    expect(panels).toEqual({
      origination: ["deal-map", "priority-list", "procurement-calendar", "project-pipeline"],
      relationships: ["kanban", "next-actions", "relationship-panel"],
      monitoring: ["demand-drivers", "signal-feed", "site-watch-list", "source-health", "ticker", "tier0-alerts"],
      review: ["alert-telemetry", "approval-queue", "quarantine"],
    });
  });

  it("places every panel inside the 12 columns with no overlap", () => {
    for (const w of workspaces) {
      for (const p of w.defaultPanels) {
        expect(moduleRegistry.get(p.i), `${w.id}/${p.i} is registered`).toBeDefined();
        expect(p.x + p.w).toBeLessThanOrEqual(12);
      }
      for (const a of w.defaultPanels) {
        for (const b of w.defaultPanels) {
          if (a === b) continue;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${w.id}: ${a.i} and ${b.i}`).toBe(false);
        }
      }
    }
  });
});

describe("shortcut map", () => {
  it("has unique ids and a description and display for each shortcut", () => {
    expect(new Set(shortcuts.map((s) => s.id)).size).toBe(shortcuts.length);
    for (const s of shortcuts) {
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.display.length).toBeGreaterThan(0);
      expect(!!s.bindings || !!s.sequence).toBe(true);
    }
  });

  it("maps g 1 to g 4 to the four workspaces in navigation order", () => {
    expect(Object.values(WORKSPACE_SHORTCUTS)).toEqual(workspaces.map((w) => w.id));
  });

  it("matches the bindings with exact modifier keys", () => {
    expect(matchesBinding(key("/"), { key: "/" })).toBe(true);
    expect(matchesBinding(key("k", { ctrlKey: true }), { key: "k", ctrl: true })).toBe(true);
    expect(matchesBinding(key("k"), { key: "k", ctrl: true })).toBe(false);
    expect(matchesBinding(key("k", { ctrlKey: true, altKey: true }), { key: "k", ctrl: true })).toBe(false);
    expect(matchesBinding(key("?", { shiftKey: true }), { key: "?" })).toBe(true);
  });
});
