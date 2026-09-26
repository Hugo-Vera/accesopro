import { and, eq, lt, isNotNull } from "drizzle-orm";
import { ASI_USER_TYPES, randomAsiCardNo } from "@accesopro/catalog";
import { db } from "./db/client.js";
import {
  events,
  guardApprovals,
  personCredentials,
  propertyFamilyMembers,
  ownerProfiles,
  users,
  visitPasses,
} from "./db/schema.js";
import { openViaLabel } from "./openContext.js";
import { stampResidentInfo } from "./residentInfo.js";
import {
  deletePersonOnSiteDevicesWait,
  enrollOk,
  enrollPersonOnSiteDevicesWait,
} from "./dahuaSite.js";
import {
  findCredentialByPayload,
  incrementCredentialUse,
  listCredentials,
  revokeCredentialsForUser,
  upsertCredential,
} from "./credentials.js";
import { getVisitAuthDefaultHours } from "./retention.js";
import { actuatorsForSentido } from "./accessPoints.js";
import { fireActuator } from "./actuatorExec.js";
import { broadcastRealtimeEvent } from "./eventStream.js";
import { nid } from "./scope.js";
import { parseVisitQrPayload } from "./visitPass.js";

export type AccessQrView = {
  active: boolean;
  credentialId: string | null;
  payload: string | null;
  qrHint: string | null;
  validFrom: Date | number | null;
  validUntil: Date | number | null;
  label: string | null;
};

function qrHintOf(payload: string | null | undefined) {
  const p = String(payload || "").trim();
  if (p.length < 4) return p || null;
  return `****${p.slice(-4)}`;
}

export async function activeAccessQr(siteId: string, dahuaUserId: string): Promise<AccessQrView> {
  const rows = await listCredentials(siteId, dahuaUserId);
  const now = Date.now();
  const qr = rows.find((c) => {
    if (c.kind !== "qr" || c.status !== "active") return false;
    const until = c.validUntil instanceof Date ? c.validUntil.getTime() : Number(c.validUntil) || 0;
    if (until && until < now) return false;
    return true;
  });
  if (!qr) {
    return {
      active: false,
      credentialId: null,
      payload: null,
      qrHint: null,
      validFrom: null,
      validUntil: null,
      label: null,
    };
  }
  return {
    active: true,
    credentialId: qr.id,
    payload: qr.payload,
    qrHint: qrHintOf(qr.payload),
    validFrom: qr.validFrom,
    validUntil: qr.validUntil,
    label: qr.label,
  };
}

/** Emite o rota el QR de acceso own_/fam_ (abre solo; no es visita). */
export async function issueAccessQr(input: {
  siteId: string;
  tenantId: string;
  dahuaUserId: string;
  name: string;
  photoBase64?: string | null;
  /** Sin fecha = permanente. Con useDefaultHours = plazo del barrio. */
  validFrom?: Date | null;
  validUntil?: Date | null;
  useDefaultHours?: boolean;
}): Promise<{ ok: true; accessQr: AccessQrView; deviceSync: unknown } | { ok: false; error: string }> {
  const dahuaUserId = input.dahuaUserId.trim();
  if (!dahuaUserId.startsWith("own_") && !dahuaUserId.startsWith("fam_")) {
    return { ok: false, error: "Solo se emite QR de acceso para titular o familiar" };
  }

  let validFrom = input.validFrom ?? null;
  let validUntil = input.validUntil ?? null;
  if (input.useDefaultHours) {
    const hours = await getVisitAuthDefaultHours(input.tenantId);
    validFrom = new Date();
    validUntil = new Date(Date.now() + hours * 3_600_000);
  }

  // Rotar: baja QR previos del mismo usuario (no toca cara/tarjeta/PIN).
  const prev = await listCredentials(input.siteId, dahuaUserId);
  for (const c of prev.filter((x) => x.kind === "qr" && x.status === "active")) {
    await db
      .update(personCredentials)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(personCredentials.id, c.id));
  }

  const payload = randomAsiCardNo();
  const cred = await upsertCredential({
    siteId: input.siteId,
    dahuaUserId,
    kind: "qr",
    payload,
    label: input.name,
    validFrom,
    validUntil,
    maxUses: 0,
    validationMode: "local",
  });

  const results = await enrollPersonOnSiteDevicesWait(
    input.siteId,
    {
      userId: dahuaUserId,
      name: input.name,
      cardNo: cred.payload,
      photoBase64: input.photoBase64 || undefined,
      userType: ASI_USER_TYPES.general,
      useTime: 0,
    },
    validFrom || validUntil
      ? { fechaDesde: validFrom ?? undefined, fechaHasta: validUntil ?? undefined }
      : undefined,
  );

  if (dahuaUserId.startsWith("own_")) {
    await db
      .update(ownerProfiles)
      .set({ dahuaSynced: enrollOk(results), dahuaUserId })
      .where(eq(ownerProfiles.dahuaUserId, dahuaUserId));
  } else {
    await db
      .update(propertyFamilyMembers)
      .set({ dahuaSynced: enrollOk(results), dahuaUserId })
      .where(eq(propertyFamilyMembers.dahuaUserId, dahuaUserId));
  }

  return {
    ok: true,
    accessQr: {
      active: true,
      credentialId: cred.id,
      payload: cred.payload,
      qrHint: qrHintOf(cred.payload),
      validFrom: cred.validFrom,
      validUntil: cred.validUntil,
      label: cred.label,
    },
    deviceSync: results,
  };
}

