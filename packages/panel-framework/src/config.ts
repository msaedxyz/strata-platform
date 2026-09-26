import { tokenValues } from "@strata/design-system/tokens";
import raw from "./grid.config.json";

type TokenTree = { [key: string]: string | TokenTree };

/** Read a size token as a number of pixels, for the grid library that needs numbers. */
export function tokenPx(path: string): number {
  const value = path.split(".").reduce<string | TokenTree | undefined>((node, key) => (node && typeof node === "object" ? node[key] : undefined), tokenValues as unknown as TokenTree);
  if (typeof value !== "string") throw new Error(`grid config: no token ${path}`);
  const n = Number.parseFloat(value);
  if (Number.isNaN(n)) throw new Error(`grid config: token ${path} is not a size (${value})`);
  return n;
}

export interface GridSettings {
  cols: number;
  rowHeight: number;
  margin: [number, number];
  containerPadding: [number, number];
  collapsedRows: number;
  dragThreshold: number;
  resizeHandles: Array<"s" | "w" | "e" | "n" | "sw" | "nw" | "se" | "ne">;
  storage: { keyPrefix: string; schemaVersion: number };
}

export const gridSettings: GridSettings = {
  cols: raw.cols,
  rowHeight: tokenPx(raw.rowHeightToken),
  margin: [tokenPx(raw.marginToken), tokenPx(raw.marginToken)],
  containerPadding: [tokenPx(raw.containerPaddingToken), tokenPx(raw.containerPaddingToken)],
  collapsedRows: raw.collapsedRows,
  dragThreshold: raw.dragThresholdPx,
  resizeHandles: raw.resizeHandles as GridSettings["resizeHandles"],
  storage: { keyPrefix: raw.storage.keyPrefix, schemaVersion: raw.storage.schemaVersion },
};
