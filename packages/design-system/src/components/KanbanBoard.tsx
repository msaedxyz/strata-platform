import { type DragEvent, type KeyboardEvent, type ReactNode, useState } from "react";
import { cx } from "../lib/utils";
import { type Status, StatusBadge } from "./Badge";
import { EmptyState, ErrorState, LoadingState } from "./States";
import "./KanbanBoard.css";

export interface KanbanColumn {
  id: string;
  title: string;
  /** A terminal column, for example Won or Lost. */
  terminal?: boolean;
}

export interface KanbanCard {
  id: string;
  columnId: string;
  title: string;
  subtitle?: string;
  /** For example "pending_approval" after a move that waits for an approver (docs/07 rule 3). */
  status?: Status;
  meta?: ReactNode;
}

export interface KanbanBoardProps {
  columns: KanbanColumn[];
  cards: KanbanCard[];
  /** Called when a card moves to another column. The app creates a proposal; it does not move the card itself. */
  onMove?: (cardId: string, toColumnId: string) => void;
  /** False hides the move controls, for example for the Viewer role. */
  canMove?: boolean;
  onCardSelect?: (cardId: string) => void;
  label: string;
  loading?: boolean;
  error?: string;
  className?: string;
}

/**
 * Columns and cards with drag and drop. Keyboard: Space or Enter picks a card up, the left and right
 * arrow keys choose the column, Space or Enter drops it, Esc cancels.
 */
export function KanbanBoard({ columns, cards, onMove, canMove = true, onCardSelect, label, loading, error, className }: KanbanBoardProps) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [grabbed, setGrabbed] = useState<{ cardId: string; target: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  if (error) return <ErrorState description={error} />;
  if (loading) return <LoadingState rows={5} label={`Loading ${label}`} />;
  if (columns.length === 0) return <EmptyState title="No stages" />;

  const movable = canMove && !!onMove;
  const indexOf = (id: string) => columns.findIndex((c) => c.id === id);

  const drop = (cardId: string, columnId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.columnId === columnId) return;
    onMove?.(cardId, columnId);
    const col = columns.find((c) => c.id === columnId);
    setAnnouncement(`${card.title} moved to ${col?.title ?? columnId}. Pending approval.`);
  };

  const onCardKey = (e: KeyboardEvent<HTMLElement>, card: KanbanCard) => {
    if (!movable) {
      if ((e.key === "Enter" || e.key === " ") && onCardSelect) {
        e.preventDefault();
        onCardSelect(card.id);
      }
      return;
    }
    if (!grabbed) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setGrabbed({ cardId: card.id, target: indexOf(card.columnId) });
        setAnnouncement(`${card.title} picked up. Use the left and right arrow keys to choose a stage, then press Space.`);
      }
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const target = Math.max(0, Math.min(columns.length - 1, grabbed.target + delta));
      setGrabbed({ ...grabbed, target });
      setAnnouncement(`Stage ${columns[target]!.title}`);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      drop(grabbed.cardId, columns[grabbed.target]!.id);
      setGrabbed(null);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setGrabbed(null);
      setAnnouncement("Move cancelled.");
    }
  };

  return (
    <div className={cx("sds-kanban", className)} role="group" aria-label={label}>
      {columns.map((col, ci) => {
        const colCards = cards.filter((c) => c.columnId === col.id);
        const targeted = over === col.id || (grabbed !== null && grabbed.target === ci);
        return (
          <section
            key={col.id}
            className={cx("sds-kanban__column", targeted && "sds-kanban__column--target", col.terminal && "sds-kanban__column--terminal")}
            aria-label={`${col.title}, ${colCards.length} ${colCards.length === 1 ? "card" : "cards"}`}
            data-column-id={col.id}
            onDragOver={(e: DragEvent) => {
              if (!movable || !dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(col.id);
            }}
            onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain") || dragging;
              if (id) drop(id, col.id);
              setDragging(null);
              setOver(null);
            }}
          >
            <header className="sds-kanban__header">
              <h3 className="sds-kanban__title">{col.title}</h3>
              <span className="sds-kanban__count sds-num">{colCards.length}</span>
            </header>
            <ul className="sds-kanban__cards">
              {colCards.map((card) => (
                <li key={card.id}>
                  <article
                    className={cx(
                      "sds-kanban__card",
                      dragging === card.id && "sds-kanban__card--dragging",
                      grabbed?.cardId === card.id && "sds-kanban__card--grabbed",
                    )}
                    tabIndex={0}
                    draggable={movable}
                    aria-roledescription={movable ? "draggable card" : undefined}
                    aria-label={`${card.title}${card.status ? `, ${card.status.replace("_", " ")}` : ""}`}
                    data-card-id={card.id}
                    onDragStart={(e: DragEvent) => {
                      e.dataTransfer.setData("text/plain", card.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragging(card.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    onKeyDown={(e) => onCardKey(e, card)}
                    onClick={() => onCardSelect?.(card.id)}
                    onBlur={() => grabbed?.cardId === card.id && setGrabbed(null)}
                  >
                    <p className="sds-kanban__card-title">{card.title}</p>
                    {card.subtitle && <p className="sds-kanban__card-subtitle">{card.subtitle}</p>}
                    {(card.status || card.meta) && (
                      <div className="sds-kanban__card-meta">
                        {card.status && <StatusBadge status={card.status} />}
                        {card.meta}
                      </div>
                    )}
                  </article>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <span className="sds-visually-hidden" aria-live="assertive">
        {announcement}
      </span>
    </div>
  );
}
