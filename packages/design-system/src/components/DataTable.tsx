import { type KeyboardEvent, type PointerEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { cx, nextListIndex } from "../lib/utils";
import { IconButton } from "./Button";
import { Select } from "./Form";
import { EmptyState, ErrorState, LoadingState } from "./States";
import "./DataTable.css";

export type Density = "compact" | "comfortable";
export type SortDirection = "asc" | "desc";
export interface SortState {
  columnId: string;
  direction: SortDirection;
}

export interface Column<T> {
  id: string;
  header: string;
  /** The value for sort and filter. */
  value: (row: T) => string | number | null | undefined;
  /** The cell content. Without it, the cell shows the value. */
  cell?: (row: T) => ReactNode;
  sortable?: boolean;
  filterable?: boolean;
  /** Start width in pixels. Without it, the browser sizes the column. */
  width?: number;
  minWidth?: number;
  align?: "start" | "end";
  /** Numbers use the mono font with tabular figures. */
  numeric?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  label: string;
  density?: Density;
  defaultDensity?: Density;
  onDensityChange?: (d: Density) => void;
  sort?: SortState | null;
  defaultSort?: SortState | null;
  onSortChange?: (s: SortState | null) => void;
  /** Show the filter row at the start. */
  defaultShowFilters?: boolean;
  /** Show the toolbar with the filter toggle and the density control. */
  toolbar?: boolean;
  onRowClick?: (row: T) => void;
  selectedRowId?: string;
  onColumnResize?: (columnId: string, width: number) => void;
  /** Pixels per arrow key press on a resize handle. */
  resizeStep?: number;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyTitle?: string;
  className?: string;
}

const DEFAULT_MIN_WIDTH = 40;

function compare(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** A data table with sort, filter, column resize and density (compact or comfortable). */
export function DataTable<T>({
  columns,
  rows,
  getRowId,
  label,
  density,
  defaultDensity = "compact",
  onDensityChange,
  sort,
  defaultSort = null,
  onSortChange,
  defaultShowFilters = false,
  toolbar = true,
  onRowClick,
  selectedRowId,
  onColumnResize,
  resizeStep = 16,
  loading = false,
  error,
  onRetry,
  emptyTitle = "No rows",
  className,
}: DataTableProps<T>) {
  const [innerDensity, setInnerDensity] = useState<Density>(defaultDensity);
  const [innerSort, setInnerSort] = useState<SortState | null>(defaultSort);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(defaultShowFilters);
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(columns.filter((c) => c.width !== undefined).map((c) => [c.id, c.width as number])),
  );
  const [activeRow, setActiveRow] = useState(0);
  const headerRefs = useRef<Record<string, HTMLTableCellElement | null>>({});
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const drag = useRef<{ id: string; startX: number; startWidth: number; min: number } | null>(null);

  const currentDensity = density ?? innerDensity;
  const currentSort = sort === undefined ? innerSort : sort;

  const setDensity = (d: Density) => {
    if (density === undefined) setInnerDensity(d);
    onDensityChange?.(d);
  };
  const setSort = (s: SortState | null) => {
    if (sort === undefined) setInnerSort(s);
    onSortChange?.(s);
  };

  const toggleSort = (col: Column<T>) => {
    if (col.sortable === false) return;
    if (!currentSort || currentSort.columnId !== col.id) setSort({ columnId: col.id, direction: "asc" });
    else if (currentSort.direction === "asc") setSort({ columnId: col.id, direction: "desc" });
    else setSort(null);
  };

  const visible = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v.trim() !== "");
    let out = rows;
    if (active.length) {
      out = rows.filter((row) =>
        active.every(([id, q]) => {
          const col = columns.find((c) => c.id === id);
          const v = col?.value(row);
          return String(v ?? "")
            .toLowerCase()
            .includes(q.trim().toLowerCase());
        }),
      );
    }
    if (currentSort) {
      const col = columns.find((c) => c.id === currentSort.columnId);
      if (col) {
        const dir = currentSort.direction === "asc" ? 1 : -1;
        out = [...out].sort((a, b) => dir * compare(col.value(a), col.value(b)));
      }
    }
    return out;
  }, [rows, columns, filters, currentSort]);

  const setWidth = (id: string, w: number, min: number) => {
    const width = Math.max(min, Math.round(w));
    setWidths((prev) => ({ ...prev, [id]: width }));
    onColumnResize?.(id, width);
  };

  const measured = (col: Column<T>) => widths[col.id] ?? headerRefs.current[col.id]?.getBoundingClientRect().width ?? col.width ?? 120;

  const onResizeStart = (e: PointerEvent<HTMLSpanElement>, col: Column<T>) => {
    e.preventDefault();
    e.stopPropagation();
    // Fix every column width first, so that one column changes and the others keep their size.
    const fixed: Record<string, number> = {};
    for (const c of columns) fixed[c.id] = measured(c);
    setWidths(fixed);
    drag.current = { id: col.id, startX: e.clientX, startWidth: fixed[col.id]!, min: col.minWidth ?? DEFAULT_MIN_WIDTH };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onResizeMove = (e: PointerEvent<HTMLSpanElement>) => {
    const d = drag.current;
    if (!d) return;
    setWidth(d.id, d.startWidth + (e.clientX - d.startX), d.min);
  };
  const onResizeEnd = (e: PointerEvent<HTMLSpanElement>) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const onResizeKey = (e: KeyboardEvent<HTMLSpanElement>, col: Column<T>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const fixed: Record<string, number> = {};
    for (const c of columns) fixed[c.id] = measured(c);
    setWidths(fixed);
    const delta = e.key === "ArrowRight" ? resizeStep : -resizeStep;
    setWidth(col.id, fixed[col.id]! + delta, col.minWidth ?? DEFAULT_MIN_WIDTH);
  };

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T, index: number) => {
    const next = nextListIndex(e.key, index, visible.length);
    if (next !== null) {
      e.preventDefault();
      setActiveRow(next);
      rowRefs.current[next]?.focus();
    } else if (e.key === "Enter" && onRowClick) {
      e.preventDefault();
      onRowClick(row);
    }
  };

  const hasWidths = Object.keys(widths).length > 0;
  const rowFocus = Math.min(activeRow, Math.max(visible.length - 1, 0));

  let status: ReactNode = null;
  if (error) status = <ErrorState description={error} onRetry={onRetry} />;
  else if (loading) status = <LoadingState rows={5} label={`Loading ${label}`} />;
  else if (visible.length === 0)
    status = <EmptyState title={rows.length === 0 ? emptyTitle : "No rows match the filters"} />;

  return (
    <div className={cx("sds-table", `sds-table--${currentDensity}`, className)}>
      {toolbar && (
        <div className="sds-table__toolbar">
          <span className="sds-table__count sds-num" aria-live="polite">
            {visible.length === rows.length ? `${rows.length} rows` : `${visible.length} of ${rows.length} rows`}
          </span>
          <IconButton
            size="sm"
            icon="search"
            label={showFilters ? "Hide filters" : "Show filters"}
            pressed={showFilters}
            onClick={() => setShowFilters((s) => !s)}
          />
          <Select
            label="Density"
            hideLabel
            className="sds-table__density"
            value={currentDensity}
            onChange={(e) => setDensity(e.target.value as Density)}
            options={[
              { value: "compact", label: "Compact" },
              { value: "comfortable", label: "Comfortable" },
            ]}
          />
        </div>
      )}
      <div className="sds-table__scroll">
        <table className={cx("sds-table__table", hasWidths && "sds-table__table--fixed")} aria-label={label} aria-rowcount={visible.length}>
          {hasWidths && (
            <colgroup>
              {columns.map((c) => (
                <col key={c.id} style={widths[c.id] !== undefined ? { width: `${widths[c.id]}px` } : undefined} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr>
              {columns.map((c) => {
                const sorted = currentSort?.columnId === c.id ? currentSort.direction : undefined;
                const sortable = c.sortable !== false;
                return (
                  <th
                    key={c.id}
                    ref={(el) => {
                      headerRefs.current[c.id] = el;
                    }}
                    scope="col"
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : sortable ? "none" : undefined}
                    className={cx("sds-table__th", (c.numeric || c.align === "end") && "sds-table__cell--end")}
                    data-column-id={c.id}
                  >
                    {sortable ? (
                      <button type="button" className="sds-table__sort" onClick={() => toggleSort(c)}>
                        <span className="sds-table__header-text">{c.header}</span>
                        <Icon name={sorted === "asc" ? "arrowUp" : sorted === "desc" ? "arrowDown" : "sort"} size="sm" className={cx("sds-table__sort-icon", sorted && "sds-table__sort-icon--active")} />
                      </button>
                    ) : (
                      <span className="sds-table__header-text">{c.header}</span>
                    )}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize column ${c.header}`}
                      aria-valuenow={widths[c.id]}
                      aria-valuemin={c.minWidth ?? DEFAULT_MIN_WIDTH}
                      tabIndex={0}
                      className="sds-table__resize"
                      onPointerDown={(e) => onResizeStart(e, c)}
                      onPointerMove={onResizeMove}
                      onPointerUp={onResizeEnd}
                      onPointerCancel={onResizeEnd}
                      onKeyDown={(e) => onResizeKey(e, c)}
                    />
                  </th>
                );
              })}
            </tr>
            {showFilters && (
              <tr className="sds-table__filters">
                {columns.map((c) => (
                  <th key={c.id} className="sds-table__th sds-table__th--filter">
                    {c.filterable !== false && (
                      <input
                        className="sds-table__filter"
                        aria-label={`Filter ${c.header}`}
                        placeholder="Filter"
                        value={filters[c.id] ?? ""}
                        onChange={(e) => setFilters((f) => ({ ...f, [c.id]: e.target.value }))}
                      />
                    )}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          {!status && (
            <tbody>
              {visible.map((row, i) => {
                const id = getRowId(row);
                return (
                  <tr
                    key={id}
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    className={cx("sds-table__row", selectedRowId === id && "sds-table__row--selected", onRowClick && "sds-table__row--clickable")}
                    tabIndex={i === rowFocus ? 0 : -1}
                    aria-selected={selectedRowId !== undefined ? selectedRowId === id : undefined}
                    onClick={() => {
                      setActiveRow(i);
                      onRowClick?.(row);
                    }}
                    onKeyDown={(e) => onRowKey(e, row, i)}
                    data-row-id={id}
                  >
                    {columns.map((c) => (
                      <td key={c.id} className={cx("sds-table__td", c.numeric && "sds-num", (c.numeric || c.align === "end") && "sds-table__cell--end")}>
                        {c.cell ? c.cell(row) : String(c.value(row) ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
        {status && <div className="sds-table__status">{status}</div>}
      </div>
    </div>
  );
}
