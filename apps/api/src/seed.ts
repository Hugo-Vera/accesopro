import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { ensureSchema } from "./db/migrate.js";
import { actuators, cameras, ownerProfiles, properties, propertyServices, sites, tenants, users, visitAuthorizations } from "./db/schema.js";
import { DEMO_AGENT_TOKEN } from "./scope.js";
import { assignPlanToTenant, getTenantPlan, syncPlansFromCatalog } from "./plans.js";
import { applyRoleTemplate, listUserGrants } from "./grants.js";
import { ensureDemoFeatures } from "./features.js";
import { syncAuthorizationToEngine, syncOwnerDniToEngine } from "./engineSync.js";

const DEMO_PASSWORD = "AccesoPro!2026";
const DEMO_TENANT = "tenant_las_acacias";
const DEMO_PLAN = "plan_acceso_pro";

export async function seedIfEmpty() {
  await ensureSchema();
  await syncPlansFromCatalog();
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

    await assignPlanToTenant(DEMO_TENANT, DEMO_PLAN, "user_platform");

    console.log("Seed OK — admin@accesopro.local / AccesoPro!2026");
  }

  await ensureDemoSubscription();
  await ensureDemoGuard();
  await ensureDemoFeatures(DEMO_TENANT);
  await ensureSiteToken();
  await purgeAccesoSeguroBleed();
  await ensureDemoOwner();
}

async function ensureDemoGuard() {
  const email = "guardia@lasacacias.local";
  const existing = await db.select().from(users).where(eq(users.email, email)).get();
  if (existing) {
    const grants = await listUserGrants(existing.id);
    if (!grants.length) {
      await applyRoleTemplate(existing.id, "guard", null);
      return;
    }
    const have = new Set(grants.map((g) => g.capabilityKey));
    if (!have.has("dahua.evidence") || !have.has("dahua.live")) {
      await applyRoleTemplate(existing.id, "guard", null);
    }
    return;
  }
  const tenant = await db.select().from(tenants).where(eq(tenants.id, DEMO_TENANT)).get();
  if (!tenant) return;
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const id = "user_acacias_guard";
  await db.insert(users).values({
    id,
    tenantId: DEMO_TENANT,
    email,
    passwordHash: hash,
    name: "Guardia Las Acacias",
    role: "guard",
    createdAt: new Date(),
  });
  await applyRoleTemplate(id, "guard", null);
}

async function ensureDemoSubscription() {
  const tenant = await db.select().from(tenants).where(eq(tenants.id, DEMO_TENANT)).get();
  if (!tenant) return;
  const plan = await getTenantPlan(DEMO_TENANT);
  if (!plan) {
    await assignPlanToTenant(DEMO_TENANT, DEMO_PLAN, null);
  }
}

async function ensureSiteToken() {
  const site = await db.select().from(sites).where(eq(sites.id, "site_las_acacias_entrada")).get();
  if (site && !site.agentToken) {
    await db.update(sites).set({ agentToken: DEMO_AGENT_TOKEN }).where(eq(sites.id, site.id));
  }
}

/** No re-sembrar barreras/cámaras de AccesoSeguro. No borra equipos Dahua que el barrio cargó. */
async function purgeAccesoSeguroBleed() {
  await db.delete(cameras);
  await db.delete(actuators).where(eq(actuators.driver, "engine"));
}

async function ensureDemoOwner() {
  const site = await db.select().from(sites).where(eq(sites.id, "site_las_acacias_entrada")).get();
  if (!site) return;
  const existing = await db.select().from(properties).where(eq(properties.id, "prop_las_acacias_15")).get();
  const now = new Date();
  if (!existing) {
    await db.insert(properties).values({
      id: "prop_las_acacias_15",
      tenantId: DEMO_TENANT,
      siteId: site.id,
      lotNumber: "15",
      label: "Lote 15 — García",
      address: "Manzana B, Lote 15",
      mapLat: "-34.60380",
      mapLng: "-58.38160",
      notes: "Demo propietario",
      createdAt: now,
    });
  }
  const ownerUser = await db.select().from(users).where(eq(users.email, "vecino@lasacacias.local")).get();
  if (!ownerUser) {
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    await db.insert(users).values({
      id: "user_acacias_vecino",
      tenantId: DEMO_TENANT,
      email: "vecino@lasacacias.local",
      passwordHash: hash,
      name: "María García",
      role: "resident",
      createdAt: now,
    });
    await db.insert(ownerProfiles).values({
      id: "owner_las_acacias_15",
      userId: "user_acacias_vecino",
      propertyId: "prop_las_acacias_15",
      dni: "27123456",
      phone: "+54 11 4567-8900",
      createdAt: now,
    });
    await db.insert(propertyServices).values({
      id: "svc_jardinero_15",
      propertyId: "prop_las_acacias_15",
      role: "jardinero",
      name: "Pedro Gómez",
      horaDesde: "08:00",
      horaHasta: "14:00",
      diasSemana: JSON.stringify([2, 4, 6]),
      notes: "Martes, jueves y sábado",
      active: true,
      createdAt: now,
    });
    const hasta = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db.insert(visitAuthorizations).values({
      id: "auth_empleada_15",
      propertyId: "prop_las_acacias_15",
      siteId: site.id,
      kind: "empleada",
      guestName: "Rosa Martínez",
      guestDni: "30111222",
      fechaDesde: now,
      fechaHasta: hasta,
      horaDesde: "09:00",
      horaHasta: "17:00",
      diasSemana: JSON.stringify([1, 2, 3, 4, 5]),
      notes: "Lunes a viernes",
      active: true,
      createdByUserId: "user_acacias_vecino",
      createdAt: now,
    });
    console.log("Demo vecino — vecino@lasacacias.local / AccesoPro!2026");
    await syncOwnerDniToEngine("15", "27123456", "María García");
    const auth = await db.select().from(visitAuthorizations).where(eq(visitAuthorizations.id, "auth_empleada_15")).get();
    const prop = await db.select().from(properties).where(eq(properties.id, "prop_las_acacias_15")).get();
    if (auth && prop) await syncAuthorizationToEngine(prop, auth);
  }
}
