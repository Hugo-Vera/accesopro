import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db/client.js";
import {
  events,
  guardApprovals,
  ownerProfiles,
  properties,
  users,
  vehicleInsurances,
  vehicles,
  visitCompanions,
  visitPasses,
  visitRecords,
  ownerNotices,
  personInsurances,
  driverLicenses,
  visitorIdentities,
  dahuaDevices,
  visitTrunkChecks,
  sites,
} from "./db/schema.js";
import { canonicalVisitKind, entryRuleSections, isKnownVisitKind, type VisitKindKey } from "@accesopro/catalog";
import { fireActuator } from "./actuatorExec.js";
import { openContextPayload, openViaLabel, type OpenContext, type OpenVia } from "./openContext.js";
import { actuatorsForDahuaDevice, actuatorsForSentido, laneCodeOf } from "./accessPoints.js";
import { broadcastRealtimeEvent } from "./eventStream.js";
import { nid, normalizePlate } from "./scope.js";
import { parseVisitQrPayload } from "./visitPass.js";
import { companionIsMinor, isMinorBirthDate, yearsFromBirthDate } from "./age.js";
import { createOwnerNotice, expireOwnerNotices } from "./ownerNotices.js";
import { saveEventPhoto } from "./eventPhotos.js";
import { verifyUserGuardCode } from "./users.js";
import { getVisitAuthDefaultHours } from "./retention.js";
import { processDocumentImage } from "./documentScan.js";
import { notifyStaff } from "./pushNotify.js";
import { saveVisitorDoc } from "./visitorDocs.js";
import { expireVisitPassOnSite, releaseVisitCredential } from "./accessQr.js";
import {
  canSwitchToPedestrian,
  expiredKeyLabel,
  linkedVehicleInsurance,
  missingVisitFields,
  ruleForPass,
  trunkCheckOf,
  trunkPhotoIdsOf,
  visitFieldGaps,
  type VisitFieldGaps,
} from "./visitRequirements.js";

export { canSwitchToPedestrian, missingVisitFields, trunkCheckOf, visitFieldGaps };

type TrunkCheckRow = typeof visitTrunkChecks.$inferSelect;

export type ArrivalMode = "peatonal" | "plataforma" | "vehiculo";
export type VisitKind = VisitKindKey;

const OPEN_STATUSES = new Set(["preauthorized", "active", "awaiting_entry", "in_site", "awaiting_exit", "temp_out"]);

export type ScanChannel = "totem" | "web" | "app";
export type Presence = "in" | "out_temp" | "out";
export type ExitPeople = { guest: boolean; companionIds: string[]; vehicle: boolean };

/** Adentro del predio: in_site / awaiting_exit, o vencido por el barrido viejo sin salida registrada. */
export function passIsInside(pass: {
  status: string;
  scannedInAt?: Date | number | null;
  scannedOutAt?: Date | number | null;
}) {
  if (pass.status === "in_site" || pass.status === "awaiting_exit") return true;
  return pass.status === "expired" && pass.scannedInAt != null && pass.scannedOutAt == null;
}

/** No se sale si no se entró: primer acceso = in; ya en el predio = out; temp_out = reingreso. */
export function visitSentidoFromPass(pass: {
  status: string;
  scannedInAt?: Date | number | null;
  scannedOutAt?: Date | number | null;
}): "in" | "out" {
  return passIsInside(pass) ? "out" : "in";
}

export function parseExitPeople(raw: string | null | undefined): ExitPeople | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ExitPeople>;
    return {
      guest: Boolean(v.guest),
      companionIds: Array.isArray(v.companionIds) ? v.companionIds.map(String) : [],
      vehicle: Boolean(v.vehicle),
    };
  } catch {
    return null;
  }
}

function presenceOf(v: string | null | undefined): Presence {
  return v === "out_temp" || v === "out" ? v : "in";
}

/** Quién está adentro y quién salió con "Sale y vuelve". */
export async function passPresence(pass: typeof visitPasses.$inferSelect) {
  const comps = await listCompanions(pass.id);
  const guest = presenceOf(pass.guestPresence);
  return {
    guest,
    companions: comps.map((c) => ({ ...c, presence: presenceOf(c.presence) })),
    anyInside: guest === "in" || comps.some((c) => presenceOf(c.presence) === "in"),
    anyTempOut: guest === "out_temp" || comps.some((c) => presenceOf(c.presence) === "out_temp"),
  };
}

export function qrHintOf(token?: string | null, dahuaCardNo?: string | null) {
  const raw = String(token || dahuaCardNo || "").trim();
  if (!raw) return "";
  return `****${raw.slice(-4)}`;
}

export function scanChannelLabel(channel?: string | null, deviceName?: string | null) {
  if (channel === "totem") return deviceName?.trim() ? `Tótem · ${deviceName.trim()}` : "Tótem ASI";
  if (channel === "app") return "App de portería";
  if (channel === "web") return "Dashboard web";
  return deviceName?.trim() || "Portería";
}

const HOLD_DEBOUNCE_MS = 25_000;

export function dwellLabel(scannedInAt: Date | number | null | undefined, now = Date.now()) {
  if (scannedInAt == null) return null;
  const t = scannedInAt instanceof Date ? scannedInAt.getTime() : Number(scannedInAt);
  if (!t) return null;
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `entró ${hh}:${mm} · ${mins} min`;
}

function normalizeScanChannel(raw: unknown, deviceId?: string | null): ScanChannel {
  if (raw === "app" || raw === "web" || raw === "totem") return raw;
  return deviceId ? "totem" : "web";
}

async function userNameOf(id?: string | null) {
  if (!id) return null;
  return (await db.select({ name: users.name }).from(users).where(eq(users.id, id)).get())?.name ?? null;
}

