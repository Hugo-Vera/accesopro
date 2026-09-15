import type { FacialEventAlert } from "@/components/LiveFacialAlertToast";
import { asiMethodLabel } from "@accesopro/catalog";
import { apiUrl } from "@/lib/api";

export type EventRow = {
  id: string;
  createdAt: string | number;
  payload: Record<string, unknown>;
  sentido?: string | null;
  laneCode?: number | null;
};

/** Evita reintentar capturas que ya fallaron (HMR / remount / 404 Dahua). */
const failedSnapshots = new Set<string>();

export function normalizeSnapshotUrl(raw: unknown): string | undefined {
  const s = String(raw ?? "").trim();
  if (!s || s === "undefined" || s === "null" || s === "None") return undefined;
  // Rutas típicas Dahua: /mnt/... o FileManager path; a veces URL http del equipo
  if (s.startsWith("/") || /^https?:\/\//i.test(s)) return s;
  if (s.includes("/") && !/\s/.test(s)) return s;
  return undefined;
}

function snapshotKey(deviceId: string, snapshotUrl: string) {
  return `${deviceId}\0${snapshotUrl}`;
}

export function markSnapshotFailed(deviceId: string, snapshotUrl?: string) {
  const url = normalizeSnapshotUrl(snapshotUrl);
  if (!deviceId || !url) return;
  failedSnapshots.add(snapshotKey(deviceId, url));
}

export function parseFacialEvent(
  ev: {
    id: string;
    createdAt?: number | string;
    payload?: Record<string, unknown>;
    laneCode?: number | null;
    sentido?: string | null;
  },
): FacialEventAlert | null {
  if (!ev?.id) return null;
  const p = (ev.payload || {}) as Record<string, unknown>;
  const isApproved = p.approved === true || String(p.status ?? p.Status ?? "0") === "1";
  const personName = String(
    p.personName ||
      p.CardName ||
      p.userName ||
      p.UserID ||
      (isApproved ? "Usuario ASI" : "Rostro no reconocido"),
  );
  // Etiqueta ya resuelta contra el catálogo: el código crudo manda sobre el nombre guardado.
  const method = asiMethodLabel(p.methodCode ?? p.Method, p.method);
  const deviceName = String(p.deviceName || "Lector Facial Dahua");
  const deviceId = String(p.deviceId || "");
  const snapshotUrl = normalizeSnapshotUrl(p.snapshotUrl || p.URL);
  const reason = isApproved ? undefined : String(p.reason || "Rostro no registrado en el sistema");
  const code = Number(p.laneCode ?? ev.laneCode ?? 0);
  const stamped = String(p.sentido ?? ev.sentido ?? "").trim();
  const lane: "in" | "out" = code === 2 || stamped === "out" ? "out" : "in";

  return {
    id: ev.id,
    createdAt: typeof ev.createdAt === "number" || typeof ev.createdAt === "string" ? ev.createdAt : Date.now(),
    approved: isApproved,
    personName,
    method,
    deviceName,
    deviceId,
    snapshotUrl,
    reason,
    lane,
    photoStored: p.photoStored === true,
  };
}

export function eventPhotoUrl(eventId: string, tenantId?: string | null) {
  if (!eventId) return null;
  const qs = new URLSearchParams();
  if (tenantId) qs.set("tenantId", tenantId);
  const q = qs.toString();
  return apiUrl(`/api/events/${encodeURIComponent(eventId)}/photo${q ? `?${q}` : ""}`);
}

export function snapshotProxyUrl(deviceId: string, snapshotUrl?: string, tenantId?: string | null) {
  const url = normalizeSnapshotUrl(snapshotUrl);
  if (!deviceId || !url) return null;
  if (failedSnapshots.has(snapshotKey(deviceId, url))) return null;
  const qs = new URLSearchParams({ url });
  if (tenantId) qs.set("tenantId", tenantId);
  return apiUrl(`/api/dahua/${deviceId}/record-snapshot?${qs.toString()}`);
}
