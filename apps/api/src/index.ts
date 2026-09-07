import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { FEATURE_PACK_CATALOG, MODULE_CATALOG, PLAN_CATALOG, isModuleKey, planIncludesModule, type ModuleKey } from "@accesopro/catalog";
import {
  COOKIE,
  attachCookie,
  createSession,
  destroySession,
  requireAuth,
  requirePlatform,
  userFromToken,
  type AuthUser,
} from "./auth.js";
import { agentRoutes } from "./agent.js";
import { startEngineBridgePoller } from "./engineBridge.js";
import { db } from "./db/client.js";
import { properties, sites, tenantModules, tenants, users, visitPasses } from "./db/schema.js";
import { scanVisitPass, parseVisitQrPayload } from "./visitPass.js";
import { accessPointsApi } from "./accessPoints.js";
import { hardware } from "./hardware.js";
import { residents } from "./residents.js";
import { attendanceApi } from "./attendance.js";
import { visitorsApi } from "./visitors.js";
import { eventStreamRoutes } from "./eventStream.js";
import {
  assignPlanToTenant,
  getTenantPlan,
  serializePlan,
  syncPlansFromCatalog,
} from "./plans.js";
import { seedIfEmpty } from "./seed.js";
import { resolveCapabilities, denyUnlessCapability } from "./grants.js";
import { usersApi } from "./users.js";
import {
  ensureDefaultFeaturesForModule,
  listTenantFeatures,
  serializeFeature,
  setTenantFeature,
} from "./features.js";
import { systemApi } from "./systemUpdate.js";

type Env = { Variables: { user: AuthUser } };

const app = new Hono<Env>();
const originList = (process.env.WEB_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function corsOrigin(requestOrigin: string): string | undefined {
  if (originList.includes(requestOrigin)) return requestOrigin;
  // LAN / ZeroTier / localhost en cualquier puerto de dashboard
  try {
    const u = new URL(requestOrigin);
    const host = u.hostname;
    if (host === "localhost" || host === "127.0.0.1") return requestOrigin;
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return requestOrigin;
  } catch {
    /* ignore */
  }
  return originList[0];
}

app.use(
  "*",
  cors({
    origin: corsOrigin,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", (c) => c.json({ ok: true, product: "AccesoPro" }));

app.post("/auth/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) return c.json({ error: "Completá email y clave" }, 400);

  const row = await db.select().from(users).where(eq(users.email, email)).get();
  if (!row) return c.json({ error: "Email o clave incorrectos" }, 401);
  const ok = await bcrypt.compare(password, row.passwordHash);
  if (!ok) return c.json({ error: "Email o clave incorrectos" }, 401);

  const token = await createSession(row.id);
  attachCookie(c, token);
  const authUser = {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    name: row.name,
    role: row.role,
  };
  const capabilities = await resolveCapabilities(authUser);
  return c.json({ user: { ...authUser, capabilities } });
});

app.post("/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

app.get("/auth/me", async (c) => {
  const token = getCookie(c, COOKIE) ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const user = await userFromToken(token);
  if (!user) return c.json({ user: null });
  const capabilities = await resolveCapabilities(user);
  return c.json({ user: { ...user, capabilities } });
});

app.get("/api/visit-passes/verify/:token", async (c) => {
  const token = c.req.param("token");
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.token, token)).get();
  if (!pass) return c.json({ valid: false, error: "QR no encontrado" }, 404);
  const property = await db.select().from(properties).where(eq(properties.id, pass.propertyId)).get();
  const now = Date.now();
  const valid =
    pass.status === "active" && now >= pass.validFrom.getTime() && now <= pass.validUntil.getTime();
  return c.json({
    valid,
    status: pass.status,
    guestName: pass.guestName,
    patente: pass.patente,
    guestDni: pass.guestDni,
    lotNumber: property?.lotNumber,
    validFrom: pass.validFrom,
    validUntil: pass.validUntil,
    horaDesde: pass.horaDesde,
    horaHasta: pass.horaHasta,
    scannedInAt: pass.scannedInAt,
    scannedOutAt: pass.scannedOutAt,
  });
});

app.post("/api/visit-passes/scan", async (c) => {
  const body = await c.req.json<{ raw?: string; token?: string; sentido?: string }>();
  let token = body.token?.trim() ?? "";
  if (body.raw) token = parseVisitQrPayload(body.raw) ?? token;
  if (!token) return c.json({ ok: false, error: "QR inválido" }, 400);
  const sentido = body.sentido === "out" ? "out" : "in";
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.token, token)).get();
  if (!pass) return c.json({ ok: false, error: "QR no encontrado" }, 404);
  const site = await db.select().from(sites).where(eq(sites.id, pass.siteId)).get();
  if (!site) return c.json({ ok: false, error: "Sitio no encontrado" }, 404);
  const result = await scanVisitPass(site, token, sentido);
  return c.json(result, result.ok ? 200 : 403);
});

