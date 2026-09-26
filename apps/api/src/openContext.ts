import type { Context } from "hono";

/**
 * Quién pidió un pulso y para qué. El ASI después reporta el relé como Method 4 («Apertura remota»)
 * sin identidad: con esto la tarjeta del historial muestra la visita real y el guardia que abrió.
 */
export type OpenContext = {
  reason: "visit" | "manual" | "access_qr";
  openedByUserId?: string | null;
  openedByName?: string | null;
  openedVia?: OpenVia | null;
  /** Tarjeta ya creada a la que se le pega la foto del pulso (en vez de una fila nueva). */
  eventId?: string | null;
  passId?: string | null;
  approvalId?: string | null;
  guestName?: string | null;
  guestDni?: string | null;
  lotNumber?: string | null;
  visitKind?: string | null;
  arrivalMode?: string | null;
  plate?: string | null;
  authorizedBy?: string | null;
  sentido?: "in" | "out" | null;
  reentry?: boolean;
  personName?: string | null;
  actuatorName?: string | null;
};

export type OpenVia = "app" | "web";

const OPEN_VIA_LABEL: Record<OpenVia, string> = {
  app: "App de portería",
  web: "Dashboard",
};

export function openViaLabel(via?: string | null) {
  return via === "app" || via === "web" ? OPEN_VIA_LABEL[via] : null;
}

/** La app manda `X-AccesoPro-Client: guard-app`; builds viejos se reconocen por el Bearer sin cookie. */
export function openViaOf(c: Context): OpenVia {
  const client = (c.req.header("x-accesopro-client") || "").toLowerCase();
  if (client === "guard-app") return "app";
  if (client === "web") return "web";
  const bearer = /^Bearer\s+/i.test(c.req.header("authorization") || "");
  const cookie = (c.req.header("cookie") || "").length > 0;
  return bearer && !cookie ? "app" : "web";
}

const TTL_MS = 30_000;
const pending = new Map<string, { ctx: OpenContext; at: number }>();

function key(siteId: string, deviceId: string) {
  return `${siteId}\0${deviceId}`;
}

export function rememberOpen(siteId: string, deviceId: string, ctx: OpenContext) {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.at > TTL_MS) pending.delete(k);
  pending.set(key(siteId, deviceId), { ctx, at: now });
}

export function takeOpen(siteId: string, deviceId: string): OpenContext | null {
  const k = key(siteId, deviceId);
  const hit = pending.get(k);
  if (!hit) return null;
  pending.delete(k);
  return Date.now() - hit.at <= TTL_MS ? hit.ctx : null;
}

/** Campos que se pegan al evento Method 4 del pulso. */
export function openContextPayload(ctx: OpenContext, at = Date.now()): Record<string, unknown> {
  const base: Record<string, unknown> = {
    remoteOpen: true,
    openReason: ctx.reason,
    openedByName: ctx.openedByName || null,
    openedVia: ctx.openedVia || null,
    openedViaLabel: openViaLabel(ctx.openedVia),
    actuatorName: ctx.actuatorName || null,
  };
  if (ctx.reason === "visit") {
    return {
      ...base,
      accessKind: "visita",
      visitHold: false,
      visitStatus: "approved",
      guardApproved: true,
      approved: true,
      approvedAt: at,
      approvedByName: ctx.openedByName || null,
      guestName: ctx.guestName || null,
      personName: ctx.guestName || null,
      guestDni: ctx.guestDni || null,
      lotNumber: ctx.lotNumber || null,
      visitKind: ctx.visitKind || null,
      arrivalMode: ctx.arrivalMode || null,
      plate: ctx.plate || null,
      authorizedBy: ctx.authorizedBy || null,
      visitPassId: ctx.passId || null,
      approvalId: ctx.approvalId || null,
      reentry: Boolean(ctx.reentry),
    };
  }
  if (ctx.reason === "access_qr") {
    return { ...base, approved: true, personName: ctx.personName || null, lotNumber: ctx.lotNumber || null };
  }
  return { ...base, approved: true };
}
