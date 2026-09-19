import { and, desc, eq } from "drizzle-orm";
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
} from "./db/schema.js";
import { fireActuator } from "./actuatorExec.js";
import { actuatorsForDahuaDevice, actuatorsForSentido, laneCodeOf } from "./accessPoints.js";
import { broadcastRealtimeEvent } from "./eventStream.js";
import { nid, normalizePlate } from "./scope.js";
import { parseVisitQrPayload } from "./visitPass.js";
import { companionIsMinor, isMinorBirthDate } from "./age.js";
import { createOwnerNotice, expireOwnerNotices } from "./ownerNotices.js";
import { saveEventPhoto } from "./eventPhotos.js";

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

export async function missingVisitFields(passId: string): Promise<string[]> {
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, passId)).get();
  if (!pass) return ["pase"];
  const missing: string[] = [];
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
  }
  return missing;
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
}): Promise<{
  held: boolean;
  passId?: string;
  approvalId?: string;
  reason?: string;
  guestName?: string;
}> {
  const pass = await findVisitPassByCard(input.siteId, input.cardRaw);
  if (!pass) return { held: false };
  if (pass.status === "revoked" || pass.status === "denied") {
    return { held: true, passId: pass.id, guestName: pass.guestName, reason: "closed" };
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
  } else if (existing.reason !== reason || existing.sentido !== sentido) {
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

  return { held: true, passId: pass.id, approvalId, reason, guestName: pass.guestName };
}

async function openForVisit(
  site: { id: string; lastSeenAt: Date | number | null },
  sentido: "in" | "out",
  deviceId?: string | null,
) {
  const fired: string[] = [];
  const wired = deviceId ? await actuatorsForDahuaDevice(site.id, deviceId) : [];
  const byLane = await actuatorsForSentido(site.id, sentido);
  const targets = wired.length ? wired : byLane.filter((x) => x.triggerQr);
  for (const a of targets) {
    const r = await fireActuator(site, a.id, "open");
    if (r.ok) fired.push(a.name);
  }
  return fired;
}

export async function decideGuardApproval(input: {
  site: { id: string; tenantId: string; lastSeenAt: Date | number | null };
  approvalId: string;
  guardUserId: string;
  decision: "approved" | "denied";
  comment?: string | null;
  trunkChecked?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string; missing?: string[] }> {
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
    return { ok: true };
  }

  const missing = await missingVisitFields(pass.id);
  if (missing.length) return { ok: false, error: "Faltan datos obligatorios", missing };
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

  const fired = await openForVisit(input.site, row.sentido as "in" | "out", row.deviceId);
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
      actuatorsFired: fired,
      accessKind: "visita",
      guardApproved: true,
    }),
    createdAt: now,
  });
  broadcastRealtimeEvent({
    id: nid(),
    siteId: input.site.id,
    tenantId: input.site.tenantId,
    type: "visit_hold",
    payload: { passId: pass.id, approvalId: row.id, decided: "approved", sentido: row.sentido },
    createdAt: now.getTime(),
  });
  return { ok: true };
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
  const missing = await missingVisitFields(pass.id);
  let insurance: { company: string; policyNumber: string; validUntil: Date | number } | null = null;
  if (pass.insuranceId) {
    const ins = await db.select().from(vehicleInsurances).where(eq(vehicleInsurances.id, pass.insuranceId)).get();
    if (ins) insurance = { company: ins.company, policyNumber: ins.policyNumber, validUntil: ins.validUntil };
  } else if (pass.vehicleId) {
    const ins = await db
      .select()
      .from(vehicleInsurances)
      .where(eq(vehicleInsurances.vehicleId, pass.vehicleId))
      .orderBy(desc(vehicleInsurances.createdAt))
      .get();
    if (ins) insurance = { company: ins.company, policyNumber: ins.policyNumber, validUntil: ins.validUntil };
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
    needsTrunk: needsVehicleDocs(pass.arrivalMode),
    missing,
    companions: companions.map((x) => ({
      id: x.id,
      name: x.name,
      dni: x.dni,
      birthDate: x.birthDate,
      isMinor: companionIsMinor(x),
      situation: x.situation,
    })),
    insurance,
    lotNumber: property?.lotNumber ?? null,
    propertyId: pass.propertyId,
    mapLat: property?.mapLat ?? null,
    mapLng: property?.mapLng ?? null,
    lotPolygon: property?.lotPolygon ?? null,
    ...contact,
    ownerAuthStatus: row?.ownerAuthStatus ?? "none",
    ownerAuthExpiresAt: row?.ownerAuthExpiresAt ?? null,
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
  input: { plate?: string; company?: string; policyNumber?: string; validUntil?: string },
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
  await db.insert(vehicleInsurances).values({
    id: insId,
    tenantId,
    vehicleId,
    company: input.company.trim(),
    policyNumber: input.policyNumber.trim(),
    validFrom: null,
    validUntil: new Date(input.validUntil),
    coverageType: "responsabilidad_civil",
    cardPhotoUrl: null,
    verifiedBy: null,
    status: "active",
    createdAt: new Date(),
  });
  await db
    .update(visitPasses)
    .set({ vehicleId, insuranceId: insId, patente: plate, completeness: "full" })
    .where(eq(visitPasses.id, passId));
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
    validUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000),
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

