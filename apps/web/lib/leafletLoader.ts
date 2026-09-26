type LeafletNS = typeof import("leaflet");

let loading: Promise<LeafletNS> | null = null;

/**
 * Leaflet + leaflet-rotate. El plugin parchea el `L` global, así que tiene que ser
 * el mismo objeto que usan los mapas (no el namespace ESM, que es de solo lectura).
 */
export function loadLeaflet(): Promise<LeafletNS> {
  if (!loading) {
    loading = (async () => {
      const mod = await import("leaflet");
      const L = ((mod as unknown as { default?: LeafletNS }).default ?? mod) as LeafletNS;
      (window as unknown as { L: LeafletNS }).L = L;
      await import("leaflet-rotate/dist/leaflet-rotate-src.js");
      return L;
    })().catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

/** Zoom en pasos cortos (rueda y +/−) en vez de saltos de a 1 nivel. */
export const SMOOTH_ZOOM_OPTIONS = {
  zoomSnap: 0.25,
  zoomDelta: 0.5,
  wheelPxPerZoomLevel: 140,
  wheelDebounceTime: 30,
} as const;
