import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "./db/client.js";
import { actuators, cameras, commands, dahuaDevices, events, plates, sites } from "./db/schema.js";
import { nid, normalizePlate } from "./scope.js";
import { fireActuator } from "./actuatorExec.js";
import { matchesSentido, sentidoOf } from "./engineBridge.js";
import { broadcastRealtimeEvent } from "./eventStream.js";

type AgentEnv = { Variables: { siteId: string } };

export const agentRoutes = new Hono<AgentEnv>();

agentRoutes.use("*", async (c, next) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return c.json({ error: "Falta token del agent" }, 401);
  const site = await db.select().from(sites).where(eq(sites.agentToken, token)).get();
  if (!site) return c.json({ error: "Token de agent inválido" }, 401);
  c.set("siteId", site.id);
  await next();
});

agentRoutes.post("/heartbeat", async (c) => {
  const siteId = c.get("siteId");
  await db.update(sites).set({ lastSeenAt: new Date() }).where(eq(sites.id, siteId));
  return c.json({ ok: true });
});

agentRoutes.get("/config", async (c) => {
  const siteId = c.get("siteId");
  const [devs, acts, cams, plist] = await Promise.all([
    db.select().from(dahuaDevices).where(eq(dahuaDevices.siteId, siteId)),
    db.select().from(actuators).where(eq(actuators.siteId, siteId)),
    db.select().from(cameras).where(eq(cameras.siteId, siteId)),
    db.select().from(plates).where(eq(plates.siteId, siteId)),
  ]);
  return c.json({
    siteId,
    dahua: devs,
    actuators: acts,
    cameras: cams.filter((cam) => cam.enabled),
    plates: plist,
  });
});

agentRoutes.get("/commands", async (c) => {
  const siteId = c.get("siteId");
  const rows = await db
    .select()
    .from(commands)
    .where(and(eq(commands.siteId, siteId), eq(commands.status, "pending")));
  return c.json({
    commands: rows.map((r) => ({
      id: r.id,
      action: r.action,
      payload: JSON.parse(r.payload) as unknown,
    })),
  });
});

agentRoutes.post("/commands/:id/result", async (c) => {
  const siteId = c.get("siteId");
  const body = await c.req.json<{ ok?: boolean; result?: unknown; error?: string }>();
  await db
    .update(commands)
    .set({
      status: body.ok ? "done" : "error",
      result: JSON.stringify(body.result ?? { error: body.error }),
    })
    .where(and(eq(commands.id, c.req.param("id")), eq(commands.siteId, siteId)));
  return c.json({ ok: true });
});

agentRoutes.post("/events", async (c) => {
  const siteId = c.get("siteId");
  const site = await db.select().from(sites).where(eq(sites.id, siteId)).get();
  const body = await c.req.json<{
    type?: string;
    payload?: Record<string, unknown>;
  }>();
  if (!body.type || !body.payload) return c.json({ error: "Evento incompleto" }, 400);

  let openActuatorId: string | null = null;
  const payload = { ...body.payload };
  const acts = await db.select().from(actuators).where(eq(actuators.siteId, siteId));

  if (body.type === "plate") {
    const plate = normalizePlate(String(payload.plate ?? ""));
    payload.plate = plate;
    const row = await db
      .select()
      .from(plates)
      .where(and(eq(plates.siteId, siteId), eq(plates.plate, plate)))
      .get();
    payload.list = row?.list ?? "unknown";
    if (row?.list === "white") {
      const cameraId = String(payload.cameraId ?? "");
      const cam = await db.select().from(cameras).where(eq(cameras.id, cameraId)).get();
      if (cam?.actuatorId) openActuatorId = cam.actuatorId;
      for (const a of acts.filter((x) => x.triggerAlpr)) {
        if (a.driver === "engine" && site) await fireActuator(site, a.id, "open");
        else if (!openActuatorId) openActuatorId = a.id;
      }
    }
    if (row?.list === "black") {
      payload.blocked = true;
    }
  }

  if (body.type === "dahua_access") {
    const failed = String(payload.Status ?? payload.status ?? "1") === "0";
    const method = String(payload.Method ?? payload.methodCode ?? payload.method ?? "");
    const isRemoteUnlock = method === "4" || method === "remote";
    const deviceId = String(payload.deviceId ?? "");

    // Evitamos bucle infinito: si ya es una apertura remota (Method 4), no disparamos actuadores.
    // Además, el terminal Dahua ya acciona su propio relé localmente al reconocer la cara;
    // solo se disparan actuadores vinculados distintos (ej. barreras auxiliares de motor LAN u otros relés).
    if (!failed && !isRemoteUnlock && site) {
      for (const a of acts.filter((x) => x.triggerDahua)) {
        if (a.driver === "dahua" && a.dahuaDeviceId === deviceId) {
          continue;
        }
        await fireActuator(site, a.id, "open");
      }
    }
  }

  if (body.type === "qr_access" || body.type === "dni_access") {
    const resultado = String(payload.resultado ?? "autorizado");
    const failed = resultado !== "autorizado" && resultado !== "manual";
    if (!failed && site) {
      const sentido = sentidoOf(String(payload.sentido ?? "in"));
      for (const a of acts.filter((x) => x.triggerQr && matchesSentido(x, sentido))) {
        await fireActuator(site, a.id, "open");
      }
    }
  }

  const eventId = nid();
  const eventDate = new Date();

  await db.insert(events).values({
    id: eventId,
    siteId,
    type: body.type,
    payload: JSON.stringify(payload),
    createdAt: eventDate,
  });

  // Emisión en tiempo real por SSE al frontend con 0ms de latencia
  broadcastRealtimeEvent({
    id: eventId,
    siteId,
    tenantId: site?.tenantId,
    type: body.type,
    payload,
    createdAt: eventDate.getTime(),
  });

  return c.json({ ok: true, openActuatorId });
});
