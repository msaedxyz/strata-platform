import { type PanelDefinition, type Role, roleAtLeast } from "./types";

export interface PanelRegistry {
  get(id: string): PanelDefinition | undefined;
  /** The panels that the role can use, in registration order. */
  list(role?: Role | null): PanelDefinition[];
  ids(): string[];
}

/** The panel registry: each module that can be a panel. */
export function createPanelRegistry(definitions: PanelDefinition[]): PanelRegistry {
  const map = new Map<string, PanelDefinition>();
  for (const d of definitions) {
    if (map.has(d.id)) throw new Error(`panel registry: the id ${d.id} is registered twice`);
    if (d.defaultSize.w < 1 || d.defaultSize.h < 1) throw new Error(`panel registry: ${d.id} needs a default size of 1x1 or more`);
    map.set(d.id, d);
  }
  return {
    get: (id) => map.get(id),
    list: (role) => [...map.values()].filter((d) => role === undefined || roleAtLeast(role, d.minRole)),
    ids: () => [...map.keys()],
  };
}
