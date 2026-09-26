// Layout storage. PROVISIONAL: Infora's method is unknown until audit/layout-system.md exists.
// The grid uses the LayoutStore interface, so a server store can replace localStorage with no change to the grid.
import { gridSettings } from "./config";
import type { WorkspaceLayout } from "./types";

export interface LayoutStore {
  load(workspaceId: string): WorkspaceLayout | null;
  save(workspaceId: string, layout: WorkspaceLayout): void;
  clear(workspaceId: string): void;
}

export const LAYOUT_SCHEMA_VERSION = gridSettings.storage.schemaVersion;

/** The versioned key, for example "strata.layout.v1.user-1.origination". */
export function layoutKey(userId: string, workspaceId: string, version = LAYOUT_SCHEMA_VERSION): string {
  return `${gridSettings.storage.keyPrefix}.v${version}.${userId}.${workspaceId}`;
}

function isLayout(value: unknown): value is WorkspaceLayout {
  if (!value || typeof value !== "object") return false;
  const v = value as WorkspaceLayout;
  return (
    v.version === LAYOUT_SCHEMA_VERSION &&
    Array.isArray(v.panels) &&
    v.panels.every((p) => typeof p.i === "string" && [p.x, p.y, p.w, p.h].every((n) => Number.isFinite(n) && n >= 0)) &&
    typeof v.collapsed === "object" &&
    v.collapsed !== null
  );
}

export interface LocalStorageLayoutStoreOptions {
  userId: string;
  storage?: Storage;
}

/** Keeps each user's layouts in localStorage under versioned keys. Old versions are removed on load. */
export class LocalStorageLayoutStore implements LayoutStore {
  private readonly userId: string;
  private readonly storage: Storage;

  constructor({ userId, storage }: LocalStorageLayoutStoreOptions) {
    this.userId = userId;
    this.storage = storage ?? window.localStorage;
  }

  load(workspaceId: string): WorkspaceLayout | null {
    for (let v = 0; v < LAYOUT_SCHEMA_VERSION; v++) this.storage.removeItem(layoutKey(this.userId, workspaceId, v));
    const text = this.storage.getItem(layoutKey(this.userId, workspaceId));
    if (!text) return null;
    try {
      const value = JSON.parse(text) as unknown;
      return isLayout(value) ? value : null;
    } catch {
      return null;
    }
  }

  save(workspaceId: string, layout: WorkspaceLayout): void {
    try {
      this.storage.setItem(layoutKey(this.userId, workspaceId), JSON.stringify(layout));
    } catch {
      // A full or blocked storage must not break the dashboard. The layout stays in memory.
    }
  }

  clear(workspaceId: string): void {
    this.storage.removeItem(layoutKey(this.userId, workspaceId));
  }
}

/** A store in memory, for tests and for a session with no storage. */
export class MemoryLayoutStore implements LayoutStore {
  readonly data = new Map<string, WorkspaceLayout>();
  load(workspaceId: string) {
    return this.data.get(workspaceId) ?? null;
  }
  save(workspaceId: string, layout: WorkspaceLayout) {
    this.data.set(workspaceId, structuredClone(layout));
  }
  clear(workspaceId: string) {
    this.data.delete(workspaceId);
  }
}
