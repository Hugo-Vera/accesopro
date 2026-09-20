import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { planById } from "@accesopro/catalog";
import type { AuthUser } from "./auth.js";
import { requireAuth, requirePlatform } from "./auth.js";
import { db } from "./db/client.js";
import {
  events,
  guardApprovals,
  hubSites,
  properties,
  propertyFamilyMembers,
  sites,
  tenants,
  users,
  visitPasses,
} from "./db/schema.js";
import { applyRoleTemplate } from "./grants.js";
import { assignPlanToTenant } from "./plans.js";
import { nid } from "./scope.js";

type Env = { Variables: { user: AuthUser } };

export type HubSnapshot = {
  tenantName: string | null;
  lots: number;
  ownersPending: number;
  ownersActive: number;
  familyMembers: number;
  visitsInSite: number;
  pendingApprovals: number;
  eventsToday: number;
  lastEventAt: number | null;
};

function slugify(name: string) {
  const s = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "barrio";
}

function hubHeader(c: { req: { header: (n: string) => string | undefined } }) {
  return (c.req.header("x-accesopro-hub-token") || c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || "").trim();
}

async function tokenAccepted(token: string): Promise<boolean> {
  if (!token) return false;
  const envTok = (process.env.ACCESOPRO_HUB_TOKEN ?? "").trim();
  if (envTok && envTok === token) return true;
  const byHub = await db.select({ id: sites.id }).from(sites).where(eq(sites.hubToken, token)).get();
  if (byHub) return true;
  const byAgent = await db.select({ id: sites.id }).from(sites).where(eq(sites.agentToken, token)).get();
  return Boolean(byAgent);
}

async function countN(q: Promise<{ n: number } | undefined>) {
  const row = await q;
  return Number(row?.n ?? 0);
}

export async function buildHubSnapshot(): Promise<HubSnapshot> {
  const tenant = await db.select().from(tenants).limit(1).get();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const lastEv = await db.select({ createdAt: events.createdAt }).from(events).orderBy(desc(events.createdAt)).limit(1).get();
  const lastAt = lastEv?.createdAt instanceof Date ? lastEv.createdAt.getTime() : lastEv?.createdAt ?? null;
  return {
    tenantName: tenant?.name ?? null,
    lots: await countN(db.select({ n: sql<number>`count(*)` }).from(properties).get()),
    ownersPending: await countN(
      db
        .select({ n: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.role, "resident"), eq(users.mustChangePassword, true)))
        .get(),
    ),
    ownersActive: await countN(
      db
        .select({ n: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.role, "resident"), eq(users.mustChangePassword, false)))
        .get(),
    ),
    familyMembers: await countN(
      db
        .select({ n: sql<number>`count(*)` })
        .from(propertyFamilyMembers)
        .where(eq(propertyFamilyMembers.active, true))
        .get(),
    ),
    visitsInSite: await countN(
      db.select({ n: sql<number>`count(*)` }).from(visitPasses).where(eq(visitPasses.status, "in_site")).get(),
    ),
    pendingApprovals: await countN(
      db.select({ n: sql<number>`count(*)` }).from(guardApprovals).where(eq(guardApprovals.status, "pending")).get(),
    ),
    eventsToday: await countN(
      db.select({ n: sql<number>`count(*)` }).from(events).where(gte(events.createdAt, start)).get(),
    ),
    lastEventAt: lastAt != null ? Number(lastAt) : null,
  };
}

async function bootstrapPredio(body: {
  name: string;
  slug: string;
  planId: string;
  adminName: string;
  adminEmail: string;
  passwordHash: string;
  hubToken: string;
}) {
  const plan = planById(body.planId);
  if (!plan) throw new Error("Plan desconocido");
  const email = body.adminEmail.trim().toLowerCase();
  const existingTok = await db.select().from(sites).where(eq(sites.hubToken, body.hubToken)).get();
  if (existingTok) {
    return { ok: true as const, already: true, tenantId: existingTok.tenantId, siteId: existingTok.id };
  }
  const tenantCount = await db.select({ n: sql<number>`count(*)` }).from(tenants).get();
  if (Number(tenantCount?.n ?? 0) > 0) {
    const site = await db.select().from(sites).limit(1).get();
    if (site) {
      await db.update(sites).set({ hubToken: body.hubToken }).where(eq(sites.id, site.id));
    }
    return { ok: true as const, already: true, tenantId: site?.tenantId ?? "", siteId: site?.id ?? "" };
  }
  const now = new Date();
  const tenantId = `tenant_${body.slug}`.slice(0, 64);
  const siteId = nid();
  const userId = nid();
  const agentToken = randomBytes(18).toString("hex");
  await db.insert(tenants).values({
    id: tenantId,
    name: body.name.trim(),
    slug: body.slug,
    createdAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    name: "Acceso principal",
    agentToken,
    hubToken: body.hubToken,
    createdAt: now,
  });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email,
    passwordHash: body.passwordHash,
    name: body.adminName.trim(),
    role: "tenant_admin",
    mustChangePassword: true,
    createdAt: now,
  });
  await assignPlanToTenant(tenantId, plan.id, userId);
  await applyRoleTemplate(userId, "tenant_admin", userId);
  return { ok: true as const, already: false, tenantId, siteId, agentToken };
}

