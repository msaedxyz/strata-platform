import { cx } from "../lib/utils";
import { EmptyState, ErrorState, LoadingState } from "./States";
import "./Charts.css";

export type ChartTone = "neutral" | "positive" | "negative" | "accent" | "warning";

export interface SparklineProps {
  values: number[];
  tone?: ChartTone;
  /** Accessible description, for example "Signals per day, last 14 days". */
  label: string;
  /** Mark the last point. */
  showLast?: boolean;
  className?: string;
}

const VIEW_W = 100;
const VIEW_H = 24;

/** A small line chart. It scales to the size from the chart tokens. */
export function Sparkline({ values, tone = "accent", label, showLast = true, className }: SparklineProps) {
  if (values.length === 0) {
    return (
      <span className={cx("sds-sparkline", "sds-sparkline--empty", className)} role="img" aria-label={`${label}: no data`}>
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" x2={VIEW_W} y1={VIEW_H / 2} y2={VIEW_H / 2} className="sds-chart__baseline" />
        </svg>
      </span>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? VIEW_W / (values.length - 1) : 0;
  const pts = values.map((v, i) => [i * step, VIEW_H - 2 - ((v - min) / span) * (VIEW_H - 4)] as const);
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  const last = pts[pts.length - 1]!;
  const lastValue = values[values.length - 1];
  return (
    <span className={cx("sds-sparkline", `sds-chart--${tone}`, className)} role="img" aria-label={`${label}. Last value ${lastValue}. Range ${min} to ${max}.`}>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={d} className="sds-chart__line" />
        {showLast && <circle cx={last[0]} cy={last[1]} r="1.5" className="sds-chart__point" />}
      </svg>
    </span>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  tone?: ChartTone;
}

export interface BarChartProps {
  data: BarDatum[];
  label: string;
  /** Format a value for its label. */
  format?: (v: number) => string;
  /** The value of a full bar. Default: the largest value. */
  max?: number;
  loading?: boolean;
  error?: string;
  className?: string;
}

/** A horizontal bar chart. Each row has a label, a bar and the value. */
export function BarChart({ data, label, format = (v) => String(v), max, loading, error, className }: BarChartProps) {
  if (error) return <ErrorState description={error} />;
  if (loading) return <LoadingState rows={data.length || 4} label={`Loading ${label}`} />;
  if (data.length === 0) return <EmptyState title="No data" />;
  const top = max ?? Math.max(...data.map((d) => d.value), 0);
  return (
    <figure className={cx("sds-bar-chart", className)} aria-label={label}>
      <ul className="sds-bar-chart__rows">
        {data.map((d) => {
          const ratio = top > 0 ? Math.max(0, Math.min(1, d.value / top)) : 0;
          return (
            <li key={d.label} className="sds-bar-chart__row">
              <span className="sds-bar-chart__label">{d.label}</span>
              <svg className={cx("sds-bar-chart__track", `sds-chart--${d.tone ?? "accent"}`)} viewBox="0 0 100 1" preserveAspectRatio="none" aria-hidden="true">
                <rect x="0" y="0" width="100" height="1" className="sds-bar-chart__bg" />
                <rect x="0" y="0" width={ratio * 100} height="1" className="sds-bar-chart__bar" />
              </svg>
              <span className="sds-bar-chart__value sds-num" data-live="value">
                {format(d.value)}
              </span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
