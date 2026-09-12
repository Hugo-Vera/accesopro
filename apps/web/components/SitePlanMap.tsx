"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileUp, Hand, Home, Layers, Pentagon, Search, Trash2, Undo2, X } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { api, withTenant } from "@/lib/api";
import {
  lotNumberFromName,
  overlayBounds,
  overlayStats,
  readKmlFile,
  type OverlayLayer,
} from "@/lib/kml";
import { defaultPlanMapBase, makePlanTiles, type PlanMapBase } from "@/lib/planMap";
import { useDash } from "@/components/DashboardProvider";
import { useEscapeKey } from "@/hooks/useEscapeKey";

type Lot = {
  id: string;
  lotNumber: string;
  label: string;
  address: string | null;
  mapLat: string | null;
  mapLng: string | null;
  lotPolygon: string | null;
};

type Tool = "move" | "lot" | "house";

type Modal =
  | { kind: "lot"; points: { lat: number; lng: number }[]; lot?: Lot }
  | { kind: "house"; lat: number; lng: number; lot?: Lot }
  | { kind: "edit"; lot: Lot };

type SearchHit = { label: string; lat: string; lng: string };

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

function toGeoJson(points: { lat: number; lng: number }[]) {
  const ring = points.map((p) => [p.lng, p.lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first);
  return { type: "Polygon", coordinates: [ring] };
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

function flyToLots(
  map: import("leaflet").Map,
  L: typeof import("leaflet"),
  list: Lot[],
  focusKey: string,
) {
  const focused = focusKey
    ? list.find((l) => l.id === focusKey || l.lotNumber.toLowerCase() === focusKey.toLowerCase())
    : null;
  const single = focused ? lotPoint(focused) : null;
  if (single) {
    map.setView([single.lat, single.lng], 18);
    return;
  }
  const pts = list.map(lotPoint).filter((p): p is { lat: number; lng: number } => Boolean(p));
  if (pts.length === 1) {
    map.setView([pts[0].lat, pts[0].lng], 18);
    return;
  }
  if (pts.length > 1) {
    map.fitBounds(
      L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])),
      { padding: [48, 48], maxZoom: 18 },
    );
  }
}

const DETAIL_MIN_ZOOM = 16;

const HOUSE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

