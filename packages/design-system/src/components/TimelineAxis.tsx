import { cx } from "../lib/utils";
import type { ChartTone } from "./Charts";
import { EmptyState, ErrorState, LoadingState } from "./States";
import "./TimelineAxis.css";

export interface TimelineRange {
  id: string;
  /** ISO date, YYYY-MM-DD. */
  start: string;
  end: string;
  label?: string;
  tone?: ChartTone;
  /** A forecast range is shown with a dashed border. */
  forecast?: boolean;
}

export interface TimelineMarker {
  id: string;
  date: string;
  label: string;
  tone?: ChartTone;
}

export interface TimelineRow {
  id: string;
  label: string;
  ranges?: TimelineRange[];
  markers?: TimelineMarker[];
}

export interface TimelineAxisProps {
  /** The first month, YYYY-MM. */
  start: string;
  /** Number of months on the axis. The procurement calendar uses 24. */
  months?: number;
  rows?: TimelineRow[];
  /** Today, YYYY-MM-DD. A line marks it. */
  today?: string;
  label: string;
  locale?: string;
  onRangeSelect?: (rowId: string, rangeId: string) => void;
  loading?: boolean;
  error?: string;
  className?: string;
}

function monthStart(ym: string, add: number): Date {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + add, 1));
}

const toTime = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** A month axis with rows of ranges and markers, for example forecast procurement windows. */
export function TimelineAxis({
  start,
  months = 24,
  rows = [],
  today,
  label,
  locale = "en-GB",
  onRangeSelect,
  loading,
  error,
  className,
}: TimelineAxisProps) {
  const from = monthStart(start, 0).getTime();
  const to = monthStart(start, months).getTime();
  const span = to - from;
  const pos = (iso: string) => Math.max(0, Math.min(1, (toTime(iso) - from) / span));
  const monthFmt = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const yearFmt = new Intl.DateTimeFormat(locale, { year: "2-digit", timeZone: "UTC" });
  const ticks = Array.from({ length: months }, (_, i) => monthStart(start, i));
  const pct = (f: number) => `${(f * 100).toFixed(3)}%`;
  const todayPos = today ? (toTime(today) - from) / span : null;

  let body;
  if (error) body = <ErrorState description={error} />;
  else if (loading) body = <LoadingState rows={4} label={`Loading ${label}`} />;
  else if (rows.length === 0) body = <EmptyState title="No forecast windows" />;
  else
    body = (
      <ul className="sds-timeline__rows">
        {rows.map((row) => (
          <li key={row.id} className="sds-timeline__row">
            <span className="sds-timeline__row-label" title={row.label}>
              {row.label}
            </span>
            <div className="sds-timeline__track">
              {row.ranges?.map((r) => {
                const left = pos(r.start);
                const width = Math.max(pos(r.end) - left, 0.005);
                const text = `${r.label ?? row.label}: ${r.start} to ${r.end}${r.forecast ? " (forecast)" : ""}`;
                const cls = cx("sds-timeline__range", `sds-chart--${r.tone ?? "accent"}`, r.forecast && "sds-timeline__range--forecast");
                const style = { left: pct(left), width: pct(width) };
                return onRangeSelect ? (
                  <button key={r.id} type="button" className={cls} style={style} title={text} aria-label={text} onClick={() => onRangeSelect(row.id, r.id)}>
                    {r.label && <span className="sds-timeline__range-label">{r.label}</span>}
                  </button>
                ) : (
                  <span key={r.id} className={cls} style={style} title={text} role="img" aria-label={text}>
                    {r.label && <span className="sds-timeline__range-label">{r.label}</span>}
                  </span>
                );
              })}
              {row.markers?.map((m) => (
                <span
                  key={m.id}
                  className={cx("sds-timeline__marker", `sds-chart--${m.tone ?? "warning"}`)}
                  style={{ left: pct(pos(m.date)) }}
                  role="img"
                  aria-label={`${m.label}: ${m.date}`}
                  title={`${m.label}: ${m.date}`}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
    );

  return (
    <figure className={cx("sds-timeline", className)} aria-label={label}>
      <div className="sds-timeline__axis" aria-hidden="true">
        <span className="sds-timeline__corner" />
        <div className="sds-timeline__months">
          {ticks.map((d, i) => (
            <span key={d.toISOString()} className={cx("sds-timeline__month", d.getUTCMonth() === 0 && "sds-timeline__month--year")}>
              {monthFmt.format(d)}
              {(i === 0 || d.getUTCMonth() === 0) && <span className="sds-timeline__year"> {yearFmt.format(d)}</span>}
            </span>
          ))}
        </div>
      </div>
      <div className="sds-timeline__body">
        {body}
        {todayPos !== null && todayPos >= 0 && todayPos <= 1 && (
          <div className="sds-timeline__today-layer" aria-hidden="true">
            <span className="sds-timeline__corner" />
            <div className="sds-timeline__today-track">
              <span className="sds-timeline__today" style={{ left: pct(todayPos) }} data-live="today" />
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}
