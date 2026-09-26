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
  const code = Number(p.laneCode ?? ev.laneCode ?? 0);
  const stamped = String(p.sentido ?? ev.sentido ?? "").trim();
  const lane: "in" | "out" = code === 2 || stamped === "out" ? "out" : "in";
  const out = lane === "out";
  const personName = isVisit
    ? cleanPersonName(p.guestName) || cleanPersonName(p.personName) || "Visita"
    : cleanPersonName(p.guestName) ||
      cleanPersonName(p.personName) ||
      cleanPersonName(p.CardName) ||
      cleanPersonName(p.userName) ||
      (openReason === "manual" ? (out ? "Salida manual" : "Ingreso manual") : "") ||
      (isRemote ? (out ? "Salida por portería" : "Ingreso por portería") : "") ||
      (!isApproved && qrString ? "QR no autorizado" : "") ||
      (isApproved ? "No identificado" : "Rostro no reconocido");
  const opened = hhmm(p.approvedAt);
  const noBarrier = p.noBarrier === true;
  const visitBase = hasQr ? "QR visita" : visitKindText || "Visita";
  const approvedWord = noBarrier
    ? `${out ? "salida" : "ingreso"} sin abrir barrera`
    : out
      ? "salida habilitada"
      : "ingreso habilitado";
  const method = isVisit
    ? visitStatus === "approved"
      ? opened
        ? `${visitBase} · ${approvedWord} ${opened}`
        : `${visitBase} · ${approvedWord}`
      : visitStatus === "denied"
        ? `${visitBase} · denegado`
        : `${visitBase} · espera aprobación`
    : openReason === "manual"
      ? "Accionado manualmente desde portería"
      : openReason === "access_qr"
        ? "Mi QR de acceso"
        : isRemote
          ? "Accionado desde portería"
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
    residentRole: isVisit ? undefined : residentRoleOf(p.residentRole),
    residentRoleLabel: isVisit ? undefined : str(p.residentRoleLabel),
    lotLabel: isVisit ? undefined : str(p.lotLabel),
    titularName: isVisit ? undefined : str(p.titularName),
    titularPhone: isVisit ? undefined : str(p.titularPhone),
    residentPhone: isVisit ? undefined : str(p.residentPhone),
    residentSchedule: isVisit ? undefined : str(p.residentSchedule),
    residentNotes: isVisit ? undefined : str(p.residentNotes),
  };
}

function residentRoleOf(raw: unknown): FacialEventAlert["residentRole"] {
  return raw === "owner" || raw === "family" || raw === "service" ? raw : undefined;
}

/** Cartel principal: el sentido va en el texto para no confundir ingreso con salida. */
export function accessBadgeLabel(alert: FacialEventAlert, tone: "pending" | "approved" | "denied") {
  const out = alert.lane === "out";
  if (tone === "pending") return out ? "Salida · identificado" : "Ingreso · identificado";
  if (tone === "approved") return out ? "Salida autorizada" : "Ingreso autorizado";
  if (alert.kind === "visit") return out ? "Salida denegada" : "Visita denegada";
  return out ? "Salida denegada" : "Ingreso denegado";
}

/** Línea de estado de un acceso aprobado que no es visita. */
export function accessStatusLine(alert: FacialEventAlert) {
  const out = alert.lane === "out";
  const opener = alert.openedByName || alert.approvedByName;
  const via = alert.openedViaLabel
    ? /app/i.test(alert.openedViaLabel)
      ? " desde la app"
      : " desde el dashboard"
    : " desde portería";
  if (alert.isRemote || alert.openReason === "manual") {
    const verb = out ? "Salida accionada" : "Ingreso accionado";
    return opener ? `${verb} por ${opener}${via}` : `${verb} desde portería`;
  }
  if (alert.openReason === "access_qr" || alert.method === "Mi QR de acceso") {
    const verb = out ? "Salida autorizada" : "Ingreso autorizado";
    return opener ? `${verb} con Mi QR de acceso · ${opener}${via}` : `${verb} con Mi QR de acceso`;
  }
  return out ? "Salida autorizada · identidad validada" : "Ingreso autorizado · identidad validada";
}

/** «Propietario · Lote 12» para la línea bajo el nombre. */
export function residentHeadline(alert: FacialEventAlert) {
  if (!alert.residentRoleLabel && !alert.residentRole) return null;
  return [
    alert.residentRoleLabel,
    alert.lotNumber ? `Lote ${alert.lotNumber}` : null,
    alert.lotLabel,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Datos breves del residente para el toast (el detalle usa `residentFacts`). */
export function residentDetails(alert: FacialEventAlert): string[] {
  const out: string[] = [];
  if (alert.titularName) {
    out.push(`Titular: ${[alert.titularName, alert.titularPhone].filter(Boolean).join(" · ")}`);
  }
  if (alert.residentPhone) out.push(`Teléfono: ${alert.residentPhone}`);
  if (alert.residentSchedule) out.push(`Horario: ${alert.residentSchedule}`);
  return out;
}

export function residentFacts(alert: FacialEventAlert): [string, string][] {
  if (!alert.residentRoleLabel && !alert.residentRole) return [];
  const out: [string, string][] = [];
  if (alert.residentRoleLabel) out.push(["Rol", alert.residentRoleLabel]);
  if (alert.lotNumber) out.push(["Lote", [`Lote ${alert.lotNumber}`, alert.lotLabel].filter(Boolean).join(" · ")]);
  if (alert.titularName) out.push(["Titular", alert.titularName]);
  if (alert.titularPhone) out.push(["Tel. titular", alert.titularPhone]);
  if (alert.residentPhone) out.push(["Teléfono", alert.residentPhone]);
  if (alert.residentSchedule) out.push(["Horario", alert.residentSchedule]);
  if (alert.residentNotes) out.push(["Nota", alert.residentNotes]);
  return out;
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
