import { eq } from "drizzle-orm";
import {
  CAPABILITY_CATALOG,
  isCapabilityKey,
  roleTemplate,
  type CapabilityKey,
} from "@accesopro/catalog";
import type { AuthUser } from "./auth.js";
import { db } from "./db/client.js";
import { userGrants, users } from "./db/schema.js";
import { getTenantPlan } from "./plans.js";

export type AuthUserWithCaps = AuthUser & { capabilities: CapabilityKey[] };

function planCapabilitySet(planCaps: string[] | null | undefined): Set<string> | null {
  if (!planCaps) return null;
  return new Set(planCaps);
}

/** Caps efectivas = plantilla/rol ∩ plan ∩ grants (admin/plataforma implícitos). */
export async function resolveCapabilities(user: AuthUser): Promise<CapabilityKey[]> {
  if (user.role === "platform_admin") {
    return CAPABILITY_CATALOG.map((c) => c.key);
  }

  const plan = user.tenantId ? await getTenantPlan(user.tenantId) : null;
  const planCaps = planCapabilitySet(plan?.capabilityKeys);

  if (user.role === "tenant_admin") {
    const template = roleTemplate("tenant_admin");
    return template.filter((k) => !planCaps || planCaps.has(k));
  }

  const rows = await db.select().from(userGrants).where(eq(userGrants.userId, user.id));
  const granted = new Set(rows.map((r) => r.capabilityKey));
  const base = roleTemplate(user.role);
  // Si no hay filas aún, usar plantilla del rol (bootstrap). Si hay filas, solo esas.
  const keys = rows.length === 0 ? base : [...granted].filter(isCapabilityKey);
  return keys.filter((k) => {
    if (!isCapabilityKey(k)) return false;
    if (planCaps && !planCaps.has(k)) return false;
    return true;
  });
}

export async function userHasCapability(user: AuthUser, key: CapabilityKey): Promise<boolean> {
  const caps = await resolveCapabilities(user);
  return caps.includes(key);
}

export async function applyRoleTemplate(
  userId: string,
  role: string,
  grantedByUserId: string | null,
) {
  const keys = roleTemplate(role).filter((k) => !k.startsWith("platform."));
  const now = new Date();
  await db.delete(userGrants).where(eq(userGrants.userId, userId));
  for (const key of keys) {
    await db.insert(userGrants).values({
      userId,
      capabilityKey: key,
      grantedAt: now,
      grantedByUserId,
    });
  }
}

export async function setUserCapabilityGrants(
  userId: string,
  capabilityKeys: string[],
  grantedByUserId: string | null,
) {
  const target = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!target) throw new Error("Usuario no encontrado");
  if (target.role === "platform_admin" || target.role === "tenant_admin") {
    throw new Error("El admin usa la plantilla del rol; no se editan grants");
  }

  const plan = target.tenantId ? await getTenantPlan(target.tenantId) : null;
  const planCaps = planCapabilitySet(plan?.capabilityKeys);
  const clean = [
    ...new Set(
      capabilityKeys.filter((k) => isCapabilityKey(k) && (!planCaps || planCaps.has(k))),
    ),
  ] as CapabilityKey[];

  const now = new Date();
  await db.delete(userGrants).where(eq(userGrants.userId, userId));
  for (const key of clean) {
    await db.insert(userGrants).values({
      userId,
      capabilityKey: key,
      grantedAt: now,
      grantedByUserId,
    });
  }
  return clean;
}

export async function listUserGrants(userId: string) {
  return db.select().from(userGrants).where(eq(userGrants.userId, userId));
}

export function serializeCapability(key: CapabilityKey) {
  const def = CAPABILITY_CATALOG.find((c) => c.key === key);
  return def ?? { key, group: "?", name: key, summary: "" };
}

/** Helper de ruta: 403 si falta el capability. */
export async function denyUnlessCapability(
  user: AuthUser,
  key: CapabilityKey,
): Promise<Response | null> {
  if (await userHasCapability(user, key)) return null;
  return Response.json({ error: `Sin permiso «${key}»` }, { status: 403 });
}
