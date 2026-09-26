// The API for the modules: the JSON client with the session token, the typed reads and the shared configuration reads.
import { type Evidence, EvidenceProvider, type EvidenceIds } from "@strata/design-system";
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { createHttp, type Http } from "../../api/http";
import { createReads, type Reads } from "../../api/reads";
import type { EvidenceItem, StagesConfig, Taxonomy } from "../../api/types";
import { useSession } from "../../auth/AuthContext";
import { appConfig } from "../../config/app.config";
import { useResource } from "../../data/resource";
import { formatDate } from "./format";

interface ApiValue {
  http: Http;
  reads: Reads;
}

const ApiContext = createContext<ApiValue | null>(null);

/** Text around the span for the evidence drawer. The API gives the context only for a source with licence full. */
const CONTEXT_CHARS = 240;

export function toEvidence(item: EvidenceItem): Evidence {
  let before: string | undefined;
  let after: string | undefined;
  if (item.context) {
    const at = item.context.indexOf(item.quote);
    if (at >= 0) {
      before = item.context.slice(Math.max(0, at - CONTEXT_CHARS), at) || undefined;
      after = item.context.slice(at + item.quote.length, at + item.quote.length + CONTEXT_CHARS) || undefined;
    }
  }
  return {
    id: item.id,
    quote: item.quote,
    before,
    after,
    sourceUrl: item.url,
    sourceTitle: item.title ?? undefined,
    publisher: item.publisher ?? undefined,
    publishedAt: item.published_at ? formatDate(item.published_at) : undefined,
  };
}

export function ApiProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const value = useMemo(() => {
    const http = createHttp(session.getToken, appConfig.api.baseUrl);
    return { http, reads: createReads(http) };
  }, [session.getToken]);
  const loader = useCallback(async (ids: readonly string[]) => (await value.reads.evidence(ids)).items.map(toEvidence), [value]);
  return (
    <ApiContext.Provider value={value}>
      <EvidenceProvider loader={loader}>{children}</EvidenceProvider>
    </ApiContext.Provider>
  );
}

export function useApi(): ApiValue {
  const v = useContext(ApiContext);
  if (!v) throw new Error("useApi needs an ApiProvider");
  return v;
}

/** Deal stages, lifecycle stages and the engagement window (config/stages.yaml, config/lifecycle.yaml). */
export function useStages() {
  const { reads } = useApi();
  return useResource<StagesConfig>("config/stages", reads.stages);
}

/** Codes and names for the filters (config/taxonomy). */
export function useTaxonomy() {
  const { reads } = useApi();
  return useResource<Taxonomy>("config/taxonomy", reads.taxonomy);
}

/** A list of evidence ids as the non-empty type that Fact needs, or null for an empty list. */
export function evidenceIds(ids: readonly string[] | null | undefined): EvidenceIds | null {
  return ids && ids.length > 0 ? (ids as unknown as EvidenceIds) : null;
}