function mergeComment(prev: string | null | undefined, next: string | null | undefined) {
  const parts = [prev?.trim(), next?.trim()].filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

async function goodsNoticeOf(approvalId: string) {
  return db
    .select({ status: ownerNotices.status, createdAt: ownerNotices.createdAt })
    .from(ownerNotices)
    .where(and(eq(ownerNotices.approvalId, approvalId), eq(ownerNotices.kind, "goods")))
    .orderBy(desc(ownerNotices.createdAt))
    .get();
}

async function deviceNameOf(id?: string | null) {
  if (!id) return null;
  return (await db.select({ name: dahuaDevices.name }).from(dahuaDevices).where(eq(dahuaDevices.id, id)).get())?.name ?? null;
}

export function isArrivalMode(v: unknown): v is ArrivalMode {
  return v === "peatonal" || v === "plataforma" || v === "vehiculo";
}

export function needsVehicleDocs(mode: string | null | undefined) {
  return mode === "vehiculo";
}

export function withinTimeWindow(horaDesde: string | null, horaHasta: string | null, now: Date) {
  if (!horaDesde || !horaHasta) return true;
  const [h1, m1] = horaDesde.split(":").map(Number);
  const [h2, m2] = horaHasta.split(":").map(Number);
  if (![h1, m1, h2, m2].every((n) => Number.isFinite(n))) return true;
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= h1 * 60 + m1 && mins <= h2 * 60 + m2;
}

export function passWindowState(pass: {
  validFrom: Date | number;
  validUntil: Date | number;
  horaDesde: string | null;
  horaHasta: string | null;
  status: string;
}, now = new Date()) {
  const from = pass.validFrom instanceof Date ? pass.validFrom.getTime() : Number(pass.validFrom);
  const until = pass.validUntil instanceof Date ? pass.validUntil.getTime() : Number(pass.validUntil);
  const t = now.getTime();
  if (pass.status === "revoked" || pass.status === "denied") return "closed" as const;
  if (pass.status === "expired" || (until && t > until)) return "expired" as const;
  if (from && t < from) return "too_early" as const;
  if (!withinTimeWindow(pass.horaDesde, pass.horaHasta, now)) return "expired" as const;
  return "ok" as const;
}

export async function findVisitPassByCard(siteId: string, cardRaw: string) {
  const card = (parseVisitQrPayload(cardRaw) ?? cardRaw).trim().toUpperCase();
  if (!card) return null;
  const rows = await db.select().from(visitPasses).where(eq(visitPasses.siteId, siteId));
  return (
    rows.find((p) => {
      const token = String(p.token || "").toUpperCase();
      const dahua = String(p.dahuaCardNo || "").toUpperCase();
      if (dahua && dahua === card) return true;
      if (token && token === card) return true;
      if (card.startsWith("V_") && p.id.toUpperCase().endsWith(card.slice(2))) return true;
      return false;
    }) ?? null
  );
}

export async function findVisitPassByDni(siteId: string, dniRaw: string) {
  return (await findVisitPassByPersonDni(siteId, dniRaw))?.pass ?? null;
}

/** Titular del pase o acompañante (este último solo con el pase adentro o en temp_out). */
export async function findVisitPassByPersonDni(
  siteId: string,
  dniRaw: string,
): Promise<{ pass: typeof visitPasses.$inferSelect; companionId: string | null; presence: Presence } | null> {
  const dni = String(dniRaw || "").replace(/\D/g, "");
  if (dni.length < 7) return null;
  const rows = await db.select().from(visitPasses).where(eq(visitPasses.siteId, siteId));
  const open = rows.filter(
    (p) => OPEN_STATUSES.has(p.status) && String(p.guestDni || "").replace(/\D/g, "") === dni,
  );
  const rank = (s: string) =>
    s === "awaiting_exit" || s === "in_site" || s === "temp_out" ? 0 : s === "awaiting_entry" ? 1 : 2;
  open.sort((a, b) => rank(a.status) - rank(b.status));
  if (open[0]) return { pass: open[0], companionId: null, presence: presenceOf(open[0].guestPresence) };
  const inside = rows.filter((p) => p.status === "in_site" || p.status === "awaiting_exit" || p.status === "temp_out");
  for (const p of inside) {
    const comp = (await listCompanions(p.id)).find((c) => String(c.dni || "").replace(/\D/g, "") === dni);
    if (comp) return { pass: p, companionId: comp.id, presence: presenceOf(comp.presence) };
  }
  return null;
}

export async function applyPassIdentity(
  passId: string,
  input: {
    guestDni?: string;
    guestName?: string;
    firstName?: string;
    lastName?: string;
    tramite?: string;
    gender?: string;
    birthDate?: string;
  },
) {
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, passId)).get();
  if (!pass) return;
  const name =
    String(input.guestName || "").trim() ||
    `${input.lastName || ""} ${input.firstName || ""}`.replace(/\s+/g, " ").trim();
  const dni = String(input.guestDni || "").replace(/\D/g, "");
  const patch: { guestDni?: string; guestName?: string } = {};
  if (dni) patch.guestDni = dni;
  if (name) patch.guestName = name;
  if (Object.keys(patch).length) {
    await db.update(visitPasses).set(patch).where(eq(visitPasses.id, passId));
  }
  if (!pass.visitRecordId) return;
  const rec = await db.select().from(visitRecords).where(eq(visitRecords.id, pass.visitRecordId)).get();
  if (!rec?.personId) return;
  await db
    .update(visitorIdentities)
    .set({
      ...(dni ? { dniNumber: dni } : {}),
      ...(input.firstName?.trim() ? { firstName: input.firstName.trim() } : {}),
      ...(input.lastName?.trim() ? { lastName: input.lastName.trim() } : {}),
      ...(input.tramite?.trim() ? { tramiteNumber: input.tramite.trim() } : {}),
      ...(input.gender?.trim() ? { gender: input.gender.trim().slice(0, 1).toUpperCase() } : {}),
      ...(input.birthDate?.trim() ? { birthDate: input.birthDate.trim() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(visitorIdentities.id, rec.personId));
}

export async function listCompanions(passId: string) {
  return db.select().from(visitCompanions).where(eq(visitCompanions.passId, passId));
}

export async function replaceCompanions(
  passId: string,
  rows: { name?: string; dni?: string; birthDate?: string; isMinor?: boolean; situation?: string }[] | undefined,
) {
  if (!rows) return;
  await db.delete(visitCompanions).where(eq(visitCompanions.passId, passId));
  const now = new Date();
  for (const row of rows) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    const birthDate = String(row.birthDate || "").trim() || null;
    const situation =
      row.situation === "queda_a_jugar" || row.situation === "traslado" ? row.situation : "acompanante";
    await db.insert(visitCompanions).values({
      id: nid(),
      passId,
      name,
      dni: String(row.dni || "").replace(/\D/g, "") || null,
      birthDate,
      isMinor: Boolean(row.isMinor) || isMinorBirthDate(birthDate),
      situation,
      createdAt: now,
    });
  }
}

export async function syncVisitRecordFromPass(pass: typeof visitPasses.$inferSelect) {
  if (!pass.visitRecordId) return;
  const recordStatus =
    pass.status === "temp_out"
      ? "in_site"
      : pass.status === "in_site" || pass.status === "completed" || pass.status === "denied" || pass.status === "awaiting_exit"
        ? pass.status
        : "awaiting_entry";
  await db
    .update(visitRecords)
    .set({
      status: recordStatus,
      scannedInAt: pass.scannedInAt ?? null,
      scannedOutAt: pass.scannedOutAt ?? null,
    })
    .where(eq(visitRecords.id, pass.visitRecordId));
}

function untilMs(v: Date | number | null | undefined) {
  if (v == null) return 0;
  return v instanceof Date ? v.getTime() : Number(v) || 0;
}

function isPast(v: Date | number | null | undefined, now = Date.now()) {
  const t = untilMs(v);
  return t > 0 && t < now;
}

/** Tipo pedido por el cliente, ya canónico (`contractor` → `service`). null si no vino o no se conoce. */
export function toVisitKind(v: unknown): VisitKind | null {
  return isKnownVisitKind(v) ? canonicalVisitKind(v) : null;
}

export async function ownerContactForProperty(propertyId: string) {
  const profile = await db.select().from(ownerProfiles).where(eq(ownerProfiles.propertyId, propertyId)).get();
  const owner = profile ? await db.select().from(users).where(eq(users.id, profile.userId)).get() : null;
  return {
    ownerName: profile?.fullName || owner?.name || "Propietario",
    ownerPhone: profile?.phone || profile?.whatsapp || null,
    ownerWhatsapp: profile?.whatsapp || null,
    emergencyName: profile?.emergencyName || null,
    emergencyPhone: profile?.emergencyPhone || null,
  };
}

export async function holdVisitQr(input: {
  siteId: string;
  tenantId?: string | null;
  cardRaw: string;
  /** Carril del lector (tótem). El sentido de la visita sale del estado del pase. */
  sentido?: "in" | "out";
  deviceId?: string | null;
  scanChannel?: ScanChannel | string | null;
  scannedByUserId?: string | null;
  at?: Date;
  /** Aviso informativo al lote (QR preautorizado). Walk-in pasa false. */
  notifyLot?: boolean;
  /** Presencia de la persona identificada por DNI (titular o acompañante). */
  personPresence?: Presence | null;
}): Promise<{
  held: boolean;
  passId?: string;
  approvalId?: string;
  reason?: string;
  guestName?: string;
  guestDni?: string | null;
  lotNumber?: string | null;
  sentido?: "in" | "out";
  qrHint?: string;
  scanChannel?: ScanChannel;
  scanChannelLabel?: string;
  scannedByName?: string | null;
  eventId?: string;
  deduped?: boolean;
  denied?: boolean;
  validFrom?: Date | number | null;
  validUntil?: Date | number | null;
  horaDesde?: string | null;
  horaHasta?: string | null;
  reentry?: boolean;
  overstay?: boolean;
}> {
  const pass = await findVisitPassByCard(input.siteId, input.cardRaw);
  if (!pass) return { held: false };
  const lotOf = async (propertyId: string) => {
    const row = await db.select().from(properties).where(eq(properties.id, propertyId)).get();
    return row?.lotNumber ?? null;
  };
  const inside = passIsInside(pass);
  if (
    !inside &&
    (pass.status === "revoked" || pass.status === "denied" || pass.status === "completed" || pass.status === "expired")
  ) {
    return {
      held: true,
      passId: pass.id,
      guestName: pass.guestName,
      guestDni: pass.guestDni,
      lotNumber: await lotOf(pass.propertyId),
      reason: pass.status === "expired" ? "expired" : "closed",
      denied: true,
      validFrom: pass.validFrom,
      validUntil: pass.validUntil,
      horaDesde: pass.horaDesde,
      horaHasta: pass.horaHasta,
    };
  }

  const now = input.at ?? new Date();
  const window = passWindowState(pass, now);
  const scanChannel = normalizeScanChannel(input.scanChannel, input.deviceId);
  const presence = await passPresence(pass);
  let sentido: "in" | "out" = inside ? "out" : "in";
  let reentry = pass.status === "temp_out";
  if (inside && presence.anyTempOut) {
    const laneIn = scanChannel === "totem" && input.sentido === "in";
    if (input.personPresence === "out_temp" || (input.personPresence !== "in" && laneIn)) {
      sentido = "in";
      reentry = true;
    }
  }
  const overstay = sentido === "out" && window === "expired";
  const deviceName = await deviceNameOf(input.deviceId);
  const scannedByName = await userNameOf(input.scannedByUserId);
  const channelLabel = scanChannelLabel(scanChannel, deviceName);
  const qrHint = qrHintOf(pass.token, pass.dahuaCardNo);
  const lotNumber = await lotOf(pass.propertyId);

  // Vencido / todavía no vale al ENTRAR: deny duro, historial, sin cola ni aprobar.
  // Solo al vencer se baja el v_ del ASI y status=expired (too_early conserva el pase).
  // Quien ya está adentro sale igual (overstay); si queda gente adentro no se vence el pase.
  if (sentido === "in" && (window === "expired" || window === "too_early")) {
    if (window === "expired" && !inside) await expireVisitPassOnSite(input.siteId, pass);
    const eventId = nid();
    const reason = window === "too_early" ? "too_early" : "expired";
    const denyPayload = {
      passId: pass.id,
      sentido,
      reason,
      guestName: pass.guestName,
      guestDni: pass.guestDni,
      qrHint,
      lotNumber,
      validFrom: pass.validFrom,
      validUntil: pass.validUntil,
      horaDesde: pass.horaDesde,
      horaHasta: pass.horaHasta,
      expired: reason === "expired",
      denied: true,
      scanChannel,
      scanChannelLabel: channelLabel,
      scannedByName,
      accessKind: "visita" as const,
      photoStored: false,
    };
    await db.insert(events).values({
      id: eventId,
      siteId: input.siteId,
      type: "visit_hold",
      sentido,
      laneCode: laneCodeOf(sentido),
      payload: JSON.stringify(denyPayload),
      createdAt: now,
    });
    broadcastRealtimeEvent({
      id: eventId,
      siteId: input.siteId,
      tenantId: input.tenantId ?? undefined,
      type: "visit_hold",
      payload: denyPayload,
      createdAt: now.getTime(),
    });
    return {
      held: true,
      passId: pass.id,
      reason,
      guestName: pass.guestName,
      guestDni: pass.guestDni,
      lotNumber,
      sentido,
      qrHint,
      scanChannel,
      scanChannelLabel: channelLabel,
      scannedByName,
      eventId,
      denied: true,
      validFrom: pass.validFrom,
      validUntil: pass.validUntil,
      horaDesde: pass.horaDesde,
      horaHasta: pass.horaHasta,
    };
  }

  const missing = reentry ? [] : await missingVisitFields(pass.id, sentido);
  const reason = missing.length ? "incomplete" : "ok";
  const nextStatus = reentry ? pass.status : sentido === "out" ? "awaiting_exit" : "awaiting_entry";
  const initialMinors = reentry ? pass.minorsOutTemp ?? 0 : sentido === "out" ? pass.minorsInCount ?? 0 : 0;
  const readerSentido =
    scanChannel === "totem" && (input.sentido === "in" || input.sentido === "out") ? input.sentido : null;

  const existing = await db
    .select()
    .from(guardApprovals)
    .where(and(eq(guardApprovals.passId, pass.id), eq(guardApprovals.status, "pending")))
    .get();
  let approvalId = existing?.id;
  if (!existing) {
    approvalId = nid();
    await db.insert(guardApprovals).values({
      id: approvalId,
      siteId: input.siteId,
      passId: pass.id,
      sentido,
      reason,
      status: "pending",
      trunkChecked: false,
      comment: null,
      guardUserId: null,
      deviceId: input.deviceId || null,
      scanChannel,
      scannedByUserId: input.scannedByUserId || null,
      readerSentido,
      minorsCount: initialMinors,
      reentry,
      createdAt: now,
      decidedAt: null,
    });
  } else {
    const flipped = existing.sentido !== sentido || Boolean(existing.reentry) !== reentry;
    await db
      .update(guardApprovals)
      .set({
        reason,
        sentido,
        reentry,
        ...(flipped ? { minorsCount: initialMinors, exitPeople: null, returns: false } : {}),
        deviceId: input.deviceId || existing.deviceId,
        scanChannel: existing.scanChannel || scanChannel,
        scannedByUserId: existing.scannedByUserId || input.scannedByUserId || null,
        readerSentido: existing.readerSentido || readerSentido,
      })
      .where(eq(guardApprovals.id, existing.id));
    const age = now.getTime() - (existing.createdAt instanceof Date ? existing.createdAt.getTime() : Number(existing.createdAt) || 0);
    if (age >= 0 && age < HOLD_DEBOUNCE_MS) {
      const lotNumber = await lotOf(pass.propertyId);
      return {
        held: true,
        passId: pass.id,
        approvalId,
        reason,
        guestName: pass.guestName,
        guestDni: pass.guestDni,
        lotNumber,
        sentido,
        qrHint,
        scanChannel,
        scanChannelLabel: channelLabel,
        scannedByName,
        deduped: true,
        reentry,
        overstay,
      };
    }
  }

  if (pass.status !== nextStatus && pass.status !== "completed") {
    await db.update(visitPasses).set({ status: nextStatus }).where(eq(visitPasses.id, pass.id));
    await syncVisitRecordFromPass({ ...pass, status: nextStatus });
  }

  const property = await db.select().from(properties).where(eq(properties.id, pass.propertyId)).get();
  const contact = await ownerContactForProperty(pass.propertyId);
  const eventId = nid();
  const holdPayload = {
    passId: pass.id,
    approvalId,
    sentido,
    reason,
    guestName: pass.guestName,
    guestDni: pass.guestDni,
    qrHint,
    lotNumber: property?.lotNumber,
    arrivalMode: pass.arrivalMode,
    missing,
    expired: false,
    scanChannel,
    scanChannelLabel: channelLabel,
    scannedByName,
    readerSentido,
    accessKind: "visita" as const,
    dwellLabel: dwellLabel(pass.scannedInAt),
    minorsInCount: pass.minorsInCount ?? 0,
    reentry,
    overstay,
    photoStored: false,
  };
  await db.insert(events).values({
    id: eventId,
    siteId: input.siteId,
    type: "visit_hold",
    sentido,
    laneCode: laneCodeOf(sentido),
    payload: JSON.stringify(holdPayload),
    createdAt: now,
  });
  broadcastRealtimeEvent({
    id: eventId,
    siteId: input.siteId,
    tenantId: input.tenantId ?? undefined,
    type: "visit_hold",
    payload: {
      ...holdPayload,
      ownerPhone: contact.ownerPhone,
    },
    createdAt: now.getTime(),
  });

  if (input.notifyLot !== false && input.tenantId && existing?.reason !== "walk_in" && sentido === "in" && !reentry) {
    const dup = await db
      .select({ id: ownerNotices.id })
      .from(ownerNotices)
      .where(
        and(
          eq(ownerNotices.passId, pass.id),
          eq(ownerNotices.kind, "visit_qr"),
          eq(ownerNotices.status, "pending"),
        ),
      )
      .get();
    if (!dup) {
      const until =
        pass.validUntil instanceof Date ? pass.validUntil.getTime() : Number(pass.validUntil) || 0;
      const remaining = until ? until - now.getTime() : 3_600_000;
      const ttlMs = Math.max(60_000, Math.min(3_600_000, Number.isFinite(remaining) ? remaining : 3_600_000));
      const lot = property?.lotNumber || "";
      await createOwnerNotice({
        siteId: input.siteId,
        tenantId: input.tenantId,
        propertyId: pass.propertyId,
        passId: pass.id,
        approvalId: approvalId || null,
        kind: "visit_qr",
        title: "Visita en portería",
        message: `${pass.guestName} llegó a portería (QR). Lote ${lot || "—"}. Lectura: ${channelLabel}. Portería abre.`,
        payload: { guestName: pass.guestName, lotNumber: lot || null, scanChannel, scanChannelLabel: channelLabel },
        ttlMs,
      });
    }
  }

  if (scanChannel === "totem" && input.tenantId) {
    void notifyStaff({
      tenantId: input.tenantId,
      title: sentido === "out" ? "Visita en salida" : reentry ? "Visita reingresa" : "Visita en tótem",
      message: `${pass.guestName}${property?.lotNumber ? ` · lote ${property.lotNumber}` : ""} · ${channelLabel}`,
      data: {
        type: "visit_hold",
        passId: pass.id,
        approvalId: approvalId || "",
        sentido,
      },
    });
  }

  return {
    held: true,
    passId: pass.id,
    approvalId,
    reason,
    guestName: pass.guestName,
    guestDni: pass.guestDni,
    lotNumber: property?.lotNumber ?? null,
    sentido,
    qrHint,
    scanChannel,
    scanChannelLabel: channelLabel,
    scannedByName,
    eventId,
    reentry,
    overstay,
  };
}

async function patchVisitLaneEvent(input: {
  siteId: string;
  tenantId: string;
  passId: string;
  approvalId: string;
  guestName: string;
  guestDni?: string | null;
  qrHint?: string | null;
  lotNumber?: string | null;
  visitStatus: "approved" | "denied";
  decidedAt: Date;
  decidedByUserId: string;
  approvedVia?: string | null;
  openedVia?: OpenVia | null;
  visitKind?: string | null;
  scanChannel?: string | null;
  scanChannelLabel?: string | null;
  /** Aprobado según la regla sin pulsar el relé. */
  noBarrier?: boolean;
}): Promise<boolean> {
  const guard = await db.select().from(users).where(eq(users.id, input.decidedByUserId)).get();
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.siteId, input.siteId), inArray(events.type, ["dahua_access", "qr_access"])))
    .orderBy(desc(events.createdAt))
    .limit(40);
  let target: { row: typeof rows[number]; payload: Record<string, unknown> } | null = null;
  for (const row of rows) {
    let p: Record<string, unknown> = {};
    try {
      p = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    const passHit =
      String(p.visitPassId ?? p.passId ?? "") === input.passId ||
      String(p.approvalId ?? "") === input.approvalId;
    if (!passHit) continue;
    target = { row, payload: p };
    break;
  }
  if (!target) return false;
  const approved = input.visitStatus === "approved";
  const payload: Record<string, unknown> = {
    ...target.payload,
    guestName: input.guestName,
    personName: input.guestName,
    guestDni: input.guestDni ?? target.payload.guestDni ?? null,
    qrHint: input.qrHint ?? target.payload.qrHint ?? null,
    lotNumber: input.lotNumber ?? target.payload.lotNumber ?? null,
    accessKind: "visita",
    visitHold: !approved,
    visitPassId: input.passId,
    approvalId: input.approvalId,
    guardApproved: approved,
    approved,
    visitStatus: input.visitStatus,
    approvedAt: input.decidedAt.getTime(),
    approvedByName: guard?.name || null,
    approvedVia: input.approvedVia ?? "login",
    openedVia: input.openedVia ?? target.payload.openedVia ?? null,
    openedViaLabel: openViaLabel(input.openedVia) ?? target.payload.openedViaLabel ?? null,
    visitKind: input.visitKind ?? target.payload.visitKind ?? null,
    scanChannel: input.scanChannel ?? target.payload.scanChannel ?? null,
    scanChannelLabel: input.scanChannelLabel ?? target.payload.scanChannelLabel ?? null,
    ...(input.noBarrier ? { noBarrier: true, barrierOpened: false } : {}),
  };
  await db.update(events).set({ payload: JSON.stringify(payload) }).where(eq(events.id, target.row.id));
  const createdAt =
    target.row.createdAt instanceof Date
      ? target.row.createdAt.getTime()
      : Number(target.row.createdAt) || input.decidedAt.getTime();
  broadcastRealtimeEvent({
    id: target.row.id,
    siteId: input.siteId,
    tenantId: input.tenantId,
    type: target.row.type,
    payload,
    createdAt,
  });
  return true;
}

