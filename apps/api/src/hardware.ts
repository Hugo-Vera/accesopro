import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthUser } from "./auth.js";
import { requireAuth } from "./auth.js";
import { db } from "./db/client.js";
import { accessPointActuators, accessPointCameras, accessPointDevices, actuators, cameras, commands, dahuaDevices, departments, events, plates } from "./db/schema.js";
import { enqueue, fireActuator, waitCommand } from "./actuatorExec.js";
import { processEngineAccessEvents } from "./engineBridge.js";
import { agentOnline, nid, normalizePlate, scopedSite, scopedSiteWithModule } from "./scope.js";
import { parseDeviceLaneSector, parseDeviceSentido, syncDeviceLaneWiring } from "./accessPoints.js";
import { denyUnlessCapability } from "./grants.js";
import { tenantFeatureEnabled, assertFeature } from "./features.js";
import { engineDetections, engineGet, engineHealth, engineOps, enginePost, enginePut, engineRelay, maskSecrets, safeMediaPath, siteFetch } from "./siteEngine.js";

export { fireActuator } from "./actuatorExec.js";

function parseServicePort(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return fallback;
  return Math.trunc(n);
}

type Env = { Variables: { user: AuthUser } };

/** Base del site-agent. En Ubuntu (agent host network) debe ser host.docker.internal:8790. */
function agentBaseUrl(): string {
  return (process.env.SITE_AGENT_URL ?? "http://127.0.0.1:8790").replace(/\/$/, "");
}

export const hardware = new Hono<Env>();
hardware.use("*", requireAuth);

hardware.get("/status", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = await db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .where(and(eq(events.siteId, scoped.site.id), gte(events.createdAt, start)))
    .get();
  const platesToday = await db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .where(and(eq(events.siteId, scoped.site.id), eq(events.type, "plate"), gte(events.createdAt, start)))
    .get();
  const engine = await engineHealth();
  let evidenceIn = false;
  let evidenceOut = false;
  if (engine.online) {
    try {
      const sub = (await engineGet("/api/subsystems")) as {
        snapshot_enabled_in?: boolean;
        snapshot_enabled_out?: boolean;
      };
      evidenceIn = Boolean(sub.snapshot_enabled_in);
      evidenceOut = Boolean(sub.snapshot_enabled_out);
    } catch {
      /* motor sin subsystems */
    }
  }
  return c.json({
    agentOnline: agentOnline(scoped.site.lastSeenAt),
    engineOnline: engine.online,
    engineUrl: process.env.SITE_ENGINE_URL ?? "http://127.0.0.1:5051",
    lastSeenAt: scoped.site.lastSeenAt,
    eventsToday: Number(today?.n ?? 0),
    platesToday: Number(platesToday?.n ?? 0),
    cameraIn: engine.online
      ? { running: Boolean(engine.in?.running), host: engine.in?.cameraHost ?? "", configured: Boolean(engine.in?.configured) }
      : null,
    cameraOut: engine.online
      ? { running: Boolean(engine.out?.running), host: engine.out?.cameraHost ?? "", configured: Boolean(engine.out?.configured) }
      : null,
    evidenceIn,
    evidenceOut,
  });
});

hardware.get("/alpr/live", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const engine = await engineHealth();
  if (!engine.online) {
    return c.json({
      engineOnline: false,
      engineUrl: process.env.SITE_ENGINE_URL ?? "http://127.0.0.1:5051",
      detections: [],
      in: null,
      out: null,
      error: "AccesoSeguro no responde. Tiene que estar corriendo en la LAN (:5051).",
    });
  }
  try {
    const detections = await engineDetections(40);
    return c.json({
      engineOnline: true,
      engineUrl: process.env.SITE_ENGINE_URL ?? "http://127.0.0.1:5051",
      in: engine.in,
      out: engine.out,
      detections: detections.items,
      total: detections.total,
    });
  } catch (err) {
    return c.json(
      {
        engineOnline: true,
        engineUrl: process.env.SITE_ENGINE_URL ?? "http://127.0.0.1:5051",
        detections: [],
        error: err instanceof Error ? err.message : "No se pudieron leer detecciones",
      },
      502,
    );
  }
});

hardware.get("/alpr/media", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const path = safeMediaPath(c.req.query("p"));
  if (!path) return c.json({ error: "Ruta de evidencia inválida" }, 400);
  try {
    const res = await siteFetch(`/${path}`);
    if (!res.ok) return c.json({ error: "Evidencia no encontrada" }, 404);
    const type = res.headers.get("content-type") ?? "image/jpeg";
    return new Response(await res.arrayBuffer(), {
      headers: { "Content-Type": type, "Cache-Control": "private, max-age=120" },
    });
  } catch {
    return c.json({ error: "No se pudo leer la evidencia" }, 502);
  }
});

hardware.get("/alpr/ops", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  try {
    const ops = await engineOps();
    if (ops.health.online) {
      await processEngineAccessEvents(scoped.site, ops.events);
    }
    return c.json({
      engineOnline: ops.health.online,
      engineUrl: process.env.SITE_ENGINE_URL ?? "http://127.0.0.1:5051",
      in: ops.health.online ? ops.health.in : null,
      out: ops.health.online ? ops.health.out : null,
      stats: ops.stats,
      relay: ops.relay,
      events: ops.events,
    });
  } catch {
    return c.json({
      engineOnline: false,
      engineUrl: process.env.SITE_ENGINE_URL ?? "http://127.0.0.1:5051",
      in: null,
      out: null,
      stats: null,
      relay: null,
      events: [],
    });
  }
});

