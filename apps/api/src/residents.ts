import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import bcrypt from "bcryptjs";
import type { AuthUser } from "./auth.js";
import { requireAuth } from "./auth.js";
import { db } from "./db/client.js";
import {
  credentialDeviceSync,
  ownerProfiles,
  properties,
  propertyFamilyMembers,
  propertyServices,
  tenantModules,
  users,
  visitAuthorizations,
  visitPasses,
} from "./db/schema.js";
import {
  deletePersonOnSiteDevicesWait,
  enrollOk,
  enrollPersonOnSiteDevicesWait,
} from "./dahuaSite.js";
import { revokeAuthorizationOnEngine, syncAuthorizationToEngine, syncOwnerDniToEngine } from "./engineSync.js";
import { nid, normalizePlate, scopedSiteWithModule } from "./scope.js";
import { makeVisitToken } from "./visitPass.js";
import { applyRoleTemplate, userHasCapability } from "./grants.js";
import { assertFeature, tenantFeatureEnabled } from "./features.js";
import {
  activationUrl,
  hashPassword,
  inviteExpiresAt,
  inviteShareText,
  newInviteToken,
  newTempPassword,
  normalizeArWhatsapp,
} from "./ownerInvite.js";

type Env = { Variables: { user: AuthUser } };

export const residents = new Hono<Env>();
residents.use("*", requireAuth);

function parseDateInput(raw: string | undefined, fallback?: Date): Date {
  if (!raw) return fallback ?? new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error("Fecha inválida");
  return d;
}

async function ownerContext(user: AuthUser) {
  let profile = await db.select().from(ownerProfiles).where(eq(ownerProfiles.userId, user.id)).get();
  let property = profile ? await db.select().from(properties).where(eq(properties.id, profile.propertyId)).get() : null;

  if ((!profile || !property) && isAdmin(user) && user.tenantId) {
    property = await db.select().from(properties).where(eq(properties.tenantId, user.tenantId)).limit(1).get();
    if (property) {
      profile = await db.select().from(ownerProfiles).where(eq(ownerProfiles.propertyId, property.id)).limit(1).get();
      if (!profile) {
        const profileId = nid();
        await db.insert(ownerProfiles).values({
          id: profileId,
          userId: user.id,
          propertyId: property.id,
          fullName: user.name,
          dni: "30123456",
          phone: "+54 9 11 5555-0001",
          createdAt: new Date(),
        });
        profile = await db.select().from(ownerProfiles).where(eq(ownerProfiles.id, profileId)).get();
      }
    }
  }

  if (!profile || !property) return null;
  return { profile, property };
}

function isAdmin(user: AuthUser) {
  return user.role === "platform_admin" || user.role === "tenant_admin";
}

async function canInvite(user: AuthUser) {
  if (isAdmin(user)) return true;
  return userHasCapability(user, "access.owners.invite");
}

function publicWebBase(c: { req: { header: (n: string) => string | undefined } }) {
  const env = (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",")[0]?.trim();
  return c.req.header("origin") || env || "http://localhost:3000";
}

async function featureMap(tenantId: string) {
  return {
    face: await tenantFeatureEnabled(tenantId, "dahua.face"),
    qr: await tenantFeatureEnabled(tenantId, "dahua.qr"),
    fingerprint: await tenantFeatureEnabled(tenantId, "dahua.fingerprint"),
    card: await tenantFeatureEnabled(tenantId, "dahua.card"),
    password: await tenantFeatureEnabled(tenantId, "dahua.password"),
  };
}

async function syncLanes(dahuaUserId: string | null | undefined) {
  if (!dahuaUserId) return [];
  return db.select().from(credentialDeviceSync).where(eq(credentialDeviceSync.dahuaUserId, dahuaUserId));
}

// ── Admin / vigilador: propiedades ───────────────────────────────────────────