/** Sin pulso no hay evento Method 4 del ASI: la tarjeta del carril se crea acá con los datos de la visita. */
async function insertNoBarrierCard(input: {
  siteId: string;
  tenantId: string;
  sentido: "in" | "out";
  ctx: OpenContext;
  qrHint?: string | null;
  scanChannelLabel?: string | null;
  at: Date;
}) {
  const id = nid();
  const payload: Record<string, unknown> = {
    ...openContextPayload(input.ctx, input.at.getTime()),
    remoteOpen: false,
    noBarrier: true,
    barrierOpened: false,
    qrHint: input.qrHint ?? null,
    scanChannelLabel: input.scanChannelLabel ?? null,
    sentido: input.sentido,
  };
  await db.insert(events).values({
    id,
    siteId: input.siteId,
    type: "qr_access",
    sentido: input.sentido,
    laneCode: laneCodeOf(input.sentido),
    payload: JSON.stringify(payload),
    createdAt: input.at,
  });
  broadcastRealtimeEvent({
    id,
    siteId: input.siteId,
    tenantId: input.tenantId,
    type: "qr_access",
    payload,
    createdAt: input.at.getTime(),
  });
}

async function openForVisit(
  site: { id: string; lastSeenAt: Date | number | null },
  sentido: "in" | "out",
  deviceId?: string | null,
  ctx?: OpenContext,
) {
  const fired: string[] = [];
  const errors: string[] = [];
  const wired = deviceId ? await actuatorsForDahuaDevice(site.id, deviceId) : [];
  const byLane = await actuatorsForSentido(site.id, sentido);
  const targets = wired.length ? wired : byLane;
  if (!targets.length) {
    return { fired, error: "No hay relé cableado a ese punto o carril" };
  }
  for (const a of targets) {
    const r = await fireActuator(site, a.id, "open", ctx);
    if (r.ok) fired.push(a.name);
    else if (r.error) errors.push(`${a.name}: ${r.error}`);
  }
  return { fired, error: fired.length ? undefined : errors[0] || "El relé no pulsó" };
}

export async function decideGuardApproval(input: {
  site: { id: string; tenantId: string; lastSeenAt: Date | number | null };
  approvalId: string;
  guardUserId: string;
  decision: "approved" | "denied";
  comment?: string | null;
  trunkChecked?: boolean;
  /** Quién cruza (salida parcial o reingreso). Sin dato: todos los que están adentro / afuera temporalmente. */
  exitPeople?: ExitPeople | null;
  /** Salida con "Sale y vuelve". */
  returns?: boolean;
  /** Desde dónde aprobó el guardia (app o dashboard). */
  openedVia?: OpenVia;
  /** «Abrir igual»: pulsa el relé aunque la regla diga que no abre. */
  open?: boolean;
}): Promise<
  { ok: true; actuatorsFired?: string[]; barrierOpened?: boolean } | { ok: false; error: string; missing?: string[] }
