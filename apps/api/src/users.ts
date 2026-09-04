import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { CAPABILITY_CATALOG, isCapabilityKey, roleTemplate } from "@accesopro/catalog";
import { Hono } from "hono";
import type { AuthUser } from "./auth.js";
import { db } from "./db/client.js";
import { users } from "./db/schema.js";
import {
  applyRoleTemplate,
  denyUnlessCapability,
  resolveCapabilities,
  setUserCapabilityGrants,
} from "./grants.js";
import { getTenantPlan } from "./plans.js";
import { nid, tenantIdOf } from "./scope.js";

type Env = { Variables: { user: AuthUser } };

const usersApi = new Hono<Env>();

function publicUser(u: typeof users.$inferSelect, capabilities?: string[]) {
  return {
    id: u.id,
    tenantId: u.tenantId,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt,
    capabilities,
  };
}

usersApi.get("/capabilities", async (c) => {
  const user = c.get("user");
  const tenantId = tenantIdOf(user, c.req.query("tenantId"));
  const plan = tenantId ? await getTenantPlan(tenantId) : null;
  const planSet = plan ? new Set(plan.capabilityKeys) : null;
  const caps = CAPABILITY_CATALOG.filter((cap) => {
    if (cap.key.startsWith("platform.")) return user.role === "platform_admin";
    if (!planSet) return user.role === "platform_admin";
    return planSet.has(cap.key);
  });
  return c.json({
    capabilities: caps,
    templates: {
      guard: roleTemplate("guard"),
      resident: roleTemplate("resident"),
    },
  });
});

usersApi.get("/users", async (c) => {
  const user = c.get("user");
  const denied = await denyUnlessCapability(user, "core.users.read");
  if (denied) return denied;
  const tenantId = tenantIdOf(user, c.req.query("tenantId"));
  if (!tenantId) return c.json({ error: "Elegí un barrio" }, 400);
  if (user.role !== "platform_admin" && user.tenantId !== tenantId) {
    return c.json({ error: "Sin acceso a este barrio" }, 403);
  }
  const rows = await db.select().from(users).where(eq(users.tenantId, tenantId));
  const withCaps = await Promise.all(
    rows.map(async (u) => {
      const caps = await resolveCapabilities({
        id: u.id,
        tenantId: u.tenantId,
        email: u.email,
        name: u.name,
        role: u.role,
      });
      return publicUser(u, caps);
    }),
  );
  return c.json({ users: withCaps });
});

usersApi.post("/users", async (c) => {
  const user = c.get("user");
  const denied = await denyUnlessCapability(user, "core.users.write");
  if (denied) return denied;
  const tenantId = tenantIdOf(user, c.req.query("tenantId"));
  if (!tenantId) return c.json({ error: "Elegí un barrio" }, 400);
  if (user.role !== "platform_admin" && user.tenantId !== tenantId) {
    return c.json({ error: "Sin acceso a este barrio" }, 403);
  }

  const body = await c.req.json<{
    email?: string;
    name?: string;
    password?: string;
    role?: string;
    capabilities?: string[];
  }>();
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const name = String(body.name ?? "").trim();
  const password = String(body.password ?? "");
  const role = body.role === "resident" ? "resident" : "guard";
  if (!email || !name || password.length < 8) {
    return c.json({ error: "Email, nombre y clave (mín. 8) son obligatorios" }, 400);
  }
  const exists = await db.select().from(users).where(eq(users.email, email)).get();
  if (exists) return c.json({ error: "Ese email ya existe" }, 409);

  const plan = await getTenantPlan(tenantId);
  if (role === "guard" && plan) {
    const guards = await db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "guard")));
    if (guards.length >= plan.limits.maxGuards) {
      return c.json({ error: `El plan permite hasta ${plan.limits.maxGuards} guardias` }, 400);
    }
  }

  const id = nid();
  const now = new Date();
  await db.insert(users).values({
    id,
    tenantId,
    email,
    name,
    role,
    passwordHash: await bcrypt.hash(password, 10),
    createdAt: now,
  });

  const caps =
    Array.isArray(body.capabilities) && body.capabilities.length
      ? body.capabilities.filter(isCapabilityKey)
      : roleTemplate(role);
  await setUserCapabilityGrants(id, caps, user.id);

  const created = await db.select().from(users).where(eq(users.id, id)).get();
  return c.json({ user: publicUser(created!, caps) }, 201);
});

usersApi.put("/users/:id/grants", async (c) => {
  const user = c.get("user");
  const denied = await denyUnlessCapability(user, "tenant.grants");
  if (denied) return denied;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Falta id" }, 400);
  const target = await db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return c.json({ error: "Usuario no encontrado" }, 404);
  if (user.role !== "platform_admin" && user.tenantId !== target.tenantId) {
    return c.json({ error: "Sin acceso a este barrio" }, 403);
  }
  const body = await c.req.json<{ capabilities?: string[] }>();
  try {
    const caps = await setUserCapabilityGrants(id, body.capabilities ?? [], user.id);
    return c.json({ ok: true, userId: id, capabilities: caps });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo guardar" }, 400);
  }
});

usersApi.post("/users/:id/reset-template", async (c) => {
  const user = c.get("user");
  const denied = await denyUnlessCapability(user, "tenant.grants");
  if (denied) return denied;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Falta id" }, 400);
  const target = await db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return c.json({ error: "Usuario no encontrado" }, 404);
  if (user.role !== "platform_admin" && user.tenantId !== target.tenantId) {
    return c.json({ error: "Sin acceso a este barrio" }, 403);
  }
  if (target.role === "tenant_admin" || target.role === "platform_admin") {
    return c.json({ error: "El admin no usa grants editables" }, 400);
  }
  await applyRoleTemplate(id, target.role, user.id);
  const caps = await resolveCapabilities({
    id: target.id,
    tenantId: target.tenantId,
    email: target.email,
    name: target.name,
    role: target.role,
  });
  return c.json({ ok: true, capabilities: caps });
});

export { usersApi };
