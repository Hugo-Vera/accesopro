import { and, eq } from "drizzle-orm";
import {
  MODULE_CATALOG,
  PLAN_CATALOG,
  isModuleKey,
  planById,
  planIncludesModule,
  type PlanDef,
} from "@accesopro/catalog";
import { db } from "./db/client.js";
import { plans, tenantModules, tenantSubscriptions } from "./db/schema.js";

export type TenantPlanView = PlanDef & {
  assignedAt: Date | null;
};

export async function syncPlansFromCatalog() {
  const now = new Date();
  for (const p of PLAN_CATALOG) {
    const row = await db.select().from(plans).where(eq(plans.id, p.id)).get();
    const values = {
      slug: p.slug,
      name: p.name,
      summary: p.summary,
      moduleKeysJson: JSON.stringify(p.moduleKeys),
      capabilityKeysJson: JSON.stringify(p.capabilityKeys),
      limitsJson: JSON.stringify(p.limits),
      sortOrder: p.sortOrder,
    };
    if (!row) {
      await db.insert(plans).values({ id: p.id, createdAt: now, ...values });
    } else {
      await db.update(plans).set(values).where(eq(plans.id, p.id));
    }
  }
}

export async function getTenantPlan(tenantId: string): Promise<TenantPlanView | null> {
  const sub = await db
    .select()
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.tenantId, tenantId))
    .get();
  if (!sub) return null;
  const def = planById(sub.planId);
  if (!def) return null;
  return { ...def, assignedAt: sub.assignedAt };
}

export async function tenantModuleAllowed(tenantId: string, moduleKey: string): Promise<boolean> {
  const def = MODULE_CATALOG.find((m) => m.key === moduleKey);
  if (def?.alwaysOn) return true;
  if (!isModuleKey(moduleKey)) return false;
  const plan = await getTenantPlan(tenantId);
  if (plan && !planIncludesModule(plan, moduleKey)) return false;
  const row = await db
    .select()
    .from(tenantModules)
    .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, moduleKey)))
    .get();
  return Boolean(row?.enabled);
}

/** Aplica plan: enciende módulos del plan, apaga los que quedan fuera. */
export async function assignPlanToTenant(
  tenantId: string,
  planId: string,
  assignedByUserId: string | null,
) {
  const def = planById(planId);
  if (!def) throw new Error("Plan desconocido");
  await syncPlansFromCatalog();
  const now = new Date();
  await db
    .insert(tenantSubscriptions)
    .values({
      tenantId,
      planId: def.id,
      assignedAt: now,
      assignedByUserId,
    })
    .onConflictDoUpdate({
      target: [tenantSubscriptions.tenantId],
      set: {
        planId: def.id,
        assignedAt: now,
        assignedByUserId,
      },
    });

  const allowed = new Set<string>(["core", ...def.moduleKeys]);
  for (const mod of MODULE_CATALOG) {
    const on = allowed.has(mod.key);
    await db
      .insert(tenantModules)
      .values({ tenantId, moduleKey: mod.key, enabled: on })
      .onConflictDoUpdate({
        target: [tenantModules.tenantId, tenantModules.moduleKey],
        set: { enabled: on },
      });
  }
  return def;
}

export function serializePlan(p: PlanDef | TenantPlanView) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    summary: p.summary,
    moduleKeys: p.moduleKeys,
    capabilityKeys: p.capabilityKeys,
    limits: p.limits,
    sortOrder: p.sortOrder,
    assignedAt: "assignedAt" in p ? p.assignedAt : undefined,
  };
}
