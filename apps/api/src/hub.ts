import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
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

async function resolveHubSite(token: string) {
  if (!token) return null;
  const byHub = await db.select().from(sites).where(eq(sites.hubToken, token)).get();
  if (byHub) return byHub;
  const byAgent = await db.select().from(sites).where(eq(sites.agentToken, token)).get();
  if (byAgent) return byAgent;
  const envTok = (process.env.ACCESOPRO_HUB_TOKEN ?? "").trim();
  if (envTok && envTok === token) {
    return (await db.select().from(sites).limit(1).get()) ?? null;
  }
  return null;
}

async function tokenAccepted(token: string): Promise<boolean> {
  if (!token) return false;
  const envTok = (process.env.ACCESOPRO_HUB_TOKEN ?? "").trim();
  if (envTok && envTok === token) return true;
  return Boolean(await resolveHubSite(token));
}

async function countN(q: Promise<{ n: number } | undefined>) {
  const row = await q;
  return Number(row?.n ?? 0);
}

export async function buildHubSnapshot(tenantId?: string | null): Promise<HubSnapshot> {
  const tenant = tenantId
    ? await db.select().from(tenants).where(eq(tenants.id, tenantId)).get()
    : await db.select().from(tenants).limit(1).get();
  const empty: HubSnapshot = {
    tenantName: tenant?.name ?? null,
    lots: 0,
    ownersPending: 0,
    ownersActive: 0,
    familyMembers: 0,
    visitsInSite: 0,
    pendingApprovals: 0,
    eventsToday: 0,
    lastEventAt: null,
  };
  if (!tenant) return empty;
  const siteRows = await db.select({ id: sites.id }).from(sites).where(eq(sites.tenantId, tenant.id));
  const siteIds = siteRows.map((s) => s.id);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const lastEv = siteIds.length
    ? await db
        .select({ createdAt: events.createdAt })
        .from(events)
        .where(inArray(events.siteId, siteIds))
        .orderBy(desc(events.createdAt))
        .limit(1)
        .get()
    : undefined;
  const lastAt = lastEv?.createdAt instanceof Date ? lastEv.createdAt.getTime() : lastEv?.createdAt ?? null;
  return {
    tenantName: tenant.name,
    lots: await countN(db.select({ n: sql<number>`count(*)` }).from(properties).where(eq(properties.tenantId, tenant.id)).get()),
    ownersPending: await countN(
      db
        .select({ n: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.tenantId, tenant.id), eq(users.role, "resident"), eq(users.mustChangePassword, true)))
        .get(),
    ),
    ownersActive: await countN(
      db
        .select({ n: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.tenantId, tenant.id), eq(users.role, "resident"), eq(users.mustChangePassword, false)))
        .get(),
    ),
    familyMembers: await countN(
      db
        .select({ n: sql<number>`count(*)` })
        .from(propertyFamilyMembers)
        .innerJoin(properties, eq(propertyFamilyMembers.propertyId, properties.id))
        .where(and(eq(properties.tenantId, tenant.id), eq(propertyFamilyMembers.active, true)))
        .get(),
    ),
    visitsInSite: siteIds.length
      ? await countN(
          db
            .select({ n: sql<number>`count(*)` })
            .from(visitPasses)
            .where(and(inArray(visitPasses.siteId, siteIds), eq(visitPasses.status, "in_site")))
            .get(),
        )
      : 0,
    pendingApprovals: siteIds.length
      ? await countN(
          db
            .select({ n: sql<number>`count(*)` })
            .from(guardApprovals)
            .where(and(inArray(guardApprovals.siteId, siteIds), eq(guardApprovals.status, "pending")))
            .get(),
        )
      : 0,
    eventsToday: siteIds.length
      ? await countN(
          db
            .select({ n: sql<number>`count(*)` })
            .from(events)
            .where(and(inArray(events.siteId, siteIds), gte(events.createdAt, start)))
            .get(),
        )
      : 0,
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
  const bySlug = await db.select().from(tenants).where(eq(tenants.slug, body.slug)).get();
  if (bySlug) {
    const site = await db.select().from(sites).where(eq(sites.tenantId, bySlug.id)).limit(1).get();
    if (site) {
      await db.update(sites).set({ hubToken: body.hubToken }).where(eq(sites.id, site.id));
    }
    return { ok: true as const, already: true, tenantId: bySlug.id, siteId: site?.id ?? "" };
  }
  const emailTaken = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  if (emailTaken) throw new Error("Ese email ya está en uso en este Ubuntu");
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

function selfHostnames(): Set<string> {
  const hosts = new Set(["localhost", "127.0.0.1", "host.docker.internal"]);
  const ip = (process.env.ACCESOPRO_IP ?? "").trim();
  if (ip) hosts.add(ip);
  const origin = (process.env.WEB_ORIGIN ?? "").trim();
  if (origin) {
    try {
      hosts.add(new URL(origin).hostname);
    } catch {
      /* ignore */
    }
  }
  return hosts;
}

function rewriteIfSelf(origin: string): string | null {
  try {
    const host = new URL(origin).hostname;
    if (selfHostnames().has(host)) return "http://web:3000";
  } catch {
    /* ignore */
  }
  return null;
}

