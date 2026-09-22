import { overlayBounds, type OverlayLayer } from "@/lib/kml";

export type PlanMapBase = "osm" | "google";
export type GoogleMapType = "roadmap" | "satellite" | "hybrid";
export type PlanMapStyle = "osm" | "roadmap" | "satellite" | "hybrid";

const STYLE_KEY = "accesopro.planMapStyle";

export function googleMapsApiKey() {
  return (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "").trim();
}

export function googleMapType(): GoogleMapType {
  const raw = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_TYPE ?? "hybrid").toLowerCase();
  if (raw === "roadmap" || raw === "satellite" || raw === "hybrid") return raw;
  return "hybrid";
}

export function defaultPlanMapBase(): PlanMapBase {
  const raw = (process.env.NEXT_PUBLIC_MAP_PROVIDER ?? "osm").toLowerCase();
  return raw === "google" ? "google" : "osm";
}

export function defaultPlanMapStyle(): PlanMapStyle {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(STYLE_KEY);
      if (stored === "osm" || stored === "roadmap" || stored === "satellite" || stored === "hybrid") {
        return stored;
      }
    } catch {
      /* private mode */
    }
  }
  if (defaultPlanMapBase() === "google") return googleMapType();
  return "osm";
}

export function persistPlanMapStyle(style: PlanMapStyle) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STYLE_KEY, style);
  } catch {
    /* ignore */
  }
}

export function makePlanTiles(
  L: typeof import("leaflet"),
  style: PlanMapStyle | PlanMapBase,
): import("leaflet").TileLayer {
  const resolved: PlanMapStyle = style === "google" ? googleMapType() : style;
  if (resolved === "osm") {
    return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    });
  }
  const lyrs = resolved === "roadmap" ? "m" : resolved === "satellite" ? "s" : "y";
  const key = googleMapsApiKey();
  const keyQ = key ? `&key=${encodeURIComponent(key)}` : "";
  return L.tileLayer(`https://{s}.google.com/vt/lyrs=${lyrs}&hl=es-AR&x={x}&y={y}&z={z}${keyQ}`, {
    maxZoom: 21,
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    attribution: '&copy; <a href="https://www.google.com/maps">Google</a>',
  });
}

function ringFromGeo(raw: string | null | undefined): { lat: number; lng: number }[] {
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

export function escapePlanText(value: string) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

export const PLAN_HOUSE_HTML =
  '<span class="ops-plan-house-face"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span>';

export function planLotLabelHtml(lotNumber: string) {
  return `<span>${escapePlanText(lotNumber)}</span>`;
}

export function lotPolygonRing(raw: string | null | undefined): { lat: number; lng: number }[] {
  return ringFromGeo(raw);
}

export function lotCentroid(ring: { lat: number; lng: number }[]): { lat: number; lng: number } | null {
  if (!ring.length) return null;
  return {
    lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length,
    lng: ring.reduce((s, p) => s + p.lng, 0) / ring.length,
  };
}

export function lotHouseLatLng(lot: {
  mapLat?: string | null;
  mapLng?: string | null;
  lotPolygon?: string | null;
}): [number, number] | null {
  if (lot.mapLat && lot.mapLng) {
    const lat = Number(lot.mapLat);
    const lng = Number(lot.mapLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
  }
  return null;
}

export function lotLabelLatLng(lot: {
  mapLat?: string | null;
  mapLng?: string | null;
  lotPolygon?: string | null;
}): [number, number] | null {
  const ring = ringFromGeo(lot.lotPolygon);
  const c = lotCentroid(ring);
  if (c) return [c.lat, c.lng];
  return lotHouseLatLng(lot);
}

export function planContentPoints(
  lots: Array<{ mapLat?: string | null; mapLng?: string | null; lotPolygon?: string | null }>,
  overlays: OverlayLayer[] | undefined,
): { lat: number; lng: number }[] {
  const pts = overlayBounds((overlays ?? []).filter((layer) => layer.visible !== false)).map((p) => ({
    lat: p.lat,
    lng: p.lng,
  }));
  for (const lot of lots) {
    const ring = ringFromGeo(lot.lotPolygon);
    for (const p of ring) pts.push(p);
    if (lot.mapLat && lot.mapLng) {
      const lat = Number(lot.mapLat);
      const lng = Number(lot.mapLng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) pts.push({ lat, lng });
    }
  }
  return pts;
}

export function fitPlanContent(
  map: import("leaflet").Map,
  L: typeof import("leaflet"),
  lots: Array<{ mapLat?: string | null; mapLng?: string | null; lotPolygon?: string | null }>,
  overlays: OverlayLayer[] | undefined,
  opts?: { padding?: number; maxZoom?: number },
): boolean {
  const pts = planContentPoints(lots, overlays);
  if (!pts.length) return false;
  const padding = opts?.padding ?? 36;
  const maxZoom = opts?.maxZoom ?? 18;
  if (pts.length === 1) {
    map.setView([pts[0].lat, pts[0].lng], Math.min(18, maxZoom));
    return true;
  }
  const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number]));
  const span = bounds.getNorthEast().distanceTo(bounds.getSouthWest());
  if (!Number.isFinite(span) || span <= 0 || span > 25000) return false;
  map.fitBounds(bounds, { padding: [padding, padding], maxZoom });
  return true;
}
