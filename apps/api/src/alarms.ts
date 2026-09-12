import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "./db/client.js";
import { events, ownerProfiles, properties } from "./db/schema.js";
import type { AuthUser } from "./auth.js";
import { denyUnlessCapability } from "./grants.js";
import { nid, scopedSite, scopedSiteWithModule } from "./scope.js";

type Env = { Variables: { user: AuthUser } };

export const alarmsApi = new Hono<Env>();

const PANIC_TYPES = ["panic_sos"] as const;
const FIRE_TYPES = ["fire_contact"] as const;

function parsePayload(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

alarmsApi.get("/alarms", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.alarms");
  if (denied) return denied;
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;

  const kind = c.req.query("kind");
  const types = kind === "fire" ? [...FIRE_TYPES] : kind === "panic" ? [...PANIC_TYPES] : [...PANIC_TYPES, ...FIRE_TYPES];
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.siteId, scoped.site.id), inArray(events.type, types)))
    .orderBy(desc(events.createdAt))
    .limit(80);

  return c.json({
    alarms: rows.map((row) => {
      const payload = parsePayload(row.payload);
      return {
        id: row.id,
        type: row.type,
        createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
        status: String(payload.status || "open"),
        source: String(payload.source || "manual"),
        message: String(payload.message || ""),
        lotNumber: payload.lotNumber ?? null,
        ownerName: payload.ownerName ?? null,
        zone: payload.zone ?? null,
        payload,
      };
    }),
  });
});

alarmsApi.post("/alarms/panic", async (c) => {
  const scoped = await scopedSiteWithModule(c, "panic");
  if ("error" in scoped) return scoped.error;
  const user = c.get("user");
  const body = (await c.req.json().catch(() => ({}))) as { message?: string; source?: string };

  let lotNumber: string | null = null;
  let ownerName: string | null = user.name;
  const profile = await db.select().from(ownerProfiles).where(eq(ownerProfiles.userId, user.id)).get();
  if (profile) {
    const property = await db.select().from(properties).where(eq(properties.id, profile.propertyId)).get();
    lotNumber = property?.lotNumber ?? null;
    ownerName = profile.fullName || user.name;
  }

  const id = nid();
  const now = new Date();
  await db.insert(events).values({
    id,
    siteId: scoped.site.id,
    type: "panic_sos",
    sentido: null,
    laneCode: null,
    payload: JSON.stringify({
      status: "open",
      source: body.source || (user.role === "resident" ? "portal" : "manual"),
      message: (body.message || "SOS vecino").trim(),
      lotNumber,
      ownerName,
      userId: user.id,
    }),
    createdAt: now,
  });
  return c.json({ ok: true, id });
});

alarmsApi.post("/alarms/fire", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.alarms");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "fire");
  if ("error" in scoped) return scoped.error;
  const body = (await c.req.json().catch(() => ({}))) as { zone?: string; active?: boolean; message?: string };
  const active = body.active !== false;
  const id = nid();
  await db.insert(events).values({
    id,
    siteId: scoped.site.id,
    type: "fire_contact",
    payload: JSON.stringify({
      status: active ? "open" : "closed",
      source: "panel",
      zone: (body.zone || "Panel principal").trim(),
      message: (body.message || (active ? "Contacto de incendio abierto" : "Contacto normalizado")).trim(),
      certified: false,
    }),
    createdAt: new Date(),
  });
  return c.json({ ok: true, id, active });
});

alarmsApi.post("/alarms/:id/ack", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.alarms");
  if (denied) return denied;
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  const row = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Alarma no encontrada" }, 404);
  const payload = parsePayload(row.payload);
  payload.status = "acked";
  payload.ackedBy = c.get("user").email;
  payload.ackedAt = Date.now();
  await db.update(events).set({ payload: JSON.stringify(payload) }).where(eq(events.id, id));
  return c.json({ ok: true });
});

alarmsApi.post("/alarms/:id/close", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.alarms");
  if (denied) return denied;
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  const row = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Alarma no encontrada" }, 404);
  const payload = parsePayload(row.payload);
  payload.status = "closed";
  payload.closedBy = c.get("user").email;
  payload.closedAt = Date.now();
  await db.update(events).set({ payload: JSON.stringify(payload) }).where(eq(events.id, id));
  return c.json({ ok: true });
});
