// Geographic deal map: Zambia and its neighbours, with the sites, the opportunities at the sites and the recent
// signals (GET /api/map). Filters by site class, stage and sector. A click opens the site drawer. Live.
// The base layer is the country outlines of world-atlas (Natural Earth, public domain), converted with
// topojson-client. The map loads no tiles. The API gives no corridor geometry, so the map shows no corridor lines.
import { type MapMarker, type MapMarkerTone, MapView, Select, type SelectOption } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import type { FeatureCollection } from "geojson";
import { useEffect, useMemo, useState } from "react";
import type { MapDeal, MapResponse, MapSite } from "../api/types";
import { appConfig } from "../config/app.config";
import { moduleConfig } from "../config/modules";
import { useResource } from "../data/resource";
import { useApi, useStages, useTaxonomy } from "./common/api";
import { useDetailDrawer } from "./common/drawers";
import { humanise } from "./common/format";
import { ModuleRoot, resourceState } from "./common/ui";

const cfg = moduleConfig["deal-map"];

let boundaryCache: Promise<FeatureCollection> | null = null;

/** The country outlines of the configured countries. Loaded once, only when a map shows. */
export function loadBoundaries(): Promise<FeatureCollection> {
  boundaryCache ??= Promise.all([import("world-atlas/countries-50m.json"), import("topojson-client")]).then(([atlas, topo]) => {
    const topology = (atlas as unknown as { default: TopoJSON.Topology }).default ?? (atlas as unknown as TopoJSON.Topology);
    const countries = topology.objects.countries as TopoJSON.GeometryCollection;
    const wanted = new Set<string>(cfg.countries);
    const subset: TopoJSON.GeometryCollection = { ...countries, geometries: countries.geometries.filter((g) => wanted.has(String(g.id))) };
    return topo.feature(topology, subset) as unknown as FeatureCollection;
  });
  return boundaryCache;
}

function markerTone(site: MapSite, deals: MapDeal[]): MapMarkerTone {
  if (site.status_pending || deals.some((d) => d.stage_pending)) return "warning";
  if (site.status === "suspended" || site.status === "closed" || site.status === "care_and_maintenance") return "negative";
  if (deals.length > 0) return "accent";
  return "neutral";
}

export function DealMapModule(_: PanelProps) {
  const { reads } = useApi();
  const tax = useTaxonomy();
  const stages = useStages();
  const { openSite } = useDetailDrawer();
  const [siteClass, setSiteClass] = useState("");
  const [stage, setStage] = useState("");
  const [sector, setSector] = useState("");
  const [boundaries, setBoundaries] = useState<FeatureCollection | undefined>(undefined);
  const [boundaryError, setBoundaryError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    loadBoundaries()
      .then((b) => live && setBoundaries(b))
      .catch((e: unknown) => live && setBoundaryError(e instanceof Error ? e.message : "The country outlines did not load."));
    return () => {
      live = false;
    };
  }, []);

  const key = `map:${siteClass}|${stage}|${sector}`;
  const r = useResource<MapResponse>(
    key,
    () => reads.map({ site_class: siteClass ? [siteClass] : undefined, stage: stage ? [stage] : undefined, sector: sector ? [sector] : undefined }),
    { live: cfg.live.events, batchMs: cfg.live.batchMs },
  );

  const dealsBySite = useMemo(() => {
    const m = new Map<string, MapDeal[]>();
    for (const d of r.data?.deals ?? []) m.set(d.site_id, [...(m.get(d.site_id) ?? []), d]);
    return m;
  }, [r.data]);

  const sitesWithProjects = useMemo(() => new Set((r.data?.projects ?? []).map((p) => p.site_id)), [r.data]);

  const markers: MapMarker[] = useMemo(() => {
    const sites = (r.data?.sites ?? []).filter((s) => (!stage || dealsBySite.has(s.id)) && (!sector || sitesWithProjects.has(s.id)));
    return sites.map((s) => {
      const deals = dealsBySite.get(s.id) ?? [];
      const parts = [s.name, `${deals.length} ${deals.length === 1 ? "opportunity" : "opportunities"}`, `${s.signals_90d} signals in 90 days`];
      if (s.status_pending) parts.push(`status ${humanise(s.status_pending)} pending`);
      if (s.geometry_approximate) parts.push("approximate location");
      return { id: s.id, lng: s.lon, lat: s.lat, label: parts.join(", "), tone: markerTone(s, deals) };
    });
  }, [r.data, dealsBySite, sitesWithProjects, stage, sector]);

  const opt = (list: { code: string; name: string }[] | undefined, all: string): SelectOption[] => [{ value: "", label: all }, ...(list ?? []).map((x) => ({ value: x.code, label: x.name }))];
  const s = resourceState(r, { label: "map" });

  return (
    <ModuleRoot id="deal-map" state={s.state}>
      <div className="strata-module__toolbar" role="search" aria-label="Map filters">
        <Select label="Site class" hideLabel value={siteClass} onChange={(e) => setSiteClass(e.target.value)} options={opt(tax.data?.site_classes, "All site classes")} />
        <Select label="Stage" hideLabel value={stage} onChange={(e) => setStage(e.target.value)} options={opt(stages.data?.deal_stages, "All stages")} />
        <Select label="Sector" hideLabel value={sector} onChange={(e) => setSector(e.target.value)} options={opt(tax.data?.sectors, "All sectors")} />
        <span className="strata-muted strata-num" data-marker-count={markers.length}>{`${markers.length} sites`}</span>
      </div>
      <div className="strata-module__fill">
        {s.node ?? (
          <MapView
            label="Map of sites and opportunities"
            styleUrl={appConfig.map.styleUrl || undefined}
            center={cfg.center}
            zoom={cfg.zoom}
            bounds={cfg.bounds}
            boundaries={boundaries}
            highlightId={cfg.focusCountry}
            loading={!boundaries && !boundaryError && !appConfig.map.styleUrl}
            markers={markers}
            onMarkerSelect={(id) => openSite(id, dealsBySite.get(id))}
          />
        )}
      </div>
    </ModuleRoot>
  );
}