export async function revokeAccessQr(input: {
  siteId: string;
  dahuaUserId: string;
  /** Si true, borra la persona del ASI (solo si no tiene cara/otras creds activas). */
  deletePersonIfOrphan?: boolean;
}) {
  const rows = await listCredentials(input.siteId, input.dahuaUserId);
  const activeQr = rows.filter((c) => c.kind === "qr" && c.status === "active");
  for (const c of activeQr) {
    await db
      .update(personCredentials)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(personCredentials.id, c.id));
  }
  const stillActive = (await listCredentials(input.siteId, input.dahuaUserId)).some(
    (c) => c.status === "active" && c.kind !== "qr",
  );
  const ownerRow = await db.select().from(ownerProfiles).where(eq(ownerProfiles.dahuaUserId, input.dahuaUserId)).get();
  const famRow = await db
    .select()
    .from(propertyFamilyMembers)
    .where(eq(propertyFamilyMembers.dahuaUserId, input.dahuaUserId))
    .get();
  const photo = ownerRow?.photoBase64 || famRow?.photoBase64 || null;
  const name = ownerRow?.fullName || famRow?.name || input.dahuaUserId;
  if (photo || stillActive) {
    const rows = await listCredentials(input.siteId, input.dahuaUserId);
    const card = rows.find((c) => c.kind === "card" && c.status === "active");
    const pin = rows.find((c) => c.kind === "pin" && c.status === "active");
    await enrollPersonOnSiteDevicesWait(input.siteId, {
      userId: input.dahuaUserId,
      name,
      cardNo: card?.payload || input.dahuaUserId,
      password: pin?.payload || undefined,
      photoBase64: photo || undefined,
      userType: ASI_USER_TYPES.general,
    });
  } else if (input.deletePersonIfOrphan) {
    await deletePersonOnSiteDevicesWait(input.siteId, { userId: input.dahuaUserId });
  }
  return { ok: true as const };
}

/** Baja pases de visita y credenciales QR cuja vigencia ya pasó. */
export async function expireTimedCredentialsAndPasses(now = new Date()) {
  const t = now.getTime();
  let visits = 0;
  let creds = 0;

  const openPasses = await db.select().from(visitPasses);
  for (const pass of openPasses) {
    if (pass.status === "revoked" || pass.status === "denied" || pass.status === "completed" || pass.status === "expired") {
      continue;
    }
    // Con alguien adentro el pase no vence: la salida se aprueba con aviso de horario excedido.
    if (pass.status === "in_site" || pass.status === "awaiting_exit") continue;
    const until = pass.validUntil instanceof Date ? pass.validUntil.getTime() : Number(pass.validUntil) || 0;
    if (!until || until >= t) continue;
    await expireVisitPassOnSite(pass.siteId, pass);
    visits += 1;
  }

  const expiredCreds = await db
    .select()
    .from(personCredentials)
    .where(
      and(
        eq(personCredentials.status, "active"),
        eq(personCredentials.kind, "qr"),
        isNotNull(personCredentials.validUntil),
        lt(personCredentials.validUntil, now),
      ),
    );
  const touchedUsers = new Set<string>();
  for (const c of expiredCreds) {
    await db
      .update(personCredentials)
      .set({ status: "revoked", revokedAt: now })
      .where(eq(personCredentials.id, c.id));
    if (c.dahuaUserId.startsWith("v_")) {
      try {
        await deletePersonOnSiteDevicesWait(c.siteId, { userId: c.dahuaUserId });
      } catch {
        /* ignore */
      }
    } else if (
      (c.dahuaUserId.startsWith("own_") || c.dahuaUserId.startsWith("fam_")) &&
      !touchedUsers.has(`${c.siteId}:${c.dahuaUserId}`)
    ) {
      touchedUsers.add(`${c.siteId}:${c.dahuaUserId}`);
      await revokeAccessQr({ siteId: c.siteId, dahuaUserId: c.dahuaUserId, deletePersonIfOrphan: true });
    }
    creds += 1;
  }

  return { visits, creds };
}

/** Pase cerrado (salida definitiva): se da de baja el v_ del ASI. */
export async function releaseVisitCredential(siteId: string, passId: string) {
  const dahuaUserId = `v_${passId.slice(-8)}`;
  await revokeCredentialsForUser(siteId, dahuaUserId);
  try {
    await deletePersonOnSiteDevicesWait(siteId, { userId: dahuaUserId });
  } catch {
    /* ignore */
  }
}