hardware.post("/alpr/relay/:action", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.relay");
  if (denied) return denied;
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const action = c.req.param("action");
  if (action !== "open" && action !== "close") {
    return c.json({ error: "Acción inválida" }, 400);
  }
  const body = await c.req.json<{ sentido?: string }>().catch(() => ({ sentido: "in" }));
  const sentido = body.sentido === "out" ? "out" : "in";
  try {
    const result = await engineRelay(action, sentido);
    return c.json({ ok: true, result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Fallo el relé" }, 502);
  }
});

const ENGINE_GET = new Set([
  "/api/config",
  "/api/subsystems",
  "/api/config/evidence",
  "/api/com-ports",
  "/api/auth/operadores",
  "/api/camera-config",
]);
const ENGINE_POST = new Set([
  "/api/config",
  "/api/subsystems/toggle",
  "/api/config/evidence",
  "/api/evidencia/purge-manual",
  "/api/camera-config",
  "/api/auth/operadores",
]);

function enginePath(raw: string | undefined) {
  const path = (raw ?? "").trim();
  const base = path.split("?")[0];
  if (!base.startsWith("/api/")) return null;
  return { path, base };
}

hardware.get("/alpr/engine", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const parsed = enginePath(c.req.query("p"));
  if (!parsed || !ENGINE_GET.has(parsed.base)) return c.json({ error: "Ruta no permitida" }, 403);
  try {
    const data = await engineGet(parsed.path);
    return c.json(maskSecrets(data));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Motor no responde" }, 502);
  }
});

hardware.post("/alpr/engine", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const parsed = enginePath(c.req.query("p"));
  if (!parsed || !ENGINE_POST.has(parsed.base)) return c.json({ error: "Ruta no permitida" }, 403);
  try {
    const body = await c.req.json().catch(() => ({}));
    const data = await enginePost(parsed.path, body);
    return c.json(maskSecrets(data));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo guardar" }, 502);
  }
});

hardware.put("/alpr/engine", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const parsed = enginePath(c.req.query("p"));
  if (!parsed || !/^\/api\/auth\/operadores\/\d+$/.test(parsed.base)) {
    return c.json({ error: "Ruta no permitida" }, 403);
  }
  try {
    const body = await c.req.json().catch(() => ({}));
    const data = await enginePut(parsed.path, body);
    return c.json(maskSecrets(data));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo guardar" }, 502);
  }
});

hardware.get("/dahua", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const rows = await db.select().from(dahuaDevices).where(eq(dahuaDevices.siteId, scoped.site.id));
  return c.json({
    devices: rows.map(({ password: _p, ...rest }) => rest),
  });
});

hardware.post("/dahua", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    actuatorName?: string;
    kind?: string;
    deviceType?: string;
    model?: string;
    serialNumber?: string;
    location?: string;
    rtspUrl?: string;
    rtspPort?: number;
    pssPort?: number;
    sentido?: string;
    laneSector?: string;
    useLive?: boolean;
    useLocalRelay?: boolean;
  }>();
  if (!body.name || !body.host || !body.username || !body.password) {
    return c.json({ error: "Faltan nombre, IP, usuario o clave" }, 400);
  }
  const now = new Date();
  const deviceId = nid();
  const deviceType = body.deviceType || "asi_facial";
  const sentido = parseDeviceSentido(body.sentido);
  const laneSector = parseDeviceLaneSector(body.laneSector);
  const useLive = body.useLive !== false;
  const useLocalRelay = deviceType === "camera_ip" ? false : body.useLocalRelay !== false;
  const rtspPort = parseServicePort(body.rtspPort, 554);
  const pssPort = parseServicePort(body.pssPort, 37777);
  await db.insert(dahuaDevices).values({
    id: deviceId,
    siteId: scoped.site.id,
    name: body.name.trim(),
    deviceType,
    model: body.model?.trim() || null,
    serialNumber: body.serialNumber?.trim() || null,
    location: body.location?.trim() || null,
    rtspUrl: body.rtspUrl?.trim() || null,
    lastStatus: "unknown",
    host: body.host.trim(),
    port: parseServicePort(body.port, 80),
    rtspPort,
    pssPort,
    username: body.username.trim(),
    password: body.password,
    sentido,
    laneSector,
    useLive,
    useLocalRelay,
    createdAt: now,
  });
  let actuatorId: string | null = null;
  if (useLocalRelay) {
    actuatorId = nid();
    await db.insert(actuators).values({
      id: actuatorId,
      siteId: scoped.site.id,
      name: (body.actuatorName || body.name).trim(),
      kind: body.kind ?? (laneSector === "vehicular" ? "barrier" : "door"),
      driver: "dahua",
      dahuaDeviceId: deviceId,
      dahuaChannel: 1,
      pulseMs: 1000,
      triggerDahua: true,
      triggerManual: true,
      engineSentido: sentido,
      createdAt: now,
    });
  }

  if (deviceType === "camera_ip" && body.rtspUrl?.trim()) {
    await db.insert(cameras).values({
      id: `cam_${deviceId}`,
      siteId: scoped.site.id,
      name: body.name.trim(),
      rtspUrl: body.rtspUrl.trim(),
      actuatorId: actuatorId || null,
      enabled: true,
      createdAt: now,
    }).onConflictDoUpdate({
      target: cameras.id,
      set: {
        name: body.name.trim(),
        rtspUrl: body.rtspUrl.trim(),
        actuatorId: actuatorId || null,
      },
    });
  }

  await syncDeviceLaneWiring(
    scoped.site.id,
    {
      id: deviceId,
      name: body.name.trim(),
      deviceType,
      sentido,
      laneSector,
      useLive,
      useLocalRelay,
    },
    { actuatorName: body.actuatorName, kind: body.kind },
  );

  await enqueue(scoped.site.id, "probe_dahua", { deviceId });
  return c.json({ ok: true, id: deviceId, actuatorId });
});

