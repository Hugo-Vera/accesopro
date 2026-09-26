"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Crosshair } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { api, withTenant } from "@/lib/api";
import { loadLeaflet, SMOOTH_ZOOM_OPTIONS } from "@/lib/leafletLoader";
import {
  defaultPlanMapStyle,
  fitPlanContent,
  lotHouseLatLng,
  lotLabelLatLng,
  lotPolygonRing,
  makePlanTiles,
  persistPlanMapStyle,
  PLAN_HOUSE_HTML,
  planLotLabelHtml,
  validPoint,
  type PlanMapStyle,
} from "@/lib/planMap";
import { useDash } from "@/components/DashboardProvider";
import type { OverlayLayer } from "@/lib/kml";

type AuthPin = {
  id: string;
  passId?: string;
  guestName: string;
  lot: string;
  status: string;
  mapLat?: string | null;
  mapLng?: string | null;
  lotPolygon?: string | null;
};

function pinLatLng(p: AuthPin): [number, number] | null {
  const lat = Number(p.mapLat);
  const lng = Number(p.mapLng);
  if (validPoint(lat, lng)) return [lat, lng];
  if (!p.lotPolygon) return null;
  try {
    const g = JSON.parse(p.lotPolygon) as { coordinates?: number[][][] };
    const ring = g.coordinates?.[0] ?? [];
    if (ring.length < 3) return null;
    let slat = 0;
    let slng = 0;
    let n = 0;
    for (const pt of ring) {
      const x = Number(pt[0]);
      const y = Number(pt[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      slng += x;
      slat += y;
      n++;
    }
    if (!n) return null;
    return [slat / n, slng / n];
  } catch {
    return null;
  }
}

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
  const tilesRef = useRef<import("leaflet").Layer | null>(null);
  const lotsRef = useRef<Lot[]>([]);
  const overlaysRef = useRef<OverlayLayer[]>([]);
  const pinsLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
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
      const L = await loadLeaflet();
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
        rotate: true,
        bearing: Number(d.view?.mapBearing) || 0,
        rotateControl: false,
        touchRotate: false,
        shiftKeyRotate: false,
        ...SMOOTH_ZOOM_OPTIONS,
      });
      L.control.zoom({ position: "bottomright" }).addTo(map);
      if (dead) {
        map.remove();
        map = null;
        return;
      }
      tilesRef.current = makePlanTiles(L, defaultPlanMapStyle()).addTo(map);
      if (!map.getPane("lotLabels")) {
        const pane = map.createPane("lotLabels");
        pane.style.zIndex = "650";
      }
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
        const ring = lotPolygonRing(lot.lotPolygon);
        const announce = () => {
          window.dispatchEvent(
            new CustomEvent("ap:announce-lot", { detail: { propertyId: lot.id, lotNumber: lot.lotNumber } }),
          );
        };
        if (ring.length >= 3) {
          L.polygon(
            ring.map((p) => [p.lat, p.lng] as [number, number]),
            { color: "#0284c7", weight: 2, fillColor: "#38bdf8", fillOpacity: 0.28 },
          )
            .bindTooltip(`Lote ${lot.lotNumber} · ${lot.label}`, { sticky: true })
            .on("click", announce)
            .addTo(group);
        }
        const houseAt = lotHouseLatLng(lot);
        if (houseAt) {
          L.marker(houseAt, {
            icon: L.divIcon({
              className: "ops-plan-house-icon",
              html: PLAN_HOUSE_HTML,
              iconSize: [16, 16],
              iconAnchor: [8, 14],
            }),
          })
            .bindTooltip(`Lote ${lot.lotNumber} · ${lot.label}`, { direction: "top" })
            .on("click", announce)
            .addTo(group);
        }
        const labelAt = lotLabelLatLng(lot);
        if (labelAt) {
          L.marker(labelAt, {
            icon: L.divIcon({
              className: "ops-plan-lot-label",
              html: planLotLabelHtml(lot.lotNumber),
              iconSize: [28, 18],
              iconAnchor: [14, 9],
            }),
            pane: "lotLabels",
            zIndexOffset: 2000,
            interactive: false,
            keyboard: false,
          }).addTo(group);
        }
      }
      mapRef.current = map;
      setMapReady(true);
      const viewSaved = Boolean(d.view?.saved);
      let placed = false;
      const applyView = () => {
        if (dead || !map) return;
        try {
          map.invalidateSize();
          const size = map.getSize();
          if (!size.x || !size.y) return;
          if (placed) return;
          if (viewSaved) {
            map.setView(center, zoom);
            placed = true;
            return;
          }
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
  }, [mapStyle, mapReady]);

  useEffect(() => {
    if (!mapReady || !tenantId) return;
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    if (!pinsLayerRef.current) pinsLayerRef.current = L.layerGroup().addTo(map);
    const layer = pinsLayerRef.current;
    let dead = false;
    const draw = async () => {
      try {
        const d = await api<{ passes: AuthPin[] }>(withTenant("/api/visitors/owner-passes", tenantId));
        if (dead) return;
        layer.clearLayers();
        for (const p of d.passes || []) {
          if (p.status === "completed" || p.status === "revoked" || p.status === "denied" || p.status === "expired") continue;
          const ll = pinLatLng(p);
          if (!ll) continue;
          const icon = L.divIcon({
            className: "ops-auth-bell",
            html: `<div style="transform:translate(-50%,-110%);display:flex;flex-direction:column;align-items:center;pointer-events:auto">
              <div style="background:#f59e0b;color:#111;border-radius:999px;padding:4px 6px;font:700 11px/1 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35)">!</div>
              <div style="margin-top:2px;background:#0f172a;color:#fff;border-radius:6px;padding:2px 6px;font:700 10px/1.2 sans-serif;white-space:nowrap">${p.guestName}</div>
            </div>`,
            iconSize: [1, 1],
            iconAnchor: [0, 0],
          });
          const marker = L.marker(ll, { icon, zIndexOffset: 800 })
            .bindTooltip(`${p.lot} · ${p.guestName}`, { direction: "top" })
            .addTo(layer);
          marker.on("click", () => {
            const passId = p.passId || (p.id.startsWith("pass:") ? p.id.slice(5) : p.id);
            window.dispatchEvent(new CustomEvent("ap:open-visit-approval", { detail: { passId } }));
          });
        }
      } catch {
        /* poll silencioso */
      }
    };
    void draw();
    const id = window.setInterval(() => void draw(), 8000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [mapReady, tenantId]);

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
