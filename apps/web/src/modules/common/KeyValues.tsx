import { type Column, DataTable } from "@strata/design-system";
import type { ReactNode } from "react";

export interface KeyValue {
  id: string;
  label: string;
  value: ReactNode;
  /** Text for sort and filter. */
  text?: string;
}

const columns: Column<KeyValue>[] = [
  { id: "label", header: "Item", value: (r) => r.label, sortable: false, filterable: false },
  { id: "value", header: "Value", value: (r) => r.text ?? "", cell: (r) => r.value, sortable: false, filterable: false },
];

/** Label and value pairs as a two column DataTable (no new visual pattern). */
export function KeyValues({ rows, label }: { rows: KeyValue[]; label: string }) {
  return <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} label={label} toolbar={false} emptyTitle="No values" className="strata-kv" />;
}
