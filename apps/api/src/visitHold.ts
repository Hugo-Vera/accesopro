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
} from "./db/schema.js";
import { fireActuator } from "./actuatorExec.js";
import { actuatorsForDahuaDevice, actuatorsForSentido, laneCodeOf } from "./accessPoints.js";
import { broadcastRealtimeEvent } from "./eventStream.js";
import { nid, normalizePlate } from "./scope.js";
import { parseVisitQrPayload } from "./visitPass.js";
import { companionIsMinor, isMinorBirthDate } from "./age.js";
import { createOwnerNotice, expireOwnerNotices } from "./ownerNotices.js";
import { saveEventPhoto } from "./eventPhotos.js";
import { verifyUserGuardCode } from "./users.js";
import { getVisitAuthDefaultHours } from "./retention.js";
import { processDocumentImage } from "./documentScan.js";
import { saveVisitorDoc } from "./visitorDocs.js";

export type ArrivalMode = "peatonal" | "plataforma" | "vehiculo";
export type VisitKind = "social" | "service" | "contractor" | "delivery";

const OPEN_STATUSES = new Set(["preauthorized", "active", "awaiting_entry", "in_site", "awaiting_exit"]);

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
    pass.status === "in_site" || pass.status === "completed" || pass.status === "denied" || pass.status === "awaiting_exit"
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

export type VisitFieldGaps = { missing: string[]; expired: string[] };

export async function visitFieldGaps(passId: string): Promise<VisitFieldGaps> {
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, passId)).get();
  if (!pass) return { missing: ["pase"], expired: [] };
  const missing: string[] = [];
  const expired: string[] = [];
  if (!String(pass.guestDni || "").replace(/\D/g, "")) missing.push("dni");
  if (needsVehicleDocs(pass.arrivalMode)) {
    if (!String(pass.patente || "").trim()) missing.push("patente");
    let ins = pass.insuranceId
      ? await db.select().from(vehicleInsurances).where(eq(vehicleInsurances.id, pass.insuranceId)).get()
      : null;
    if (!ins && pass.vehicleId) {
      ins = await db
        .select()
        .from(vehicleInsurances)
        .where(eq(vehicleInsurances.vehicleId, pass.vehicleId))
        .orderBy(desc(vehicleInsurances.createdAt))
        .get();
    }
    if (!ins?.company || !ins.policyNumber || !ins.validUntil) missing.push("seguro_vehiculo");
    else if (isPast(ins.validUntil)) expired.push("seguro_vehiculo");
  }
  if (pass.visitKind === "contractor") {
    const pi = pass.personInsuranceId
      ? await db.select().from(personInsurances).where(eq(personInsurances.id, pass.personInsuranceId)).get()
      : null;
    if (!pi?.validUntil) missing.push("art");
    else if (isPast(pi.validUntil)) expired.push("art");
  }
  if (pass.licenseId) {
    const lic = await db.select().from(driverLicenses).where(eq(driverLicenses.id, pass.licenseId)).get();
    if (!lic?.validUntil || isPast(lic.validUntil)) expired.push("licencia");
  }
  return { missing, expired };
}