hardware.patch("/dahua/:id", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Falta id" }, 400);
  const row = await db
    .select()
    .from(dahuaDevices)
    .where(and(eq(dahuaDevices.id, id), eq(dahuaDevices.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Equipo no encontrado" }, 404);
  const body = await c.req.json<{
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    actuatorName?: string;
    kind?: string;
    deviceType?: string;
    model?: string;
    serialNumber?: string;
    location?: string;
    rtspUrl?: string;
    rtspPort?: number;
    pssPort?: number;
    sentido?: string;
    laneSector?: string;
    useLive?: boolean;
    useLocalRelay?: boolean;
  }>();
  const next: Record<string, unknown> = {
    name: body.name?.trim() || row.name,
    host: body.host?.trim() || row.host,
    port: body.port !== undefined ? parseServicePort(body.port, row.port) : row.port,
    username: body.username?.trim() || row.username,
    password: body.password?.trim() ? body.password : row.password,
  };
  if (body.deviceType !== undefined) next.deviceType = body.deviceType;
  if (body.model !== undefined) next.model = body.model?.trim() || null;
  if (body.serialNumber !== undefined) next.serialNumber = body.serialNumber?.trim() || null;
  if (body.location !== undefined) next.location = body.location?.trim() || null;
  if (body.rtspUrl !== undefined) next.rtspUrl = body.rtspUrl?.trim() || null;
  if (body.rtspPort !== undefined) next.rtspPort = parseServicePort(body.rtspPort, row.rtspPort ?? 554);
  if (body.pssPort !== undefined) next.pssPort = parseServicePort(body.pssPort, row.pssPort ?? 37777);
  const deviceType = String(body.deviceType ?? row.deviceType ?? "asi_facial");
  const sentido = body.sentido !== undefined ? parseDeviceSentido(body.sentido) : parseDeviceSentido(row.sentido);
  next.sentido = sentido;
  const laneSector =
    body.laneSector !== undefined ? parseDeviceLaneSector(body.laneSector) : parseDeviceLaneSector(row.laneSector);
  next.laneSector = laneSector;
  const useLive = body.useLive !== undefined ? Boolean(body.useLive) : row.useLive !== false;
  next.useLive = useLive;
  const useLocalRelay =
    deviceType === "camera_ip"
      ? false
      : body.useLocalRelay !== undefined
        ? Boolean(body.useLocalRelay)
        : row.useLocalRelay !== false;
  next.useLocalRelay = useLocalRelay;

  await db.update(dahuaDevices).set(next).where(eq(dahuaDevices.id, id));
  if (body.actuatorName?.trim() || body.kind) {
    const act = await db.select().from(actuators).where(eq(actuators.dahuaDeviceId, id)).get();
    if (act) {
      await db
        .update(actuators)
        .set({
          name: body.actuatorName?.trim() || act.name,
          kind: body.kind || act.kind,
        })
        .where(eq(actuators.id, act.id));
    }
  }

  // Si es cámara, sincronizar cameras
  const isCam = deviceType === "camera_ip";
  if (isCam && body.rtspUrl?.trim()) {
    await db.insert(cameras).values({
      id: `cam_${id}`,
      siteId: scoped.site.id,
      name: (body.name || row.name).trim(),
      rtspUrl: body.rtspUrl.trim(),
      enabled: true,
      createdAt: new Date(),
    }).onConflictDoUpdate({
      target: cameras.id,
      set: {
        name: (body.name || row.name).trim(),
        rtspUrl: body.rtspUrl.trim(),
      },
    });
  }

  await syncDeviceLaneWiring(
    scoped.site.id,
    {
      id,
      name: String(next.name),
      deviceType,
      sentido,
      laneSector,
      useLive,
      useLocalRelay,
    },
    { actuatorName: body.actuatorName, kind: body.kind },
  );

  return c.json({ ok: true, id });
});

hardware.delete("/dahua/:id", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  const acts = await db.select().from(actuators).where(eq(actuators.dahuaDeviceId, id));
  for (const a of acts) {
    await db.delete(accessPointActuators).where(eq(accessPointActuators.actuatorId, a.id));
  }
  await db.delete(accessPointDevices).where(eq(accessPointDevices.dahuaDeviceId, id));
  await db.delete(accessPointCameras).where(eq(accessPointCameras.cameraId, `cam_${id}`));
  await db.delete(actuators).where(eq(actuators.dahuaDeviceId, id));
  await db.delete(cameras).where(eq(cameras.id, `cam_${id}`));
  await db.delete(dahuaDevices).where(and(eq(dahuaDevices.id, id), eq(dahuaDevices.siteId, scoped.site.id)));
  return c.json({ ok: true });
});

hardware.post("/dahua/probe-transient", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  if (!agentOnline(scoped.site.lastSeenAt)) {
    return c.json({ error: "El agent del sitio no está en línea. Arrancalo en la LAN." }, 503);
  }
  const body = await c.req.json<{
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    cameraBrand?: string;
    deviceType?: string;
  }>();
  if (!body.host || !body.username || !body.password) {
    return c.json({ error: "Completá IP, usuario y clave para probar conexión" }, 400);
  }
  const cmd = await enqueue(scoped.site.id, "probe_dahua", {
    host: body.host.trim(),
    port: Number(body.port) || 80,
    username: body.username.trim(),
    password: body.password,
    cameraBrand: body.cameraBrand?.trim() || "",
    deviceType: body.deviceType?.trim() || "camera_ip",
  });
  const done = await waitCommand(cmd, 25);
  return c.json(done);
});

hardware.post("/dahua/:id/probe", async (c) => {
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  if (!agentOnline(scoped.site.lastSeenAt)) {
    return c.json({ error: "El agent del sitio no está en línea. Arrancalo en la LAN." }, 503);
  }
  const id = c.req.param("id");
  const cmd = await enqueue(scoped.site.id, "probe_dahua", { deviceId: id });
  const done = await waitCommand(cmd, 25);
  const isOk = Boolean(done.ok && (done.result as { ok?: boolean } | null)?.ok !== false);
  const updateData: Record<string, unknown> = {
    lastStatus: isOk ? "online" : "offline",
    lastSeenAt: isOk ? new Date() : undefined,
  };
  const resObj = done.result as { deviceType?: string; serial?: string } | null;
  if (isOk && resObj?.deviceType) updateData.model = resObj.deviceType;
  if (isOk && resObj?.serial) updateData.serialNumber = resObj.serial;
  await db.update(dahuaDevices).set(updateData).where(eq(dahuaDevices.id, id));
  return c.json(done);
});

hardware.post("/dahua/:id/check-online", async (c) => {
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  if (!agentOnline(scoped.site.lastSeenAt)) {
    await db.update(dahuaDevices).set({ lastStatus: "offline" }).where(eq(dahuaDevices.id, id));
    return c.json({ ok: false, status: "offline", error: "Agent Dahua offline" });
  }
  const cmd = await enqueue(scoped.site.id, "probe_dahua", { deviceId: id });
  const done = await waitCommand(cmd, 25);
  const isOk = Boolean(done.ok && (done.result as { ok?: boolean } | null)?.ok !== false);
  const updateData: Record<string, unknown> = {
    lastStatus: isOk ? "online" : "offline",
  };
  if (isOk) updateData.lastSeenAt = new Date();
  const resObj = done.result as { deviceType?: string; serial?: string } | null;
  if (isOk && resObj?.deviceType) updateData.model = resObj.deviceType;
  if (isOk && resObj?.serial) updateData.serialNumber = resObj.serial;
  await db.update(dahuaDevices).set(updateData).where(eq(dahuaDevices.id, id));
  return c.json({ ok: isOk, status: isOk ? "online" : "offline", result: done.result });
});

