"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import "leaflet/dist/leaflet.css";
import { api, withTenant } from "@/lib/api";
import { attachMapBearing } from "@/lib/leafletBearing";
import { defaultPlanMapBase, makePlanTiles } from "@/lib/planMap";
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

function ringFromGeo(raw: string | null): { lat: number; lng: number }[] {
  if (!raw) return [];
  try {
    const g = JSON.parse(raw) as { coordinates?: number[][][] };
    const ring = g.coordinates?.[0];
    if (!Array.isArray(ring)) return [];
    return ring
      .map((pt) => ({ lng: Number(pt[0]), lat: Number(pt[1]) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  } catch {
    return [];
  }
}

function centroid(points: { lat: number; lng: number }[]) {
  if (!points.length) return { lat: 0, lng: 0 };
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  };
}

function lotPoint(lot: Lot): { lat: number; lng: number } | null {
  if (lot.mapLat && lot.mapLng) {
    const lat = Number(lot.mapLat);
    const lng = Number(lot.mapLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const ring = ringFromGeo(lot.lotPolygon);
  if (ring.length >= 3) return centroid(ring);
  return null;
}

/** Plano de solo lectura para portería. Sin RTSP, sin herramientas de dibujo. */
export function OpsPlanMap() {
  const { tenantId } = useDash();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    let map: import("leaflet").Map | null = null;
    let ro: ResizeObserver | null = null;
    const timers: number[] = [];
    (async () => {
      if (!tenantId || !hostRef.current) return;
      const L = await import("leaflet");
      if (dead || !hostRef.current) return;
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
      makePlanTiles(L, defaultPlanMapBase()).addTo(map);
      const group = L.layerGroup().addTo(map);
      const pts: { lat: number; lng: number }[] = [];
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
            const [lng, lat] = feat.geometry.coordinates as number[];
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            L.circleMarker([lat, lng], {
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
        const ring = ringFromGeo(lot.lotPolygon);
        if (ring.length >= 3) {
          L.polygon(
            ring.map((p) => [p.lat, p.lng] as [number, number]),
            { color: "#0284c7", weight: 2, fillColor: "#38bdf8", fillOpacity: 0.28 },
          )
            .bindTooltip(`Lote ${lot.lotNumber} · ${lot.label}`, { sticky: true })
            .addTo(group);
        }
        const pt = lotPoint(lot);
        if (pt) pts.push(pt);
      }
      const lotPts = pts.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      let placed = false;
      const applyView = () => {
        if (dead || !map) return;
        try {
          map.invalidateSize();
          const size = map.getSize();
          if (!size.x || !size.y) return;
          if (placed) return;
          if (d.view?.saved) {
            map.setView(center, zoom);
            placed = true;
            return;
          }
          if (lotPts.length > 1) {
            const bounds = L.latLngBounds(lotPts.map((p) => [p.lat, p.lng] as [number, number]));
            const span = bounds.getNorthEast().distanceTo(bounds.getSouthWest());
            if (Number.isFinite(span) && span > 0 && span < 8000) {
              map.fitBounds(bounds, { padding: [24, 24], maxZoom: 18 });
              placed = true;
              return;
            }
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
      }
    })().catch((err) => {
      if (!dead) setMsg(err instanceof Error ? err.message : "Sin plano");
    });
    return () => {
      dead = true;
      for (const id of timers) window.clearTimeout(id);
      ro?.disconnect();
      map?.remove();
    };
  }, [tenantId]);

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
      <div ref={hostRef} className="ops-predio-map" />
    </section>
  );
}