export async function missingVisitFields(passId: string): Promise<string[]> {
  const gaps = await visitFieldGaps(passId);
  return [
    ...gaps.missing,
    ...gaps.expired.map((k) => (k === "licencia" ? "licencia_vencida" : `${k}_vencido`)),
  ];
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
  sentido: "in" | "out";
  deviceId?: string | null;
  at?: Date;
  /** Aviso informativo al lote (QR preautorizado). Walk-in pasa false. */
  notifyLot?: boolean;
}): Promise<{
  held: boolean;
  passId?: string;
  approvalId?: string;
  reason?: string;
  guestName?: string;
  lotNumber?: string | null;
}> {
  const pass = await findVisitPassByCard(input.siteId, input.cardRaw);
  if (!pass) return { held: false };
  const lotOf = async (propertyId: string) => {
    const row = await db.select().from(properties).where(eq(properties.id, propertyId)).get();
    return row?.lotNumber ?? null;
  };
  if (pass.status === "revoked" || pass.status === "denied") {
    return {
      held: true,
      passId: pass.id,
      guestName: pass.guestName,
      lotNumber: await lotOf(pass.propertyId),
      reason: "closed",
    };
  }

  const now = input.at ?? new Date();
  const window = passWindowState(pass, now);
  const missing = await missingVisitFields(pass.id);
  const reason = window === "expired" || window === "too_early" ? "expired" : missing.length ? "incomplete" : "ok";
  const sentido = input.sentido;
  const nextStatus = sentido === "out" ? "awaiting_exit" : "awaiting_entry";

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
      createdAt: now,
      decidedAt: null,
    });
  } else {
    await db
      .update(guardApprovals)
      .set({ reason, sentido, deviceId: input.deviceId || existing.deviceId })
      .where(eq(guardApprovals.id, existing.id));
  }

  if (pass.status !== nextStatus && pass.status !== "completed") {
    await db.update(visitPasses).set({ status: nextStatus }).where(eq(visitPasses.id, pass.id));
    await syncVisitRecordFromPass({ ...pass, status: nextStatus });
  }

  const property = await db.select().from(properties).where(eq(properties.id, pass.propertyId)).get();
  const contact = await ownerContactForProperty(pass.propertyId);
  const eventId = nid();
  await db.insert(events).values({
    id: eventId,
    siteId: input.siteId,
    type: "visit_hold",
    sentido,
    laneCode: laneCodeOf(sentido),
    payload: JSON.stringify({
      passId: pass.id,
      approvalId,
      sentido,
      reason,
      guestName: pass.guestName,
      guestDni: pass.guestDni,
      lotNumber: property?.lotNumber,
      arrivalMode: pass.arrivalMode,
      missing,
      expired: reason === "expired",
    }),
    createdAt: now,
  });
  broadcastRealtimeEvent({
    id: eventId,
    siteId: input.siteId,
    tenantId: input.tenantId ?? undefined,
    type: "visit_hold",
    payload: {
      passId: pass.id,
      approvalId,
      sentido,
      reason,
      guestName: pass.guestName,
      lotNumber: property?.lotNumber,
      ownerPhone: contact.ownerPhone,
      expired: reason === "expired",
    },
    createdAt: now.getTime(),
  });

  if (input.notifyLot !== false && input.tenantId && existing?.reason !== "walk_in") {
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
        message: `${pass.guestName} llegó a portería (QR). Lote ${lot || "—"}. Portería abre.`,
        payload: { guestName: pass.guestName, lotNumber: lot || null },
        ttlMs,
      });
    }
  }

  return {
    held: true,
    passId: pass.id,
    approvalId,
    reason,
    guestName: pass.guestName,
    lotNumber: property?.lotNumber ?? null,
  };
}