hardware.post("/dahua/:id/test", async (c) => {
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Falta id" }, 400);
  const body = await c.req.json<{ action?: string; channel?: number }>().catch(() => ({} as { action?: string; channel?: number }));
  const action = body.action ?? "probe";
  if (action === "open") {
    const u = c.get("user");
    const deniedOpen = await denyUnlessCapability(u, "dahua.open");
    if (deniedOpen) {
      const deniedRelay = await denyUnlessCapability(u, "ops.relay");
      if (deniedRelay) return deniedOpen;
    }
  }
  if (!agentOnline(scoped.site.lastSeenAt)) {
    return c.json({ error: "El agent del sitio no está en línea. Arrancalo en la LAN." }, 503);
  }
  const row = await db
    .select()
    .from(dahuaDevices)
    .where(and(eq(dahuaDevices.id, id), eq(dahuaDevices.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Equipo no encontrado" }, 404);
  const channel = Number(body.channel) || 1;
  const map: Record<string, string> = {
    probe: "probe_dahua",
    door_status: "dahua_door_status",
    open: "dahua_open",
    snapshot: "dahua_snapshot",
  };
  const agentAction = map[action];
  if (!agentAction) return c.json({ error: "Acción de prueba desconocida" }, 400);
  const cmd = await enqueue(scoped.site.id, agentAction, { deviceId: id, channel });
  const done = await waitCommand(cmd, action === "snapshot" ? 40 : 25);
  const isOk = Boolean(done.ok && (done.result as { ok?: boolean } | null)?.ok !== false);
  const updateData: Record<string, unknown> = {
    lastStatus: isOk ? "online" : "offline",
  };
  if (isOk) updateData.lastSeenAt = new Date();
  const resObj = done.result as { deviceType?: string; serial?: string } | null;
  if (isOk && resObj?.deviceType) updateData.model = resObj.deviceType;
  if (isOk && resObj?.serial) updateData.serialNumber = resObj.serial;
  await db.update(dahuaDevices).set(updateData).where(eq(dahuaDevices.id, id));
  return c.json(done);
});

hardware.get("/dahua/:id/access-records", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "dahua.events");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  const count = Number(c.req.query("count") || 8);
  const ingest = c.req.query("ingest") === "1" || c.req.query("ingest") === "true";
  if (!agentOnline(scoped.site.lastSeenAt)) {
    return c.json({ error: "El agent del sitio no está en línea." }, 503);
  }
  const agentBase = agentBaseUrl();
  const agentToken = process.env.SITE_AGENT_TOKEN ?? "accesopro-demo-agent";
  const qs = new URLSearchParams({
    count: String(Math.min(Math.max(count || 8, 1), 20)),
    ingest: ingest ? "1" : "0",
  });
  try {
    const res = await fetch(`${agentBase}/dahua/${id}/records?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${agentToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return c.json(await res.json());
    const errText = await res.text().catch(() => "");
    return c.json({ error: errText || `Agent HTTP ${res.status}` }, 502);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "No se pudo leer RecordFinder del ASI" },
      502,
    );
  }
});

hardware.get("/dahua/:id/snapshot", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "dahua.live");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Falta id" }, 400);
  if (!(await tenantFeatureEnabled(scoped.site.tenantId, "dahua.live"))) {
    return c.json({ error: "Pack Live apagado en este barrio" }, 403);
  }
  if (!agentOnline(scoped.site.lastSeenAt)) {
    return c.json({ error: "El agent del sitio no está en línea. Arrancalo en la LAN." }, 503);
  }
  const row = await db
    .select()
    .from(dahuaDevices)
    .where(and(eq(dahuaDevices.id, id), eq(dahuaDevices.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Equipo no encontrado" }, 404);

  const channel = Number(c.req.query("channel")) || 1;
  const agentBase = agentBaseUrl();
  const agentToken = process.env.SITE_AGENT_TOKEN ?? "accesopro-demo-agent";
  try {
    const res = await fetch(`${agentBase}/dahua/${id}/snapshot?channel=${channel}`, {
      headers: { Authorization: `Bearer ${agentToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
          "Cache-Control": "no-store",
        },
      });
    }
  } catch {
    // cae al comando en cola
  }

  const cmd = await enqueue(scoped.site.id, "dahua_snapshot", { deviceId: id, channel });
  const done = await waitCommand(cmd, 40);
  const result = done.result as { imageBase64?: string; contentType?: string; error?: string } | null;
  if (!done.ok || !result?.imageBase64) {
    return c.json({ error: done.error || result?.error || "Sin imagen" }, 502);
  }
  const buf = Buffer.from(result.imageBase64, "base64");
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": result.contentType || "image/jpeg",
      "Cache-Control": "no-store",
    },
  });
});

