import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { MODULE_CATALOG, isModuleKey } from "@accesopro/catalog";
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
import { tenantModules, tenants, users } from "./db/schema.js";
import { hardware } from "./hardware.js";
import { seedIfEmpty } from "./seed.js";

type Env = { Variables: { user: AuthUser } };

const app = new Hono<Env>();
const origin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

app.use(
  "*",
  cors({
    origin,
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
  return c.json({
    user: {
      id: row.id,
      tenantId: row.tenantId,
      email: row.email,
      name: row.name,
      role: row.role,
    },
  });
});

app.post("/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

app.get("/auth/me", async (c) => {
  const token = getCookie(c, COOKIE) ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const user = await userFromToken(token);
  if (!user) return c.json({ user: null });
  return c.json({ user });
});

app.use("/api/*", requireAuth);

app.get("/api/catalog", (c) => c.json({ modules: MODULE_CATALOG }));

app.get("/api/tenants", requirePlatform, async (c) => {
  const rows = await db.select().from(tenants);
  return c.json({ tenants: rows });
});

app.get("/api/tenants/:id/modules", async (c) => {
  const user = c.get("user");
  const tenantId = c.req.param("id");
  if (user.role !== "platform_admin" && user.tenantId !== tenantId) {
    return c.json({ error: "Sin acceso a este barrio" }, 403);
  }
  const rows = await db.select().from(tenantModules).where(eq(tenantModules.tenantId, tenantId));
  const enabled = new Set(rows.filter((r) => r.enabled).map((r) => r.moduleKey));
  const modules = MODULE_CATALOG.map((m) => ({
    ...m,
    enabled: m.alwaysOn || enabled.has(m.key),
  }));
  return c.json({ tenantId, modules });
});

app.patch("/api/tenants/:id/modules", requirePlatform, async (c) => {
  const tenantId = c.req.param("id");
  const body = await c.req.json<{ key?: string; enabled?: boolean }>();
  if (!body.key || !isModuleKey(body.key)) {
    return c.json({ error: "Módulo desconocido" }, 400);
  }
  const def = MODULE_CATALOG.find((m) => m.key === body.key)!;
  if (def.alwaysOn && body.enabled === false) {
    return c.json({ error: "El núcleo no se puede apagar" }, 400);
  }
  if (body.enabled) {
    for (const dep of def.dependsOn) {
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
  return c.json({ ok: true, key: body.key, enabled: Boolean(body.enabled) });
});

app.route("/api", hardware);
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

await seedIfEmpty();
startEngineBridgePoller();

serve({ fetch: app.fetch, port }, () => {
  console.log(`AccesoPro API en http://localhost:${port}`);
});
