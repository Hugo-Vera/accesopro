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