function publicSite(row: typeof hubSites.$inferSelect, snapshot: HubSnapshot | null) {
  let snap = snapshot;
  if (!snap && row.lastSnapshotJson) {
    try {
      snap = JSON.parse(row.lastSnapshotJson) as HubSnapshot;
    } catch {
      snap = null;
    }
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    planId: row.planId,
    planName: planById(row.planId)?.name ?? row.planId,
    baseUrl: row.baseUrl,
    cloudUrl: row.cloudUrl,
    adminName: row.adminName,
    adminEmail: row.adminEmail,
    status: row.status,
    lastSeenAt: row.lastSeenAt,
    snapshot: snap,
    createdAt: row.createdAt,
  };
}

async function fetchRemote(
  baseUrl: string,
  cloudUrl: string | null,
  path: string,
  init: RequestInit & { hubToken: string },
): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> {
  const urls = [baseUrl, cloudUrl].map((u) => String(u || "").replace(/\/$/, "")).filter(Boolean);
  let last = "Sin URL";
  for (let i = 0; i < urls.length; i++) {
    const timeout = i === 0 && urls.length > 1 ? 2000 : 8000;
    try {
      const res = await fetch(`${urls[i]}${path}`, {
        method: init.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          "X-AccesoPro-Hub-Token": init.hubToken,
          ...(init.headers ?? {}),
        },
        body: init.body,
        signal: AbortSignal.timeout(timeout),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, status: res.status, json };
      last = (json as { error?: string }).error || `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : "Sin enlace";
    }
  }
  return { ok: false, status: 0, json: null, error: last };
}

async function pullAndStore(row: typeof hubSites.$inferSelect) {
  const got = await fetchRemote(row.baseUrl, row.cloudUrl, "/api/hub/snapshot", { hubToken: row.hubToken });
  if (!got.ok) {
    await db.update(hubSites).set({ status: "offline" }).where(eq(hubSites.id, row.id));
    return { ...row, status: "offline" as const };
  }
  const snapshot = got.json as HubSnapshot;
  const now = new Date();
  await db
    .update(hubSites)
    .set({
      status: "online",
      lastSeenAt: now,
      lastSnapshotJson: JSON.stringify(snapshot),
    })
    .where(eq(hubSites.id, row.id));
  return { ...row, status: "online" as const, lastSeenAt: now, lastSnapshotJson: JSON.stringify(snapshot) };
}

async function tryBootstrap(row: typeof hubSites.$inferSelect) {
  if (!row.adminPasswordHash) return { error: "Falta clave para el bootstrap" };
  const body = JSON.stringify({
    name: row.name,
    slug: row.slug,
    planId: row.planId,
    adminName: row.adminName,
    adminEmail: row.adminEmail,
    passwordHash: row.adminPasswordHash,
    hubToken: row.hubToken,
  });
  const got = await fetchRemote(row.baseUrl, row.cloudUrl, "/api/hub/bootstrap", {
    method: "POST",
    hubToken: row.hubToken,
    body,
  });
  if (!got.ok) return { error: got.error || "No se pudo iniciar el predio" };
  return { ok: true as const };
}

/** Rutas públicas del predio (token de hub, sin cookie). */
export const hubPredioApi = new Hono();

hubPredioApi.get("/snapshot", async (c) => {
  const token = hubHeader(c);
  if (!(await tokenAccepted(token))) return c.json({ error: "Token de hub inválido" }, 401);
  const snapshot = await buildHubSnapshot();
  return c.json(snapshot);
});

hubPredioApi.post("/bootstrap", async (c) => {
  const token = hubHeader(c);
  const body = await c.req.json<{
    name?: string;
    slug?: string;
    planId?: string;
    adminName?: string;
    adminEmail?: string;
    passwordHash?: string;
    hubToken?: string;
  }>();
  const hubToken = String(body.hubToken || token || "").trim();
  if (!hubToken) return c.json({ error: "Falta token de hub" }, 401);
  const envTok = (process.env.ACCESOPRO_HUB_TOKEN ?? "").trim();
  if (envTok && envTok !== hubToken) return c.json({ error: "Token de hub inválido" }, 401);
  if (!envTok && !(await tokenAccepted(hubToken))) {
    const n = await db.select({ n: sql<number>`count(*)` }).from(tenants).get();
    if (Number(n?.n ?? 0) > 0) return c.json({ error: "Token de hub inválido" }, 401);
  }
  const name = String(body.name ?? "").trim();
  const slug = slugify(String(body.slug || name));
  const planId = String(body.planId ?? "").trim();
  const adminName = String(body.adminName ?? "").trim();
  const adminEmail = String(body.adminEmail ?? "").trim().toLowerCase();
  const passwordHash = String(body.passwordHash ?? "").trim();
  if (!name || !planId || !adminName || !adminEmail || !passwordHash) {
    return c.json({ error: "Faltan datos del barrio o del administrador" }, 400);
  }
  try {
    const out = await bootstrapPredio({ name, slug, planId, adminName, adminEmail, passwordHash, hubToken });
    return c.json(out);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo iniciar" }, 409);
  }
});

/** Directorio en el concentrador (cookie de plataforma). */
export const hubAdminApi = new Hono<Env>();
hubAdminApi.use("*", requireAuth);
hubAdminApi.use("*", async (c, next) => requirePlatform(c, next));

hubAdminApi.get("/sites", async (c) => {
  const rows = await db.select().from(hubSites);
  const live = await Promise.all(
    rows.map(async (row) => {
      const updated = await pullAndStore(row);
      return publicSite(updated, null);
    }),
  );
  return c.json({ sites: live });
});

hubAdminApi.post("/sites", async (c) => {
  const body = await c.req.json<{
    name?: string;
    planId?: string;
    adminName?: string;
    adminEmail?: string;
    adminPassword?: string;
    baseUrl?: string;
    cloudUrl?: string;
  }>();
  const name = String(body.name ?? "").trim();
  const planId = String(body.planId ?? "").trim();
  const adminName = String(body.adminName ?? "").trim();
  const adminEmail = String(body.adminEmail ?? "").trim().toLowerCase();
  const adminPassword = String(body.adminPassword ?? "");
  const baseUrl = String(body.baseUrl ?? "").trim().replace(/\/$/, "");
  const cloudUrl = String(body.cloudUrl ?? "").trim().replace(/\/$/, "") || null;
  if (!name) return c.json({ error: "Falta el nombre del barrio" }, 400);
  const plan = planById(planId);
  if (!plan) return c.json({ error: "Elegí un plan comercial" }, 400);
  if (!adminName || !adminEmail) return c.json({ error: "Falta el administrador del predio" }, 400);
  if (adminPassword.length < 8) return c.json({ error: "La clave debe tener al menos 8 caracteres" }, 400);
  if (!baseUrl && !cloudUrl) return c.json({ error: "Indicá la URL LAN o la pública del Ubuntu" }, 400);
  let slug = slugify(name);
  const clash = await db.select().from(hubSites).where(eq(hubSites.slug, slug)).get();
  if (clash) slug = `${slug}-${randomBytes(3).toString("hex")}`;
  const now = new Date();
  const id = nid();
  const hubToken = randomBytes(24).toString("hex");
  const adminPasswordHash = await bcrypt.hash(adminPassword, 10);
  await db.insert(hubSites).values({
    id,
    name,
    slug,
    planId: plan.id,
    baseUrl: baseUrl || cloudUrl || "",
    cloudUrl,
    hubToken,
    adminName,
    adminEmail,
    adminPasswordHash,
    status: "pending",
    createdAt: now,
  });
  let row = (await db.select().from(hubSites).where(eq(hubSites.id, id)).get())!;
  const boot = await tryBootstrap(row);
  if (boot.ok) {
    row = (await pullAndStore(row)) as typeof row;
  }
  return c.json({
    site: publicSite(row, null),
    hubToken,
    adminEmail,
    adminPassword,
    agentHint: "En el Ubuntu del predio: ACCESOPRO_HUB_TOKEN y SITE_AGENT_TOKEN del bootstrap.",
    bootstrapError: boot.ok ? null : boot.error,
  });
});

hubAdminApi.post("/sites/:id/refresh", async (c) => {
  const id = c.req.param("id");
  const row = await db.select().from(hubSites).where(eq(hubSites.id, id)).get();
  if (!row) return c.json({ error: "Barrio no encontrado" }, 404);
  let bootError: string | null = null;
  if (row.status !== "online") {
    const boot = await tryBootstrap(row);
    if (!boot.ok) bootError = boot.error ?? null;
  }
  const updated = await pullAndStore(row);
  return c.json({ site: publicSite(updated, null), bootstrapError: bootError });
});

/** Un solo árbol /api/hub: snapshot/bootstrap públicos; /sites con cookie. */
export const hubApi = new Hono<Env>();
hubApi.route("/", hubPredioApi);
hubApi.route("/", hubAdminApi);