async function patchVisitLaneEvent(input: {
  siteId: string;
  tenantId: string;
  passId: string;
  approvalId: string;
  guestName: string;
  lotNumber?: string | null;
  visitStatus: "approved" | "denied";
  decidedAt: Date;
  decidedByUserId: string;
}) {
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
  if (!target) return;
  const approved = input.visitStatus === "approved";
  const payload: Record<string, unknown> = {
    ...target.payload,
    guestName: input.guestName,
    personName: input.guestName,
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
}

async function openForVisit(
  site: { id: string; lastSeenAt: Date | number | null },
  sentido: "in" | "out",
  deviceId?: string | null,
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
    const r = await fireActuator(site, a.id, "open");
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
}): Promise<{ ok: true; actuatorsFired?: string[] } | { ok: false; error: string; missing?: string[] }> {
  const row = await db
    .select()
    .from(guardApprovals)
    .where(and(eq(guardApprovals.id, input.approvalId), eq(guardApprovals.siteId, input.site.id)))
    .get();
  if (!row) return { ok: false, error: "No hay una solicitud de aprobación" };
  if (row.status !== "pending") return { ok: false, error: "Esa solicitud ya se resolvió" };
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, row.passId)).get();
  if (!pass) return { ok: false, error: "El pase ya no existe" };

  const now = new Date();
  if (input.decision === "denied") {
    await db
      .update(guardApprovals)
      .set({
        status: "denied",
        comment: input.comment?.trim() || null,
        trunkChecked: Boolean(input.trunkChecked),
        guardUserId: input.guardUserId,
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
      lotNumber: deniedLot?.lotNumber ?? null,
      visitStatus: "denied",
      decidedAt: now,
      decidedByUserId: input.guardUserId,
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

  if (row.reason === "walk_in") {
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

  const gaps = await visitFieldGaps(pass.id);
  if (gaps.missing.length) return { ok: false, error: "Faltan datos obligatorios", missing: gaps.missing };
  if (gaps.expired.length && row.ownerAuthStatus !== "owner_approved") {
    return {
      ok: false,
      error: "Hay un documento vencido. Pedí autorización al titular o denegá.",
      missing: gaps.expired.map((k) => (k === "licencia" ? "licencia_vencida" : `${k}_vencido`)),
    };
  }
  if (needsVehicleDocs(pass.arrivalMode) && !input.trunkChecked) {
    return { ok: false, error: "Hay que revisar el baúl antes de aprobar" };
  }

  if (row.sentido === "out") {
    if (row.goodsAlert && !row.goodsAuthorizedByUserId) {
      return {
        ok: false,
        error: "Hay un bien no registrado: el titular del lote tiene que autorizar la salida",
      };
    }
    const comps = await listCompanions(pass.id);
    const minorsIn = comps.filter((x) => companionIsMinor(x)).length;
    const exitMinors = row.exitMinorsCount ?? minorsIn;
    if (exitMinors > minorsIn && !row.minorTransferAuthorizedByUserId) {
      return {
        ok: false,
        error: "Sale un menor de más: pedí autorización al lote de procedencia",
      };
    }
  }

  const pulse = await openForVisit(input.site, row.sentido as "in" | "out", row.deviceId);
  if (!pulse.fired.length) {
    return { ok: false, error: pulse.error || "No se pudo pulsar el relé. Revisá el agent y el cableado." };
  }

  const nextStatus = row.sentido === "out" ? "completed" : "in_site";
  const patch: Partial<typeof visitPasses.$inferInsert> = { status: nextStatus };
  if (row.sentido === "in") patch.scannedInAt = pass.scannedInAt ?? now;
  if (row.sentido === "out") {
    patch.scannedOutAt = now;
    if (!pass.scannedInAt) patch.scannedInAt = now;
  }

  await db.update(visitPasses).set(patch).where(eq(visitPasses.id, pass.id));
  await syncVisitRecordFromPass({ ...pass, ...patch, status: nextStatus });
  await db
    .update(guardApprovals)
    .set({
      status: "approved",
      comment: input.comment?.trim() || null,
      trunkChecked: Boolean(input.trunkChecked),
      guardUserId: input.guardUserId,
      decidedAt: now,
    })
    .where(eq(guardApprovals.id, row.id));

  const property = await db.select().from(properties).where(eq(properties.id, pass.propertyId)).get();
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
      lotNumber: property?.lotNumber,
      actuatorsFired: pulse.fired,
      accessKind: "visita",
      guardApproved: true,
    }),
    createdAt: now,
  });
  await patchVisitLaneEvent({
    siteId: input.site.id,
    tenantId: input.site.tenantId,
    passId: pass.id,
    approvalId: row.id,
    guestName: pass.guestName,
    lotNumber: property?.lotNumber ?? null,
    visitStatus: "approved",
    decidedAt: now,
    decidedByUserId: input.guardUserId,
  });
  broadcastRealtimeEvent({
    id: nid(),
    siteId: input.site.id,
    tenantId: input.site.tenantId,
    type: "visit_hold",
    payload: { passId: pass.id, approvalId: row.id, decided: "approved", sentido: row.sentido },
    createdAt: now.getTime(),
  });
  return { ok: true, actuatorsFired: pulse.fired };
}

