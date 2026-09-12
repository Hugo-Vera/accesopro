export type PlanMapBase = "osm" | "google";
export type GoogleMapType = "roadmap" | "satellite" | "hybrid";

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

export function makePlanTiles(
  L: typeof import("leaflet"),
  base: PlanMapBase,
): import("leaflet").TileLayer {
  if (base === "google") {
    const kind = googleMapType();
    const lyrs = kind === "roadmap" ? "m" : kind === "satellite" ? "s" : "y";
    const key = googleMapsApiKey();
    const keyQ = key ? `&key=${encodeURIComponent(key)}` : "";
    return L.tileLayer(`https://{s}.google.com/vt/lyrs=${lyrs}&hl=es-AR&x={x}&y={y}&z={z}${keyQ}`, {
      maxZoom: 21,
      subdomains: ["mt0", "mt1", "mt2", "mt3"],
      attribution: '&copy; <a href="https://www.google.com/maps">Google</a>',
    });
  }
  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
}
