import type { FacialEventAlert } from "@/components/LiveFacialAlertToast";
import { asiMethodKey, asiMethodLabel } from "@accesopro/catalog";
import { apiUrl } from "@/lib/api";
import { arrivalModeLabel, visitKindLabel } from "@/lib/visitDocs";

export type EventRow = {
  id: string;
  createdAt: string | number;
  payload: Record<string, unknown>;
  sentido?: string | null;
  laneCode?: number | null;
};

/** Evita reintentar capturas que ya fallaron (HMR / remount / 404 Dahua). */
const failedSnapshots = new Set<string>();

const BOGUS_NAMES = new Set([
  "rostro no identificado",
  "rostro no reconocido",
  "usuario facial",
  "usuario asi",
  "apertura remota",
  "visita / qr",
]);

function cleanPersonName(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s || BOGUS_NAMES.has(s.toLowerCase())) return null;
  if (/^\d+$/.test(s)) return null;
  if (!/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(s)) return null;
  return s;
}

function hhmm(raw: unknown): string | null {
  const n = typeof raw === "number" ? raw : Date.parse(String(raw ?? ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n > 0 && n < 1e12 ? n * 1000 : n);
  if (!Number.isFinite(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${min}`;
}

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
  const visitStatusRaw = String(p.visitStatus ?? "").trim();
  const isVisit =
    p.visitHold === true ||
    String(p.accessKind ?? "") === "visita" ||
    visitStatusRaw === "pending" ||
    visitStatusRaw === "approved" ||
    visitStatusRaw === "denied";
  const visitStatus: FacialEventAlert["visitStatus"] = isVisit
    ? visitStatusRaw === "approved" || p.guardApproved === true
      ? "approved"
      : visitStatusRaw === "denied"
        ? "denied"
        : "pending"
    : undefined;
  const isApproved = isVisit
    ? visitStatus === "approved"
    : p.approved === true || String(p.status ?? p.Status ?? "0") === "1";
  const qrString = String(p.qrPayload ?? p.QRCode ?? p.QRCodeEx ?? "").trim();
  const qrHintRaw = String(p.qrHint ?? "").trim();
  const qrHint = qrHintRaw || (qrString ? `****${qrString.slice(-4)}` : undefined);
  const guestDni = String(p.guestDni ?? p.dni ?? "").trim() || undefined;
  const scanChannelLabel = String(p.scanChannelLabel ?? "").trim() || undefined;
  const scannedByName = String(p.scannedByName ?? "").trim() || undefined;
  const approvedByName = String(p.approvedByName ?? "").trim() || undefined;
  const approvedVia = String(p.approvedVia ?? "").trim() || undefined;
  const methodKey = asiMethodKey(p.methodCode ?? p.Method, p.method);
  const isRemote = methodKey === "remote";
  const openReasonRaw = String(p.openReason ?? "").trim();
  const openReason =
    openReasonRaw === "visit" || openReasonRaw === "manual" || openReasonRaw === "access_qr" ? openReasonRaw : undefined;
  const openedByName = str(p.openedByName);
  const openedViaLabel = str(p.openedViaLabel);
  const visitKindRaw = str(p.visitKind);
  const visitKindText = visitKindRaw ? (visitKindRaw === "social" ? "Visita" : visitKindLabel(visitKindRaw)) : undefined;
  const hasQr = Boolean(qrHint || qrString);
  const personName = isVisit
    ? cleanPersonName(p.guestName) || cleanPersonName(p.personName) || "Visita"
    : cleanPersonName(p.guestName) ||
      cleanPersonName(p.personName) ||
      cleanPersonName(p.CardName) ||
      cleanPersonName(p.userName) ||
      (openReason === "manual" ? "Apertura manual" : "") ||
      (isRemote ? "Apertura remota" : "") ||
      (!isApproved && qrString ? "QR no autorizado" : "") ||
      (isApproved ? "No identificado" : "Rostro no reconocido");
  const opened = hhmm(p.approvedAt);
  const noBarrier = p.noBarrier === true;
  const visitBase = hasQr ? "QR visita" : visitKindText || "Visita";
  const approvedWord = noBarrier ? "sin abrir barrera" : "abierto";
  const method = isVisit
    ? visitStatus === "approved"
      ? opened
        ? `${visitBase} · ${approvedWord} ${opened}`
        : `${visitBase} · ${approvedWord}`
      : visitStatus === "denied"
        ? `${visitBase} · denegado`
        : `${visitBase} · espera aprobación`
    : openReason === "manual"
      ? "Apertura manual"
      : openReason === "access_qr"
        ? "Mi QR de acceso"
        : isRemote
          ? "Apertura remota"
          : !isApproved && qrString
            ? "Código QR"
            : asiMethodLabel(p.methodCode ?? p.Method, p.method);
  const deviceName = String(p.deviceName || "Lector Facial Dahua");
  const deviceId = String(p.deviceId || "");
  const snapshotUrl = normalizeSnapshotUrl(p.snapshotUrl || p.URL);
  const reason = isVisit
    ? visitStatus === "approved"
      ? undefined
      : visitStatus === "denied"
        ? "Visita denegada"
        : "QR visita · espera aprobación"
    : isApproved
      ? undefined
      : qrString
        ? "QR no autorizado"
        : String(p.reason || "Rostro no registrado en el sistema");
  const code = Number(p.laneCode ?? ev.laneCode ?? 0);
  const stamped = String(p.sentido ?? ev.sentido ?? "").trim();
  const lane: "in" | "out" = code === 2 || stamped === "out" ? "out" : "in";
  const lotNumber = p.lotNumber != null && String(p.lotNumber).trim() ? String(p.lotNumber) : undefined;
  const approvalId = p.approvalId != null ? String(p.approvalId) : undefined;
  const passId = p.visitPassId != null ? String(p.visitPassId) : p.passId != null ? String(p.passId) : undefined;
  const approvedAt = typeof p.approvedAt === "number" ? p.approvedAt : undefined;

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
    kind: isVisit ? "visit" : "facial",
    isRemote,
    visitStatus,
    approvedAt,
    lotNumber,
    approvalId,
    passId,
    guestDni,
    qrHint,
    scanChannelLabel: scanChannelLabel || (isVisit && deviceName ? deviceName : undefined),
    scannedByName,
    approvedByName,
    approvedVia,
    visitKindLabel: isVisit ? visitKindText : undefined,
    arrivalLabel: isVisit && str(p.arrivalMode) ? arrivalModeLabel(str(p.arrivalMode)) : undefined,
    plate: str(p.plate ?? p.patente),
    authorizedBy: str(p.authorizedBy),
    openedByName: openedByName || (isVisit ? approvedByName : undefined),
    openedViaLabel,
    openReason,
    actuatorName: str(p.actuatorName),
    noBarrier: noBarrier || undefined,
  };
}

function str(raw: unknown): string | undefined {
  const s = String(raw ?? "").trim();
  return s && s !== "null" && s !== "undefined" ? s : undefined;
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