export async function serializePassFicha(
  passId: string,
  row?: typeof guardApprovals.$inferSelect | null,
) {
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, passId)).get();
  if (!pass) return null;
  const property = await db.select().from(properties).where(eq(properties.id, pass.propertyId)).get();
  const contact = await ownerContactForProperty(pass.propertyId);
  const companions = await listCompanions(pass.id);
  const gaps = await visitFieldGaps(pass.id);
  const missing = gaps.missing;
  let insurance: { company: string; policyNumber: string; validUntil: Date | number; cardPhotoUrl?: string | null } | null = null;
  if (pass.insuranceId) {
    const ins = await db.select().from(vehicleInsurances).where(eq(vehicleInsurances.id, pass.insuranceId)).get();
    if (ins) insurance = { company: ins.company, policyNumber: ins.policyNumber, validUntil: ins.validUntil, cardPhotoUrl: ins.cardPhotoUrl };
  } else if (pass.vehicleId) {
    const ins = await db
      .select()
      .from(vehicleInsurances)
      .where(eq(vehicleInsurances.vehicleId, pass.vehicleId))
      .orderBy(desc(vehicleInsurances.createdAt))
      .get();
    if (ins) insurance = { company: ins.company, policyNumber: ins.policyNumber, validUntil: ins.validUntil, cardPhotoUrl: ins.cardPhotoUrl };
  }
  let personInsurance: { id: string; kind: string; company: string | null; validUntil: Date | number; hasDocument: boolean } | null = null;
  if (pass.personInsuranceId) {
    const pi = await db.select().from(personInsurances).where(eq(personInsurances.id, pass.personInsuranceId)).get();
    if (pi) {
      personInsurance = {
        id: pi.id,
        kind: pi.kind,
        company: pi.company,
        validUntil: pi.validUntil,
        hasDocument: Boolean(pi.documentPath),
      };
    }
  }
  let license: { id: string; licenseNumber: string; validUntil: Date | number } | null = null;
  if (pass.licenseId) {
    const lic = await db.select().from(driverLicenses).where(eq(driverLicenses.id, pass.licenseId)).get();
    if (lic) license = { id: lic.id, licenseNumber: lic.licenseNumber, validUntil: lic.validUntil };
  }
  const awaitingOut = pass.status === "in_site" || pass.status === "awaiting_exit";
  const pending = Boolean(row && row.status === "pending");
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
    patente: pass.patente,
    arrivalMode: pass.arrivalMode,
    visitKind: pass.visitKind,
    completeness: pass.completeness,
    passStatus: pass.status,
    validFrom: pass.validFrom,
    validUntil: pass.validUntil,
    horaDesde: pass.horaDesde,
    horaHasta: pass.horaHasta,
    windowState: passWindowState(pass),
    needsTrunk: needsVehicleDocs(pass.arrivalMode),
    needsArt: pass.visitKind === "contractor",
    missing,
    expiredDocs: gaps.expired,
    companions: companions.map((x) => ({
      id: x.id,
      name: x.name,
      dni: x.dni,
      birthDate: x.birthDate,
      isMinor: companionIsMinor(x),
      situation: x.situation,
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
    ownerAuthStatus: row?.ownerAuthStatus ?? "none",
    ownerAuthExpiresAt: row?.ownerAuthExpiresAt ?? null,
    ownerAuthorizedByUserId: row?.ownerAuthorizedByUserId ?? null,
    ownerAuthorizedByName: row?.ownerAuthorizedByUserId
      ? ((await db.select({ name: users.name }).from(users).where(eq(users.id, row.ownerAuthorizedByUserId)).get())?.name ?? null)
      : null,
    goodsAlert: Boolean(row?.goodsAlert),
    goodsDescription: row?.goodsDescription ?? null,
    goodsPhotoPath: row?.goodsPhotoPath ?? null,
    goodsAuthorized: Boolean(row?.goodsAuthorizedByUserId),
    goodsCallReady: Boolean(
      row?.goodsAlert &&
        !row.goodsAuthorizedByUserId &&
        Date.now() - (row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt)) >= 30_000,
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
          (row.goodsAlert && !row.goodsAuthorizedByUserId) ||
          (Number(row.exitMinorsCount ?? 0) >
            companions.filter((x) => companionIsMinor(x)).length &&
            !row.minorTransferAuthorizedByUserId)),
    ),
    minorsIn: companions.filter((x) => companionIsMinor(x)).length,
    adultsIn: 1 + companions.filter((x) => !companionIsMinor(x)).length,
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

export async function attachVehicleInsurance(
  tenantId: string,
  passId: string,
  input: {
    plate?: string;
    company?: string;
    policyNumber?: string;
    validUntil?: string;
    cardPhotoBase64?: string | null;
  },
) {
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, passId)).get();
  if (!pass) return;
  const plate = normalizePlate(input.plate || pass.patente || "");
  if (!plate || !input.company?.trim() || !input.policyNumber?.trim() || !input.validUntil) return;
  let vehicleId = pass.vehicleId;
  if (!vehicleId) {
    const existing = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.plate, plate)))
      .get();
    if (existing) vehicleId = existing.id;
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
  }
  const insId = nid();
  let cardPhotoUrl: string | null = null;
  if (input.cardPhotoBase64) {
    const raw = input.cardPhotoBase64.replace(/^data:[\w/+.-]+;base64,/, "").trim();
    try {
      let buf = Buffer.from(raw, "base64");
      if (buf.length > 80 && buf.length < 4 * 1024 * 1024) {
        try {
          buf = Buffer.from((await processDocumentImage(buf)).jpeg);
        } catch {
          /* se guarda igual */
        }
        cardPhotoUrl = saveVisitorDoc(pass.siteId, `veh-ins-${insId}`, "image/jpeg", buf);
      }
    } catch {
      /* sin foto */
    }
  }
  await db.insert(vehicleInsurances).values({
    id: insId,
    tenantId,
    vehicleId,
    company: input.company.trim(),
    policyNumber: input.policyNumber.trim(),
    validFrom: null,
    validUntil: new Date(input.validUntil),
    coverageType: "responsabilidad_civil",
    cardPhotoUrl,
    verifiedBy: null,
    status: "active",
    createdAt: new Date(),
  });
  await db
    .update(visitPasses)
    .set({ vehicleId, insuranceId: insId, patente: plate, completeness: "full" })
    .where(eq(visitPasses.id, passId));
}