function fetchOrigins(baseUrl: string, cloudUrl: string | null): string[] {
  const raw = [baseUrl, cloudUrl].map((u) => String(u || "").replace(/\/$/, "")).filter(Boolean);
  const out: string[] = [];
  for (const u of raw) {
    const local = rewriteIfSelf(u);
    if (local && local !== u) out.push(local);
    out.push(u);
  }
  return [...new Set(out)];
}

async function fetchRemote(
  baseUrl: string,
  cloudUrl: string | null,
  path: string,
  init: RequestInit & { hubToken: string },
): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> {
  const urls = fetchOrigins(baseUrl, cloudUrl);
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

function isSelfHubRow(row: { baseUrl: string; cloudUrl: string | null }) {
  return Boolean(rewriteIfSelf(row.baseUrl) || rewriteIfSelf(row.cloudUrl || ""));
}

async function pullAndStore(row: typeof hubSites.$inferSelect) {
  if (isSelfHubRow(row)) {
    const site = await db.select().from(sites).where(eq(sites.hubToken, row.hubToken)).get();
    const snapshot = await buildHubSnapshot(site?.tenantId ?? null);
    const now = new Date();
    await db
      .update(hubSites)
      .set({
        status: site ? "online" : "pending",
        lastSeenAt: site ? now : row.lastSeenAt,
        lastSnapshotJson: JSON.stringify(snapshot),
      })
      .where(eq(hubSites.id, row.id));
    return {
      ...row,
      status: site ? ("online" as const) : ("pending" as const),
      lastSeenAt: site ? now : row.lastSeenAt,
      lastSnapshotJson: JSON.stringify(snapshot),
    };
  }
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
  const payload = {
    name: row.name,
    slug: row.slug,
    planId: row.planId,
    adminName: row.adminName,
    adminEmail: row.adminEmail,
    passwordHash: row.adminPasswordHash,
    hubToken: row.hubToken,
  };
  if (isSelfHubRow(row)) {
    try {
      await bootstrapPredio(payload);
      return { ok: true as const };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "No se pudo iniciar el predio" };
    }
  }
  const body = JSON.stringify(payload);
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
  const site = await resolveHubSite(token);
  const snapshot = await buildHubSnapshot(site?.tenantId ?? null);
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

hubAdminApi.patch("/sites/:id", async (c) => {
  const id = c.req.param("id");
  const row = await db.select().from(hubSites).where(eq(hubSites.id, id)).get();
  if (!row) return c.json({ error: "Barrio no encontrado" }, 404);
  const body = await c.req.json<{
    name?: string;
    planId?: string;
    adminName?: string;
    adminEmail?: string;
    adminPassword?: string;
    baseUrl?: string;
    cloudUrl?: string;
  }>();
  const name = String(body.name ?? row.name).trim();
  const planId = String(body.planId ?? row.planId).trim();
  const adminName = String(body.adminName ?? row.adminName).trim();
  const adminEmail = String(body.adminEmail ?? row.adminEmail).trim().toLowerCase();
  const adminPassword = String(body.adminPassword ?? "");
  const baseUrl = String(body.baseUrl ?? row.baseUrl).trim().replace(/\/$/, "");
  const cloudUrlRaw = body.cloudUrl !== undefined ? String(body.cloudUrl ?? "").trim().replace(/\/$/, "") : row.cloudUrl;
  const cloudUrl = cloudUrlRaw || null;
  if (!name) return c.json({ error: "Falta el nombre del barrio" }, 400);
  const plan = planById(planId);
  if (!plan) return c.json({ error: "Elegí un plan comercial" }, 400);
  if (!adminName || !adminEmail) return c.json({ error: "Falta el administrador del predio" }, 400);
  if (adminPassword && adminPassword.length < 8) {
    return c.json({ error: "La clave debe tener al menos 8 caracteres" }, 400);
  }
  if (!baseUrl && !cloudUrl) return c.json({ error: "Indicá la URL LAN o la pública del Ubuntu" }, 400);
  const patch: Partial<typeof hubSites.$inferInsert> = {
    name,
    planId: plan.id,
    adminName,
    adminEmail,
    baseUrl: baseUrl || cloudUrl || "",
    cloudUrl,
  };
  if (adminPassword) patch.adminPasswordHash = await bcrypt.hash(adminPassword, 10);
  await db.update(hubSites).set(patch).where(eq(hubSites.id, id));
  let next = (await db.select().from(hubSites).where(eq(hubSites.id, id)).get())!;
  const boot = await tryBootstrap(next);
  if (boot.ok) next = (await pullAndStore(next)) as typeof next;
  return c.json({
    site: publicSite(next, null),
    bootstrapError: boot.ok ? null : boot.error,
  });
});

hubAdminApi.delete("/sites/:id", async (c) => {
  const id = c.req.param("id");
  const row = await db.select().from(hubSites).where(eq(hubSites.id, id)).get();
  if (!row) return c.json({ error: "Barrio no encontrado" }, 404);
  await db.delete(hubSites).where(eq(hubSites.id, id));
  return c.json({ ok: true });
});

/** Un solo árbol /api/hub: snapshot/bootstrap públicos; /sites con cookie. */
export const hubApi = new Hono<Env>();
hubApi.route("/", hubPredioApi);
hubApi.route("/", hubAdminApi);