hardware.get("/dahua/:id/record-snapshot", async (c) => {
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  // Algunos proxies/rewrites pierden query; aceptar también header/fallback
  let url = c.req.query("url") || c.req.query("path") || "";
  try {
    url = decodeURIComponent(url);
  } catch {
    /* keep raw */
  }
  if (!id || !url) return c.json({ error: "Falta id o url" }, 400);
  const trimmed = url.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") {
    return c.json({ error: "URL de captura inválida" }, 400);
  }
  // Solo rutas de archivo del ASI (evitar open-proxy)
  if (!trimmed.startsWith("/SnapShot") && !trimmed.startsWith("/var") && !trimmed.startsWith("/")) {
    return c.json({ error: "Ruta de captura no permitida" }, 400);
  }

  const agentBase = agentBaseUrl();
  const agentToken = process.env.SITE_AGENT_TOKEN ?? "accesopro-demo-agent";
  try {
    const res = await fetch(`${agentBase}/dahua/${id}/record-snapshot?url=${encodeURIComponent(trimmed)}`, {
      headers: { Authorization: `Bearer ${agentToken}` },
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": res.headers.get("Content-Type") || "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
    // Archivo borrado del ASI / agent offline: 204 para no spamear consola del browser con 4xx
    if (res.status === 404 || res.status === 400) {
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }
    const status = res.status === 503 ? 503 : 502;
    return c.json(
      { error: "Captura no disponible", agent: agentBase },
      {
        status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    return c.json(
      {
        error: err instanceof Error ? err.message : "Error al descargar captura",
        agent: agentBase,
        hint: "Si el agent corre en network_mode:host, SITE_AGENT_URL debe ser http://host.docker.internal:8790",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
});

hardware.get("/dahua/:id/live", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "dahua.live");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Falta id" }, 400);
  if (!(await tenantFeatureEnabled(scoped.site.tenantId, "dahua.live"))) {
    return c.json({ error: "Pack Live apagado en este barrio" }, 403);
  }
  if (!agentOnline(scoped.site.lastSeenAt)) {
    return c.json({ error: "El agent del sitio no está en línea. Arrancalo en la LAN." }, 503);
  }
  const row = await db
    .select()
    .from(dahuaDevices)
    .where(and(eq(dahuaDevices.id, id), eq(dahuaDevices.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Equipo no encontrado" }, 404);

  const channel = Number(c.req.query("channel")) || 1;
  const rawSubtype = c.req.query("subtype");
  const subtype = rawSubtype !== undefined && !isNaN(Number(rawSubtype))
    ? Number(rawSubtype)
    : /facial|lector|asi|totem|pedestre/i.test(row.name) ? 2 : 2;
  const agentBase = agentBaseUrl();
  const agentToken = process.env.SITE_AGENT_TOKEN ?? "accesopro-demo-agent";
  try {
    const res = await fetch(
      `${agentBase}/dahua/${id}/live?channel=${channel}&subtype=${subtype}`,
      {
        headers: { Authorization: `Bearer ${agentToken}` },
      },
    );
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      return c.json(
        {
          error: detail || "El agent no pudo abrir el live RTSP",
          agent: agentBase,
        },
        502,
      );
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "multipart/x-mixed-replace; boundary=frame",
        "Cache-Control": "no-cache, no-store, no-transform, must-revalidate",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return c.json(
      {
        error: err instanceof Error ? err.message : "No se pudo conectar al agent para live",
        agent: agentBase,
        hint: "En Ubuntu con agent host-network: SITE_AGENT_URL=http://host.docker.internal:8790",
      },
      502,
    );
  }
});

hardware.get("/dahua/:id/persons", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "dahua.persons");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Falta id" }, 400);
  if (!(await tenantFeatureEnabled(scoped.site.tenantId, "dahua.persons"))) {
    return c.json({ error: "Pack Personas apagado en este barrio" }, 403);
  }
  if (!agentOnline(scoped.site.lastSeenAt)) {
    return c.json({ error: "El agent del sitio no está en línea." }, 503);
  }
  const row = await db
    .select()
    .from(dahuaDevices)
    .where(and(eq(dahuaDevices.id, id), eq(dahuaDevices.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Equipo no encontrado" }, 404);
  const agentBase = agentBaseUrl();
  const agentToken = process.env.SITE_AGENT_TOKEN ?? "accesopro-demo-agent";
  try {
    const res = await fetch(`${agentBase}/dahua/${id}/persons`, {
      headers: { Authorization: `Bearer ${agentToken}` },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) return c.json(await res.json());
  } catch {
    /* cola */
  }
  const cmd = await enqueue(scoped.site.id, "dahua_person_list", { deviceId: id });
  const done = await waitCommand(cmd, 30);
  if (!done.ok) return c.json({ error: done.error || "No se pudo listar" }, 502);
  return c.json(done.result ?? { ok: true, persons: [] });
});

hardware.post("/dahua/:id/persons", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "dahua.persons");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Falta id" }, 400);
  if (!(await tenantFeatureEnabled(scoped.site.tenantId, "dahua.persons"))) {
    return c.json({ error: "Pack Personas apagado en este barrio" }, 403);
  }
  if (!agentOnline(scoped.site.lastSeenAt)) {
    return c.json({ error: "El agent del sitio no está en línea." }, 503);
  }
  const row = await db
    .select()
    .from(dahuaDevices)
    .where(and(eq(dahuaDevices.id, id), eq(dahuaDevices.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Equipo no encontrado" }, 404);
  const body = await c.req.json<{
    name?: string;
    userId?: string;
    cardNo?: string;
    password?: string;
    photoBase64?: string;
    validDateStart?: string;
    validDateEnd?: string;
    periodIndex?: number;
    userType?: number;
    useTime?: number;
  }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "Falta el nombre" }, 400);
  const userId = (body.userId?.trim() || `u${Date.now().toString().slice(-8)}`).slice(0, 16);
  const cardNo = (body.cardNo?.trim() || userId).slice(0, 20);
  const cmd = await enqueue(scoped.site.id, "dahua_person_enroll", {
    deviceId: id,
    userId,
    name,
    cardNo,
    password: body.password?.trim() || undefined,
    photoBase64: body.photoBase64 || undefined,
    validDateStart: body.validDateStart?.trim() || undefined,
    validDateEnd: body.validDateEnd?.trim() || undefined,
    periodIndex: body.periodIndex !== undefined ? Number(body.periodIndex) : 255,
    userType: Number(body.userType || 0),
    useTime: Number(body.useTime || 0),
  });
  const done = await waitCommand(cmd, 50);
  if (!done.ok) {
    const result = done.result as { error?: string } | null;
    return c.json({ error: done.error || result?.error || "No se pudo enrolar" }, 502);
  }
  return c.json(done.result);
});

hardware.delete("/dahua/:id/persons/:userId", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "dahua.persons");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  const userId = c.req.param("userId");
  if (!id || !userId) return c.json({ error: "Falta id" }, 400);
  if (!(await tenantFeatureEnabled(scoped.site.tenantId, "dahua.persons"))) {
    return c.json({ error: "Pack Personas apagado en este barrio" }, 403);
  }
  if (!agentOnline(scoped.site.lastSeenAt)) {
    return c.json({ error: "El agent del sitio no está en línea." }, 503);
  }
  const cardNo = c.req.query("cardNo") || undefined;
  const recNo = c.req.query("recNo") || undefined;
  const cmd = await enqueue(scoped.site.id, "dahua_person_delete", {
    deviceId: id,
    userId,
    cardNo,
    recNo,
  });
  const done = await waitCommand(cmd, 30);
  if (!done.ok) return c.json({ error: done.error || "No se pudo borrar" }, 502);
  return c.json(done.result ?? { ok: true });
});

hardware.get("/dahua/:id/qr-config", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "dahua.qr");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const feat = await assertFeature(scoped.site.tenantId, "dahua.qr");
  if (feat) return c.json({ error: feat }, 403);
  const id = c.req.param("id");
  const agentBase = agentBaseUrl();
  const agentToken = process.env.SITE_AGENT_TOKEN ?? "accesopro-demo-agent";
  try {
    const res = await fetch(`${agentBase}/dahua/${id}/qr-config`, {
      headers: { Authorization: `Bearer ${agentToken}` },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) return c.json(await res.json());
  } catch {}
  const cmd = await enqueue(scoped.site.id, "dahua_qr_get_config", { deviceId: id });
  const done = await waitCommand(cmd, 20);
  if (!done.ok) return c.json({ error: done.error || "No se pudo consultar QR" }, 502);
  return c.json(done.result);
});

hardware.post("/dahua/:id/qr-config", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "dahua.qr");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const feat = await assertFeature(scoped.site.tenantId, "dahua.qr");
  if (feat) return c.json({ error: feat }, 403);
  const id = c.req.param("id");
  const body = await c.req.json<{ transmissionEnable?: boolean; validTime?: number }>();
  const agentBase = agentBaseUrl();
  const agentToken = process.env.SITE_AGENT_TOKEN ?? "accesopro-demo-agent";
  try {
    const res = await fetch(`${agentBase}/dahua/${id}/qr-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return c.json(await res.json());
  } catch {}
  const cmd = await enqueue(scoped.site.id, "dahua_qr_set_config", {
    deviceId: id,
    transmissionEnable: body.transmissionEnable,
    validTime: body.validTime,
  });
  const done = await waitCommand(cmd, 25);
  if (!done.ok) return c.json({ error: done.error || "No se pudo actualizar QR" }, 502);
  return c.json(done.result);
});

hardware.get("/dahua/:id/schedules", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "dahua.schedules");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const feat = await assertFeature(scoped.site.tenantId, "dahua.schedules");
  if (feat) return c.json({ error: feat }, 403);
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  const count = Number(c.req.query("count")) || 16;
  const agentBase = agentBaseUrl();
  const agentToken = process.env.SITE_AGENT_TOKEN ?? "accesopro-demo-agent";
  try {
    const res = await fetch(`${agentBase}/dahua/${id}/schedules?count=${count}`, {
      headers: { Authorization: `Bearer ${agentToken}` },
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) return c.json(await res.json());
  } catch {}
  const cmd = await enqueue(scoped.site.id, "dahua_schedules_get", { deviceId: id, count });
  const done = await waitCommand(cmd, 35);
  if (!done.ok) return c.json({ error: done.error || "No se pudo consultar periodos" }, 502);
  return c.json(done.result);
});

hardware.post("/dahua/:id/schedules", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "dahua.schedules");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const feat = await assertFeature(scoped.site.tenantId, "dahua.schedules");
  if (feat) return c.json({ error: feat }, 403);
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  const body = await c.req.json<{ index: number; enabled?: boolean; days: string[][] }>();
  const agentBase = agentBaseUrl();
  const agentToken = process.env.SITE_AGENT_TOKEN ?? "accesopro-demo-agent";
  try {
    const res = await fetch(`${agentBase}/dahua/${id}/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return c.json(await res.json());
  } catch {}
  const cmd = await enqueue(scoped.site.id, "dahua_schedule_set", {
    deviceId: id,
    index: body.index,
    enabled: body.enabled,
    days: body.days,
  });
  const done = await waitCommand(cmd, 30);
  if (!done.ok) return c.json({ error: done.error || "No se pudo guardar periodo" }, 502);
  return c.json(done.result);
});

hardware.post("/dahua/:id/listen-card", async (c) => {
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  const body = await c.req.json<{ timeout?: number }>().catch(() => ({ timeout: 15 }));
  const agentBase = agentBaseUrl();
  const agentToken = process.env.SITE_AGENT_TOKEN ?? "accesopro-demo-agent";
  try {
    const res = await fetch(`${agentBase}/dahua/${id}/listen-card`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) return c.json(await res.json());
  } catch {}
  const cmd = await enqueue(scoped.site.id, "dahua_card_listen", {
    deviceId: id,
    timeout: body.timeout || 15,
  });
  const done = await waitCommand(cmd, 25);
  if (!done.ok) return c.json({ error: done.error || "No se detectó tarjeta" }, 502);
  return c.json(done.result);
});

hardware.post("/actuators/:id/open", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.relay");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "actuators");
  if ("error" in scoped) return scoped.error;
  return c.json(await fireActuator(scoped.site, c.req.param("id"), "open"));
});

hardware.post("/actuators/:id/close", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.relay");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "actuators");
  if ("error" in scoped) return scoped.error;
  return c.json(await fireActuator(scoped.site, c.req.param("id"), "close"));
});

hardware.get("/actuators", async (c) => {
  const scoped = await scopedSiteWithModule(c, "actuators");
  if ("error" in scoped) return scoped.error;
  const rows = await db.select().from(actuators).where(eq(actuators.siteId, scoped.site.id));
  let relay: { open_in?: boolean; open_out?: boolean; simulated?: boolean } | null = null;
  try {
    const res = await siteFetch("/api/relay/status");
    if (res.ok) relay = (await res.json()) as { open_in?: boolean; open_out?: boolean; simulated?: boolean };
  } catch {
    relay = null;
  }
  const ordered = [...rows].sort((a, b) => {
    const rank = (r: (typeof rows)[number]) =>
      r.driver === "engine" && r.engineSentido === "in" ? 0 : r.driver === "engine" && r.engineSentido === "out" ? 1 : 2;
    return rank(a) - rank(b) || a.name.localeCompare(b.name, "es");
  });
  return c.json({
    actuators: ordered.map((r) => ({
      ...r,
      open:
        r.driver === "engine" && r.engineSentido === "in"
          ? Boolean(relay?.open_in)
          : r.driver === "engine" && r.engineSentido === "out"
            ? Boolean(relay?.open_out)
            : null,
    })),
    relay,
  });
});

hardware.post("/actuators", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "actuators");
  if ("error" in scoped) return scoped.error;
  const parsed = parseActuatorBody(await c.req.json().catch(() => ({})));
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const taken = await sentidoTaken(scoped.site.id, parsed.engineSentido);
  if (taken) return c.json({ error: "Ese lado del motor LAN ya tiene un actuador" }, 409);
  const id = nid();
  await db.insert(actuators).values({
    id,
    siteId: scoped.site.id,
    ...parsed,
    createdAt: new Date(),
  });
  return c.json({ ok: true, id });
});