residents.get("/properties", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  if (!(await canInvite(c.get("user")))) return c.json({ error: "Sin permiso para ver lotes" }, 403);
  const rows = await db.select().from(properties).where(eq(properties.tenantId, scoped.tenantId));
  const propertiesOut = [];
  for (const p of rows) {
    const profiles = await db.select().from(ownerProfiles).where(eq(ownerProfiles.propertyId, p.id));
    const owners = [];
    for (const pr of profiles) {
      const u = await db.select().from(users).where(eq(users.id, pr.userId)).get();
      if (!u) continue;
      owners.push({
        userId: u.id,
        email: u.email,
        name: u.name,
        dni: pr.dni,
        whatsapp: pr.whatsapp,
        mustChangePassword: Boolean(u.mustChangePassword),
        invitePending: Boolean(u.mustChangePassword || u.inviteToken),
      });
    }
    propertiesOut.push({ ...p, owners });
  }
  return c.json({ properties: propertiesOut, canCreateLot: isAdmin(c.get("user")) });
});

residents.post("/properties", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  if (!isAdmin(c.get("user"))) return c.json({ error: "Solo administración del barrio" }, 403);
  const body = await c.req.json<{
    lotNumber?: string;
    label?: string;
    address?: string;
    mapLat?: string;
    mapLng?: string;
    lotPolygon?: string;
    notes?: string;
  }>();
  const lotNumber = String(body.lotNumber ?? "").trim();
  const label = String(body.label ?? "").trim();
  if (!lotNumber || !label) return c.json({ error: "Faltan lote y nombre" }, 400);
  const id = nid();
  await db.insert(properties).values({
    id,
    tenantId: scoped.tenantId,
    siteId: scoped.site.id,
    lotNumber,
    label,
    address: body.address?.trim() || null,
    mapLat: body.mapLat?.trim() || null,
    mapLng: body.mapLng?.trim() || null,
    lotPolygon: body.lotPolygon?.trim() || null,
    notes: body.notes?.trim() || null,
    createdAt: new Date(),
  });
  return c.json({ ok: true, id });
});

residents.patch("/properties/:id", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  if (!isAdmin(c.get("user"))) return c.json({ error: "Solo administración del barrio" }, 403);
  const body = await c.req.json<Record<string, unknown>>();
  const row = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, c.req.param("id")), eq(properties.tenantId, scoped.tenantId)))
    .get();
  if (!row) return c.json({ error: "Propiedad no encontrada" }, 404);
  await db
    .update(properties)
    .set({
      lotNumber: body.lotNumber ? String(body.lotNumber).trim() : row.lotNumber,
      label: body.label ? String(body.label).trim() : row.label,
      address: body.address !== undefined ? String(body.address || "").trim() || null : row.address,
      mapLat: body.mapLat !== undefined ? String(body.mapLat || "").trim() || null : row.mapLat,
      mapLng: body.mapLng !== undefined ? String(body.mapLng || "").trim() || null : row.mapLng,
      lotPolygon: body.lotPolygon !== undefined ? String(body.lotPolygon || "").trim() || null : row.lotPolygon,
      notes: body.notes !== undefined ? String(body.notes || "").trim() || null : row.notes,
    })
    .where(eq(properties.id, row.id));
  return c.json({ ok: true });
});

