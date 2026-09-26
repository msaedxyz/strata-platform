import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker, StyleSpecification } from "maplibre-gl";
import { cx } from "../lib/utils";
import { ErrorState, LoadingState } from "./States";
import "./MapView.css";

export type MapMarkerTone = "neutral" | "positive" | "negative" | "accent" | "warning";

export interface MapMarker {
  id: string;
  lng: number;
  lat: number;
  label: string;
  tone?: MapMarkerTone;
}

export interface MapViewProps {
  /** The style URL from configuration. Without it, the map uses an empty style and loads no tiles. */
  styleUrl?: string;
  /** Longitude and latitude. */
  center: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  onMarkerSelect?: (id: string) => void;
  selectedMarkerId?: string;
  label: string;
  loading?: boolean;
  error?: string;
  className?: string;
}

/** An empty style: no sources and no layers. The map works with no network access. */
export const EMPTY_MAP_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [] };

type Status = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

/** A MapLibre GL map. MapLibre loads on demand, so the map code is not in the main bundle. */
export function MapView({
  styleUrl,
  center,
  zoom = 5,
  markers = [],
  onMarkerSelect,
  selectedMarkerId,
  label,
  loading = false,
  error,
  className,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const markerRefs = useRef<MapLibreMarker[]>([]);
  const onSelect = useRef(onMarkerSelect);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [centerLng, centerLat] = center;

  useEffect(() => {
    onSelect.current = onMarkerSelect;
  }, [onMarkerSelect]);

  useEffect(() => {
    const el = container.current;
    if (!el || loading || error) return undefined;
    let cancelled = false;
    setStatus({ kind: "loading" });
    Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")])
      .then(([mod]) => {
        if (cancelled) return;
        lib.current = mod;
        const instance = new mod.Map({
          container: el,
          style: styleUrl ?? EMPTY_MAP_STYLE,
          center: [centerLng, centerLat],
          zoom,
          attributionControl: { compact: true },
        });
        map.current = instance;
        instance.on("load", () => !cancelled && setStatus({ kind: "ready" }));
        instance.on("error", (e) => {
          if (!cancelled && e.error && !instance.loaded()) setStatus({ kind: "error", message: String(e.error.message) });
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setStatus({ kind: "error", message: err instanceof Error ? err.message : "The map cannot start." });
      });
    return () => {
      cancelled = true;
      markerRefs.current.forEach((m) => m.remove());
      markerRefs.current = [];
      map.current?.remove();
      map.current = null;
    };
    // The center and zoom are start values. Later changes do not rebuild the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl, loading, error]);

  useEffect(() => {
    const m = map.current;
    const mod = lib.current;
    if (!m || !mod || status.kind !== "ready") return;
    markerRefs.current.forEach((mk) => mk.remove());
    markerRefs.current = markers.map((mk) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = cx("sds-map-marker", `sds-map-marker--${mk.tone ?? "accent"}`, mk.id === selectedMarkerId && "sds-map-marker--selected");
      button.setAttribute("aria-label", mk.label);
      button.title = mk.label;
      button.dataset.markerId = mk.id;
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelect.current?.(mk.id);
      });
      return new mod.Marker({ element: button }).setLngLat([mk.lng, mk.lat]).addTo(m);
    });
  }, [markers, selectedMarkerId, status.kind]);

  if (error) return <ErrorState description={error} className={cx("sds-map", className)} />;
  return (
    <div className={cx("sds-map", className)} role="region" aria-label={label} aria-busy={loading || status.kind === "loading"}>
      <div ref={container} className="sds-map__canvas" />
      {(loading || status.kind === "loading") && (
        <div className="sds-map__status">
          <LoadingState label="Loading map" />
        </div>
      )}
      {status.kind === "error" && (
        <div className="sds-map__status">
          <ErrorState title="The map cannot start" description={status.message} />
        </div>
      )}
    </div>
  );
}