export async function expireVisitPassOnSite(siteId: string, pass: { id: string; siteId: string }) {
  await db.update(visitPasses).set({ status: "expired" }).where(eq(visitPasses.id, pass.id));
  await db
    .update(guardApprovals)
    .set({ status: "denied", comment: "Pase vencido", decidedAt: new Date() })
    .where(and(eq(guardApprovals.passId, pass.id), eq(guardApprovals.status, "pending")));
  const dahuaUserId = `v_${pass.id.slice(-8)}`;
  await revokeCredentialsForUser(siteId, dahuaUserId);
  try {
    await deletePersonOnSiteDevicesWait(siteId, { userId: dahuaUserId });
  } catch {
    /* ignore */
  }
}

/** Portería escanea QR own_/fam_: abre sin cola de visita. */
export async function openAccessQrFromScan(input: {
  site: { id: string; tenantId: string };
  cardRaw: string;
  scanChannel?: string;
  guardUserId?: string;
  sentido?: "in" | "out";
}): Promise<
  | {
      ok: true;
      accessKind: "access_qr";
      dahuaUserId: string;
      personName: string;
      actuatorsFired: string[];
      validUntil: Date | number | null;
    }
  | { ok: false; error: string; denied?: boolean; validFrom?: Date | number | null; validUntil?: Date | number | null }
> {
  const card = (parseVisitQrPayload(input.cardRaw) ?? input.cardRaw).trim().toUpperCase();
  if (!card) return { ok: false, error: "QR vacío" };
  const cred = await findCredentialByPayload(input.site.id, card, "qr");
  if (!cred || cred.status !== "active") return { ok: false, error: "QR no autorizado" };
  if (cred.dahuaUserId.startsWith("v_")) return { ok: false, error: "QR no autorizado" };
  if (!cred.dahuaUserId.startsWith("own_") && !cred.dahuaUserId.startsWith("fam_")) {
    return { ok: false, error: "QR no autorizado" };
  }

  const now = Date.now();
  const until = cred.validUntil instanceof Date ? cred.validUntil.getTime() : Number(cred.validUntil) || 0;
  const from = cred.validFrom instanceof Date ? cred.validFrom.getTime() : Number(cred.validFrom) || 0;
  if (from && now < from) {
    return {
      ok: false,
      denied: true,
      error: "El QR de acceso todavía no vale",
      validFrom: cred.validFrom,
      validUntil: cred.validUntil,
    };
  }
  if (until && now > until) {
    await revokeAccessQr({
      siteId: input.site.id,
      dahuaUserId: cred.dahuaUserId,
      deletePersonIfOrphan: true,
    });
    return {
      ok: false,
      denied: true,
      error: "QR de acceso vencido",
      validFrom: cred.validFrom,
      validUntil: cred.validUntil,
    };
  }

  const owner = await db.select().from(ownerProfiles).where(eq(ownerProfiles.dahuaUserId, cred.dahuaUserId)).get();
  const fam = !owner
    ? await db.select().from(propertyFamilyMembers).where(eq(propertyFamilyMembers.dahuaUserId, cred.dahuaUserId)).get()
    : null;
  const personName = owner?.fullName || fam?.name || cred.label || cred.dahuaUserId;
  const sentido = input.sentido === "out" ? "out" : "in";
  const targets = (await actuatorsForSentido(input.site.id, sentido)).filter((a) => a.triggerQr);
  const eventId = nid();
  const guard = input.guardUserId
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, input.guardUserId)).get()
    : null;
  const fired: string[] = [];
  for (const a of targets) {
    const r = await fireActuator({ id: input.site.id, lastSeenAt: null }, a.id, "open", {
      reason: "access_qr",
      eventId,
      personName,
      openedByUserId: input.guardUserId || null,
      openedByName: guard?.name || null,
      openedVia: input.scanChannel === "app" ? "app" : "web",
    });
    if (r.ok) fired.push(a.id);
  }
  if (!fired.length) {
    return { ok: false, error: "No hay actuadores de QR en ese carril. Revisá el cableado." };
  }
  await incrementCredentialUse(cred.id);
  const payload: Record<string, unknown> = {
    accessKind: "access_qr",
    dahuaUserId: cred.dahuaUserId,
    personName,
    qrHint: qrHintOf(cred.payload),
    scanChannel: input.scanChannel || "web",
    approved: true,
    passthroughGranted: true,
    guardUserId: input.guardUserId || null,
    openedByName: guard?.name || null,
    openedVia: input.scanChannel === "app" ? "app" : "web",
    openedViaLabel: openViaLabel(input.scanChannel === "app" ? "app" : "web"),
  };
  await stampResidentInfo(payload, cred.dahuaUserId).catch(() => undefined);
  await db.insert(events).values({
    id: eventId,
    siteId: input.site.id,
    type: "qr_access",
    sentido,
    payload: JSON.stringify(payload),
    createdAt: new Date(),
  });
  broadcastRealtimeEvent({
    id: eventId,
    siteId: input.site.id,
    tenantId: input.site.tenantId,
    type: "access_event",
    payload,
    createdAt: Date.now(),
  });
  return {
    ok: true,
    accessKind: "access_qr",
    dahuaUserId: cred.dahuaUserId,
    personName,
    actuatorsFired: fired,
    validUntil: cred.validUntil,
  };
}
