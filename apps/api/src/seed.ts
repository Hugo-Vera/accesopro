import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { MODULE_CATALOG } from "@accesopro/catalog";
import { db } from "./db/client.js";
import { ensureSchema } from "./db/migrate.js";
import { actuators, sites, tenantModules, tenants, users } from "./db/schema.js";
import { DEMO_AGENT_TOKEN } from "./scope.js";

const DEMO_PASSWORD = "AccesoPro!2026";
const DEMO_TENANT = "tenant_las_acacias";
const URGENT = ["actuators", "dahua_access", "alpr"] as const;

export async function seedIfEmpty() {
  await ensureSchema();
  const existing = await db.select().from(users).limit(1).get();
  if (!existing) {
    const now = new Date();
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

    await db.insert(tenants).values({
      id: DEMO_TENANT,
      name: "Barrio Las Acacias",
      slug: "las-acacias",
      createdAt: now,
    });

    await db.insert(sites).values({
      id: "site_las_acacias_entrada",
      tenantId: DEMO_TENANT,
      name: "Acceso principal",
      agentToken: DEMO_AGENT_TOKEN,
      createdAt: now,
    });

    for (const mod of MODULE_CATALOG) {
      await db.insert(tenantModules).values({
        tenantId: DEMO_TENANT,
        moduleKey: mod.key,
        enabled: mod.alwaysOn || URGENT.includes(mod.key as (typeof URGENT)[number]),
      });
    }

    await db.insert(users).values([
      {
        id: "user_platform",
        tenantId: null,
        email: "admin@accesopro.local",
        passwordHash: hash,
        name: "Administrador plataforma",
        role: "platform_admin",
        createdAt: now,
      },
      {
        id: "user_acacias_admin",
        tenantId: DEMO_TENANT,
        email: "admin@lasacacias.local",
        passwordHash: hash,
        name: "Administración Las Acacias",
        role: "tenant_admin",
        createdAt: now,
      },
    ]);

    console.log("Seed OK — admin@accesopro.local / AccesoPro!2026");
  }

  await ensureUrgentModules();
  await ensureEngineActuators();
}

async function ensureUrgentModules() {
  const site = await db.select().from(sites).where(eq(sites.id, "site_las_acacias_entrada")).get();
  if (site && !site.agentToken) {
    await db.update(sites).set({ agentToken: DEMO_AGENT_TOKEN }).where(eq(sites.id, site.id));
  }
  for (const key of URGENT) {
    const row = await db
      .select()
      .from(tenantModules)
      .where(and(eq(tenantModules.tenantId, DEMO_TENANT), eq(tenantModules.moduleKey, key)))
      .get();
    if (!row) {
      await db.insert(tenantModules).values({ tenantId: DEMO_TENANT, moduleKey: key, enabled: true });
    } else if (!row.enabled) {
      await db
        .update(tenantModules)
        .set({ enabled: true })
        .where(and(eq(tenantModules.tenantId, DEMO_TENANT), eq(tenantModules.moduleKey, key)));
    }
  }
}

async function ensureEngineActuators() {
  const site = await db.select().from(sites).where(eq(sites.id, "site_las_acacias_entrada")).get();
  if (!site) return;
  const now = new Date();
  const wanted = [
    { id: "act_las_acacias_in", name: "Barrera entrada", engineSentido: "in" },
    { id: "act_las_acacias_out", name: "Barrera salida", engineSentido: "out" },
  ] as const;
  for (const item of wanted) {
    const byId = await db.select().from(actuators).where(eq(actuators.id, item.id)).get();
    if (byId) continue;
    const taken = await db
      .select()
      .from(actuators)
      .where(and(eq(actuators.siteId, site.id), eq(actuators.engineSentido, item.engineSentido)))
      .get();
    if (taken) continue;
    await db.insert(actuators).values({
      id: item.id,
      siteId: site.id,
      name: item.name,
      kind: "barrier",
      driver: "engine",
      dahuaChannel: 1,
      pulseMs: 1000,
      engineSentido: item.engineSentido,
      triggerAlpr: true,
      triggerQr: true,
      triggerManual: true,
      createdAt: now,
    });
  }
}