hardware.patch("/actuators/:id", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "actuators");
  if ("error" in scoped) return scoped.error;
  const row = await db
    .select()
    .from(actuators)
    .where(and(eq(actuators.id, c.req.param("id")), eq(actuators.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Actuador no encontrado" }, 404);
  const parsed = parseActuatorBody({ ...row, ...(await c.req.json().catch(() => ({}))) });
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const taken = await sentidoTaken(scoped.site.id, parsed.engineSentido, row.id);
  if (taken) return c.json({ error: "Ese lado del motor LAN ya tiene un actuador" }, 409);
  await db
    .update(actuators)
    .set(parsed)
    .where(and(eq(actuators.id, row.id), eq(actuators.siteId, scoped.site.id)));
  return c.json({ ok: true });
});

hardware.delete("/actuators/:id", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "actuators");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  await db.delete(actuators).where(and(eq(actuators.id, id), eq(actuators.siteId, scoped.site.id)));
  return c.json({ ok: true });
});

hardware.get("/commands", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const rows = await db
    .select()
    .from(commands)
    .where(eq(commands.siteId, scoped.site.id))
    .orderBy(desc(commands.createdAt))
    .limit(60);
  return c.json({
    commands: rows.map((r) => ({
      id: r.id,
      action: r.action,
      payload: safeJson(r.payload),
      status: r.status,
      result: safeJson(r.result),
      createdAt: r.createdAt,
    })),
  });
});