residents.post("/properties/:id/owners", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  if (!isAdmin(c.get("user"))) return c.json({ error: "Solo administración del barrio" }, 403);
  const property = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, c.req.param("id")), eq(properties.tenantId, scoped.tenantId)))
    .get();
  if (!property) return c.json({ error: "Propiedad no encontrada" }, 404);
  const body = await c.req.json<{
    email?: string;
    password?: string;
    name?: string;
    dni?: string;
    phone?: string;
  }>();
  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim();
  const password = body.password ?? "";
  if (!email || !name || password.length < 8) {
    return c.json({ error: "Email, nombre y clave (8+ caracteres) son obligatorios" }, 400);
  }
  const exists = await db.select().from(users).where(eq(users.email, email)).get();
  if (exists) return c.json({ error: "Ya existe un usuario con ese email" }, 409);
  const userId = nid();
  const profileId = nid();
  const hash = await bcrypt.hash(password, 10);
  await db.insert(users).values({
    id: userId,
    tenantId: scoped.tenantId,
    email,
    passwordHash: hash,
    name,
    role: "resident",
    createdAt: new Date(),
  });
  await db.insert(ownerProfiles).values({
    id: profileId,
    userId,
    propertyId: property.id,
    dni: body.dni?.trim() || null,
    phone: body.phone?.trim() || null,
    createdAt: new Date(),
  });
  if (body.dni?.trim()) {
    await syncOwnerDniToEngine(property.lotNumber, body.dni.trim(), name);
  }
  return c.json({ ok: true, userId, profileId });
});

residents.post("/properties/:id/invite", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  if (!(await canInvite(c.get("user")))) return c.json({ error: "Sin permiso para invitar propietarios" }, 403);
  const property = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, c.req.param("id")), eq(properties.tenantId, scoped.tenantId)))
    .get();
  if (!property) return c.json({ error: "Propiedad no encontrada" }, 404);
  const body = await c.req.json<{
    email?: string;
    name?: string;
    dni?: string;
    whatsapp?: string;
  }>();
  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim() || "";
  const dni = body.dni?.trim() || "";
  const whatsapp = normalizeArWhatsapp(body.whatsapp || "");
  if (!email) return c.json({ error: "Falta el email del propietario" }, 400);
  if (!name && !dni) return c.json({ error: "Pedí el nombre o el DNI" }, 400);
  if (!whatsapp) return c.json({ error: "Falta un WhatsApp válido (con código de área)" }, 400);
  const exists = await db.select().from(users).where(eq(users.email, email)).get();
  if (exists) return c.json({ error: "Ya existe un usuario con ese email" }, 409);

  const userId = nid();
  const profileId = nid();
  const tempPassword = newTempPassword();
  const token = newInviteToken();
  const displayName = name || `Lote ${property.lotNumber}`;
  await db.insert(users).values({
    id: userId,
    tenantId: scoped.tenantId,
    email,
    passwordHash: await hashPassword(tempPassword),
    name: displayName,
    role: "resident",
    mustChangePassword: true,
    inviteToken: token,
    inviteExpiresAt: inviteExpiresAt(),
    createdAt: new Date(),
  });
  await applyRoleTemplate(userId, "resident", c.get("user").id);
  await db.insert(ownerProfiles).values({
    id: profileId,
    userId,
    propertyId: property.id,
    fullName: name || null,
    dni: dni || null,
    whatsapp,
    phone: whatsapp,
    createdAt: new Date(),
  });
  if (dni) await syncOwnerDniToEngine(property.lotNumber, dni, displayName);
  const url = activationUrl(publicWebBase(c), token);
  const shareText = inviteShareText({
    name: displayName,
    lotNumber: property.lotNumber,
    email,
    tempPassword,
    url,
  });
  return c.json({
    ok: true,
    userId,
    profileId,
    email,
    tempPassword,
    activateUrl: url,
    whatsapp,
    waUrl: `https://wa.me/${whatsapp}?text=${encodeURIComponent(shareText)}`,
    shareText,
  });
});

