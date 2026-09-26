import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../lib/utils";
import { Badge, type BadgeTone, type Status, StatusBadge } from "./Badge";
import { type Evidence, type EvidenceIds, ProvenanceControl } from "./Provenance";
import "./FeedItem.css";

export interface FeedItemProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  /** Publisher or source name. */
  source?: string;
  /** Already formatted time text. */
  time?: string;
  /** Machine time for the time element (ISO 8601). */
  dateTime?: string;
  tier?: { label: string; tone?: BadgeTone };
  status?: Status;
  summary?: ReactNode;
  /** Tags such as sector or geography. */
  tags?: string[];
  evidenceIds?: EvidenceIds;
  evidence?: Evidence[];
  selected?: boolean;
  /** The item arrived by a live update. It shows the change highlight once. */
  fresh?: boolean;
  actions?: ReactNode;
}

/** One item in a feed or a list, for example a signal or an alert. */
export const FeedItem = forwardRef<HTMLElement, FeedItemProps>(function FeedItem(
  { title, source, time, dateTime, tier, status, summary, tags, evidenceIds, evidence, selected = false, fresh = false, actions, className, ...rest },
  ref,
) {
  return (
    <article
      ref={ref}
      className={cx("sds-feed-item", selected && "sds-feed-item--selected", fresh && "sds-feed-item--fresh", className)}
      aria-current={selected || undefined}
      {...rest}
    >
      <div className="sds-feed-item__head">
        {tier && <Badge tone={tier.tone ?? "neutral"}>{tier.label}</Badge>}
        {status && <StatusBadge status={status} />}
        <span className="sds-feed-item__source">{source}</span>
        {time && (
          <time className="sds-feed-item__time sds-num" dateTime={dateTime} data-live="time">
            {time}
          </time>
        )}
      </div>
      <div className="sds-feed-item__title">
        {title}
        {evidenceIds && <ProvenanceControl evidenceIds={evidenceIds} evidence={evidence} />}
      </div>
      {summary && <p className="sds-feed-item__summary">{summary}</p>}
      {(tags?.length || actions) && (
        <div className="sds-feed-item__foot">
          {tags?.map((t) => (
            <span key={t} className="sds-feed-item__tag">
              {t}
            </span>
          ))}
          {actions && <div className="sds-feed-item__actions">{actions}</div>}
        </div>
      )}
    </article>
  );
});
