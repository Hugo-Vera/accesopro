import { and, eq } from "drizzle-orm";
import {
  FEATURE_PACK_CATALOG,
  featuresForModule,
  isFeatureKey,
  type FeaturePackDef,
  type ModuleKey,
} from "@accesopro/catalog";
import { db } from "./db/client.js";
import { tenantFeatures, tenantModules } from "./db/schema.js";
import { tenantModuleAllowed } from "./plans.js";

export async function listTenantFeatures(tenantId: string) {
  const rows = await db.select().from(tenantFeatures).where(eq(tenantFeatures.tenantId, tenantId));
  const byKey = new Map(rows.map((r) => [r.featureKey, r.enabled]));

  const packs = await Promise.all(
    FEATURE_PACK_CATALOG.map(async (pack) => {
      const parentOn = await tenantModuleAllowed(tenantId, pack.parentModule);
      const stored = byKey.get(pack.key);
      const enabled = parentOn && (stored === undefined ? pack.defaultOn : Boolean(stored));
      return {
        ...pack,
        parentOn,
        enabled,
        configured: stored !== undefined,
      };
    }),
  );
  return packs.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function tenantFeatureEnabled(tenantId: string, featureKey: string): Promise<boolean> {
  const pack = FEATURE_PACK_CATALOG.find((f) => f.key === featureKey);
  if (!pack) return false;
  if (!(await tenantModuleAllowed(tenantId, pack.parentModule))) return false;
  const row = await db
    .select()
    .from(tenantFeatures)
    .where(and(eq(tenantFeatures.tenantId, tenantId), eq(tenantFeatures.featureKey, featureKey)))
    .get();
  if (!row) return pack.defaultOn;
  return Boolean(row.enabled);
}

export async function setTenantFeature(tenantId: string, featureKey: string, enabled: boolean) {
  if (!isFeatureKey(featureKey)) throw new Error("Feature desconocida");
  const pack = FEATURE_PACK_CATALOG.find((f) => f.key === featureKey)!;
  if (!(await tenantModuleAllowed(tenantId, pack.parentModule))) {
    throw new Error(`Activá el módulo «${pack.parentModule}» antes`);
  }
  await db
    .insert(tenantFeatures)
    .values({ tenantId, featureKey, enabled })
    .onConflictDoUpdate({
      target: [tenantFeatures.tenantId, tenantFeatures.featureKey],
      set: { enabled },
    });
  return pack;
}

/** Al habilitar un módulo, sembrá features default si no hay filas. */
export async function ensureDefaultFeaturesForModule(tenantId: string, moduleKey: ModuleKey) {
  const modOn = await db
    .select()
    .from(tenantModules)
    .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, moduleKey)))
    .get();
  if (!modOn?.enabled && moduleKey !== "core") return;

  for (const pack of featuresForModule(moduleKey)) {
    const existing = await db
      .select()
      .from(tenantFeatures)
      .where(and(eq(tenantFeatures.tenantId, tenantId), eq(tenantFeatures.featureKey, pack.key)))
      .get();
    if (existing) continue;
    await db.insert(tenantFeatures).values({
      tenantId,
      featureKey: pack.key,
      enabled: pack.defaultOn,
    });
  }
}

export async function ensureDemoFeatures(tenantId: string) {
  await ensureDefaultFeaturesForModule(tenantId, "dahua_access");
  for (const key of ["dahua.live", "dahua.evidence", "dahua.persons", "dahua.qr"] as const) {
    await setTenantFeature(tenantId, key, true);
  }
}

export function serializeFeature(pack: FeaturePackDef & { parentOn?: boolean; enabled?: boolean }) {
  return {
    key: pack.key,
    parentModule: pack.parentModule,
    name: pack.name,
    summary: pack.summary,
    capabilityKey: pack.capabilityKey,
    href: pack.href ?? null,
    defaultOn: pack.defaultOn,
    sortOrder: pack.sortOrder,
    parentOn: pack.parentOn ?? true,
    enabled: pack.enabled ?? pack.defaultOn,
  };
}