async function ensurePersonForPass(tenantId: string, pass: typeof visitPasses.$inferSelect) {
  const dni = String(pass.guestDni || "").replace(/\D/g, "");
  if (!dni) return null;
  const existing = await db
    .select()
    .from(visitorIdentities)
    .where(and(eq(visitorIdentities.tenantId, tenantId), eq(visitorIdentities.dniNumber, dni)))
    .get();
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
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, passId)).get();
  if (!pass) return { ok: false, error: "El pase ya no existe" };
  if (!input.validUntil) return { ok: false, error: "Falta la fecha de vencimiento de la ART" };
  const person = await ensurePersonForPass(tenantId, pass);
  if (!person) return { ok: false, error: "Primero cargá el DNI" };
  const validUntilDate = new Date(input.validUntil);
  if (!Number.isFinite(validUntilDate.getTime())) return { ok: false, error: "Fecha de ART inválida" };
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
      const id = nid();
      documentPath = saveVisitorDoc(pass.siteId, id, mime, buf);
      documentMime = mime;
    } catch {
      return { ok: false, error: "La constancia no se pudo leer" };
    }
  }
  const id = nid();
  await db.insert(personInsurances).values({
    id,
    tenantId,
    personId: person.id,
    kind: input.kind === "art" ? "art" : "life",
    company: input.company?.trim() || null,
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
  input: { licenseNumber?: string; validUntil?: string; photoBase64?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, passId)).get();
  if (!pass) return { ok: false, error: "El pase ya no existe" };
  if (!input.validUntil) return { ok: false, error: "Falta el vencimiento de la licencia" };
  const person = await ensurePersonForPass(tenantId, pass);
  if (!person) return { ok: false, error: "Primero cargá el DNI" };
  const validUntilDate = new Date(input.validUntil);
  if (!Number.isFinite(validUntilDate.getTime())) return { ok: false, error: "Fecha de licencia inválida" };
  let photoUrl: string | null = null;
  if (input.photoBase64) {
    const raw = input.photoBase64.replace(/^data:[\w/+.-]+;base64,/, "").trim();
    try {
      let buf = Buffer.from(raw, "base64");
      if (buf.length > 80 && buf.length < 4 * 1024 * 1024) {
        try {
          buf = Buffer.from((await processDocumentImage(buf)).jpeg);
        } catch {
          /* igual */
        }
        photoUrl = saveVisitorDoc(pass.siteId, `lic-${nid()}`, "image/jpeg", buf);
      }
    } catch {
      /* sin foto */
    }
  }
  const id = nid();
  await db.insert(driverLicenses).values({
    id,
    tenantId,
    personId: person.id,
    licenseNumber: (input.licenseNumber || person.dniNumber).trim(),
    classes: "B.1",
    jurisdiction: null,
    validUntil: validUntilDate,
    photoUrl,
    createdAt: new Date(),
  });
  await db.update(visitPasses).set({ licenseId: id }).where(eq(visitPasses.id, passId));
  return { ok: true };
}