app.route("/api", eventStreamRoutes);

app.use("/api/*", requireAuth);

app.get("/api/catalog", (c) => c.json({ modules: MODULE_CATALOG, plans: PLAN_CATALOG.map(serializePlan) }));

app.get("/api/plans", async (c) => {
  await syncPlansFromCatalog();
  return c.json({ plans: PLAN_CATALOG.map(serializePlan) });
});

app.get("/api/tenants", requirePlatform, async (c) => {
  const rows = await db.select().from(tenants);
  const withPlan = await Promise.all(
    rows.map(async (t) => {
      const plan = await getTenantPlan(t.id);
      return {
        ...t,
        planId: plan?.id ?? null,
        planName: plan?.name ?? null,
        planSlug: plan?.slug ?? null,
      };
    }),
  );
  return c.json({ tenants: withPlan });
});

app.get("/api/tenants/:id/subscription", async (c) => {
  const user = c.get("user");
  const tenantId = c.req.param("id");
  if (!tenantId) return c.json({ error: "Falta id" }, 400);
  if (user.role !== "platform_admin" && user.tenantId !== tenantId) {
    return c.json({ error: "Sin acceso a este barrio" }, 403);
  }
  const plan = await getTenantPlan(tenantId);
  return c.json({ tenantId, plan: plan ? serializePlan(plan) : null });
});

app.put("/api/tenants/:id/subscription", requirePlatform, async (c) => {
  const tenantId = c.req.param("id");
  if (!tenantId) return c.json({ error: "Falta id" }, 400);
  const user = c.get("user");
  const body = await c.req.json<{ planId?: string }>();
  const planId = body.planId;
  if (!planId) return c.json({ error: "Falta planId" }, 400);
  const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  if (!tenant) return c.json({ error: "Barrio no encontrado" }, 404);
  try {
    const plan = await assignPlanToTenant(tenantId, planId, user.id);
    return c.json({ ok: true, tenantId, plan: serializePlan(plan) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo asignar" }, 400);
  }
});

app.get("/api/tenants/:id/modules", async (c) => {
  const user = c.get("user");
  const tenantId = c.req.param("id");
  if (!tenantId) return c.json({ error: "Falta id" }, 400);
  if (user.role !== "platform_admin" && user.tenantId !== tenantId) {
    return c.json({ error: "Sin acceso a este barrio" }, 403);
  }
  const plan = await getTenantPlan(tenantId);
  const rows = await db.select().from(tenantModules).where(eq(tenantModules.tenantId, tenantId));
  const enabled = new Set(rows.filter((r) => r.enabled).map((r) => r.moduleKey));
  const modules = MODULE_CATALOG.map((m) => {
    const inPlan = m.alwaysOn || (plan ? planIncludesModule(plan, m.key) : false);
    return {
      ...m,
      inPlan,
      enabled: m.alwaysOn || (inPlan && enabled.has(m.key)),
    };
  });
  return c.json({
    tenantId,
    plan: plan ? serializePlan(plan) : null,
    modules,
  });
});

app.patch("/api/tenants/:id/modules", requirePlatform, async (c) => {
  const tenantId = c.req.param("id");
  if (!tenantId) return c.json({ error: "Falta id" }, 400);
  const body = await c.req.json<{ key?: string; enabled?: boolean }>();
  if (!body.key || !isModuleKey(body.key)) {
    return c.json({ error: "Módulo desconocido" }, 400);
  }
  const def = MODULE_CATALOG.find((m) => m.key === body.key)!;
  if (def.alwaysOn && body.enabled === false) {
    return c.json({ error: "El núcleo no se puede apagar" }, 400);
  }
  const plan = await getTenantPlan(tenantId);
  if (!plan) {
    return c.json({ error: "Asigná un plan al barrio antes de tildar módulos" }, 400);
  }
  if (body.enabled && !planIncludesModule(plan, body.key)) {
    return c.json({ error: `El plan «${plan.name}» no incluye este módulo` }, 400);
  }
  if (body.enabled) {
    for (const dep of def.dependsOn) {
      if (!planIncludesModule(plan, dep) && dep !== "core") {
        return c.json({ error: `El plan no incluye la dependencia «${dep}»` }, 400);
      }
      const depRow = await db
        .select()
        .from(tenantModules)
        .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, dep)))
        .get();
      if (!depRow?.enabled && dep !== "core") {
        await db
          .insert(tenantModules)
          .values({ tenantId, moduleKey: dep, enabled: true })
          .onConflictDoUpdate({
            target: [tenantModules.tenantId, tenantModules.moduleKey],
            set: { enabled: true },
          });
      }
    }
  }
  await db
    .insert(tenantModules)
    .values({ tenantId, moduleKey: body.key, enabled: Boolean(body.enabled) })
    .onConflictDoUpdate({
      target: [tenantModules.tenantId, tenantModules.moduleKey],
      set: { enabled: Boolean(body.enabled) },
    });
  if (body.enabled) {
    await ensureDefaultFeaturesForModule(tenantId, body.key as ModuleKey);
  }
  return c.json({ ok: true, key: body.key, enabled: Boolean(body.enabled) });
});

