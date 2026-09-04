import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import bcrypt from "bcryptjs";
import type { AuthUser } from "./auth.js";
import { requireAuth } from "./auth.js";
import { db } from "./db/client.js";
import {
  ownerProfiles,
  properties,
  propertyServices,
  users,
  visitAuthorizations,
  visitPasses,
} from "./db/schema.js";
import { revokeAuthorizationOnEngine, syncAuthorizationToEngine, syncOwnerDniToEngine } from "./engineSync.js";
import { nid, normalizePlate, scopedSiteWithModule } from "./scope.js";
import { makeVisitToken } from "./visitPass.js";

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
  if (user.role !== "resident") return null;
  const profile = await db.select().from(ownerProfiles).where(eq(ownerProfiles.userId, user.id)).get();
  if (!profile) return null;
  const property = await db.select().from(properties).where(eq(properties.id, profile.propertyId)).get();
  if (!property) return null;
  return { profile, property };
}

function isAdmin(user: AuthUser) {
  return user.role === "platform_admin" || user.role === "tenant_admin";
}

// ── Admin: propiedades ───────────────────────────────────────────────────────

residents.get("/properties", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  if (!isAdmin(c.get("user"))) return c.json({ error: "Solo administración del barrio" }, 403);
  const rows = await db.select().from(properties).where(eq(properties.tenantId, scoped.tenantId));
  return c.json({ properties: rows });
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
  return c.json({
    user: c.get("user"),
    profile: ctx.profile,
    property: ctx.property,
    services,
  });
});

residents.patch("/me", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  const body = await c.req.json<{
    phone?: string;
    phoneAlt?: string;
    emergencyName?: string;
    emergencyPhone?: string;
  }>();
  await db
    .update(ownerProfiles)
    .set({
      phone: body.phone !== undefined ? body.phone.trim() || null : ctx.profile.phone,
      phoneAlt: body.phoneAlt !== undefined ? body.phoneAlt.trim() || null : ctx.profile.phoneAlt,
      emergencyName: body.emergencyName !== undefined ? body.emergencyName.trim() || null : ctx.profile.emergencyName,
      emergencyPhone: body.emergencyPhone !== undefined ? body.emergencyPhone.trim() || null : ctx.profile.emergencyPhone,
    })
    .where(eq(ownerProfiles.id, ctx.profile.id));
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
    notes?: string;
  }>();
  const name = body.name?.trim();
  const role = body.role?.trim() || "otro";
  if (!name) return c.json({ error: "Falta el nombre" }, 400);
  const id = nid();
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
    notes: body.notes?.trim() || null,
    active: true,
    createdAt: new Date(),
  });
  return c.json({ ok: true, id });
});

residents.delete("/me/services/:id", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  await db
    .update(propertyServices)
    .set({ active: false })
    .where(and(eq(propertyServices.id, c.req.param("id")), eq(propertyServices.propertyId, ctx.property.id)));
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
  await db.insert(visitPasses).values({
    id: passId,
    propertyId: ctx.property.id,
    siteId: ctx.property.siteId,
    authorizationId: body.authorizationId || null,
    token,
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
  return c.json({
    ok: true,
    id: passId,
    token,
    qrPayload: `ACCESOPRO:V1:${token}`,
    lotNumber: ctx.property.lotNumber,
  });
});

residents.post("/me/visit-passes/:id/revoke", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const ctx = await ownerContext(c.get("user"));
  if (!ctx) return c.json({ error: "Perfil de propietario no encontrado" }, 404);
  await db
    .update(visitPasses)
    .set({ status: "revoked" })
    .where(and(eq(visitPasses.id, c.req.param("id")), eq(visitPasses.propertyId, ctx.property.id)));
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
