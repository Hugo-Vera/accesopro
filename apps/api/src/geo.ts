export const LATLNG_ERROR = "Coordenadas inválidas: latitud entre -90 y 90 y longitud entre -180 y 180 (ej. -34.6037, -58.3816).";

function coord(raw: unknown): number | null {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Punto de casa del lote: vacío = sin punto; fuera de rango = error (manda el plano a la otra punta del mundo). */
export function parseLotLatLng(
  rawLat: unknown,
  rawLng: unknown,
): { mapLat: string | null; mapLng: string | null } | { error: string } {
  const lat = coord(rawLat);
  const lng = coord(rawLng);
  if (lat === null && lng === null) return { mapLat: null, mapLng: null };
  if (lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng)) return { error: LATLNG_ERROR };
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: LATLNG_ERROR };
  return { mapLat: String(lat), mapLng: String(lng) };
}

export function validLatLng(lat: unknown, lng: unknown) {
  const a = Number(lat);
  const b = Number(lng);
  return lat != null && lng != null && lat !== "" && lng !== "" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180;
}
