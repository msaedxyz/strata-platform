import "@testing-library/jest-dom/vitest";
import { setProjectAnnotations } from "@storybook/react";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import preview from "../.storybook/preview";

setProjectAnnotations(preview);

afterEach(() => {
  cleanup();
});

// jsdom has no ResizeObserver and no matchMedia. The components use both.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
