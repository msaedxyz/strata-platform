import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { cx, useReducedMotion } from "../lib/utils";
import { Badge, type BadgeTone } from "./Badge";
import "./TickerStrip.css";

export interface TickerItem {
  id: string;
  text: string;
  /** Short tag before the text, for example "T0". */
  tag?: string;
  tone?: BadgeTone;
  /** Time text, already formatted. */
  time?: string;
  onSelect?: () => void;
}

export interface TickerCount {
  label: string;
  value: number;
  tone?: BadgeTone;
}

export interface TickerStripProps {
  items: TickerItem[];
  counts?: TickerCount[];
  /** Scroll speed in pixels per second. The app reads it from configuration. */
  speed?: number;
  /** Stop the scroll. Stories and visual tests use this. */
  paused?: boolean;
  loading?: boolean;
  error?: string;
  emptyText?: string;
  label?: string;
}

/**
 * A continuous scrolling strip. It pauses on hover and on keyboard focus.
 * With reduced motion it does not move, and the user scrolls it.
 */
export function TickerStrip({
  items,
  counts = [],
  speed = 40,
  paused = false,
  loading = false,
  error,
  emptyText = "No signals",
  label = "Latest signals",
}: TickerStripProps) {
  const track = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(0);
  const reduced = useReducedMotion();
  const moving = !reduced && !paused && items.length > 0 && !loading && !error;

  useLayoutEffect(() => {
    const el = track.current;
    if (!el || !moving) return undefined;
    const measure = () => {
      const width = el.scrollWidth / 2;
      setDuration(width > 0 && speed > 0 ? width / speed : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items, speed, moving]);

  const renderItems = (hidden: boolean) =>
    items.map((it) => (
      <li key={`${hidden ? "b" : "a"}-${it.id}`} className="sds-ticker__item" aria-hidden={hidden || undefined}>
        {it.tag && <Badge tone={it.tone ?? "neutral"}>{it.tag}</Badge>}
        {it.onSelect ? (
          <button type="button" className="sds-ticker__link" onClick={it.onSelect} tabIndex={hidden ? -1 : undefined}>
            {it.text}
          </button>
        ) : (
          <span>{it.text}</span>
        )}
        {it.time && <span className="sds-ticker__time sds-num">{it.time}</span>}
      </li>
    ));

  let content;
  if (error) content = <span className="sds-ticker__message sds-ticker__message--error">{error}</span>;
  else if (loading) content = <span className="sds-ticker__message">Loading signals</span>;
  else if (items.length === 0) content = <span className="sds-ticker__message">{emptyText}</span>;
  else
    content = (
      <div
        ref={track}
        className={cx("sds-ticker__track", moving && duration > 0 && "sds-ticker__track--moving")}
        style={{ "--sds-ticker-duration": `${duration}s` } as CSSProperties}
      >
        <ul className="sds-ticker__list">{renderItems(false)}</ul>
        {moving && <ul className="sds-ticker__list">{renderItems(true)}</ul>}
      </div>
    );

  return (
    <section className={cx("sds-ticker", reduced && "sds-ticker--static")} aria-label={label} data-live="ticker">
      {counts.length > 0 && (
        <ul className="sds-ticker__counts" aria-label="Counts by tier">
          {counts.map((c) => (
            <li key={c.label} className="sds-ticker__count">
              <Badge tone={c.tone ?? "neutral"}>{c.label}</Badge>
              <span className="sds-num">{c.value}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="sds-ticker__viewport">{content}</div>
    </section>
  );
}