> {
  const row = await db
    .select()
    .from(guardApprovals)
    .where(and(eq(guardApprovals.id, input.approvalId), eq(guardApprovals.siteId, input.site.id)))
    .get();
  if (!row) return { ok: false, error: "No hay una solicitud de aprobación" };
  if (row.status !== "pending") return { ok: false, error: "Esa solicitud ya se resolvió" };
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, row.passId)).get();
  if (!pass) return { ok: false, error: "El pase ya no existe" };
  const isOut = row.sentido === "out";
  const isReentry = !isOut && Boolean(row.reentry);

  const now = new Date();
  if (input.decision === "denied" && (isOut || isReentry)) {
    // Negar una salida o un reingreso no cierra el pase: la gente sigue donde estaba.
    const pr = await passPresence(pass);
    const back = isOut || pr.anyInside ? "in_site" : "temp_out";
    await db
      .update(guardApprovals)
      .set({
        status: "denied",
        comment: mergeComment(row.comment, input.comment),
        guardUserId: input.guardUserId,
        approvedVia: "login",
        decidedAt: now,
      })
      .where(eq(guardApprovals.id, row.id));
    await db.update(visitPasses).set({ status: back }).where(eq(visitPasses.id, pass.id));
    broadcastRealtimeEvent({
      id: nid(),
      siteId: input.site.id,
      tenantId: input.site.tenantId,
      type: "visit_hold",
      payload: { passId: pass.id, approvalId: row.id, decided: "denied", sentido: row.sentido },
      createdAt: now.getTime(),
    });
    return { ok: true };
  }
  if (input.decision === "denied") {
    await db
      .update(guardApprovals)
      .set({
        status: "denied",
        comment: mergeComment(row.comment, input.comment),
        trunkChecked: Boolean(input.trunkChecked),
        guardUserId: input.guardUserId,
        approvedVia: "login",
        decidedAt: now,
      })
      .where(eq(guardApprovals.id, row.id));
    await db.update(visitPasses).set({ status: "denied" }).where(eq(visitPasses.id, pass.id));
    if (pass.visitRecordId) {
      await db.update(visitRecords).set({ status: "denied" }).where(eq(visitRecords.id, pass.visitRecordId));
    }
    const deniedLot = await db.select().from(properties).where(eq(properties.id, pass.propertyId)).get();
    await patchVisitLaneEvent({
      siteId: input.site.id,
      tenantId: input.site.tenantId,
      passId: pass.id,
      approvalId: row.id,
      guestName: pass.guestName,
      guestDni: pass.guestDni,
      qrHint: qrHintOf(pass.token, pass.dahuaCardNo),
      lotNumber: deniedLot?.lotNumber ?? null,
      visitStatus: "denied",
      decidedAt: now,
      decidedByUserId: input.guardUserId,
      approvedVia: "login",
      scanChannel: row.scanChannel,
      scanChannelLabel: scanChannelLabel(row.scanChannel, await deviceNameOf(row.deviceId)),
    });
    broadcastRealtimeEvent({
      id: nid(),
      siteId: input.site.id,
      tenantId: input.site.tenantId,
      type: "visit_hold",
      payload: { passId: pass.id, approvalId: row.id, decided: "denied", sentido: row.sentido },
      createdAt: now.getTime(),
    });
    return { ok: true };
  }

  // Vigencia solo al entrar: quien ya está adentro sale aunque se haya pasado del horario.
  if (!isOut) {
    if (row.reason === "expired" || row.reason === "too_early") {
      return { ok: false, error: "El pase está vencido o fuera de vigencia. Solo se puede denegar." };
    }
    const windowNow = passWindowState(pass);
    if (windowNow === "expired" || windowNow === "too_early") {
      return { ok: false, error: "El pase está vencido o fuera de vigencia. Solo se puede denegar." };
    }
    if (!isReentry && pass.visitKind !== "social") {
      if ((row.minorsCount ?? 0) > 0) return { ok: false, error: MINORS_KIND_ERROR };
      if (await passGuestIsMinor(pass)) return { ok: false, error: MINOR_KIND_ERROR };
    }
  }

  const pr = await passPresence(pass);
  const rule = await ruleForPass(pass);
  const vehicleMode = needsVehicleDocs(pass.arrivalMode);
  const crossing: Presence = isOut ? "in" : "out_temp";
  const defaults: ExitPeople = {
    guest: pr.guest === crossing,
    companionIds: pr.companions.filter((c) => c.presence === crossing).map((c) => c.id),
    vehicle: vehicleMode && pr.guest === crossing,
  };
  const asked = input.exitPeople ?? parseExitPeople(row.exitPeople) ?? defaults;
  const people: ExitPeople = {
    guest: asked.guest && pr.guest === crossing,
    companionIds: asked.companionIds.filter((id) => pr.companions.some((c) => c.id === id && c.presence === crossing)),
    vehicle: vehicleMode && asked.vehicle,
  };
  const overstayNow = isOut && passWindowState(pass) === "expired";
  if (overstayNow && input.returns === true) {
    return { ok: false, error: "Se pasó del horario: la salida es definitiva. Para volver necesita una nueva autorización." };
  }
  const returns = isOut && !overstayNow && Boolean(input.returns ?? row.returns);
  if ((isOut || isReentry) && !people.guest && !people.companionIds.length) {
    return { ok: false, error: isOut ? "Marcá quién sale" : "Marcá quién vuelve a entrar" };
  }

  if (isReentry) {
    const gaps = await visitFieldGaps(pass.id, "in");
    const expiredNow = people.vehicle ? gaps.expired : gaps.expired.filter((k) => k !== "seguro_vehiculo" && k !== "licencia");
    if (expiredNow.length) {
      return {
        ok: false,
        error: canSwitchToPedestrian(expiredNow)
          ? "Documento vencido: no puede volver a entrar con el vehículo. Puede dejarlo afuera y pasar a pie."
          : "Documento vencido: no puede volver a entrar.",
        missing: expiredNow.map(expiredKeyLabel),
      };
    }
    if (people.vehicle && rule.items.baul) {
      const t = await trunkCheckOf(pass.id, "in");
      const ok = t && t.approvalId === row.id && (String(t.description || "").trim() || trunkPhotoIdsOf(t).length);
      if (!ok) return { ok: false, error: "Revisá el baúl antes de abrir el reingreso", missing: ["baul"] };
    }
  }

  if (row.reason === "walk_in" && !isReentry) {
    if (row.ownerAuthStatus === "owner_denied") {
      return { ok: false, error: "El titular rechazó. Denegá el paso o pedí otra autorización." };
    }
    if (row.ownerAuthStatus !== "owner_approved") {
      return {
        ok: false,
        error: "El titular tiene que autorizar en el portal o por llamada, con tu código de guardia",
      };
    }
  }

  const sentidoRow = row.sentido === "out" ? "out" : "in";
  const gaps: VisitFieldGaps = isReentry ? { missing: [], expired: [] } : await visitFieldGaps(pass.id, sentidoRow);
  // Vencido no pasa, sin excepción del titular ni autorización verbal.
  if (gaps.expired.length) {
    return {
      ok: false,
      error: canSwitchToPedestrian(gaps.expired)
        ? "Documento vencido: no puede ingresar con el vehículo. Puede dejarlo afuera y pasar a pie."
        : "Documento vencido: no puede ingresar.",
      missing: gaps.expired.map(expiredKeyLabel),
    };
  }
  if (gaps.missing.length) return { ok: false, error: "Faltan datos obligatorios", missing: gaps.missing };
  const trunkTicked = Boolean(input.trunkChecked || row.trunkChecked);
  if (isOut && people.vehicle && rule.items.baul && !trunkTicked) {
    return { ok: false, error: "Hay que revisar el baúl antes de abrir la salida", missing: ["baul"] };
  }

  const inCount = pass.minorsInCount ?? 0;
  const crossMinors = Math.max(0, row.minorsCount ?? row.exitMinorsCount ?? 0);
  if (isOut) {
    if (row.goodsAlert && !row.goodsAuthorizedByUserId) {
      const denied = (await goodsNoticeOf(row.id))?.status === "denied";
      return {
        ok: false,
        error: denied
          ? "El lote rechazó el bien: sale sin él o denegá"
          : "Sale con un bien: el lote tiene que autorizarlo (o confirmá con tu código de guardia)",
      };
    }
    const outCount = crossMinors;
    const adultsRemain =
      (pr.guest === "in" && !people.guest) ||
      pr.companions.some((c) => c.presence === "in" && !people.companionIds.includes(c.id));
    // Salida parcial: pueden quedar menores con los adultos que siguen adentro; solos no.
    const mismatch = outCount > inCount || (!adultsRemain && outCount !== inCount);
    if (mismatch) {
      if (!row.minorsMismatchNotified) {
        return {
          ok: false,
          error: `Ingresaron ${inCount} menor(es) y ahora salen ${outCount}. Avisá al lote antes de abrir.`,
        };
      }
      if (outCount > inCount && !row.minorTransferAuthorizedByUserId) {
        return {
          ok: false,
          error: "Salen más menores de los que ingresaron. Esperá autorización del lote de donde está saliendo.",
        };
      }
    }
  }

  const property = await db.select().from(properties).where(eq(properties.id, pass.propertyId)).get();
  const approvedByName = await userNameOf(input.guardUserId);
  const record = pass.visitRecordId
    ? await db.select().from(visitRecords).where(eq(visitRecords.id, pass.visitRecordId)).get()
    : null;
  const openCtx: OpenContext = {
    reason: "visit",
    openedByUserId: input.guardUserId,
    openedByName: approvedByName,
    openedVia: input.openedVia ?? null,
    passId: pass.id,
    approvalId: row.id,
    guestName: pass.guestName,
    guestDni: pass.guestDni,
    lotNumber: property?.lotNumber ?? null,
    visitKind: canonicalVisitKind(pass.visitKind),
    arrivalMode: pass.arrivalMode,
    plate: pass.patente,
    authorizedBy: record?.authorizedBy || null,
    sentido: row.sentido as "in" | "out",
    reentry: isReentry,
  };
  // La regla decide si aprobar pulsa el relé; a pie por defecto se registra sin abrir.
  const barrier = rule.openBarrier || input.open === true;
  const pulse = barrier
    ? await openForVisit(input.site, row.sentido as "in" | "out", row.deviceId, openCtx)
    : { fired: [] as string[], error: undefined };
  if (barrier && !pulse.fired.length) {
    return { ok: false, error: pulse.error || "No se pudo pulsar el relé. Revisá el agent y el cableado." };
  }

  const patch: Partial<typeof visitPasses.$inferInsert> = {};
  let nextStatus: string;
  if (isOut) {
    const moved: Presence = returns ? "out_temp" : "out";
    const guestAfter = people.guest ? moved : pr.guest;
    const compsAfter = pr.companions.map((c) => (people.companionIds.includes(c.id) ? moved : c.presence));
    const anyInAfter = guestAfter === "in" || compsAfter.includes("in");
    const anyTempAfter = guestAfter === "out_temp" || compsAfter.includes("out_temp");
    nextStatus = anyInAfter ? "in_site" : anyTempAfter ? "temp_out" : "completed";
    patch.guestPresence = guestAfter;
    patch.minorsInCount = Math.max(0, inCount - crossMinors);
    if (returns) patch.minorsOutTemp = (pass.minorsOutTemp ?? 0) + crossMinors;
    if (people.companionIds.length) {
      await db
        .update(visitCompanions)
        .set({ presence: moved })
        .where(inArray(visitCompanions.id, people.companionIds));
    }
    if (nextStatus === "completed") {
      patch.scannedOutAt = now;
      patch.minorsOutTemp = 0;
      if (!pass.scannedInAt) patch.scannedInAt = now;
    }
  } else if (isReentry) {
    nextStatus = "in_site";
    if (people.guest) patch.guestPresence = "in";
    if (people.companionIds.length) {
      await db
        .update(visitCompanions)
        .set({ presence: "in" })
        .where(inArray(visitCompanions.id, people.companionIds));
    }
    patch.minorsInCount = inCount + crossMinors;
    patch.minorsOutTemp = Math.max(0, (pass.minorsOutTemp ?? 0) - crossMinors);
  } else {
    nextStatus = "in_site";
    patch.scannedInAt = pass.scannedInAt ?? now;
    patch.minorsInCount = row.minorsCount ?? 0;
    patch.guestPresence = "in";
    await db.update(visitCompanions).set({ presence: "in" }).where(eq(visitCompanions.passId, pass.id));
  }
  patch.status = nextStatus;

  await db.update(visitPasses).set(patch).where(eq(visitPasses.id, pass.id));
  await syncVisitRecordFromPass({ ...pass, ...patch, status: nextStatus });
  if (nextStatus === "completed") void releaseVisitCredential(input.site.id, pass.id);
  await db
    .update(guardApprovals)
    .set({
      status: "approved",
      comment: mergeComment(row.comment, input.comment),
      trunkChecked: trunkTicked,
      guardUserId: input.guardUserId,
      approvedVia: "login",
      decidedAt: now,
      exitPeople: isOut || isReentry ? JSON.stringify(people) : null,
      returns,
    })
    .where(eq(guardApprovals.id, row.id));

  if ((isOut && returns) || isReentry) {
    const names = [
      ...(people.guest ? [pass.guestName] : []),
      ...pr.companions.filter((c) => people.companionIds.includes(c.id)).map((c) => c.name),
    ];
    const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}` : names[0] || pass.guestName;
    const plural = names.length > 1;
    const minorsTxt = crossMinors ? ` con ${crossMinors} menor${crossMinors === 1 ? "" : "es"}` : "";
    await createOwnerNotice({
      siteId: input.site.id,
      tenantId: input.site.tenantId,
      propertyId: pass.propertyId,
      passId: pass.id,
      approvalId: row.id,
      kind: "visit_info",
      title: isOut ? "Visita salió y vuelve" : "Visita volvió a ingresar",
      message: isOut
        ? `${who}${minorsTxt} ${plural ? "salieron" : "salió"}, ${plural ? "vuelven" : "vuelve"}.`
        : `${who}${minorsTxt} ${plural ? "volvieron" : "volvió"} a ingresar.`,
      payload: { guestName: pass.guestName, names, minors: crossMinors, returns: isOut },
      ttlMs: 3_600_000,
    });
  }

  const channelLabel = scanChannelLabel(row.scanChannel, await deviceNameOf(row.deviceId));
  const qrHint = qrHintOf(pass.token, pass.dahuaCardNo);
  await db.insert(events).values({
    id: nid(),
    siteId: input.site.id,
    type: "visit_scan",
    sentido: row.sentido as "in" | "out",
    laneCode: laneCodeOf(row.sentido as "in" | "out"),
    payload: JSON.stringify({
      passId: pass.id,
      approvalId: row.id,
      guestName: pass.guestName,
      guestDni: pass.guestDni,
      qrHint,
      lotNumber: property?.lotNumber,
      actuatorsFired: pulse.fired,
      barrierOpened: barrier,
      accessKind: "visita",
      guardApproved: true,
      approvedByName,
      approvedVia: "login",
      openedVia: input.openedVia ?? null,
      openedViaLabel: openViaLabel(input.openedVia),
      visitKind: canonicalVisitKind(pass.visitKind),
      scanChannel: row.scanChannel,
      scanChannelLabel: channelLabel,
      reentry: isReentry,
      returns,
      overstay: isOut && passWindowState(pass, now) === "expired",
    }),
    createdAt: now,
  });
  const patched = await patchVisitLaneEvent({
    siteId: input.site.id,
    tenantId: input.site.tenantId,
    passId: pass.id,
    approvalId: row.id,
    guestName: pass.guestName,
    guestDni: pass.guestDni,
    qrHint,
    lotNumber: property?.lotNumber ?? null,
    visitStatus: "approved",
    decidedAt: now,
    decidedByUserId: input.guardUserId,
    approvedVia: "login",
    openedVia: input.openedVia ?? null,
    visitKind: canonicalVisitKind(pass.visitKind),
    scanChannel: row.scanChannel,
    scanChannelLabel: channelLabel,
    noBarrier: !barrier,
  });
  if (!barrier && !patched) {
    await insertNoBarrierCard({
      siteId: input.site.id,
      tenantId: input.site.tenantId,
      sentido: row.sentido as "in" | "out",
      ctx: openCtx,
      qrHint,
      scanChannelLabel: channelLabel,
      at: now,
    });
  }
  broadcastRealtimeEvent({
    id: nid(),
    siteId: input.site.id,
    tenantId: input.site.tenantId,
    type: "visit_hold",
    payload: { passId: pass.id, approvalId: row.id, decided: "approved", sentido: row.sentido },
    createdAt: now.getTime(),
  });
  const qrNotice = await db
    .select()
    .from(ownerNotices)
    .where(and(eq(ownerNotices.passId, pass.id), eq(ownerNotices.kind, "visit_qr")))
    .orderBy(desc(ownerNotices.createdAt))
    .get();
  if (qrNotice && !isOut && !isReentry) {
    let extra: Record<string, unknown> = {};
    try {
      extra = qrNotice.payload ? (JSON.parse(qrNotice.payload) as Record<string, unknown>) : {};
    } catch {
      extra = {};
    }
    extra.approvedByName = approvedByName;
    extra.approvedVia = "login";
    extra.scanChannelLabel = channelLabel;
    await db
      .update(ownerNotices)
      .set({
        payload: JSON.stringify(extra),
        message: `${qrNotice.message} ${barrier ? "Abrió" : "Registró el ingreso"} ${approvedByName || "portería"} (${channelLabel}).`,
      })
      .where(eq(ownerNotices.id, qrNotice.id));
  }
  return { ok: true, actuatorsFired: pulse.fired, barrierOpened: barrier };
}

export async function serializePassFicha(
  passId: string,
  row?: typeof guardApprovals.$inferSelect | null,
) {
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, passId)).get();
  if (!pass) return null;
  const property = await db.select().from(properties).where(eq(properties.id, pass.propertyId)).get();
  const contact = await ownerContactForProperty(pass.propertyId);
  const visitRecord = pass.visitRecordId
    ? await db.select().from(visitRecords).where(eq(visitRecords.id, pass.visitRecordId)).get()
    : null;
  const companions = await listCompanions(pass.id);
  const guestBirthDate = await guestBirthDateOf(pass, visitRecord?.personId);
  const awaitingOut = passIsInside(pass);
  const sentidoNow: "in" | "out" = row?.sentido === "out" || (!row && awaitingOut) ? "out" : "in";
  const reentry = row ? Boolean(row.reentry) && sentidoNow === "in" : pass.status === "temp_out";
  const gaps = reentry
    ? { missing: [] as string[], expired: (await visitFieldGaps(pass.id, "in")).expired }
    : await visitFieldGaps(pass.id, sentidoNow);
  const missing = gaps.missing;
  const windowState = passWindowState(pass);
  const trunkNowRow = row ? await trunkCheckOf(pass.id, sentidoNow) : null;
  const rule = await ruleForPass(pass);
  const req = entryRuleSections(rule);
  const now = Date.now();
  let insurance: {
    id: string;
    company: string;
    policyNumber: string;
    validUntil: Date | number;
    cardPhotoUrl?: string | null;
    hasPhoto: boolean;
    expired: boolean;
  } | null = null;
  const insRow = await linkedVehicleInsurance(pass);
  if (insRow) {
    insurance = {
      id: insRow.id,
      company: insRow.company,
      policyNumber: insRow.policyNumber,
      validUntil: insRow.validUntil,
      cardPhotoUrl: insRow.cardPhotoUrl,
      hasPhoto: Boolean(insRow.cardPhotoUrl),
      expired: isPast(insRow.validUntil, now),
    };
  }
  let personInsurance: {
    id: string;
    kind: string;
    company: string | null;
    validUntil: Date | number;
    hasDocument: boolean;
    expired: boolean;
  } | null = null;
  if (pass.personInsuranceId) {
    const pi = await db.select().from(personInsurances).where(eq(personInsurances.id, pass.personInsuranceId)).get();
    if (pi) {
      personInsurance = {
        id: pi.id,
        kind: pi.kind,
        company: pi.company,
        validUntil: pi.validUntil,
        hasDocument: Boolean(pi.documentPath),
        expired: isPast(pi.validUntil, now),
      };
    }
  }
  let license: { id: string; licenseNumber: string; validUntil: Date | number; hasPhoto: boolean; expired: boolean } | null = null;
  if (pass.licenseId) {
    const lic = await db.select().from(driverLicenses).where(eq(driverLicenses.id, pass.licenseId)).get();
    if (lic) {
      license = {
        id: lic.id,
        licenseNumber: lic.licenseNumber,
        validUntil: lic.validUntil,
        hasPhoto: Boolean(lic.photoUrl),
        expired: isPast(lic.validUntil, now),
      };
    }
  }
  const onFile = await docsOnFileForPass(pass);
  const trunkIn = await serializeTrunkCheck(await trunkCheckOf(pass.id, "in"));
  const trunkOut = await serializeTrunkCheck(await trunkCheckOf(pass.id, "out"));
  const pending = Boolean(row && row.status === "pending");
  const deviceName = await deviceNameOf(row?.deviceId);
  const channel = row?.scanChannel || null;
  const goodsNotice = row?.goodsAlert ? await goodsNoticeOf(row.id) : null;
  const goodsDenied = Boolean(row?.goodsAlert && !row.goodsAuthorizedByUserId && goodsNotice?.status === "denied");
  const goodsSince = goodsNotice?.createdAt ?? row?.createdAt ?? null;
  return {
    id: row?.id ?? `preview:${pass.id}`,
    pending,
    passId: pass.id,
    sentido: row?.sentido ?? (awaitingOut ? "out" : "in"),
    reason: row?.reason ?? "preview",
    status: row?.status ?? "preview",
    trunkChecked: Boolean(row?.trunkChecked),
    comment: row?.comment ?? null,
    createdAt: row?.createdAt ?? pass.createdAt,
    guestName: pass.guestName,
    guestDni: pass.guestDni,
    guestBirthDate,
    guestAge: yearsFromBirthDate(guestBirthDate),
    qrHint: qrHintOf(pass.token, pass.dahuaCardNo),
    scanChannel: channel,
    scanChannelLabel: scanChannelLabel(channel, deviceName),
    scannedByName: await userNameOf(row?.scannedByUserId),
    approvedByName: await userNameOf(row?.guardUserId),
    approvedVia: row?.approvedVia ?? null,
    phoneAuthVia: row?.phoneAuthVia ?? null,
    readerSentido: row?.readerSentido ?? null,
    laneMismatch: Boolean(row?.readerSentido && row.readerSentido !== (row?.sentido ?? (awaitingOut ? "out" : "in"))),
    minorsInCount: pass.minorsInCount ?? 0,
    minorsCount: row?.minorsCount ?? (awaitingOut ? pass.minorsInCount ?? 0 : 0),
    minorsMismatchNotified: Boolean(row?.minorsMismatchNotified),
    scannedInAt: pass.scannedInAt ?? null,
    dwellLabel: dwellLabel(pass.scannedInAt),
    patente: pass.patente,
    arrivalMode: pass.arrivalMode,
    visitKind: canonicalVisitKind(pass.visitKind),
    completeness: pass.completeness,
    passStatus: pass.status,
    validFrom: pass.validFrom,
    validUntil: pass.validUntil,
    horaDesde: pass.horaDesde,
    horaHasta: pass.horaHasta,
    windowState,
    overstay: sentidoNow === "out" && windowState === "expired",
    reentry,
    returns: Boolean(row?.returns),
    exitPeople: parseExitPeople(row?.exitPeople),
    guestPresence: presenceOf(pass.guestPresence),
    minorsOutTemp: pass.minorsOutTemp ?? 0,
    trunkThisRound: Boolean(trunkNowRow && row && trunkNowRow.approvalId === row.id),
    needsTrunk: req.trunk,
    needsArt: req.art,
    needsLicense: req.license,
    needsVehicle: req.vehicle,
    rule,
    missing,
    expiredDocs: gaps.expired,
    canSwitchToPedestrian: sentidoNow === "in" && canSwitchToPedestrian(gaps.expired),
    onFile,
    trunkIn,
    trunkOut,
    companions: companions.map((x) => ({
      id: x.id,
      name: x.name,
      dni: x.dni,
      birthDate: x.birthDate,
      isMinor: companionIsMinor(x),
      situation: x.situation,
      presence: presenceOf(x.presence),
    })),
    insurance,
    personInsurance,
    license,
    lotNumber: property?.lotNumber ?? null,
    propertyId: pass.propertyId,
    mapLat: property?.mapLat ?? null,
    mapLng: property?.mapLng ?? null,
    lotPolygon: property?.lotPolygon ?? null,
    ...contact,
    verbalAuthorizedBy: visitRecord?.authorizedBy?.trim() || null,
    ownerAuthStatus: row?.ownerAuthStatus ?? "none",
    ownerAuthExpiresAt: row?.ownerAuthExpiresAt ?? null,
    ownerAuthorizedByUserId: row?.ownerAuthorizedByUserId ?? null,
    ownerAuthorizedByName: row?.ownerAuthorizedByUserId
      ? ((await db.select({ name: users.name }).from(users).where(eq(users.id, row.ownerAuthorizedByUserId)).get())?.name ?? null)
      : null,
    goodsAlert: Boolean(row?.goodsAlert),
    goodsDescription: row?.goodsDescription ?? null,
    goodsPhotoPath: row?.goodsPhotoPath ?? null,
    goodsPhotoUrl: row?.goodsPhotoPath ? `/api/visitors/approvals/${row.id}/goods-photo` : null,
    goodsAuthorized: Boolean(row?.goodsAuthorizedByUserId),
    goodsAuthorizedByName: await userNameOf(row?.goodsAuthorizedByUserId),
    goodsDenied,
    goodsCallReady: Boolean(
      row?.goodsAlert &&
        !row.goodsAuthorizedByUserId &&
        !goodsDenied &&
        goodsSince != null &&
        Date.now() - (goodsSince instanceof Date ? goodsSince.getTime() : Number(goodsSince)) >= 30_000,
    ),
    exitAdultsCount: row?.exitAdultsCount ?? null,
    exitMinorsCount: row?.exitMinorsCount ?? null,
    originPropertyId: row?.originPropertyId ?? null,
    minorTransferAuthorized: Boolean(row?.minorTransferAuthorizedByUserId),
    needsPhoneAuth: Boolean(
      row &&
        row.status === "pending" &&
        (row.ownerAuthStatus === "pending_owner" ||
          row.ownerAuthStatus === "owner_expired" ||
          (row.goodsAlert && !row.goodsAuthorizedByUserId && !goodsDenied) ||
          (row.sentido === "out" &&
            (row.minorsCount ?? row.exitMinorsCount ?? 0) > (pass.minorsInCount ?? 0) &&
            !row.minorTransferAuthorizedByUserId)),
    ),
    minorsIn: pass.minorsInCount ?? 0,
    adultsIn:
      (presenceOf(pass.guestPresence) === "in" ? 1 : 0) +
      companions.filter((x) => !companionIsMinor(x) && presenceOf(x.presence) === "in").length,
    emergencies: [
      { label: "Policía / emergencias", phone: "911" },
      { label: "SAME", phone: "107" },
      { label: "Bomberos", phone: "100" },
    ],
  };
}

export async function serializeApproval(row: typeof guardApprovals.$inferSelect) {
  return serializePassFicha(row.passId, row);
}

export async function listPendingApprovals(siteId: string) {
  await expireOwnerNotices();
  const rows = await db
    .select()
    .from(guardApprovals)
    .where(and(eq(guardApprovals.siteId, siteId), eq(guardApprovals.status, "pending")))
    .orderBy(desc(guardApprovals.createdAt))
    .limit(40);
  const out = [];
  for (const row of rows) {
    const item = await serializeApproval(row);
    if (item) out.push(item);
  }
  return out;
}

export function isOpenVisitStatus(status: string) {
  return OPEN_STATUSES.has(status);
}

async function tenantIdOfSite(siteId: string) {
  return (await db.select({ tenantId: sites.tenantId }).from(sites).where(eq(sites.id, siteId)).get())?.tenantId ?? null;
}

function sameDay(a: Date | number | null | undefined, b: string | null | undefined) {
  if (a == null || !b) return false;
  const d1 = new Date(untilMs(a));
  const d2 = new Date(b);
  if (!Number.isFinite(d1.getTime()) || !Number.isFinite(d2.getTime())) return false;
  return d1.toISOString().slice(0, 10) === d2.toISOString().slice(0, 10);
}

/** Foto de documento (tarjeta de seguro, licencia): recorte en el server; si falla se guarda igual. */
async function saveDocPhoto(siteId: string, key: string, base64?: string | null): Promise<string | null> {
  if (!base64) return null;
  const raw = base64.replace(/^data:[\w/+.-]+;base64,/, "").trim();
  try {
    let buf = Buffer.from(raw, "base64");
    if (buf.length <= 80 || buf.length >= 4 * 1024 * 1024) return null;
    try {
      buf = Buffer.from((await processDocumentImage(buf)).jpeg);
    } catch {
      /* se guarda igual */
    }
    return saveVisitorDoc(siteId, key, "image/jpeg", buf);
  } catch {
    return null;
  }
}

export const MINOR_KIND_ERROR = "Menor de edad: solo puede ingresar como visita";
export const MINORS_KIND_ERROR = "Obra / servicio y delivery no ingresan con menores";

/** Nacimiento del invitado: ficha de identidad del registro o, si no hay, la del padrón por DNI. */
async function guestBirthDateOf(pass: { siteId: string; guestDni: string | null }, personId?: string | null) {
  if (personId) {
    const p = await db
      .select({ birthDate: visitorIdentities.birthDate })
      .from(visitorIdentities)
      .where(eq(visitorIdentities.id, personId))
      .get();
    if (p?.birthDate) return p.birthDate;
  }
  const tenantId = await tenantIdOfSite(pass.siteId);
  if (!tenantId) return null;
  return (await personByDni(tenantId, pass.guestDni))?.birthDate ?? null;
}

async function passGuestIsMinor(pass: typeof visitPasses.$inferSelect) {
  const rec = pass.visitRecordId
    ? await db.select({ personId: visitRecords.personId }).from(visitRecords).where(eq(visitRecords.id, pass.visitRecordId)).get()
    : null;
  return isMinorBirthDate(await guestBirthDateOf(pass, rec?.personId));
}

async function personByDni(tenantId: string, dniRaw: string | null | undefined) {
  const dni = String(dniRaw || "").replace(/\D/g, "");
  if (dni.length < 7) return null;
  return (
    (await db
      .select()
      .from(visitorIdentities)
      .where(and(eq(visitorIdentities.tenantId, tenantId), eq(visitorIdentities.dniNumber, dni)))
      .get()) ?? null
  );
}

export type DocOnFile = {
  id: string;
  kind?: string;
  company: string | null;
  policyNumber?: string | null;
  licenseNumber?: string | null;
  plate?: string | null;
  validUntil: Date | number;
  hasDocument: boolean;
  expired: boolean;
};

/** Último ART/licencia por DNI y último seguro por patente que todavía no están vinculados al pase. */
export async function docsOnFileForPass(pass: typeof visitPasses.$inferSelect) {
  const out: { art: DocOnFile | null; license: DocOnFile | null; insurance: DocOnFile | null } = {
    art: null,
    license: null,
    insurance: null,
  };
  const tenantId = await tenantIdOfSite(pass.siteId);
  if (!tenantId) return out;
  const now = Date.now();
  const person = await personByDni(tenantId, pass.guestDni);
  if (person) {
    const pi = await db
      .select()
      .from(personInsurances)
      .where(and(eq(personInsurances.tenantId, tenantId), eq(personInsurances.personId, person.id)))
      .orderBy(desc(personInsurances.validUntil))
      .get();
    if (pi && pi.id !== pass.personInsuranceId) {
      out.art = {
        id: pi.id,
        kind: pi.kind,
        company: pi.company,
        validUntil: pi.validUntil,
        hasDocument: Boolean(pi.documentPath),
        expired: isPast(pi.validUntil, now),
      };
    }
    const lic = await db
      .select()
      .from(driverLicenses)
      .where(and(eq(driverLicenses.tenantId, tenantId), eq(driverLicenses.personId, person.id)))
      .orderBy(desc(driverLicenses.validUntil))
      .get();
    if (lic && lic.id !== pass.licenseId) {
      out.license = {
        id: lic.id,
        company: null,
        licenseNumber: lic.licenseNumber,
        validUntil: lic.validUntil,
        hasDocument: Boolean(lic.photoUrl),
        expired: isPast(lic.validUntil, now),
      };
    }
  }
  const plate = normalizePlate(pass.patente || "");
  if (plate) {
    const veh = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.plate, plate)))
      .get();
    if (veh) {
      const ins = await db
        .select()
        .from(vehicleInsurances)
        .where(eq(vehicleInsurances.vehicleId, veh.id))
        .orderBy(desc(vehicleInsurances.validUntil))
        .get();
      if (ins && ins.id !== pass.insuranceId) {
        out.insurance = {
          id: ins.id,
          company: ins.company,
          policyNumber: ins.policyNumber,
          plate: veh.plate,
          validUntil: ins.validUntil,
          hasDocument: Boolean(ins.cardPhotoUrl),
          expired: isPast(ins.validUntil, now),
        };
      }
    }
  }
  return out;
}

export async function attachVehicleInsurance(
  tenantId: string,
  passId: string,
  input: {
    plate?: string;
    company?: string;
    policyNumber?: string;
    validUntil?: string;
    cardPhotoBase64?: string | null;
    reuseId?: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, passId)).get();
  if (!pass) return { ok: false, error: "El pase ya no existe" };

  const reuseId = String(input.reuseId || "").trim();
  if (reuseId) {
    const ins = await db
      .select()
      .from(vehicleInsurances)
      .where(and(eq(vehicleInsurances.id, reuseId), eq(vehicleInsurances.tenantId, tenantId)))
      .get();
    if (!ins) return { ok: false, error: "Ese seguro ya no está en archivo" };
    const veh = await db.select().from(vehicles).where(eq(vehicles.id, ins.vehicleId)).get();
    const photo = await saveDocPhoto(pass.siteId, `veh-ins-${ins.id}`, input.cardPhotoBase64);
    if (photo) await db.update(vehicleInsurances).set({ cardPhotoUrl: photo }).where(eq(vehicleInsurances.id, ins.id));
    await db
      .update(visitPasses)
      .set({ vehicleId: ins.vehicleId, insuranceId: ins.id, patente: veh?.plate ?? pass.patente, completeness: "full" })
      .where(eq(visitPasses.id, passId));
    return { ok: true };
  }

  const linked = await linkedVehicleInsurance(pass);
  const company = input.company?.trim() || "";
  const policy = input.policyNumber?.trim() || "";
  if (linked && input.cardPhotoBase64 && !company && !policy) {
    const photo = await saveDocPhoto(pass.siteId, `veh-ins-${linked.id}`, input.cardPhotoBase64);
    if (photo) await db.update(vehicleInsurances).set({ cardPhotoUrl: photo }).where(eq(vehicleInsurances.id, linked.id));
    return { ok: true };
  }
  const plate = normalizePlate(input.plate || pass.patente || "");
  if (!plate || !company || !policy || !input.validUntil) return { ok: true };
  const validUntilDate = new Date(input.validUntil);
  if (!Number.isFinite(validUntilDate.getTime())) return { ok: false, error: "Fecha de vencimiento del seguro inválida" };

  if (linked && linked.company === company && linked.policyNumber === policy && sameDay(linked.validUntil, input.validUntil)) {
    const photo = await saveDocPhoto(pass.siteId, `veh-ins-${linked.id}`, input.cardPhotoBase64);
    if (photo) await db.update(vehicleInsurances).set({ cardPhotoUrl: photo }).where(eq(vehicleInsurances.id, linked.id));
    if (pass.patente !== plate) await db.update(visitPasses).set({ patente: plate }).where(eq(visitPasses.id, passId));
    return { ok: true };
  }

  let vehicleId = pass.vehicleId;
  const plateVehicle = await db
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.plate, plate)))
    .get();
  if (plateVehicle) vehicleId = plateVehicle.id;
  else {
    vehicleId = nid();
    await db.insert(vehicles).values({
      id: vehicleId,
      tenantId,
      plate,
      brand: null,
      model: null,
      color: null,
      vehicleType: "car",
      notes: null,
      createdAt: new Date(),
    });
  }
  const insId = nid();
  const cardPhotoUrl = await saveDocPhoto(pass.siteId, `veh-ins-${insId}`, input.cardPhotoBase64);
  await db.insert(vehicleInsurances).values({
    id: insId,
    tenantId,
    vehicleId,
    company,
    policyNumber: policy,
    validFrom: null,
    validUntil: validUntilDate,
    coverageType: "responsabilidad_civil",
    cardPhotoUrl,
    verifiedBy: null,
    status: isPast(validUntilDate) ? "expired" : "active",
    createdAt: new Date(),
  });
  await db
    .update(visitPasses)
    .set({ vehicleId, insuranceId: insId, patente: plate, completeness: "full" })
    .where(eq(visitPasses.id, passId));
  return { ok: true };
}

async function ensurePersonForPass(tenantId: string, pass: typeof visitPasses.$inferSelect) {
  const dni = String(pass.guestDni || "").replace(/\D/g, "");
  if (!dni) return null;
  const existing = await personByDni(tenantId, dni);
  if (existing) return existing;
  const parts = String(pass.guestName || "").trim().split(/\s+/);
  const firstName = parts[0] || "Visita";
  const lastName = parts.slice(1).join(" ") || firstName;
  const now = new Date();
  const id = nid();
  await db.insert(visitorIdentities).values({
    id,
    tenantId,
    dniNumber: dni,
    firstName,
    lastName,
    gender: null,
    birthDate: null,
    issueDate: null,
    address: null,
    rawPdf417: null,
    phone: null,
    blacklisted: false,
    blacklistReason: null,
    tramiteNumber: null,
    createdAt: now,
    updatedAt: now,
  });
  return db.select().from(visitorIdentities).where(eq(visitorIdentities.id, id)).get();
}

/** «life» solo si la regla del barrio acepta seguro de vida en lugar de ART. */
export function personInsuranceKindFor(allowLife: boolean, requested?: string | null): "art" | "life" {
  return requested === "life" && allowLife ? "life" : "art";
}

export async function attachPersonInsuranceToPass(
  tenantId: string,
  passId: string,
  input: {
    kind?: "life" | "art";
    company?: string;
    validUntil?: string;
    documentBase64?: string | null;
    documentMime?: string;
    source?: "scan" | "upload";
    reuseId?: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, passId)).get();
  if (!pass) return { ok: false, error: "El pase ya no existe" };
  const person = await ensurePersonForPass(tenantId, pass);
  if (!person) return { ok: false, error: "Primero cargá el DNI" };

  const reuseId = String(input.reuseId || "").trim();
  if (reuseId) {
    const pi = await db
      .select()
      .from(personInsurances)
      .where(
        and(eq(personInsurances.id, reuseId), eq(personInsurances.tenantId, tenantId), eq(personInsurances.personId, person.id)),
      )
      .get();
    if (!pi) return { ok: false, error: "Esa constancia ya no está en archivo" };
    await db.update(visitPasses).set({ personInsuranceId: pi.id }).where(eq(visitPasses.id, passId));
    return { ok: true };
  }

  let documentPath: string | null = null;
  let documentMime: string | null = null;
  if (input.documentBase64) {
    const mime = input.documentMime === "application/pdf" ? "application/pdf" : "image/jpeg";
    const raw = input.documentBase64.replace(/^data:[\w/+.-]+;base64,/, "").trim();
    try {
      let buf = Buffer.from(raw, "base64");
      if (buf.length < 80 || buf.length > 4 * 1024 * 1024) {
        return { ok: false, error: "La constancia está vacía o pesa de más (máx. 4 MB)" };
      }
      if (mime !== "application/pdf") {
        try {
          buf = Buffer.from((await processDocumentImage(buf)).jpeg);
        } catch {
          /* se guarda igual */
        }
      }
      documentPath = saveVisitorDoc(pass.siteId, nid(), mime, buf);
      documentMime = mime;
    } catch {
      return { ok: false, error: "La constancia no se pudo leer" };
    }
  }

  const linked = pass.personInsuranceId
    ? await db.select().from(personInsurances).where(eq(personInsurances.id, pass.personInsuranceId)).get()
    : null;
  const company = input.company?.trim() || null;
  if (linked && (!input.validUntil || (sameDay(linked.validUntil, input.validUntil) && (company ?? linked.company) === linked.company))) {
    if (documentPath) {
      await db.update(personInsurances).set({ documentPath, documentMime }).where(eq(personInsurances.id, linked.id));
    }
    return { ok: true };
  }

  if (!input.validUntil) return { ok: false, error: "Falta la fecha de vencimiento de la ART o seguro" };
  const validUntilDate = new Date(input.validUntil);
  if (!Number.isFinite(validUntilDate.getTime())) return { ok: false, error: "Fecha de ART inválida" };
  const id = nid();
  await db.insert(personInsurances).values({
    id,
    tenantId,
    personId: person.id,
    kind: personInsuranceKindFor((await ruleForPass(pass)).items.art_vida, input.kind),
    company,
    policyNumber: null,
    validUntil: validUntilDate,
    documentPath,
    documentMime,
    source: input.source === "scan" ? "scan" : "upload",
    createdAt: new Date(),
  });
  await db.update(visitPasses).set({ personInsuranceId: id }).where(eq(visitPasses.id, passId));
  return { ok: true };
}

export async function attachLicenseToPass(
  tenantId: string,
  passId: string,
  input: { licenseNumber?: string; validUntil?: string; photoBase64?: string | null; reuseId?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, passId)).get();
  if (!pass) return { ok: false, error: "El pase ya no existe" };
  const person = await ensurePersonForPass(tenantId, pass);
  if (!person) return { ok: false, error: "Primero cargá el DNI" };

  const reuseId = String(input.reuseId || "").trim();
  if (reuseId) {
    const lic = await db
      .select()
      .from(driverLicenses)
      .where(and(eq(driverLicenses.id, reuseId), eq(driverLicenses.tenantId, tenantId), eq(driverLicenses.personId, person.id)))
      .get();
    if (!lic) return { ok: false, error: "Esa licencia ya no está en archivo" };
    await db.update(visitPasses).set({ licenseId: lic.id }).where(eq(visitPasses.id, passId));
    return { ok: true };
  }

  const linked = pass.licenseId
    ? await db.select().from(driverLicenses).where(eq(driverLicenses.id, pass.licenseId)).get()
    : null;
  const number = (input.licenseNumber || "").trim();
  if (linked && (!input.validUntil || (sameDay(linked.validUntil, input.validUntil) && (!number || number === linked.licenseNumber)))) {
    const photo = await saveDocPhoto(pass.siteId, `lic-${linked.id}`, input.photoBase64);
    if (photo) await db.update(driverLicenses).set({ photoUrl: photo }).where(eq(driverLicenses.id, linked.id));
    return { ok: true };
  }

  if (!input.validUntil) return { ok: false, error: "Falta el vencimiento de la licencia" };
  const validUntilDate = new Date(input.validUntil);
  if (!Number.isFinite(validUntilDate.getTime())) return { ok: false, error: "Fecha de licencia inválida" };
  const id = nid();
  const photoUrl = await saveDocPhoto(pass.siteId, `lic-${id}`, input.photoBase64);
  await db.insert(driverLicenses).values({
    id,
    tenantId,
    personId: person.id,
    licenseNumber: number || person.dniNumber,
    classes: "B.1",
    jurisdiction: null,
    validUntil: validUntilDate,
    photoUrl,
    createdAt: new Date(),
  });
  await db.update(visitPasses).set({ licenseId: id }).where(eq(visitPasses.id, passId));
  return { ok: true };
}

/** Tipo de ingreso y medio: cambia lo que se exige; al pasar a pie se sueltan patente/seguro/licencia/baúl. */
export async function applyPassKindAndMode(
  passId: string,
  input: { visitKind?: unknown; arrivalMode?: unknown; patente?: string | null },
): Promise<string | null> {
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, passId)).get();
  if (!pass) return null;
  const patch: Partial<typeof visitPasses.$inferInsert> = {};
  const kind = toVisitKind(input.visitKind);
  if (kind && kind !== canonicalVisitKind(pass.visitKind)) {
    if (kind !== "social" && (await passGuestIsMinor(pass))) return MINOR_KIND_ERROR;
    patch.visitKind = kind;
  }
  if (isArrivalMode(input.arrivalMode) && input.arrivalMode !== pass.arrivalMode) {
    patch.arrivalMode = input.arrivalMode;
    if (input.arrivalMode !== "vehiculo") {
      patch.vehicleId = null;
      patch.insuranceId = null;
      patch.licenseId = null;
      patch.patente = null;
      patch.completeness = "basic";
    }
  }
  const plate = normalizePlate(input.patente || "");
  if (plate && (patch.arrivalMode ?? pass.arrivalMode) === "vehiculo" && plate !== pass.patente) patch.patente = plate;
  if (!Object.keys(patch).length) return null;
  await db.update(visitPasses).set(patch).where(eq(visitPasses.id, passId));
  if (patch.visitKind && patch.visitKind !== "social") {
    await db
      .update(guardApprovals)
      .set({ minorsCount: 0 })
      .where(and(eq(guardApprovals.passId, passId), eq(guardApprovals.status, "pending"), eq(guardApprovals.sentido, "in")));
  }
  if (patch.arrivalMode && patch.arrivalMode !== "vehiculo") {
    await db
      .delete(visitTrunkChecks)
      .where(and(eq(visitTrunkChecks.passId, passId), eq(visitTrunkChecks.sentido, "in")));
    await db
      .update(guardApprovals)
      .set({ trunkChecked: false })
      .where(and(eq(guardApprovals.passId, passId), eq(guardApprovals.status, "pending")));
  }
  if (pass.visitRecordId) {
    const recPatch: Partial<typeof visitRecords.$inferInsert> = {};
    if (patch.visitKind) recPatch.visitType = patch.visitKind;
    if (patch.arrivalMode && patch.arrivalMode !== "vehiculo") {
      recPatch.vehicleId = null;
      recPatch.insuranceId = null;
      recPatch.licenseId = null;
    }
    if (Object.keys(recPatch).length) {
      await db.update(visitRecords).set(recPatch).where(eq(visitRecords.id, pass.visitRecordId));
    }
  }
  return null;
}

/** Seguro o licencia vencidos: el auto queda afuera y se re-evalúa como ingreso a pie. */
export async function switchToPedestrian(input: {
  site: { id: string; tenantId: string };
  approvalId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db
    .select()
    .from(guardApprovals)
    .where(and(eq(guardApprovals.id, input.approvalId), eq(guardApprovals.siteId, input.site.id)))
    .get();
  if (!row || row.status !== "pending") return { ok: false, error: "No hay una solicitud pendiente" };
  if (row.sentido !== "in") return { ok: false, error: "Pasar a peatonal es solo en el ingreso" };
  const gaps = await visitFieldGaps(row.passId, "in");
  if (gaps.expired.includes("art")) {
    return { ok: false, error: "La ART está vencida: no puede ingresar ni a pie" };
  }
  await applyPassKindAndMode(row.passId, { arrivalMode: "peatonal" });
  const missing = await missingVisitFields(row.passId, "in");
  if (row.reason !== "walk_in") {
    await db
      .update(guardApprovals)
      .set({ reason: missing.length ? "incomplete" : "ok" })
      .where(eq(guardApprovals.id, row.id));
  }
  broadcastRealtimeEvent({
    id: nid(),
    siteId: input.site.id,
    tenantId: input.site.tenantId,
    type: "visit_hold",
    payload: { passId: row.passId, approvalId: row.id, pedestrian: true, sentido: "in" },
    createdAt: Date.now(),
  });
  return { ok: true };
}

export async function serializeTrunkCheck(row: TrunkCheckRow | null) {
  if (!row) return null;
  const photoIds = trunkPhotoIdsOf(row);
  return {
    id: row.id,
    sentido: row.sentido,
    description: row.description ?? null,
    photoIds,
    photoUrls: photoIds.map((pid) => `/api/visitors/trunk/${row.id}/photos/${pid}`),
    at: row.updatedAt,
    guardName: await userNameOf(row.guardUserId),
  };
}

const TRUNK_MAX_PHOTOS = 6;

export function trunkPhotoKey(photoId: string) {
  return `trunk-${photoId}`;
}

export async function findTrunkCheck(siteId: string, checkId: string) {
  return (
    (await db
      .select()
      .from(visitTrunkChecks)
      .where(and(eq(visitTrunkChecks.id, checkId), eq(visitTrunkChecks.siteId, siteId)))
      .get()) ?? null
  );
}

export function trunkCheckHasPhoto(row: TrunkCheckRow, photoId: string) {
  return trunkPhotoIdsOf(row).includes(photoId);
}

/** Revisión de baúl del sentido de la solicitud (upsert). Ingreso exige descripción o foto; salida solo el tilde. */
export async function attachTrunkCheck(input: {
  site: { id: string; tenantId: string };
  approvalId: string;
  guardUserId: string;
  description?: string | null;
  addPhotosBase64?: string[];
  removePhotoIds?: string[];
}) {
  const row = await db
    .select()
    .from(guardApprovals)
    .where(and(eq(guardApprovals.id, input.approvalId), eq(guardApprovals.siteId, input.site.id)))
    .get();
  if (!row || row.status !== "pending") return { ok: false as const, error: "No hay una solicitud pendiente" };
  const sentido = row.sentido === "out" ? "out" : "in";
  const latest = await trunkCheckOf(row.passId, sentido);
  // Cada cruce aprobado cierra su revisión: sale y vuelve abre otra vuelta con fotos propias.
  const latestApproval = latest?.approvalId && latest.approvalId !== row.id
    ? await db.select({ status: guardApprovals.status }).from(guardApprovals).where(eq(guardApprovals.id, latest.approvalId)).get()
    : null;
  const existing = latest && latestApproval?.status === "approved" ? null : latest;
  const remove = new Set((input.removePhotoIds || []).map(String));
  const photoIds = trunkPhotoIdsOf(existing).filter((pid) => !remove.has(pid));
  for (const b64 of input.addPhotosBase64 || []) {
    if (photoIds.length >= TRUNK_MAX_PHOTOS) break;
    const raw = String(b64 || "").replace(/^data:[\w/+.-]+;base64,/, "").trim();
    if (raw.length < 80) continue;
    try {
      const buf = Buffer.from(raw, "base64");
      if (buf.length <= 80 || buf.length >= 4 * 1024 * 1024) continue;
      const pid = nid();
      saveEventPhoto(input.site.id, trunkPhotoKey(pid), buf);
      photoIds.push(pid);
    } catch {
      /* foto ilegible: se ignora */
    }
  }
  const description =
    input.description === undefined || input.description === null
      ? existing?.description ?? null
      : String(input.description).trim().slice(0, 500) || null;
  const now = new Date();
  let checkId = existing?.id;
  if (existing) {
    await db
      .update(visitTrunkChecks)
      .set({
        description,
        photoIds: JSON.stringify(photoIds),
        approvalId: row.id,
        guardUserId: input.guardUserId,
        updatedAt: now,
      })
      .where(eq(visitTrunkChecks.id, existing.id));
  } else {
    checkId = nid();
    await db.insert(visitTrunkChecks).values({
      id: checkId,
      siteId: input.site.id,
      passId: row.passId,
      approvalId: row.id,
      sentido,
      description,
      photoIds: JSON.stringify(photoIds),
      guardUserId: input.guardUserId,
      round: latest ? (latest.round ?? 0) + 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  await db.update(guardApprovals).set({ trunkChecked: true }).where(eq(guardApprovals.id, row.id));
  if (sentido === "in" && row.reason !== "walk_in" && !row.reentry) {
    const missing = await missingVisitFields(row.passId, "in");
    await db
      .update(guardApprovals)
      .set({ reason: missing.length ? "incomplete" : "ok" })
      .where(eq(guardApprovals.id, row.id));
  }
  const saved = await trunkCheckOf(row.passId, sentido);
  return { ok: true as const, trunk: await serializeTrunkCheck(saved) };
}

export async function announceWalkIn(input: {
  site: { id: string; tenantId: string };
  propertyId: string;
  guardUserId: string;
  guestName?: string;
  guestDni?: string;
  guestBirthDate?: string;
  visitKind?: string;
  arrivalMode?: string;
  patente?: string;
}): Promise<{ ok: true; passId: string; approvalId: string } | { ok: false; error: string }> {
  const requestedKind = toVisitKind(input.visitKind);
  if (requestedKind && requestedKind !== "social") {
    const birth = input.guestBirthDate || (await personByDni(input.site.tenantId, input.guestDni))?.birthDate;
    if (isMinorBirthDate(birth)) return { ok: false, error: MINOR_KIND_ERROR };
  }
  const property = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, input.propertyId), eq(properties.siteId, input.site.id)))
    .get();
  if (!property) return { ok: false, error: "Lote no encontrado" };
  const now = new Date();
  const passId = nid();
  const token = (await import("./visitPass.js")).makeVisitToken(property.id, passId);
  const guestName = (input.guestName || "Visita espontánea").trim();
  const defaultHours = await getVisitAuthDefaultHours(input.site.tenantId);
  const arrivalMode: ArrivalMode = isArrivalMode(input.arrivalMode) ? input.arrivalMode : "peatonal";
  const visitKind: VisitKind = requestedKind ?? "social";
  const plate = arrivalMode === "vehiculo" ? normalizePlate(input.patente || "") || null : null;
  await db.insert(visitPasses).values({
    id: passId,
    propertyId: property.id,
    siteId: input.site.id,
    authorizationId: null,
    token,
    guestName,
    guestDni: input.guestDni?.replace(/\D/g, "") || null,
    patente: plate,
    validFrom: now,
    validUntil: new Date(now.getTime() + defaultHours * 60 * 60 * 1000),
    horaDesde: null,
    horaHasta: null,
    status: "awaiting_entry",
    arrivalMode,
    visitKind,
    completeness: "basic",
    vehicleId: null,
    insuranceId: null,
    visitRecordId: null,
    notes: "Walk-in anunciado desde el plano",
    dahuaSynced: false,
    dahuaCardNo: token,
    scannedInAt: null,
    scannedOutAt: null,
    createdByUserId: input.guardUserId,
    createdAt: now,
  });
  const hold = await holdVisitQr({
    siteId: input.site.id,
    tenantId: input.site.tenantId,
    cardRaw: token,
    sentido: "in",
    scanChannel: "web",
    scannedByUserId: input.guardUserId,
    at: now,
    notifyLot: false,
  });
  if (hold.approvalId) {
    await db
      .update(guardApprovals)
      .set({
        reason: "walk_in",
        ownerAuthStatus: "pending_owner",
        ownerAuthExpiresAt: new Date(now.getTime() + 120_000),
      })
      .where(eq(guardApprovals.id, hold.approvalId));
    await createOwnerNotice({
      siteId: input.site.id,
      tenantId: input.site.tenantId,
      propertyId: property.id,
      passId,
      approvalId: hold.approvalId,
      kind: "walk_in",
      title: "Visita en garita",
      message: `${guestName} pide entrar a tu lote. Tenés 2 minutos para autorizar. La barrera la abre el guardia.`,
      payload: { guestName, guestDni: input.guestDni || null },
      ttlMs: 120_000,
    });
  }
  return { ok: true, passId, approvalId: hold.approvalId || "" };
}

export async function attachGoodsAlert(input: {
  site: { id: string; tenantId: string };
  approvalId: string;
  description: string;
  photoBase64?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db
    .select()
    .from(guardApprovals)
    .where(and(eq(guardApprovals.id, input.approvalId), eq(guardApprovals.siteId, input.site.id)))
    .get();
  if (!row || row.status !== "pending") return { ok: false, error: "No hay una solicitud de salida" };
  if (row.sentido !== "out") return { ok: false, error: "La alerta de bien es en el egreso" };
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, row.passId)).get();
  if (!pass) return { ok: false, error: "El pase ya no existe" };
  let photoPath: string | null = row.goodsPhotoPath;
  if (input.photoBase64) {
    const raw = input.photoBase64.replace(/^data:[\w/+.-]+;base64,/, "").trim();
    try {
      const buf = Buffer.from(raw, "base64");
      if (buf.length > 80 && buf.length < 4 * 1024 * 1024) {
        saveEventPhoto(input.site.id, `goods-${row.id}`, buf);
        photoPath = `goods-${row.id}`;
      }
    } catch {
      /* sin foto */
    }
  }
  await db
    .update(guardApprovals)
    .set({
      goodsAlert: true,
      goodsDescription: input.description.trim() || "Bien no registrado",
      goodsPhotoPath: photoPath,
    })
    .where(eq(guardApprovals.id, row.id));
  await createOwnerNotice({
    siteId: input.site.id,
    tenantId: input.site.tenantId,
    propertyId: pass.propertyId,
    passId: pass.id,
    approvalId: row.id,
    kind: "goods",
    title: "Sale con un bien de tu lote",
    message: `${pass.guestName} sale con: ${input.description.trim() || "un objeto no declarado"}. ¿Lo autorizás? La barrera queda retenida hasta que alguien del lote responda.`,
    payload: { description: input.description, hasPhoto: Boolean(photoPath) },
    ttlMs: 30 * 60 * 1000,
  });
  return { ok: true };
}

/** "Sale sin el bien": el guardia saca el aviso y la salida sigue sin ese objeto. */
export async function clearGoodsAlert(input: {
  site: { id: string; tenantId: string };
  approvalId: string;
  guardUserId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db
    .select()
    .from(guardApprovals)
    .where(and(eq(guardApprovals.id, input.approvalId), eq(guardApprovals.siteId, input.site.id)))
    .get();
  if (!row || row.status !== "pending" || row.sentido !== "out") return { ok: false, error: "No hay una salida pendiente" };
  if (!row.goodsAlert) return { ok: true };
  const guardName = (await userNameOf(input.guardUserId)) || "guardia";
  const line = `Salió sin el bien «${row.goodsDescription || "sin descripción"}» (${guardName}).`;
  await db
    .update(guardApprovals)
    .set({
      goodsAlert: false,
      goodsDescription: null,
      goodsPhotoPath: null,
      goodsAuthorizedByUserId: null,
      comment: row.comment ? `${row.comment}\n${line}` : line,
    })
    .where(eq(guardApprovals.id, row.id));
  await db
    .update(ownerNotices)
    .set({ status: "expired", decidedAt: new Date(), decidedByUserId: input.guardUserId })
    .where(and(eq(ownerNotices.approvalId, row.id), eq(ownerNotices.kind, "goods"), eq(ownerNotices.status, "pending")));
  broadcastRealtimeEvent({
    id: nid(),
    siteId: input.site.id,
    tenantId: input.site.tenantId,
    type: "visit_hold",
    payload: { approvalId: row.id, passId: row.passId, goodsCleared: true },
    createdAt: Date.now(),
  });
  return { ok: true };
}

export async function requestMinorTransfer(input: {
  site: { id: string; tenantId: string };
  approvalId: string;
  originPropertyId: string;
  exitAdultsCount?: number;
  exitMinorsCount?: number;
  extraName?: string;
  extraDni?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db
    .select()
    .from(guardApprovals)
    .where(and(eq(guardApprovals.id, input.approvalId), eq(guardApprovals.siteId, input.site.id)))
    .get();
  if (!row || row.status !== "pending" || row.sentido !== "out") {
    return { ok: false, error: "No hay un egreso pendiente" };
  }
  const origin = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, input.originPropertyId), eq(properties.siteId, input.site.id)))
    .get();
  if (!origin) return { ok: false, error: "Lote de procedencia no encontrado" };
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, row.passId)).get();
  if (!pass) return { ok: false, error: "El pase ya no existe" };
  await db
    .update(guardApprovals)
    .set({
      originPropertyId: origin.id,
      exitAdultsCount: input.exitAdultsCount ?? null,
      exitMinorsCount: input.exitMinorsCount ?? null,
    })
    .where(eq(guardApprovals.id, row.id));
  await createOwnerNotice({
    siteId: input.site.id,
    tenantId: input.site.tenantId,
    propertyId: origin.id,
    passId: pass.id,
    approvalId: row.id,
    kind: "minor_transfer",
    title: "Autorizar traslado de menor",
    message: `Un menor sale con ${pass.guestName}${pass.patente ? ` (patente ${pass.patente})` : ""}. Confirmá el traslado.`,
    payload: {
      conductor: pass.guestName,
      patente: pass.patente,
      extraName: input.extraName || null,
      extraDni: input.extraDni || null,
    },
    ttlMs: 30 * 60 * 1000,
  });
  return { ok: true };
}

export async function setApprovalMinorsCount(input: {
  siteId: string;
  approvalId: string;
  count: number;
}) {
  const row = await db
    .select()
    .from(guardApprovals)
    .where(and(eq(guardApprovals.id, input.approvalId), eq(guardApprovals.siteId, input.siteId)))
    .get();
  if (!row || row.status !== "pending") return { ok: false as const, error: "No hay una solicitud pendiente" };
  const n = Math.max(0, Math.min(20, Math.round(Number(input.count) || 0)));
  if (n > 0 && row.sentido === "in" && !row.reentry) {
    const pass = await db.select({ visitKind: visitPasses.visitKind }).from(visitPasses).where(eq(visitPasses.id, row.passId)).get();
    if (pass && pass.visitKind !== "social") return { ok: false as const, error: MINORS_KIND_ERROR };
  }
  await db
    .update(guardApprovals)
    .set({ minorsCount: n, exitMinorsCount: n })
    .where(eq(guardApprovals.id, row.id));
  return { ok: true as const, minorsCount: n };
}

export async function setApprovalCrossingMode(input: { siteId: string; approvalId: string; mode: "exit" | "reentry" }) {
  const row = await db
    .select()
    .from(guardApprovals)
    .where(and(eq(guardApprovals.id, input.approvalId), eq(guardApprovals.siteId, input.siteId)))
    .get();
  if (!row || row.status !== "pending") return { ok: false as const, error: "No hay una solicitud pendiente" };
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, row.passId)).get();
  if (!pass) return { ok: false as const, error: "El pase ya no existe" };
  const pr = await passPresence(pass);
  if (input.mode === "reentry" && !pr.anyTempOut) {
    return { ok: false as const, error: "No hay nadie que haya salido con «Sale y vuelve»" };
  }
  if (input.mode === "exit" && !pr.anyInside) return { ok: false as const, error: "No queda nadie adentro" };
  const reentry = input.mode === "reentry";
  await db
    .update(guardApprovals)
    .set({
      sentido: reentry ? "in" : "out",
      reentry,
      reason: "ok",
      exitPeople: null,
      returns: false,
      minorsMismatchNotified: false,
      minorsCount: reentry ? pass.minorsOutTemp ?? 0 : pass.minorsInCount ?? 0,
    })
    .where(eq(guardApprovals.id, row.id));
  return { ok: true as const };
}

export async function notifyMinorsMismatch(input: {
  site: { id: string; tenantId: string };
  approvalId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db
    .select()
    .from(guardApprovals)
    .where(and(eq(guardApprovals.id, input.approvalId), eq(guardApprovals.siteId, input.site.id)))
    .get();
  if (!row || row.status !== "pending" || row.sentido !== "out") {
    return { ok: false, error: "No hay un egreso pendiente" };
  }
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, row.passId)).get();
  if (!pass) return { ok: false, error: "El pase ya no existe" };
  const inCount = pass.minorsInCount ?? 0;
  const outCount = row.minorsCount ?? row.exitMinorsCount ?? 0;
  if (inCount === outCount) return { ok: false, error: "La cantidad coincide: no hace falta avisar" };
  const property = await db.select().from(properties).where(eq(properties.id, pass.propertyId)).get();
  const lot = property?.lotNumber || "—";
  const extra = outCount > inCount;
  const message = extra
    ? `${pass.guestName} sale con ${outCount} menor(es). En el ingreso se anotaron ${inCount}. Autorizá si corresponde (lote ${lot}).`
    : `${pass.guestName} sale con ${outCount} menor(es) de los ${inCount} que ingresaron. Quedan ${inCount - outCount} en el barrio (lote ${lot}).`;
  await db
    .update(guardApprovals)
    .set({ minorsMismatchNotified: true, exitMinorsCount: outCount })
    .where(eq(guardApprovals.id, row.id));
  await createOwnerNotice({
    siteId: input.site.id,
    tenantId: input.site.tenantId,
    propertyId: pass.propertyId,
    passId: pass.id,
    approvalId: row.id,
    kind: "minors_mismatch",
    title: extra ? "Salen más menores de los que ingresaron" : "No salen todos los menores que ingresaron",
    message,
    payload: { guestName: pass.guestName, minorsIn: inCount, minorsOut: outCount, lotNumber: lot },
    ttlMs: extra ? 30 * 60 * 1000 : 4 * 60 * 60 * 1000,
  });
  return { ok: true };
}

export async function confirmPhoneAuth(input: {
  site: { id: string; tenantId: string };
  approvalId: string;
  guardUserId: string;
  guardCode: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const valid = await verifyUserGuardCode(input.guardUserId, input.guardCode);
  if (!valid) return { ok: false, error: "Código de guardia incorrecto" };
  const row = await db
    .select()
    .from(guardApprovals)
    .where(and(eq(guardApprovals.id, input.approvalId), eq(guardApprovals.siteId, input.site.id)))
    .get();
  if (!row || row.status !== "pending") return { ok: false, error: "No hay una solicitud pendiente" };
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, row.passId)).get();
  if (!pass) return { ok: false, error: "El pase ya no existe" };
  const extraMinors =
    Number(row.minorsCount ?? row.exitMinorsCount ?? 0) > (pass.minorsInCount ?? 0) &&
    !row.minorTransferAuthorizedByUserId;
  const patch: Partial<typeof guardApprovals.$inferInsert> = {};
  if (row.ownerAuthStatus === "pending_owner" || row.ownerAuthStatus === "owner_expired") {
    patch.ownerAuthStatus = "owner_approved";
    patch.ownerAuthorizedByUserId = input.guardUserId;
  }
  if (row.goodsAlert && !row.goodsAuthorizedByUserId && (await goodsNoticeOf(row.id))?.status !== "denied") {
    patch.goodsAuthorizedByUserId = input.guardUserId;
  }
  if (extraMinors) patch.minorTransferAuthorizedByUserId = input.guardUserId;
  if (!Object.keys(patch).length) {
    return { ok: false, error: "No hay una autorización de titular pendiente" };
  }
  const now = new Date();
  await db.update(guardApprovals).set({ ...patch, phoneAuthVia: "guard_code" }).where(eq(guardApprovals.id, row.id));
  await db
    .update(ownerNotices)
    .set({
      status: "approved",
      decidedAt: now,
      decidedByUserId: input.guardUserId,
    })
    .where(and(eq(ownerNotices.approvalId, row.id), eq(ownerNotices.status, "pending")));
  broadcastRealtimeEvent({
    id: nid(),
    siteId: input.site.id,
    tenantId: input.site.tenantId,
    type: "visit_hold",
    payload: { approvalId: row.id, passId: pass.id, phoneAuth: true },
    createdAt: now.getTime(),
  });
  return { ok: true };
}

