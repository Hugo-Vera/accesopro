import type { FacialEventAlert } from "@/components/LiveFacialAlertToast";

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
  ev: { id: string; createdAt?: number | string; payload?: Record<string, unknown> },
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
  const method = String(p.method || (p.Method === "15" ? "facial" : "biométrico"));
  const deviceName = String(p.deviceName || "Lector Facial Dahua");
  const deviceId = String(p.deviceId || "");
  const snapshotUrl = normalizeSnapshotUrl(p.snapshotUrl || p.URL);
  const reason = isApproved ? undefined : String(p.reason || "Rostro no registrado en el sistema");

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
  };
}

export function snapshotProxyUrl(deviceId: string, snapshotUrl?: string, tenantId?: string | null) {
  const url = normalizeSnapshotUrl(snapshotUrl);
  if (!deviceId || !url) return null;
  if (failedSnapshots.has(snapshotKey(deviceId, url))) return null;
  const qs = new URLSearchParams({ url });
  if (tenantId) qs.set("tenantId", tenantId);
  return `/api/dahua/${deviceId}/record-snapshot?${qs.toString()}`;
}