export function SitePlanMap() {
  const { tenantId, can } = useDash();
  const searchParams = useSearchParams();
  const focusKey = (searchParams.get("lote") || searchParams.get("id") || "").trim();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layersRef = useRef<import("leaflet").LayerGroup | null>(null);
  const draftRef = useRef<import("leaflet").LayerGroup | null>(null);
  const overlaysRef = useRef<import("leaflet").LayerGroup | null>(null);
  const tilesRef = useRef<import("leaflet").TileLayer | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);

  const [lots, setLots] = useState<Lot[]>([]);
  const [overlays, setOverlays] = useState<OverlayLayer[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [tool, setTool] = useState<Tool>("move");
  const [draft, setDraft] = useState<{ lat: number; lng: number }[]>([]);
  const [modal, setModal] = useState<Modal | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showLotDetail, setShowLotDetail] = useState(true);
  const [mapBase, setMapBase] = useState<PlanMapBase>(defaultPlanMapBase);
  const [kmlOpen, setKmlOpen] = useState(false);
  const [kmlPreview, setKmlPreview] = useState<OverlayLayer[] | null>(null);
  const [kmlSaveLayers, setKmlSaveLayers] = useState(true);
  const [kmlCreateLots, setKmlCreateLots] = useState(false);
  const [kmlHouse, setKmlHouse] = useState(true);
  const [form, setForm] = useState({ lotNumber: "", label: "", address: "", houseAtCenter: true, attachId: "" });
  const lotsRef = useRef(lots);
  lotsRef.current = lots;
  const draftPtsRef = useRef(draft);
  draftPtsRef.current = draft;

  const canDraw = canEdit && can("ops.plano");

  const load = useCallback(async () => {
    if (!tenantId) return;
    const d = await api<{
      canEdit: boolean;
      view: { mapLat: string; mapLng: string; mapZoom: number };
      lots: Lot[];
      overlays?: OverlayLayer[];
    }>(withTenant("/api/plan", tenantId));
    setCanEdit(d.canEdit);
    setLots(d.lots);
    setOverlays(d.overlays ?? []);
    return { view: d.view, lots: d.lots, overlays: d.overlays ?? [] };
  }, [tenantId]);

  useEffect(() => {
    let dead = false;
    (async () => {
      const L = await import("leaflet");
      if (dead || !hostRef.current || mapRef.current) return;
      LRef.current = L;
      const loaded = await load().catch(() => null);
      const view = loaded?.view ?? { mapLat: "-34.6037", mapLng: "-58.3816", mapZoom: 16 };
      const map = L.map(hostRef.current, { zoomControl: true, attributionControl: true }).setView(
        [Number(view.mapLat), Number(view.mapLng)],
        Number(view.mapZoom || 16),
      );
      flyToLots(map, L, loaded?.lots ?? [], focusKey);
      tilesRef.current = makePlanTiles(L, defaultPlanMapBase()).addTo(map);
      layersRef.current = L.layerGroup().addTo(map);
      overlaysRef.current = L.layerGroup().addTo(map);
      draftRef.current = L.layerGroup().addTo(map);
      const syncDetail = () => setShowLotDetail(map.getZoom() >= DETAIL_MIN_ZOOM);
      syncDetail();
      map.on("zoom", syncDetail);
      map.on("zoomend", syncDetail);
      mapRef.current = map;
    })().catch((err) => setMsg(err instanceof Error ? err.message : "No se pudo cargar el mapa"));
    return () => {
      dead = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [load, focusKey]);

  const redrawLots = useCallback(() => {
    const L = LRef.current;
    const group = layersRef.current;
    const map = mapRef.current;
    if (!L || !group || !map) return;
    if (!map.getPane("lotLabels")) {
      const pane = map.createPane("lotLabels");
      pane.style.zIndex = "650";
    }
    group.clearLayers();
    for (const lot of lots) {
      const focused =
        Boolean(focusKey) &&
        (lot.id === focusKey || lot.lotNumber.toLowerCase() === focusKey.toLowerCase());
      const ring = ringFromGeo(lot.lotPolygon);
      const poly =
        ring.length >= 3
          ? L.polygon(
              ring.map((p) => [p.lat, p.lng] as [number, number]),
              {
                color: focused ? "#0369a7" : "#0284c7",
                weight: focused ? 3 : 2,
                fillColor: focused ? "#0284c7" : "#38bdf8",
                fillOpacity: focused ? 0.4 : 0.28,
              },
            )
          : null;
      if (poly) {
        poly.bindTooltip(`Lote ${lot.lotNumber} · ${lot.label}`, { sticky: true });
        poly.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          if (tool === "house") {
            const ll = (ev as { latlng: { lat: number; lng: number } }).latlng;
            openHouse(ll.lat, ll.lng, lot);
            return;
          }
          if (tool === "move") openEdit(lot);
        });
        poly.addTo(group);
      }
      if (lot.mapLat && lot.mapLng) {
        const marker = L.marker([Number(lot.mapLat), Number(lot.mapLng)], {
          icon: L.divIcon({
            className: focused ? "ops-plan-house-icon ops-plan-house-icon--on" : "ops-plan-house-icon",
            html: HOUSE_SVG,
            iconSize: [28, 28],
            iconAnchor: [14, 26],
          }),
        });
        marker.bindTooltip(`Casa · Lote ${lot.lotNumber} · ${lot.label}`, { direction: "top", permanent: focused });
        marker.on("click", (ev) => {
          L.DomEvent.stopPropagation(ev);
          if (tool === "move") openEdit(lot);
        });
        marker.addTo(group);
      }
      if (poly) {
        const bounds = poly.getBounds();
        const padLat = (bounds.getNorth() - bounds.getSouth()) * 0.08;
        const padLng = (bounds.getEast() - bounds.getWest()) * 0.08;
        L.marker([bounds.getSouth() + padLat, bounds.getEast() - padLng], {
          icon: L.divIcon({
            className: `ops-plan-lot-label${focused ? " ops-plan-lot-label--on" : ""}`,
            html: `<span>${lot.lotNumber.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch)}</span>`,
            iconSize: [36, 22],
            iconAnchor: [36, 22],
          }),
          pane: "lotLabels",
          zIndexOffset: 2000,
          interactive: false,
          keyboard: false,
        }).addTo(group);
      }
    }
  }, [lots, tool, focusKey]);

  useEffect(() => {
    redrawLots();
  }, [redrawLots]);

  const drawOverlays = useCallback(() => {
    const L = LRef.current;
    const group = overlaysRef.current;
    if (!L || !group) return;
    group.clearLayers();
    for (const layer of overlays) {
      if (!layer.visible) continue;
      for (const feat of layer.features) {
        if (feat.kind === "polygon" && feat.geometry.type === "Polygon") {
          const ring = (feat.geometry.coordinates[0] ?? []).map((c) => [c[1], c[0]] as [number, number]);
          if (ring.length < 3) continue;
          const poly = L.polygon(ring, {
            color: "#b45309",
            weight: 2,
            dashArray: "5 4",
            fillColor: "#f59e0b",
            fillOpacity: 0.12,
          });
          poly.bindTooltip(feat.name, { sticky: true });
          poly.addTo(group);
        } else if (feat.kind === "line" && feat.geometry.type === "LineString") {
          const line = feat.geometry.coordinates.map((c) => [c[1], c[0]] as [number, number]);
          if (line.length < 2) continue;
          L.polyline(line, { color: "#b45309", weight: 2 }).bindTooltip(feat.name, { sticky: true }).addTo(group);
        } else if (feat.kind === "point" && feat.geometry.type === "Point") {
          const [lng, lat] = feat.geometry.coordinates;
          L.circleMarker([lat, lng], { radius: 5, color: "#b45309", fillColor: "#f59e0b", fillOpacity: 1, weight: 1 })
            .bindTooltip(feat.name, { direction: "top" })
            .addTo(group);
        }
      }
    }
  }, [overlays]);

  useEffect(() => {
    drawOverlays();
  }, [drawOverlays]);

  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    tilesRef.current?.remove();
    tilesRef.current = makePlanTiles(L, mapBase).addTo(map);
    tilesRef.current.bringToBack();
  }, [mapBase]);

  const paintDraft = useCallback(
    (points: { lat: number; lng: number }[]) => {
      const L = LRef.current;
      const group = draftRef.current;
      if (!L || !group) return;
      group.clearLayers();
      if (!points.length) return;
      const latlngs = points.map((p) => [p.lat, p.lng] as [number, number]);
      L.polyline(latlngs, { color: "#0369a7", weight: 2, dashArray: "6 4" }).addTo(group);
      points.forEach((p, idx) => {
        const first = idx === 0;
        const marker = L.circleMarker([p.lat, p.lng], {
          radius: first ? 8 : 4,
          color: first ? "#0f766e" : "#0369a7",
          fillColor: first ? "#14b8a6" : "#0369a7",
          fillOpacity: 1,
          weight: first ? 2 : 1,
        });
        if (first) {
          marker.bindTooltip("Clic para cerrar el lote", { direction: "top" });
          marker.on("click", (ev) => {
            L.DomEvent.stopPropagation(ev);
            const pts = draftPtsRef.current;
            if (pts.length >= 3) finishLot(pts);
          });
        }
        marker.addTo(group);
      });
    },
    [],
  );

  useEffect(() => {
    paintDraft(draft);
  }, [draft, paintDraft]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: { latlng: { lat: number; lng: number } }) => {
      if (!canDraw) return;
      if (tool === "lot") {
        const pts = draftPtsRef.current;
        const first = pts[0];
        if (first && pts.length >= 3) {
          const a = map.latLngToLayerPoint(e.latlng);
          const b = map.latLngToLayerPoint([first.lat, first.lng]);
          if (a.distanceTo(b) <= 16) {
            finishLot(pts);
            return;
          }
        }
        setDraft((prev) => [...prev, { lat: e.latlng.lat, lng: e.latlng.lng }]);
        return;
      }
      if (tool === "house") openHouse(e.latlng.lat, e.latlng.lng, undefined, lotsRef.current);
    };
    const onDbl = (e: { originalEvent?: Event }) => {
      e.originalEvent?.preventDefault?.();
      if (tool === "lot" && draftPtsRef.current.length >= 3) finishLot(draftPtsRef.current);
    };
    map.on("click", onClick);
    map.on("dblclick", onDbl);
    map.doubleClickZoom[tool === "lot" ? "disable" : "enable"]();
    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDbl);
    };
  }, [canDraw, tool, draft.length]);

  function closeModal() {
    setConfirmDelete(false);
    setModal(null);
  }

  function openEdit(lot: Lot) {
    setConfirmDelete(false);
    setForm({
      lotNumber: lot.lotNumber,
      label: lot.label,
      address: lot.address || "",
      houseAtCenter: false,
      attachId: lot.id,
    });
    setModal({ kind: "edit", lot });
  }

  function openHouse(lat: number, lng: number, lot?: Lot, allLots?: Lot[]) {
    const list = allLots ?? lots;
    setForm({
      lotNumber: lot?.lotNumber ?? "",
      label: lot?.label ?? "",
      address: lot?.address ?? "",
      houseAtCenter: false,
      attachId: lot?.id ?? list[0]?.id ?? "",
    });
    setModal({ kind: "house", lat, lng, lot });
  }

  function finishLot(points?: { lat: number; lng: number }[]) {
    const pts = points ?? draftPtsRef.current;
    if (pts.length < 3) return;
    const next = String(
      lotsRef.current.reduce((m, l) => Math.max(m, Number.parseInt(l.lotNumber, 10) || 0), 0) + 1,
    );
    setForm({ lotNumber: next, label: `Lote ${next}`, address: "", houseAtCenter: true, attachId: "" });
    setModal({ kind: "lot", points: pts });
  }

  function undoLastPoint() {
    setDraft((prev) => prev.slice(0, -1));
  }

  function cancelDraw() {
    setDraft([]);
    draftRef.current?.clearLayers();
    setTool("move");
    closeModal();
  }

  function closeKml() {
    setKmlOpen(false);
    setKmlPreview(null);
    setKmlSaveLayers(true);
    setKmlCreateLots(false);
    setKmlHouse(true);
    if (fileRef.current) fileRef.current.value = "";
  }

  useEscapeKey(() => {
    if (kmlOpen) {
      closeKml();
      return;
    }
    if (modal) {
      closeModal();
      return;
    }
    if (tool !== "move" || draft.length) cancelDraw();
  }, Boolean(kmlOpen) || Boolean(modal) || tool !== "move" || draft.length > 0);

  async function saveView() {
    const map = mapRef.current;
    if (!map || !tenantId) return;
    const c = map.getCenter();
    await api(withTenant("/api/plan/view", tenantId), {
      method: "PATCH",
      body: JSON.stringify({ mapLat: String(c.lat), mapLng: String(c.lng), mapZoom: map.getZoom() }),
    });
    setMsg("Vista del barrio guardada.");
  }

  function fitOverlayLayers(layers: OverlayLayer[]) {
    const map = mapRef.current;
    const L = LRef.current;
    const pts = overlayBounds(layers);
    if (!map || !L || pts.length < 1) return;
    if (pts.length === 1) {
      map.setView([pts[0].lat, pts[0].lng], 18);
      return;
    }
    map.fitBounds(
      L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])),
      { padding: [48, 48], maxZoom: 18 },
    );
  }

  async function onKmlFile(file: File | null) {
    if (!file) return;
    setMsg(null);
    try {
      const layers = await readKmlFile(file);
      setKmlPreview(layers);
    } catch (err) {
      setKmlPreview(null);
      setMsg(err instanceof Error ? err.message : "No se pudo leer el KML");
    }
  }

  async function submitKml() {
    if (!tenantId || !kmlPreview?.length) return;
    if (!kmlSaveLayers && !kmlCreateLots) {
      setMsg("Elegí guardar capas o crear lotes.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (kmlSaveLayers) {
        const next = [...overlays, ...kmlPreview];
        const d = await api<{ overlays: OverlayLayer[] }>(withTenant("/api/plan/overlays", tenantId), {
          method: "PUT",
          body: JSON.stringify({ overlays: next }),
        });
        setOverlays(d.overlays ?? next);
      }
      if (kmlCreateLots) {
        const used = new Set(lotsRef.current.map((l) => l.lotNumber.toLowerCase()));
        let seq = lotsRef.current.reduce((m, l) => Math.max(m, Number.parseInt(l.lotNumber, 10) || 0), 0);
        const payload = kmlPreview.flatMap((layer) =>
          layer.features
            .filter((f) => f.kind === "polygon" && f.geometry.type === "Polygon")
            .map((f) => {
              seq += 1;
              const lotNumber = lotNumberFromName(f.name, used, String(seq));
              const ring = f.geometry.coordinates[0] ?? [];
              const center = centroid(ring.map((c) => ({ lng: c[0], lat: c[1] })));
              return {
                lotNumber,
                label: f.name || `Lote ${lotNumber}`,
                lotPolygon: f.geometry,
                mapLat: kmlHouse ? String(center.lat) : null,
                mapLng: kmlHouse ? String(center.lng) : null,
              };
            }),
        );
        if (payload.length) {
          const d = await api<{ created: number; skipped: number }>(withTenant("/api/plan/lots/import", tenantId), {
            method: "POST",
            body: JSON.stringify({ lots: payload }),
          });
          setMsg(
            `KML importado: ${d.created} lote${d.created === 1 ? "" : "s"}${d.skipped ? `, ${d.skipped} omitidos` : ""}.`,
          );
        } else {
          setMsg("No había polígonos para crear lotes.");
        }
        await load();
      }
      fitOverlayLayers(kmlPreview);
      closeKml();
      if (!kmlCreateLots) setMsg("Capas KML guardadas en el plano.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo importar el KML");
    } finally {
      setBusy(false);
    }
  }

  async function persistOverlays(next: OverlayLayer[]) {
    if (!tenantId) return;
    const d = await api<{ overlays: OverlayLayer[] }>(withTenant("/api/plan/overlays", tenantId), {
      method: "PUT",
      body: JSON.stringify({ overlays: next }),
    });
    setOverlays(d.overlays ?? next);
  }

  async function toggleOverlay(id: string) {
    const next = overlays.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l));
    setOverlays(next);
    try {
      await persistOverlays(next);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo actualizar la capa");
    }
  }

  async function removeOverlay(id: string) {
    const next = overlays.filter((l) => l.id !== id);
    try {
      await persistOverlays(next);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo quitar la capa");
    }
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || query.trim().length < 3) return;
    setSearching(true);
    setHits([]);
    try {
      const d = await api<{ results: SearchHit[] }>(
        withTenant(`/api/plan/search?q=${encodeURIComponent(query.trim())}`, tenantId),
      );
      setHits(d.results);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Sin resultados");
    } finally {
      setSearching(false);
    }
  }

  function goTo(hit: SearchHit) {
    mapRef.current?.setView([Number(hit.lat), Number(hit.lng)], 17);
    setHits([]);
    setQuery(hit.label);
  }

  async function submitModal(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !modal) return;
    setBusy(true);
    setMsg(null);
    try {
      if (modal.kind === "lot") {
        const center = centroid(modal.points);
        await api(withTenant("/api/plan/lots", tenantId), {
          method: "POST",
          body: JSON.stringify({
            lotNumber: form.lotNumber,
            label: form.label,
            address: form.address,
            lotPolygon: toGeoJson(modal.points),
            mapLat: form.houseAtCenter ? String(center.lat) : null,
            mapLng: form.houseAtCenter ? String(center.lng) : null,
          }),
        });
        setDraft([]);
        draftRef.current?.clearLayers();
        setTool("move");
      } else if (modal.kind === "house") {
        if (form.attachId) {
          await api(withTenant(`/api/plan/lots/${form.attachId}`, tenantId), {
            method: "PATCH",
            body: JSON.stringify({ mapLat: String(modal.lat), mapLng: String(modal.lng) }),
          });
        } else {
          await api(withTenant("/api/plan/lots", tenantId), {
            method: "POST",
            body: JSON.stringify({
              lotNumber: form.lotNumber,
              label: form.label || `Lote ${form.lotNumber}`,
              address: form.address,
              mapLat: String(modal.lat),
              mapLng: String(modal.lng),
            }),
          });
        }
        setTool("move");
      } else {
        await api(withTenant(`/api/plan/lots/${modal.lot.id}`, tenantId), {
          method: "PATCH",
          body: JSON.stringify({
            lotNumber: form.lotNumber,
            label: form.label,
            address: form.address,
          }),
        });
      }
      closeModal();
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  async function deleteLot() {
    if (!tenantId || modal?.kind !== "edit") return;
    setBusy(true);
    setMsg(null);
    try {
      await api(withTenant(`/api/plan/lots/${modal.lot.id}`, tenantId), { method: "DELETE" });
      closeModal();
      setMsg(`Lote ${modal.lot.lotNumber} eliminado.`);
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo eliminar");
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  const hint = useMemo(() => {
    if (!canDraw) return "Solo lectura. Pedile al admin que dibuje lotes y casas.";
    if (tool === "lot") {
      return draft.length < 3
        ? "Clic para cada vértice. Deshacer saca el último punto."
        : "Clic en el primer punto (verde) o «Cerrar lote». Deshacer saca el último.";
    }
    if (tool === "house") return "Clic en el mapa (o sobre un lote) para ubicar la casa.";
    return "Arrastrá el mapa. Clic en un lote o casa para editarlo.";
  }, [canDraw, tool, draft.length]);

  return (
    <div className="ops-plan flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          <button
            type="button"
            className={`ops-plan-tool ${tool === "move" ? "ops-plan-tool--on" : ""}`}
            onClick={() => setTool("move")}
            title="Mover mapa"
          >
            <Hand className="h-4 w-4" />
            Mover
          </button>
          <button
            type="button"
            className={`ops-plan-tool ${tool === "lot" ? "ops-plan-tool--on" : ""}`}
            onClick={() => {
              setDraft([]);
              setTool("lot");
            }}
            disabled={!canDraw}
            title="Dibujar lote"
          >
            <Pentagon className="h-4 w-4" />
            Lote
          </button>
          <button
            type="button"
            className={`ops-plan-tool ${tool === "house" ? "ops-plan-tool--on" : ""}`}
            onClick={() => setTool("house")}
            disabled={!canDraw}
            title="Ubicar casa"
          >
            <Home className="h-4 w-4" />
            Casa
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          <button
            type="button"
            className={`ops-plan-tool ${mapBase === "osm" ? "ops-plan-tool--on" : ""}`}
            onClick={() => setMapBase("osm")}
            title="OpenStreetMap"
          >
            <Layers className="h-4 w-4" />
            OSM
          </button>
          <button
            type="button"
            className={`ops-plan-tool ${mapBase === "google" ? "ops-plan-tool--on" : ""}`}
            onClick={() => setMapBase("google")}
            title="Google Maps"
          >
            Google
          </button>
        </div>

        {tool === "lot" && draft.length > 0 ? (
          <button type="button" className="ops-plan-tool" onClick={undoLastPoint} title="Eliminar el último punto">
            <Undo2 className="h-4 w-4" />
            Deshacer
          </button>
        ) : null}
        {tool === "lot" && draft.length >= 3 ? (
          <button type="button" className="ops-plan-tool ops-plan-tool--on" onClick={() => finishLot()}>
            Cerrar lote
          </button>
        ) : null}
        {tool === "lot" && draft.length > 0 ? (
          <button type="button" className="ops-plan-tool" onClick={cancelDraw}>
            Cancelar
          </button>
        ) : null}

        <form onSubmit={onSearch} className="relative ml-auto flex min-w-[220px] flex-1 items-center gap-1.5">
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar barrio, calle o ciudad"
            className="cfg-input w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          <button type="submit" className="ops-plan-tool" disabled={searching}>
            {searching ? "…" : "Ir"}
          </button>
        </form>
        {canDraw ? (
          <button
            type="button"
            className="ops-plan-tool"
            onClick={() => {
              setKmlOpen(true);
              setKmlPreview(null);
            }}
            title="Importar KML o KMZ"
          >
            <FileUp className="h-4 w-4" />
            Importar KML
          </button>
        ) : null}
        {canDraw ? (
          <button type="button" className="ops-plan-tool" onClick={() => saveView().catch((err) => setMsg(String(err)))}>
            Guardar vista
          </button>
        ) : null}
      </div>

      {hits.length ? (
        <ul className="rounded-xl border border-slate-200 bg-white text-sm dark:border-slate-700 dark:bg-slate-900">
          {hits.map((h) => (
            <li key={`${h.lat}-${h.lng}-${h.label}`}>
              <button
                type="button"
                className="block w-full truncate px-3 py-2 text-left text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={() => goTo(h)}
              >
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-[12px] text-slate-500 dark:text-slate-400">{hint}</p>
      {msg ? <p className="text-[12px] text-sky-700 dark:text-sky-300">{msg}</p> : null}
      {overlays.length ? (
        <div className="flex flex-wrap gap-1.5">
          {overlays.map((layer) => (
            <span
              key={layer.id}
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                layer.visible
                  ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
                  : "border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
              }`}
            >
              <button type="button" onClick={() => void toggleOverlay(layer.id)} title={layer.visible ? "Ocultar capa" : "Mostrar capa"}>
                {layer.name} · {layer.features.length}
              </button>
              {canDraw ? (
                <button type="button" onClick={() => void removeOverlay(layer.id)} title="Quitar capa" className="text-rose-600 dark:text-rose-300">
                  <Trash2 className="h-3 w-3" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      <div
        className={`ops-plan-map-wrap relative min-h-[420px] flex-1 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700${tool === "lot" || tool === "house" ? " ops-plan-map-wrap--draw" : ""}${showLotDetail ? "" : " ops-plan-map-wrap--far"}`}
      >
        <div ref={hostRef} className="ops-plan-map h-full min-h-[420px] w-full" />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
        className="hidden"
        onChange={(e) => void onKmlFile(e.target.files?.[0] ?? null)}
      />

      {kmlOpen ? (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4"
          onClick={closeKml}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Importar KML</h3>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Capas y polígonos de Google Earth u otro GIS. También acepta KMZ.
                </p>
              </div>
              <button type="button" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={closeKml}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              onClick={() => fileRef.current?.click()}
            >
              <FileUp className="h-4 w-4" />
              Elegir archivo .kml o .kmz
            </button>
            {kmlPreview ? (
              <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {(() => {
                  const s = overlayStats(kmlPreview);
                  return `${s.layers} capa${s.layers === 1 ? "" : "s"} · ${s.polygons} polígono${s.polygons === 1 ? "" : "s"} · ${s.lines} línea${s.lines === 1 ? "" : "s"} · ${s.points} punto${s.points === 1 ? "" : "s"}`;
                })()}
                <ul className="mt-1 space-y-0.5">
                  {kmlPreview.map((l) => (
                    <li key={l.id}>
                      {l.name} ({l.features.length})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <label className="mb-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={kmlSaveLayers} onChange={(e) => setKmlSaveLayers(e.target.checked)} />
              Guardar como capas del plano
            </label>
            <label className="mb-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={kmlCreateLots} onChange={(e) => setKmlCreateLots(e.target.checked)} />
              Crear lotes desde los polígonos
            </label>
            {kmlCreateLots ? (
              <label className="mb-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={kmlHouse} onChange={(e) => setKmlHouse(e.target.checked)} />
                Marcar la casa en el centro de cada lote
              </label>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="rounded-xl px-3 py-2 text-xs text-slate-600 dark:text-slate-400" onClick={closeKml}>
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy || !kmlPreview}
                onClick={() => void submitKml()}
                className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {busy ? "Importando…" : "Importar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modal ? (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {modal.kind === "house" ? "Ubicar casa" : modal.kind === "edit" ? "Editar lote" : "Nuevo lote"}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {modal.kind === "house"
                    ? "La casa queda en el punto marcado. Podés colgarla de un lote existente."
                    : "Los lotes del plano son las mismas propiedades del barrio."}
                </p>
              </div>
              <button type="button" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={closeModal}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={submitModal} className="space-y-3">
              {modal.kind === "house" ? (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">Lote</label>
                  <select
                    className="cfg-input w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                    value={form.attachId}
                    onChange={(e) => setForm({ ...form, attachId: e.target.value })}
                  >
                    <option value="">Crear lote nuevo</option>
                    {lots.map((l) => (
                      <option key={l.id} value={l.id}>
                        Lote {l.lotNumber} — {l.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {modal.kind !== "house" || !form.attachId ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">Nº lote</label>
                      <input
                        required
                        value={form.lotNumber}
                        onChange={(e) => setForm({ ...form, lotNumber: e.target.value })}
                        className="cfg-input w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">Nombre</label>
                      <input
                        required
                        value={form.label}
                        onChange={(e) => setForm({ ...form, label: e.target.value })}
                        className="cfg-input w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">Dirección interna</label>
                    <input
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      className="cfg-input w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </>
              ) : null}
              {modal.kind === "lot" ? (
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.houseAtCenter}
                    onChange={(e) => setForm({ ...form, houseAtCenter: e.target.checked })}
                  />
                  Marcar la casa en el centro del lote
                </label>
              ) : null}
              {modal.kind === "edit" && confirmDelete ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 dark:border-rose-900/60 dark:bg-rose-950/40">
                  <p className="text-[11px] text-rose-800 dark:text-rose-200">
                    Se borra el lote {modal.lot.lotNumber} del plano y del padrón. No se puede deshacer.
                  </p>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2 pt-2">
                {modal.kind === "edit" ? (
                  confirmDelete ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-xl px-3 py-2 text-xs text-slate-600 dark:text-slate-400"
                    >
                      Volver
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Eliminar
                    </button>
                  )
                ) : (
                  <span />
                )}
                <div className="flex justify-end gap-2">
                  <button type="button" className="rounded-xl px-3 py-2 text-xs text-slate-600 dark:text-slate-400" onClick={closeModal}>
                    Cancelar
                  </button>
                  {modal.kind === "edit" && confirmDelete ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void deleteLot()}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {busy ? "Eliminando…" : "Sí, eliminar"}
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      {busy ? "Guardando…" : "Guardar"}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
