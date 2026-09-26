/** Giro del plano en grados enteros 0–359 (lo gira leaflet-rotate, ver `leafletLoader`). */
export function normalizeBearing(deg: number) {
  if (!Number.isFinite(deg)) return 0;
  return ((Math.round(deg) % 360) + 360) % 360;
}