app.get("/api/tenants/:id/features", async (c) => {
  const user = c.get("user");
  const tenantId = c.req.param("id");
  if (!tenantId) return c.json({ error: "Falta id" }, 400);
  if (user.role !== "platform_admin" && user.tenantId !== tenantId) {
    return c.json({ error: "Sin acceso a este barrio" }, 403);
  }
  const features = await listTenantFeatures(tenantId);
  return c.json({
    tenantId,
    catalog: FEATURE_PACK_CATALOG,
    features: features.map(serializeFeature),
  });
});

app.patch("/api/tenants/:id/features", async (c) => {
  const user = c.get("user");
  const tenantId = c.req.param("id");
  if (!tenantId) return c.json({ error: "Falta id" }, 400);
  if (user.role !== "platform_admin" && user.tenantId !== tenantId) {
    return c.json({ error: "Sin acceso a este barrio" }, 403);
  }
  const denied = await denyUnlessCapability(user, "core.config");
  if (denied) return denied;
  const body = await c.req.json<{ key?: string; enabled?: boolean }>();
  if (!body.key) return c.json({ error: "Falta key" }, 400);
  try {
    const pack = await setTenantFeature(tenantId, body.key, Boolean(body.enabled));
    return c.json({ ok: true, feature: serializeFeature({ ...pack, enabled: Boolean(body.enabled) }) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo guardar" }, 400);
  }
});

app.route("/api", accessPointsApi);
app.route("/api", hardware);
app.route("/api/hardware", hardware);
app.route("/api", usersApi);
app.route("/api", systemApi);
app.route("/api/residents", residents);
app.route("/api", attendanceApi);
app.route("/api", visitorsApi);
app.route("/agent", agentRoutes);

app.get("/api/dashboard", async (c) => {
  const user = c.get("user");
  if (!user.tenantId && user.role !== "platform_admin") {
    return c.json({ error: "Sin barrio asignado" }, 400);
  }
  const tenantId = user.tenantId ?? c.req.query("tenantId");
  if (!tenantId) {
    const all = await db.select().from(tenants);
    return c.json({ mode: "platform", tenants: all, catalog: MODULE_CATALOG });
  }
  const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  if (!tenant) return c.json({ error: "Barrio no encontrado" }, 404);
  const rows = await db.select().from(tenantModules).where(eq(tenantModules.tenantId, tenantId));
  const enabled = MODULE_CATALOG.filter(
    (m) => m.alwaysOn || rows.some((r) => r.moduleKey === m.key && r.enabled),
  );
  return c.json({
    mode: "tenant",
    tenant,
    enabledModules: enabled,
    kpis: {
      sites: 1,
      users: 2,
      eventsToday: 0,
      openAlarms: 0,
    },
  });
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

await seedIfEmpty();
startEngineBridgePoller();

serve({ fetch: app.fetch, port, hostname: host }, () => {
  console.log(`AccesoPro API en http://${host}:${port}`);
});