hardware.get("/debug", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const engine = await engineHealth();
  const acts = await db.select().from(actuators).where(eq(actuators.siteId, scoped.site.id));
  const cmds = await db
    .select()
    .from(commands)
    .where(eq(commands.siteId, scoped.site.id))
    .orderBy(desc(commands.createdAt))
    .limit(40);
  return c.json({
    agentOnline: agentOnline(scoped.site.lastSeenAt),
    agentLastSeenAt: scoped.site.lastSeenAt,
    engineOnline: engine.online,
    actuators: acts.map((a) => ({
      id: a.id,
      name: a.name,
      driver: a.driver,
      engineSentido: a.engineSentido,
      dahuaChannel: a.dahuaChannel,
      triggerAlpr: a.triggerAlpr,
      triggerDahua: a.triggerDahua,
      triggerQr: a.triggerQr,
      triggerManual: a.triggerManual,
    })),
    dahuaCgi: [
      {
        name: "getSystemInfo",
        path: "/cgi-bin/magicBox.cgi?action=getSystemInfo",
        uso: "Probar equipo (botón Probar en Acceso Dahua)",
      },
      {
        name: "openDoor",
        path: "/cgi-bin/accessControl.cgi?action=openDoor&channel={n}",
        uso: "Pulso del relé del terminal. El canal se tilda en el actuador.",
      },
      {
        name: "accessRecords",
        path: "/cgi-bin/recordFinder.cgi?action=find&name=AccessControlCardRec",
        uso: "Cola de accesos: cara, tarjeta, clave",
      },
    ],
    comandosAccesoPro: [
      { action: "open", via: "cola del agent", uso: "Abrir actuador Dahua o IP" },
      { action: "probe_dahua", via: "cola del agent", uso: "Leer modelo/serial del equipo" },
      { action: "engine.relay", via: "API motor LAN :5051", uso: "Abrir/cerrar barrera IN u OUT" },
      {
        action: "engine_bridge",
        via: "poll /api/events/recent",
        uso: "QR/DNI autorizado → actuadores con QR; chapa autorizada → actuadores con Chapa",
      },
    ],
    commands: cmds.map((r) => ({
      id: r.id,
      action: r.action,
      payload: safeJson(r.payload),
      status: r.status,
      result: safeJson(r.result),
      createdAt: r.createdAt,
    })),
  });
});

hardware.get("/cameras", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const rows = await db.select().from(cameras).where(eq(cameras.siteId, scoped.site.id));
  return c.json({ cameras: rows });
});

hardware.post("/cameras", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{
    name?: string;
    rtspUrl?: string;
    actuatorId?: string | null;
  }>();
  if (!body.name || !body.rtspUrl) {
    return c.json({ error: "Faltan nombre y URL RTSP" }, 400);
  }
  const id = nid();
  await db.insert(cameras).values({
    id,
    siteId: scoped.site.id,
    name: body.name.trim(),
    rtspUrl: body.rtspUrl.trim(),
    actuatorId: body.actuatorId || null,
    enabled: true,
    createdAt: new Date(),
  });
  return c.json({ ok: true, id });
});

hardware.delete("/cameras/:id", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  await db.delete(cameras).where(and(eq(cameras.id, c.req.param("id")), eq(cameras.siteId, scoped.site.id)));
  return c.json({ ok: true });
});

hardware.get("/plates", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const rows = await db.select().from(plates).where(eq(plates.siteId, scoped.site.id));
  return c.json({ plates: rows });
});

hardware.post("/plates", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{ plate?: string; list?: string; note?: string }>();
  const plate = normalizePlate(body.plate ?? "");
  if (plate.length < 5) return c.json({ error: "Patente inválida" }, 400);
  const list = body.list === "black" ? "black" : "white";
  await db
    .insert(plates)
    .values({ siteId: scoped.site.id, plate, list, note: body.note ?? null })
    .onConflictDoUpdate({
      target: [plates.siteId, plates.plate],
      set: { list, note: body.note ?? null },
    });
  return c.json({ ok: true, plate, list });
});

