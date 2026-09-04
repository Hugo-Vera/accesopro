import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "./db/client.js";
import { sites } from "./db/schema.js";
import type { AuthUser } from "./auth.js";
import { moduleByKey } from "@accesopro/catalog";
import { tenantModuleAllowed } from "./plans.js";

export function nid(): string {
  return crypto.randomUUID();
}

export function tenantIdOf(user: AuthUser, query?: string): string | null {
  if (user.role === "platform_admin") return query || null;
  return user.tenantId;
}

export async function siteForTenant(tenantId: string) {
  return db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
}

export function agentOnline(lastSeenAt: Date | number | null | undefined): boolean {
  if (lastSeenAt == null) return false;
  const t = lastSeenAt instanceof Date ? lastSeenAt.getTime() : lastSeenAt;
  return Date.now() - t < 25_000;
}

export async function scopedSite(c: Context<{ Variables: { user: AuthUser } }>) {
  const user = c.get("user");
  const tenantId = tenantIdOf(user, c.req.query("tenantId"));
  if (!tenantId) {
    return { error: c.json({ error: "Elegí un barrio" }, 400) as Response };
  }
  if (user.role !== "platform_admin" && user.tenantId !== tenantId) {
    return { error: c.json({ error: "Sin acceso a este barrio" }, 403) as Response };
  }
  const site = await siteForTenant(tenantId);
  if (!site) {
    return { error: c.json({ error: "El barrio no tiene sitio" }, 404) as Response };
  }
  return { tenantId, site };
}

export async function scopedSiteWithModule(
  c: Context<{ Variables: { user: AuthUser } }>,
  moduleKey: string,
) {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped;
  const def = moduleByKey(moduleKey);
  if (def?.alwaysOn) return scoped;
  const ok = await tenantModuleAllowed(scoped.tenantId, moduleKey);
  if (!ok) {
    return { error: c.json({ error: "Este módulo no está en el plan o no está habilitado" }, 403) as Response };
  }
  return scoped;
}

export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export const DEMO_AGENT_TOKEN = "accesopro-demo-agent";
