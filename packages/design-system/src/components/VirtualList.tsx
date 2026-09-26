import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useEffect, useRef } from "react";
import { cx } from "../lib/utils";
import { EmptyState, ErrorState, LoadingState } from "./States";
import "./VirtualList.css";

export interface VirtualListProps<T> {
  items: readonly T[];
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** The accessible name of the list. */
  label: string;
  /** First estimate of an item height in pixels. The list measures each item after it renders. Behaviour, not a visual value. */
  estimateSize?: number;
  /** Items to render above and below the view. */
  overscan?: number;
  /** Called when the view comes near the end of the items, for example to load the next page. */
  onEndReached?: () => void;
  /** How many items before the end onEndReached fires. */
  endThreshold?: number;
  loading?: boolean;
  /** The next page is loading. The items stay on screen. */
  loadingMore?: boolean;
  error?: string;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  className?: string;
}

/**
 * A scrolling list that renders only the items in view. Use it for long feeds, for example 10 000 signals.
 * Each item keeps its own component (for example FeedItem). The list adds no visual style of its own.
 */
export function VirtualList<T>({
  items,
  getKey,
  renderItem,
  label,
  estimateSize = 64,
  overscan = 8,
  onEndReached,
  endThreshold = 10,
  loading = false,
  loadingMore = false,
  error,
  onRetry,
  emptyTitle = "No items",
  emptyDescription,
  className,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endFor = useRef(-1);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
    getItemKey: (i) => getKey(items[i]!, i),
  });
  const virtualItems = virtualizer.getVirtualItems();
  const last = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1]!.index : -1;

  useEffect(() => {
    if (!onEndReached || items.length === 0 || last < items.length - 1 - endThreshold) return;
    // Fire once for each length of the list, so that one page loads at a time.
    if (endFor.current === items.length) return;
    endFor.current = items.length;
    onEndReached();
  }, [last, items.length, endThreshold, onEndReached]);

  if (error) return <ErrorState description={error} onRetry={onRetry} className={className} />;
  if (loading) return <LoadingState rows={6} label={`Loading ${label}`} className={className} />;
  if (items.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} className={className} />;

  return (
    <div ref={scrollRef} className={cx("sds-virtual-list", className)} role="region" aria-label={label} aria-busy={loadingMore || undefined} tabIndex={0}>
      <ul className="sds-virtual-list__inner" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((v) => (
          <li
            key={v.key}
            ref={virtualizer.measureElement}
            data-index={v.index}
            className="sds-virtual-list__item"
            style={{ transform: `translateY(${v.start}px)` }}
          >
            {renderItem(items[v.index]!, v.index)}
          </li>
        ))}
      </ul>
      {loadingMore && <LoadingState label="Loading more" />}
    </div>
  );
}
