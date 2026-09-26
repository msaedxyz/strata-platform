// Kanban stage board: one column for each deal stage in config/stages.yaml (GET /api/config/stages), cards from
// GET /api/deals. A move calls POST /api/deals/{id}/stage. It creates a DealStageChanged proposal, and the card shows
// "Pending approval" until an approver decides (docs/07 rule 3). Live.
import { Badge, type KanbanCard, type KanbanColumn, KanbanBoard } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useCallback, useMemo, useState } from "react";
import type { Deal } from "../api/types";
import { moveDealStage } from "../api/writes";
import { useCan } from "../auth/RequireRole";
import { moduleConfig, sharedResources } from "../config/modules";
import { useResource } from "../data/resource";
import { useAction } from "./common/actions";
import { useApi, useStages, useTaxonomy } from "./common/api";
import { nameOf } from "./common/format";
import { useSelection } from "./common/selection";
import { ModuleRoot, resourceState } from "./common/ui";

const cfg = moduleConfig.kanban;

/** GET /api/deals. The Kanban board, the next actions, the relationship panel and the timeline share it. */
export function useDeals() {
  const { reads } = useApi();
  return useResource<{ items: Deal[] }>("deals", reads.deals, { live: sharedResources.deals.live.events, batchMs: sharedResources.deals.live.batchMs });
}

export function KanbanModule(_: PanelProps) {
  const { http } = useApi();
  const stages = useStages();
  const tax = useTaxonomy();
  const deals = useDeals();
  const canMove = useCan("analyst");
  const { run } = useAction();
  const { select, deal: selected } = useSelection();
  /** Moves sent in this session that the API has not shown as pending yet. */
  const [sent, setSent] = useState<Record<string, string>>({});

  const stageName = useCallback((c: string) => nameOf(stages.data?.deal_stages, c), [stages.data]);
  const columns: KanbanColumn[] = useMemo(
    () => [...(stages.data?.deal_stages ?? [])].sort((a, b) => a.order - b.order).map((s) => ({ id: s.code, title: s.name, terminal: s.terminal })),
    [stages.data],
  );
  const byId = useMemo(() => new Map((deals.data?.items ?? []).map((d) => [d.id, d])), [deals.data]);
  const cards: KanbanCard[] = useMemo(
    () =>
      (deals.data?.items ?? []).map((d) => {
        const pending = d.stage_pending ?? sent[d.id] ?? null;
        return {
          id: d.id,
          columnId: d.stage,
          title: d.title,
          subtitle: [d.site_name, d.organisation_name].filter(Boolean).join(" · ") || undefined,
          status: pending ? "pending_approval" : undefined,
          meta: (
            <>
              {d.deal_type && <Badge>{nameOf(tax.data?.deal_types, d.deal_type)}</Badge>}
              {pending && <span className="strata-muted">{`to ${stageName(pending)}`}</span>}
            </>
          ),
        };
      }),
    [deals.data, sent, tax.data, stageName],
  );

  const onMove = async (cardId: string, to: string) => {
    const d = byId.get(cardId);
    if (!d) return;
    setSent((m) => ({ ...m, [cardId]: to }));
    const ok = await run("move", () => moveDealStage(http, cardId, to), { description: `${d.title}: ${stageName(d.stage)} to ${stageName(to)}` });
    if (!ok) {
      setSent((m) => {
        const next = { ...m };
        delete next[cardId];
        return next;
      });
      return;
    }
    await deals.reload();
    // After the reload the API gives stage_pending. The local mark is no longer needed.
    setSent((m) => {
      const next = { ...m };
      delete next[cardId];
      return next;
    });
  };

  const s = resourceState(
    { loading: deals.loading || stages.loading, error: deals.error ?? stages.error, reload: deals.reload },
    { label: "opportunities", empty: false },
  );
  return (
    <ModuleRoot id="kanban" state={s.state}>
      {s.node ?? (
        <KanbanBoard
          label="Opportunities by stage"
          columns={columns}
          cards={cards}
          canMove={canMove}
          onMove={(id, to) => void onMove(id, to)}
          onCardSelect={(id) => {
            const d = byId.get(id);
            if (d) select({ kind: "deal", id: d.id, label: d.title });
          }}
        />
      )}
      {selected && <span className="sds-visually-hidden" aria-live="polite">{`Selected: ${selected.label}`}</span>}
    </ModuleRoot>
  );
}