hardware.delete("/plates/:plate", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  await db
    .delete(plates)
    .where(and(eq(plates.siteId, scoped.site.id), eq(plates.plate, normalizePlate(c.req.param("plate")))));
  return c.json({ ok: true });
});

hardware.get("/events", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const type = c.req.query("type");
  const rawLimit = Number(c.req.query("limit") || 24);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 24;
  const rows = type
    ? await db
        .select()
        .from(events)
        .where(and(eq(events.siteId, scoped.site.id), eq(events.type, type)))
        .orderBy(desc(events.createdAt))
        .limit(limit)
    : await db
        .select()
        .from(events)
        .where(eq(events.siteId, scoped.site.id))
        .orderBy(desc(events.createdAt))
        .limit(limit);
  return c.json({
    events: rows.map((e) => ({
      ...e,
      payload: JSON.parse(e.payload) as unknown,
    })),
  });
});

hardware.post("/events/clear", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const user = c.get("user");
  const denied = await denyUnlessCapability(user, "core.config");
  if (denied) return denied;

  const body = await c.req.json<{
    clearLocal?: boolean;
    clearDevice?: boolean;
    type?: string;
    deviceId?: string;
  }>().catch(() => ({ clearLocal: true, clearDevice: false, type: undefined, deviceId: undefined }));

  const clearLocal = body.clearLocal !== false;
  const clearDevice = Boolean(body.clearDevice);
  const typeFilter = body.type;

  if (clearLocal) {
    if (typeFilter) {
      await db
        .delete(events)
        .where(and(eq(events.siteId, scoped.site.id), eq(events.type, typeFilter)));
    } else {
      await db.delete(events).where(eq(events.siteId, scoped.site.id));
    }
  }

  let deviceResults: Record<string, unknown> = {};
  if (clearDevice) {
    const devs = await db
      .select()
      .from(dahuaDevices)
      .where(eq(dahuaDevices.siteId, scoped.site.id));

    for (const dev of devs) {
      if (dev.deviceType === "camera_ip") continue;
      if (body.deviceId && dev.id !== body.deviceId) continue;
      const cmd = await enqueue(scoped.site.id, "dahua_clear_records", { deviceId: dev.id });
      const done = await waitCommand(cmd, 15);
      deviceResults[dev.name] = done.result ?? done;
    }
  }

  return c.json({ ok: true, clearLocal, clearDevice, deviceResults });
});

type ActuatorInput = {
  name: string;
  kind: string;
  driver: "dahua" | "ip" | "engine";
  dahuaDeviceId: string | null;
  dahuaChannel: number;
  httpUrl: string | null;
  pulseMs: number;
  engineSentido: "in" | "out" | null;
  triggerAlpr: boolean;
  triggerDahua: boolean;
  triggerQr: boolean;
  triggerManual: boolean;
};

function flag(raw: Record<string, unknown>, key: string, fallback: boolean) {
  const v = raw[key];
  if (typeof v === "boolean") return v;
  if (v === 0 || v === 1 || v === "0" || v === "1") return Boolean(Number(v));
  return fallback;
}

function parseActuatorBody(raw: Record<string, unknown>): ActuatorInput | { error: string } {
  const name = String(raw.name ?? "").trim();
  if (!name) return { error: "Falta el nombre del actuador" };
  const driver = raw.driver === "dahua" || raw.driver === "ip" || raw.driver === "engine" ? raw.driver : null;
  if (!driver) return { error: "Elegí driver: motor LAN, Dahua o IP" };
  const kind = raw.kind === "gate" || raw.kind === "barrier" ? raw.kind : "door";
  const engineSentido = driver === "engine" ? (raw.engineSentido === "out" ? "out" : raw.engineSentido === "in" ? "in" : null) : null;
  if (driver === "engine" && !engineSentido) return { error: "El motor LAN necesita lado IN o OUT" };
  if (driver === "dahua" && !String(raw.dahuaDeviceId ?? "").trim()) return { error: "Elegí el equipo Dahua" };
  if (driver === "ip" && !String(raw.httpUrl ?? "").trim()) return { error: "Falta la URL del relé IP" };
  return {
    name,
    kind,
    driver,
    dahuaDeviceId: driver === "dahua" ? String(raw.dahuaDeviceId).trim() : null,
    dahuaChannel: Number(raw.dahuaChannel) || 1,
    httpUrl: driver === "ip" ? String(raw.httpUrl).trim() : null,
    pulseMs: Math.max(200, Number(raw.pulseMs) || 1000),
    engineSentido,
    triggerAlpr: flag(raw, "triggerAlpr", driver === "engine"),
    triggerDahua: flag(raw, "triggerDahua", driver === "dahua"),
    triggerQr: flag(raw, "triggerQr", false),
    triggerManual: flag(raw, "triggerManual", true),
  };
}

async function sentidoTaken(siteId: string, sentido: "in" | "out" | null, exceptId?: string) {
  if (!sentido) return false;
  const rows = await db.select().from(actuators).where(eq(actuators.siteId, siteId));
  return rows.some((r) => r.engineSentido === sentido && r.id !== exceptId);
}

function safeJson(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

hardware.get("/departments", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const rows = await db
    .select()
    .from(departments)
    .where(and(eq(departments.tenantId, scoped.site.tenantId), eq(departments.siteId, scoped.site.id)));
  return c.json({ ok: true, departments: rows });
});

hardware.post("/departments", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{
    name?: string;
    dahuaDeptId?: string;
    defaultPeriodIndex?: number;
    description?: string;
  }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "Falta el nombre del departamento" }, 400);
  const dahuaDeptId = body.dahuaDeptId?.trim() || "1";
  const defaultPeriodIndex = body.defaultPeriodIndex !== undefined ? Number(body.defaultPeriodIndex) : 255;
  const id = nid();
  const row = {
    id,
    tenantId: scoped.site.tenantId,
    siteId: scoped.site.id,
    dahuaDeptId,
    name,
    defaultPeriodIndex,
    description: body.description?.trim() || null,
    createdAt: new Date(),
  };
  await db.insert(departments).values(row);
  return c.json({ ok: true, department: row });
});

hardware.delete("/departments/:id", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Falta id" }, 400);
  await db.delete(departments).where(and(eq(departments.id, id), eq(departments.siteId, scoped.site.id)));
  return c.json({ ok: true });
});