residents.post("/invites/:userId/resend", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  if (!(await canInvite(c.get("user")))) return c.json({ error: "Sin permiso para reenviar" }, 403);
  const userId = c.req.param("userId");
  const u = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!u || u.tenantId !== scoped.tenantId || u.role !== "resident") {
    return c.json({ error: "Propietario no encontrado" }, 404);
  }
  const profile = await db.select().from(ownerProfiles).where(eq(ownerProfiles.userId, u.id)).get();
  const property = profile
    ? await db.select().from(properties).where(eq(properties.id, profile.propertyId)).get()
    : null;
  if (!property) return c.json({ error: "Lote no encontrado" }, 404);
  const tempPassword = newTempPassword();
  const token = newInviteToken();
  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
      inviteToken: token,
      inviteExpiresAt: inviteExpiresAt(),
    })
    .where(eq(users.id, u.id));
  const url = activationUrl(publicWebBase(c), token);
  const whatsapp = profile?.whatsapp ? normalizeArWhatsapp(profile.whatsapp) : null;
  const shareText = inviteShareText({
    name: u.name,
    lotNumber: property.lotNumber,
    email: u.email,
    tempPassword,
    url,
  });
  return c.json({
    ok: true,
    tempPassword,
    activateUrl: url,
    whatsapp,
    waUrl: whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(shareText)}` : null,
    shareText,
  });
});

residents.post("/invites/:userId/revoke", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  if (!isAdmin(c.get("user"))) return c.json({ error: "Solo administración puede revocar" }, 403);
  const userId = c.req.param("userId");
  const u = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!u || u.tenantId !== scoped.tenantId) return c.json({ error: "Usuario no encontrado" }, 404);
  await db
    .update(users)
    .set({ inviteToken: null, inviteExpiresAt: null, mustChangePassword: true })
    .where(eq(users.id, u.id));
  return c.json({ ok: true });
});

// ── Portal propietario ───────────────────────────────────────────────────────

residents.get("/me", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  const services = await db
    .select()
    .from(propertyServices)
    .where(and(eq(propertyServices.propertyId, ctx.property.id), eq(propertyServices.active, true)));
  const familyMembers = await db
    .select()
    .from(propertyFamilyMembers)
    .where(and(eq(propertyFamilyMembers.propertyId, ctx.property.id), eq(propertyFamilyMembers.active, true)));
  const panicRow = await db
    .select()
    .from(tenantModules)
    .where(and(eq(tenantModules.tenantId, scoped.tenantId), eq(tenantModules.moduleKey, "panic")))
    .get();
  const features = await featureMap(scoped.tenantId);
  const familyOut = [];
  for (const f of familyMembers) {
    familyOut.push({ ...f, deviceSync: await syncLanes(f.dahuaUserId) });
  }
  const servicesOut = [];
  for (const s of services) {
    servicesOut.push({ ...s, deviceSync: await syncLanes(s.dahuaUserId) });
  }
  return c.json({
    user: c.get("user"),
    profile: { ...ctx.profile, deviceSync: await syncLanes(ctx.profile.dahuaUserId) },
    property: ctx.property,
    services: servicesOut,
    familyMembers: familyOut,
    panicEnabled: Boolean(panicRow?.enabled),
    features,
  });
});

residents.patch("/me", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  const body = await c.req.json<{
    fullName?: string;
    dni?: string;
    phone?: string;
    phoneAlt?: string;
    emergencyName?: string;
    emergencyPhone?: string;
    photoBase64?: string;
  }>();

  const dahuaUserId = ctx.profile.dahuaUserId || `own_${ctx.profile.id.slice(-8)}`;

  await db
    .update(ownerProfiles)
    .set({
      fullName: body.fullName !== undefined ? body.fullName.trim() || null : ctx.profile.fullName,
      dni: body.dni !== undefined ? body.dni.trim() || null : ctx.profile.dni,
      phone: body.phone !== undefined ? body.phone.trim() || null : ctx.profile.phone,
      phoneAlt: body.phoneAlt !== undefined ? body.phoneAlt.trim() || null : ctx.profile.phoneAlt,
      emergencyName: body.emergencyName !== undefined ? body.emergencyName.trim() || null : ctx.profile.emergencyName,
      emergencyPhone: body.emergencyPhone !== undefined ? body.emergencyPhone.trim() || null : ctx.profile.emergencyPhone,
      photoBase64: body.photoBase64 !== undefined ? body.photoBase64 : ctx.profile.photoBase64,
      dahuaUserId,
    })
    .where(eq(ownerProfiles.id, ctx.profile.id));

  // Si se envió foto facial, la sincronizamos de inmediato con el terminal Dahua ASI
  let deviceSync: unknown = await syncLanes(dahuaUserId);
  if (body.photoBase64) {
    const blocked = await assertFeature(scoped.tenantId, "dahua.face");
    if (blocked) return c.json({ error: blocked }, 403);
    const results = await enrollPersonOnSiteDevicesWait(
      ctx.property.siteId,
      {
        userId: dahuaUserId,
        name: body.fullName?.trim() || ctx.profile.fullName || c.get("user").name,
        cardNo: body.dni?.trim() || ctx.profile.dni || dahuaUserId,
        photoBase64: body.photoBase64,
        userType: 0,
      },
    );
    await db
      .update(ownerProfiles)
      .set({ dahuaSynced: enrollOk(results), dahuaUserId })
      .where(eq(ownerProfiles.id, ctx.profile.id));
    deviceSync = results;
  }

  return c.json({ ok: true, dahuaUserId, deviceSync });
});

residents.post("/me/sync-face", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  if (!ctx.profile.photoBase64) {
    return c.json({ error: "No hay foto facial cargada para el titular" }, 400);
  }

  const dahuaUserId = ctx.profile.dahuaUserId || `own_${ctx.profile.id.slice(-8)}`;
  const blocked = await assertFeature(scoped.tenantId, "dahua.face");
  if (blocked) return c.json({ error: blocked }, 403);
  const results = await enrollPersonOnSiteDevicesWait(ctx.property.siteId, {
    userId: dahuaUserId,
    name: ctx.profile.fullName || c.get("user").name,
    cardNo: ctx.profile.dni || dahuaUserId,
    photoBase64: ctx.profile.photoBase64,
    userType: 0,
  });

  await db
    .update(ownerProfiles)
    .set({ dahuaSynced: enrollOk(results), dahuaUserId })
    .where(eq(ownerProfiles.id, ctx.profile.id));

  return c.json({ ok: true, synced: enrollOk(results), dahuaUserId, deviceSync: results });
});

// ── Portal: Grupo Familiar ──────────────────────────────────────────────────

residents.get("/me/family", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  const rows = await db
    .select()
    .from(propertyFamilyMembers)
    .where(and(eq(propertyFamilyMembers.propertyId, ctx.property.id), eq(propertyFamilyMembers.active, true)));
  return c.json({ familyMembers: rows });
});

residents.post("/me/family", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);

  const body = await c.req.json<{
    name?: string;
    dni?: string;
    relationship?: string;
    phone?: string;
    photoBase64?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    horaDesde?: string;
    horaHasta?: string;
    diasSemana?: number[];
  }>();

  const name = body.name?.trim();
  if (!name) return c.json({ error: "Falta el nombre del familiar" }, 400);
  if (body.photoBase64) {
    const blocked = await assertFeature(scoped.tenantId, "dahua.face");
    if (blocked) return c.json({ error: blocked }, 403);
  }

  const id = nid();
  const dahuaUserId = `fam_${id.slice(-8)}`;
  const fechaDesde = body.fechaDesde ? parseDateInput(body.fechaDesde) : null;
  const fechaHasta = body.fechaHasta ? parseDateInput(body.fechaHasta) : null;

  await db.insert(propertyFamilyMembers).values({
    id,
    propertyId: ctx.property.id,
    name,
    dni: body.dni?.trim() || null,
    relationship: body.relationship?.trim() || "familiar",
    phone: body.phone?.trim() || null,
    photoBase64: body.photoBase64 || null,
    dahuaUserId,
    dahuaSynced: false,
    fechaDesde,
    fechaHasta,
    horaDesde: body.horaDesde?.trim() || null,
    horaHasta: body.horaHasta?.trim() || null,
    diasSemana: body.diasSemana ? JSON.stringify(body.diasSemana) : null,
    active: true,
    createdAt: new Date(),
  });

  let deviceSync: unknown[] = [];
  if (body.photoBase64) {
    const results = await enrollPersonOnSiteDevicesWait(
      ctx.property.siteId,
      {
        userId: dahuaUserId,
        name,
        cardNo: body.dni?.trim() || dahuaUserId,
        photoBase64: body.photoBase64,
        userType: 0,
      },
      {
        horaDesde: body.horaDesde,
        horaHasta: body.horaHasta,
        diasSemana: body.diasSemana,
        fechaDesde,
        fechaHasta,
      },
    );
    await db
      .update(propertyFamilyMembers)
      .set({ dahuaSynced: enrollOk(results) })
      .where(eq(propertyFamilyMembers.id, id));
    deviceSync = results;
  }

  return c.json({ ok: true, id, dahuaUserId, deviceSync });
});

residents.delete("/me/family/:id", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);

  const row = await db
    .select()
    .from(propertyFamilyMembers)
    .where(and(eq(propertyFamilyMembers.id, c.req.param("id")), eq(propertyFamilyMembers.propertyId, ctx.property.id)))
    .get();
  if (!row) return c.json({ error: "Familiar no encontrado" }, 404);

  await db
    .update(propertyFamilyMembers)
    .set({ active: false })
    .where(eq(propertyFamilyMembers.id, row.id));

  if (row.dahuaUserId) {
    await deletePersonOnSiteDevicesWait(ctx.property.siteId, { userId: row.dahuaUserId });
  }

  return c.json({ ok: true });
});

residents.get("/me/services", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  const rows = await db.select().from(propertyServices).where(eq(propertyServices.propertyId, ctx.property.id));
  return c.json({ services: rows });
});

residents.post("/me/services", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  const body = await c.req.json<{
    role?: string;
    name?: string;
    dni?: string;
    patente?: string;
    phone?: string;
    horaDesde?: string;
    horaHasta?: string;
    diasSemana?: number[];
    fechaDesde?: string;
    fechaHasta?: string;
    notes?: string;
    photoBase64?: string;
  }>();
  const name = body.name?.trim();
  const role = body.role?.trim() || "otro";
  if (!name) return c.json({ error: "Falta el nombre" }, 400);
  const id = nid();
  const dahuaUserId = `svc_${id.slice(-8)}`;
  const fechaDesde = body.fechaDesde ? parseDateInput(body.fechaDesde) : null;
  const fechaHasta = body.fechaHasta ? parseDateInput(body.fechaHasta) : null;
  await db.insert(propertyServices).values({
    id,
    propertyId: ctx.property.id,
    role,
    name,
    dni: body.dni?.trim() || null,
    patente: body.patente ? normalizePlate(body.patente) : null,
    phone: body.phone?.trim() || null,
    horaDesde: body.horaDesde?.trim() || null,
    horaHasta: body.horaHasta?.trim() || null,
    diasSemana: body.diasSemana ? JSON.stringify(body.diasSemana) : null,
    fechaDesde,
    fechaHasta,
    notes: body.notes?.trim() || null,
    photoBase64: body.photoBase64 || null,
    dahuaUserId,
    dahuaSynced: false,
    active: true,
    createdAt: new Date(),
  });
  let deviceSync: unknown[] = [];
  if (body.photoBase64 || body.dni) {
    if (body.photoBase64) {
      const blocked = await assertFeature(scoped.tenantId, "dahua.face");
      if (blocked) return c.json({ error: blocked, id }, 403);
    }
    const results = await enrollPersonOnSiteDevicesWait(
      ctx.property.siteId,
      {
        userId: dahuaUserId,
        name,
        cardNo: body.dni?.trim() || dahuaUserId,
        photoBase64: body.photoBase64,
        userType: 0,
      },
      {
        horaDesde: body.horaDesde,
        horaHasta: body.horaHasta,
        diasSemana: body.diasSemana,
        fechaDesde,
        fechaHasta,
      },
    );
    await db.update(propertyServices).set({ dahuaSynced: enrollOk(results) }).where(eq(propertyServices.id, id));
    deviceSync = results;
  }
  return c.json({ ok: true, id, dahuaUserId, deviceSync });
});

residents.delete("/me/services/:id", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  const row = await db
    .select()
    .from(propertyServices)
    .where(and(eq(propertyServices.id, c.req.param("id")), eq(propertyServices.propertyId, ctx.property.id)))
    .get();
  await db
    .update(propertyServices)
    .set({ active: false })
    .where(and(eq(propertyServices.id, c.req.param("id")), eq(propertyServices.propertyId, ctx.property.id)));
  if (row?.dahuaUserId) {
    await deletePersonOnSiteDevicesWait(ctx.property.siteId, { userId: row.dahuaUserId });
  }
  return c.json({ ok: true });
});

residents.get("/me/authorizations", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  const rows = await db
    .select()
    .from(visitAuthorizations)
    .where(eq(visitAuthorizations.propertyId, ctx.property.id))
    .orderBy(desc(visitAuthorizations.createdAt));
  return c.json({
    authorizations: rows.map((r) => ({
      ...r,
      diasSemana: r.diasSemana ? (JSON.parse(r.diasSemana) as number[]) : null,
    })),
  });
});

residents.post("/me/authorizations", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  const body = await c.req.json<{
    kind?: string;
    guestName?: string;
    guestDni?: string;
    patente?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    horaDesde?: string;
    horaHasta?: string;
    diasSemana?: number[];
    notes?: string;
  }>();
  const guestName = body.guestName?.trim();
  if (!guestName) return c.json({ error: "Falta el nombre de la persona autorizada" }, 400);
  const fechaDesde = parseDateInput(body.fechaDesde);
  const fechaHasta = parseDateInput(body.fechaHasta, new Date(fechaDesde.getTime() + 24 * 60 * 60 * 1000));
  if (fechaHasta <= fechaDesde) return c.json({ error: "La fecha de fin debe ser posterior al inicio" }, 400);
  const id = nid();
  await db.insert(visitAuthorizations).values({
    id,
    propertyId: ctx.property.id,
    siteId: ctx.property.siteId,
    kind: body.kind?.trim() || "visita",
    guestName,
    guestDni: body.guestDni?.trim() || null,
    patente: body.patente ? normalizePlate(body.patente) : null,
    fechaDesde,
    fechaHasta,
    horaDesde: body.horaDesde?.trim() || null,
    horaHasta: body.horaHasta?.trim() || null,
    diasSemana: body.diasSemana ? JSON.stringify(body.diasSemana) : null,
    notes: body.notes?.trim() || null,
    active: true,
    createdByUserId: c.get("user").id,
    createdAt: new Date(),
  });
  await syncAuthorizationToEngine(ctx.property, {
    id,
    guestName,
    guestDni: body.guestDni?.trim() || null,
    patente: body.patente ? normalizePlate(body.patente) : null,
    fechaDesde,
    fechaHasta,
    active: true,
  });
  return c.json({ ok: true, id });
});

residents.delete("/me/authorizations/:id", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  await db
    .update(visitAuthorizations)
    .set({ active: false })
    .where(and(eq(visitAuthorizations.id, c.req.param("id")), eq(visitAuthorizations.propertyId, ctx.property.id)));
  await revokeAuthorizationOnEngine(c.req.param("id"));
  return c.json({ ok: true });
});

residents.get("/me/visit-passes", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  const rows = await db
    .select()
    .from(visitPasses)
    .where(eq(visitPasses.propertyId, ctx.property.id))
    .orderBy(desc(visitPasses.createdAt))
    .limit(80);
  return c.json({
    passes: rows.map((p) => ({
      ...p,
      qrPayload: `ACCESOPRO:V1:${p.token}`,
    })),
  });
});

residents.post("/me/visit-passes", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  const qrBlocked = await assertFeature(scoped.tenantId, "dahua.qr");
  if (qrBlocked) return c.json({ error: qrBlocked }, 403);
  const body = await c.req.json<{
    guestName?: string;
    guestDni?: string;
    patente?: string;
    validFrom?: string;
    validUntil?: string;
    horaDesde?: string;
    horaHasta?: string;
    authorizationId?: string;
  }>();
  const guestName = body.guestName?.trim();
  if (!guestName) return c.json({ error: "Falta el nombre del visitante" }, 400);
  const validFrom = parseDateInput(body.validFrom);
  const validUntil = parseDateInput(body.validUntil, new Date(validFrom.getTime() + 8 * 60 * 60 * 1000));
  if (validUntil <= validFrom) return c.json({ error: "La vigencia de fin debe ser posterior al inicio" }, 400);
  const passId = nid();
  const token = makeVisitToken(ctx.property.id, passId);
  const dahuaUserId = `v_${passId.slice(-8)}`;

  await db.insert(visitPasses).values({
    id: passId,
    propertyId: ctx.property.id,
    siteId: ctx.property.siteId,
    authorizationId: body.authorizationId || null,
    token,
    dahuaCardNo: token,
    dahuaSynced: false,
    guestName,
    guestDni: body.guestDni?.trim() || null,
    patente: body.patente ? normalizePlate(body.patente) : null,
    validFrom,
    validUntil,
    horaDesde: body.horaDesde?.trim() || null,
    horaHasta: body.horaHasta?.trim() || null,
    status: "active",
    createdByUserId: c.get("user").id,
    createdAt: new Date(),
  });

  let dahuaSynced = false;
  const results = await enrollPersonOnSiteDevicesWait(
    ctx.property.siteId,
    {
      userId: dahuaUserId,
      name: guestName,
      cardNo: token,
      userType: 1,
    },
    { fechaDesde: validFrom, fechaHasta: validUntil, horaDesde: body.horaDesde, horaHasta: body.horaHasta },
  );
  dahuaSynced = enrollOk(results);
  if (dahuaSynced) {
    await db.update(visitPasses).set({ dahuaSynced: true, dahuaCardNo: token }).where(eq(visitPasses.id, passId));
  }

  return c.json({
    ok: true,
    id: passId,
    token,
    qrPayload: `ACCESOPRO:V1:${token}`,
    lotNumber: ctx.property.lotNumber,
    dahuaSynced,
    deviceSync: results,
  });
});

residents.post("/me/visit-passes/:id/revoke", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  const passId = c.req.param("id");

  await db
    .update(visitPasses)
    .set({ status: "revoked" })
    .where(and(eq(visitPasses.id, passId), eq(visitPasses.propertyId, ctx.property.id)));

  // Revocar también del terminal Dahua
  try {
    await deletePersonOnSiteDevicesWait(ctx.property.siteId, {
      userId: `v_${passId.slice(-8)}`,
    });
  } catch (err) {
    console.error("Error revocando pase de Dahua:", err);
  }

  return c.json({ ok: true });
});

residents.get("/me/history", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  const passes = await db
    .select()
    .from(visitPasses)
    .where(eq(visitPasses.propertyId, ctx.property.id))
    .orderBy(desc(visitPasses.createdAt))
    .limit(50);
  const authorizations = await db
    .select()
    .from(visitAuthorizations)
    .where(eq(visitAuthorizations.propertyId, ctx.property.id))
    .orderBy(desc(visitAuthorizations.createdAt))
    .limit(50);
  return c.json({
    lotNumber: ctx.property.lotNumber,
    visitPasses: passes,
    authorizations: authorizations.map((a) => ({
      ...a,
      diasSemana: a.diasSemana ? (JSON.parse(a.diasSemana) as number[]) : null,
    })),
  });
});
