"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Crosshair } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { api, withTenant } from "@/lib/api";
import { attachMapBearing } from "@/lib/leafletBearing";
import {
  defaultPlanMapStyle,
  fitPlanContent,
  makePlanTiles,
  persistPlanMapStyle,
  type PlanMapStyle,
} from "@/lib/planMap";
import { useDash } from "@/components/DashboardProvider";
import type { OverlayLayer } from "@/lib/kml";

type Lot = {
  id: string;
  lotNumber: string;
  label: string;
  mapLat: string | null;
  mapLng: string | null;
  lotPolygon: string | null;
};

/** Plano de solo lectura para portería. Sin RTSP, sin herramientas de dibujo. */
export function OpsPlanMap() {
  const { tenantId } = useDash();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const tilesRef = useRef<import("leaflet").TileLayer | null>(null);
  const lotsRef = useRef<Lot[]>([]);
  const overlaysRef = useRef<OverlayLayer[]>([]);
  const savedViewRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [mapStyle, setMapStyle] = useState<PlanMapStyle>(defaultPlanMapStyle);
  const [mapReady, setMapReady] = useState(false);

  const recenter = useCallback(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    map.invalidateSize({ animate: false });
    if (!fitPlanContent(map, L, lotsRef.current, overlaysRef.current, { padding: 28, maxZoom: 18 })) {
      const saved = savedViewRef.current;
      if (saved) map.setView([saved.lat, saved.lng], saved.zoom);
    }
  }, []);

  useEffect(() => {
    let dead = false;
    let map: import("leaflet").Map | null = null;
    let ro: ResizeObserver | null = null;
    const timers: number[] = [];
    (async () => {
      if (!tenantId || !hostRef.current) return;
      const L = await import("leaflet");
      if (dead || !hostRef.current) return;
      LRef.current = L;
      const d = await api<{
        view: { mapLat: string; mapLng: string; mapZoom: number; mapBearing?: number; saved?: boolean };
        lots: Lot[];
        overlays?: OverlayLayer[];
      }>(withTenant("/api/plan", tenantId));
      if (dead) return;
      if (!hostRef.current) return;
      const view = d.view ?? { mapLat: "-34.6037", mapLng: "-58.3816", mapZoom: 16 };
      const lat = Number(view.mapLat);
      const lng = Number(view.mapLng);
      const zoomRaw = Number(view.mapZoom);
      const center: [number, number] = [
        Number.isFinite(lat) ? lat : -34.6037,
        Number.isFinite(lng) ? lng : -58.3816,
      ];
      const zoom = Number.isFinite(zoomRaw) && zoomRaw >= 12 ? zoomRaw : 16;
      savedViewRef.current = { lat: center[0], lng: center[1], zoom };
      lotsRef.current = d.lots ?? [];
      overlaysRef.current = d.overlays ?? [];
      map = L.map(hostRef.current, {
        zoomControl: false,
        attributionControl: false,
      });
      attachMapBearing(L, map, Number(d.view?.mapBearing) || 0);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      if (dead) {
        map.remove();
        map = null;
        return;
      }
      tilesRef.current = makePlanTiles(L, defaultPlanMapStyle()).addTo(map);
      const group = L.layerGroup().addTo(map);
      for (const layer of d.overlays ?? []) {
        if (layer.visible === false) continue;
        for (const feat of layer.features ?? []) {
          if (feat.kind === "polygon" && feat.geometry?.type === "Polygon") {
            const ring = (feat.geometry.coordinates?.[0] ?? []).map(
              (c) => [Number(c[1]), Number(c[0])] as [number, number],
            );
            if (ring.length < 3) continue;
            L.polygon(ring, {
              color: "#b45309",
              weight: 2,
              dashArray: "5 4",
              fillColor: "#f59e0b",
              fillOpacity: 0.12,
            })
              .bindTooltip(feat.name || layer.name, { sticky: true })
              .addTo(group);
          } else if (feat.kind === "line" && feat.geometry?.type === "LineString") {
            const line = (feat.geometry.coordinates ?? []).map(
              (c) => [Number(c[1]), Number(c[0])] as [number, number],
            );
            if (line.length < 2) continue;
            L.polyline(line, { color: "#b45309", weight: 2 })
              .bindTooltip(feat.name || layer.name, { sticky: true })
              .addTo(group);
          } else if (feat.kind === "point" && feat.geometry?.type === "Point") {
            const [olng, olat] = feat.geometry.coordinates as number[];
            if (!Number.isFinite(olat) || !Number.isFinite(olng)) continue;
            L.circleMarker([olat, olng], {
              radius: 5,
              color: "#b45309",
              fillColor: "#f59e0b",
              fillOpacity: 1,
              weight: 1,
            })
              .bindTooltip(feat.name || layer.name, { direction: "top" })
              .addTo(group);
          }
        }
      }
      for (const lot of d.lots ?? []) {
        const raw = lot.lotPolygon;
        if (!raw) continue;
        try {
          const g = JSON.parse(raw) as { coordinates?: number[][][] };
          const ring = (g.coordinates?.[0] ?? [])
            .map((pt) => [Number(pt[1]), Number(pt[0])] as [number, number])
            .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
          if (ring.length < 3) continue;
          L.polygon(ring, { color: "#0284c7", weight: 2, fillColor: "#38bdf8", fillOpacity: 0.28 })
            .bindTooltip(`Lote ${lot.lotNumber} · ${lot.label}`, { sticky: true })
            .addTo(group);
        } catch {
          /* polígono inválido */
        }
      }
      mapRef.current = map;
      setMapReady(true);
      let placed = false;
      const applyView = () => {
        if (dead || !map) return;
        try {
          map.invalidateSize();
          const size = map.getSize();
          if (!size.x || !size.y) return;
          if (placed) return;
          if (fitPlanContent(map, L, d.lots ?? [], d.overlays ?? [], { padding: 28, maxZoom: 18 })) {
            placed = true;
            return;
          }
          map.setView(center, zoom);
          placed = true;
        } catch {
          /* mapa ya destruido */
        }
      };
      applyView();
      requestAnimationFrame(applyView);
      timers.push(window.setTimeout(applyView, 200), window.setTimeout(applyView, 700));
      const host = hostRef.current;
      ro = typeof ResizeObserver !== "undefined" && host ? new ResizeObserver(applyView) : null;
      if (host && ro) ro.observe(host);
      if (dead) {
        ro?.disconnect();
        map?.remove();
        map = null;
        mapRef.current = null;
      }
    })().catch((err) => {
      if (!dead) setMsg(err instanceof Error ? err.message : "Sin plano");
    });
    return () => {
      dead = true;
      setMapReady(false);
      for (const id of timers) window.clearTimeout(id);
      ro?.disconnect();
      mapRef.current = null;
      map?.remove();
    };
  }, [tenantId]);

  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    tilesRef.current?.remove();
    tilesRef.current = makePlanTiles(L, mapStyle).addTo(map);
    tilesRef.current.bringToBack();
  }, [mapStyle, mapReady]);

  function changeStyle(next: PlanMapStyle) {
    setMapStyle(next);
    persistPlanMapStyle(next);
  }

  return (
    <section className="ops-predio-panel" aria-label="Plano del barrio">
      <header className="ops-lane-head">
        <span className="ops-lane-badge ops-lane-badge--map">Predio</span>
        <Link
          href="/dashboard/plano"
          className="font-mono text-[9px] font-bold text-blue-600 hover:text-blue-700 dark:text-[#38bdf8]"
        >
          ABRIR PLANO →
        </Link>
      </header>
      {msg ? <p className="px-2 pb-2 text-[11px] text-rose-600">{msg}</p> : null}
      <div className="ops-predio-map-wrap">
        <div className="ops-predio-map-tools" role="toolbar" aria-label="Capa y encuadre del plano">
          <button
            type="button"
            className={`ops-plan-tool ${mapStyle === "osm" ? "ops-plan-tool--on" : ""}`}
            onClick={() => changeStyle("osm")}
            title="OpenStreetMap"
          >
            OSM
          </button>
          <button
            type="button"
            className={`ops-plan-tool ${mapStyle === "satellite" ? "ops-plan-tool--on" : ""}`}
            onClick={() => changeStyle("satellite")}
            title="Google Maps satélite"
          >
            Satélite
          </button>
          <button
            type="button"
            className={`ops-plan-tool ${mapStyle === "hybrid" ? "ops-plan-tool--on" : ""}`}
            onClick={() => changeStyle("hybrid")}
            title="Google Maps híbrido"
          >
            Híbrido
          </button>
          <button type="button" className="ops-plan-tool" onClick={recenter} title="Centrar el predio">
            <Crosshair className="h-3.5 w-3.5" />
            Centrar
          </button>
        </div>
        <div ref={hostRef} className="ops-predio-map" />
      </div>
    </section>
  );
}