export async function requestExpiredDocsAuth(input: {
  site: { id: string; tenantId: string };
  approvalId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db
    .select()
    .from(guardApprovals)
    .where(and(eq(guardApprovals.id, input.approvalId), eq(guardApprovals.siteId, input.site.id)))
    .get();
  if (!row || row.status !== "pending") return { ok: false, error: "No hay una solicitud pendiente" };
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, row.passId)).get();
  if (!pass) return { ok: false, error: "El pase ya no existe" };
  const gaps = await visitFieldGaps(pass.id);
  if (!gaps.expired.length) return { ok: false, error: "No hay un documento vencido en esta ficha" };
  const labels = gaps.expired
    .map((k) => (k === "art" ? "ART / seguro de vida" : k === "licencia" ? "licencia" : "seguro del auto"))
    .join(", ");
  await db
    .update(guardApprovals)
    .set({ ownerAuthStatus: "pending_owner" })
    .where(eq(guardApprovals.id, row.id));
  await createOwnerNotice({
    siteId: input.site.id,
    tenantId: input.site.tenantId,
    propertyId: pass.propertyId,
    passId: pass.id,
    approvalId: row.id,
    kind: "expired_docs",
    title: "Autorizar excepción (documento vencido)",
    message: `${pass.guestName} tiene ${labels} vencido. Si autorizás, portería puede dejar pasar.`,
    payload: { expired: gaps.expired, guestName: pass.guestName },
    ttlMs: 4 * 60 * 60 * 1000,
  });
  return { ok: true };
}

export async function announceWalkIn(input: {
  site: { id: string; tenantId: string };
  propertyId: string;
  guardUserId: string;
  guestName?: string;
  guestDni?: string;
}): Promise<{ ok: true; passId: string; approvalId: string } | { ok: false; error: string }> {
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
  await db.insert(visitPasses).values({
    id: passId,
    propertyId: property.id,
    siteId: input.site.id,
    authorizationId: null,
    token,
    guestName,
    guestDni: input.guestDni?.replace(/\D/g, "") || null,
    patente: null,
    validFrom: now,
    validUntil: new Date(now.getTime() + defaultHours * 60 * 60 * 1000),
    horaDesde: null,
    horaHasta: null,
    status: "awaiting_entry",
    arrivalMode: "peatonal",
    visitKind: "social",
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
    title: "Bien no registrado en la salida",
    message: `${pass.guestName} sale con: ${input.description.trim() || "un objeto no declarado"}. La barrera queda retenida hasta que autorices.`,
    payload: { description: input.description, hasPhoto: Boolean(photoPath) },
    ttlMs: 30 * 60 * 1000,
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
  const comps = await listCompanions(pass.id);
  const minorsIn = comps.filter((x) => companionIsMinor(x)).length;
  const extraMinors =
    Number(row.exitMinorsCount ?? 0) > minorsIn && !row.minorTransferAuthorizedByUserId;
  const patch: Partial<typeof guardApprovals.$inferInsert> = {};
  if (row.ownerAuthStatus === "pending_owner" || row.ownerAuthStatus === "owner_expired") {
    patch.ownerAuthStatus = "owner_approved";
    patch.ownerAuthorizedByUserId = input.guardUserId;
  }
  if (row.goodsAlert && !row.goodsAuthorizedByUserId) {
    patch.goodsAuthorizedByUserId = input.guardUserId;
  }
  if (extraMinors) patch.minorTransferAuthorizedByUserId = input.guardUserId;
  if (!Object.keys(patch).length) {
    return { ok: false, error: "No hay una autorización de titular pendiente" };
  }
  const now = new Date();
  await db.update(guardApprovals).set(patch).where(eq(guardApprovals.id, row.id));
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

