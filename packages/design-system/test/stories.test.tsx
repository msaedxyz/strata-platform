// Each component has a Storybook story for each state in the inventory, and every story renders.
import { composeStories } from "@storybook/react";
import type React from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { componentInventory, storyExportName } from "../src/inventory";

// jsdom has no WebGL. A small stand-in for MapLibre lets the MapView stories render.
vi.mock("maplibre-gl", () => {
  class FakeMap {
    handlers: Record<string, Array<(e?: unknown) => void>> = {};
    constructor() {
      setTimeout(() => this.handlers.load?.forEach((h) => h()), 0);
    }
    on(name: string, h: (e?: unknown) => void) {
      (this.handlers[name] ??= []).push(h);
      return this;
    }
    loaded() {
      return true;
    }
    remove() {}
  }
  class FakeMarker {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  }
  return { Map: FakeMap, Marker: FakeMarker };
});

type StoryModule = Record<string, unknown> & { default: { title: string } };
const modules = import.meta.glob<StoryModule>("../src/**/*.stories.tsx", { eager: true });
const byTitle = new Map(Object.values(modules).map((m) => [m.default.title, m]));

describe("stories", () => {
  it("every component in the inventory has a stories file", () => {
    const missing = Object.keys(componentInventory).filter((c) => !byTitle.has(c));
    expect(missing).toEqual([]);
  });

  for (const [component, states] of Object.entries(componentInventory)) {
    it(`${component} has a story for each state: ${states.join(", ")}`, () => {
      const mod = byTitle.get(component);
      expect(mod).toBeDefined();
      const missing = states.filter((s) => !(storyExportName(s) in (mod as object)));
      expect(missing).toEqual([]);
    });
  }

  for (const [file, mod] of Object.entries(modules)) {
    const stories = composeStories(mod as Parameters<typeof composeStories>[0]);
    for (const [name, Story] of Object.entries(stories) as Array<[string, React.ComponentType]>) {
      it(`${mod.default.title} / ${name} renders (${file.replace("../src/components/", "")})`, async () => {
        const { container, unmount } = render(<Story />);
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
        expect(container.innerHTML.length + document.body.innerHTML.length).toBeGreaterThan(0);
        unmount();
      });
    }
  }
});
