import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import type { AuthUser } from "./auth.js";
import { requireAuth } from "./auth.js";
import { db } from "./db/client.js";
import { accessPointActuators, accessPointCameras, accessPointDevices, actuators, cameras, commands, dahuaDevices, departments, events, plates } from "./db/schema.js";
import { enqueue, fireActuator, waitCommand, waitOpenCommand } from "./actuatorExec.js";
import { openViaOf, rememberOpen } from "./openContext.js";
import { isEnrollableDeviceType } from "./dahuaSite.js";
import { seedDeviceRoster } from "./rosterReconcile.js";
import { agentOnline, nid, normalizePlate, scopedSite, scopedSiteWithModule } from "./scope.js";
import { parseDeviceLaneSector, parseDeviceSentido, syncDeviceLaneWiring } from "./accessPoints.js";
import { denyUnlessCapability } from "./grants.js";
import { tenantFeatureEnabled, assertFeature } from "./features.js";
import { clearSiteEventPhotos, readEventPhoto } from "./eventPhotos.js";
import { toAsiCardNo } from "@accesopro/catalog";

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
  let readers: Record<string, unknown> = {};
  let cgi: unknown = null;
  if (agentOnline(scoped.site.lastSeenAt)) {
    try {
      const agentToken = process.env.SITE_AGENT_TOKEN ?? "accesopro-demo-agent";
      const hr = await fetch(`${agentBaseUrl()}/health`, {
        headers: { Authorization: `Bearer ${agentToken}` },
        signal: AbortSignal.timeout(4000),
      });
      if (hr.ok) {
        const hj = (await hr.json()) as { readers?: Record<string, unknown>; cgi?: unknown };
        readers = hj.readers ?? {};
        cgi = hj.cgi ?? null;
      }
    } catch {
      /* agent health opcional */
    }
  }
  return c.json({
    agentOnline: agentOnline(scoped.site.lastSeenAt),
    lastSeenAt: scoped.site.lastSeenAt,
    eventsToday: Number(today?.n ?? 0),
    platesToday: Number(platesToday?.n ?? 0),
    readers,
    cgi,
  });
});

hardware.get("/alpr/live", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.siteId, scoped.site.id), eq(events.type, "plate")))
    .orderBy(desc(events.createdAt))
    .limit(40);
  const detections = rows.map((r) => {
    const p = safeJson(r.payload) as Record<string, unknown> | null;
    const list = String(p?.list ?? "");
    const conf = typeof p?.ocrConf === "number" ? p.ocrConf : typeof p?.confidence === "number" ? p.confidence : null;
    return {
      id: r.id,
      fecha: r.createdAt instanceof Date ? r.createdAt.toISOString() : new Date(Number(r.createdAt)).toISOString(),
      sentido: r.sentido || String(p?.sentido ?? "in"),
      patente: String(p?.plate ?? p?.patente ?? ""),
      ocrConf: conf,
      autorizado: list === "white" ? true : list === "black" ? false : null,
      thumb: typeof p?.thumb === "string" ? p.thumb : null,
    };
  });
  return c.json({ detections, total: detections.length });
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
  if (isEnrollableDeviceType(deviceType)) {
    setTimeout(() => {
      void seedDeviceRoster(scoped.site.id, deviceId).catch((err) =>
        console.error("seed roster ASI:", err),
      );
    }, 8_000);
  }
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
  if (action === "open") {
    const u = c.get("user");
    rememberOpen(scoped.site.id, id, {
      reason: "manual",
      openedByUserId: u.id,
      openedByName: u.name,
      openedVia: openViaOf(c),
    });
  }
  const cmd = await enqueue(scoped.site.id, agentAction, { deviceId: id, channel });
  const done =
    action === "open" ? await waitOpenCommand(cmd, 25) : await waitCommand(cmd, action === "snapshot" ? 40 : 25);
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
    if (res.status === 409) {
      const detail = await res.json().catch(() => ({} as { detail?: string; error?: string }));
      return c.json(
        { error: (detail as { detail?: string }).detail || (detail as { error?: string }).error || "Live RTSP abierto" },
        409,
      );
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

hardware.get("/dahua/:id/reader-status", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "dahua.live");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Falta id" }, 400);
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
    const res = await fetch(`${agentBase}/dahua/${id}/reader-status`, {
      headers: { Authorization: `Bearer ${agentToken}` },
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    return c.json(body, res.status === 200 ? 200 : 502);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "No se pudo leer el estado del lector" },
      502,
    );
  }
});

hardware.get("/dahua/:id/inspect", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.dahua");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Falta id" }, 400);
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
    const res = await fetch(`${agentBase}/dahua/${id}/inspect`, {
      headers: { Authorization: `Bearer ${agentToken}` },
      signal: AbortSignal.timeout(12000),
    });
    const body = await res.json().catch(() => ({}));
    return c.json(body, res.status === 200 ? 200 : 502);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "No se pudo leer la config del lector" },
      502,
    );
  }
});

/** Descubrimiento del firmware (Fase 0): volcado crudo del lector, sin mapear. */
async function agentDiagnostic(c: Context<Env>, path: string, timeoutMs = 15000) {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Falta id" }, 400);
  if (!agentOnline(scoped.site.lastSeenAt)) {
    return c.json({ error: "El agent del sitio no está en línea." }, 503);
  }
  const row = await db
    .select({ id: dahuaDevices.id })
    .from(dahuaDevices)
    .where(and(eq(dahuaDevices.id, id), eq(dahuaDevices.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Equipo no encontrado" }, 404);
  const agentToken = process.env.SITE_AGENT_TOKEN ?? "accesopro-demo-agent";
  try {
    const res = await fetch(`${agentBaseUrl()}${path.replace(":id", id)}`, {
      headers: { Authorization: `Bearer ${agentToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => ({}));
    return c.json(body, res.status === 200 ? 200 : 502);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo leer el lector" }, 502);
  }
}

hardware.get("/dahua/:id/config-dump", async (c) => {
  const nodes = c.req.query("nodes") ?? "";
  const qs = nodes ? `?nodes=${encodeURIComponent(nodes)}` : "";
  return agentDiagnostic(c, `/dahua/:id/config-dump${qs}`, 20000);
});

hardware.get("/dahua/:id/person-rows", async (c) => {
  const count = Number(c.req.query("count") ?? 20);
  const safe = Number.isFinite(count) ? Math.min(Math.max(Math.trunc(count), 1), 100) : 20;
  return agentDiagnostic(c, `/dahua/:id/person-rows?count=${safe}`);
});

hardware.get("/dahua/:id/raw-events", async (c) =>
  agentDiagnostic(c, `/raw-events?deviceId=${encodeURIComponent(c.req.param("id") ?? "")}`, 8000),
);

hardware.post("/dahua/:id/face-probe", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "dahua.live");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Falta id" }, 400);
  if (!agentOnline(scoped.site.lastSeenAt)) {
    return c.json({ error: "El agent del sitio no está en línea." }, 503);
  }
  const row = await db
    .select()
    .from(dahuaDevices)
    .where(and(eq(dahuaDevices.id, id), eq(dahuaDevices.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Equipo no encontrado" }, 404);
  const baseline = c.req.query("baselineRecNo") || "";
  const agentBase = agentBaseUrl();
  const agentToken = process.env.SITE_AGENT_TOKEN ?? "accesopro-demo-agent";
  const qs = baseline ? `?baselineRecNo=${encodeURIComponent(baseline)}` : "";
  try {
    const res = await fetch(`${agentBase}/dahua/${id}/face-probe${qs}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${agentToken}` },
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.json().catch(() => ({}));
    return c.json(body, res.ok ? 200 : 502);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "No se pudo completar la prueba de cara" },
      502,
    );
  }
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
    : 1;
  const agentBase = agentBaseUrl();
  const agentToken = process.env.SITE_AGENT_TOKEN ?? "accesopro-demo-agent";
  try {
    const incoming = c.req.raw.signal;
    const ac = new AbortController();
    const stop = () => ac.abort();
    if (incoming.aborted) stop();
    else incoming.addEventListener("abort", stop, { once: true });
    const res = await fetch(
      `${agentBase}/dahua/${id}/live?channel=${channel}&subtype=${subtype}`,
      {
        headers: { Authorization: `Bearer ${agentToken}` },
        signal: ac.signal,
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
    const reader = res.body.getReader();
    const cancelUp = () => {
      stop();
      void reader.cancel().catch(() => undefined);
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            controller.close();
            return;
          }
          controller.enqueue(next.value);
        } catch {
          controller.close();
        }
      },
      cancel() {
        cancelUp();
      },
    });
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "multipart/x-mixed-replace; boundary=frame",
        "Cache-Control": "no-cache, no-store, no-transform, must-revalidate",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const aborted =
      (typeof err === "object" && err !== null && "name" in err && (err as { name: string }).name === "AbortError") ||
      (err instanceof Error && /abort/i.test(err.message));
    if (aborted) {
      return new Response(null, { status: 499 });
    }
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
      signal: AbortSignal.timeout(45000),
    });
    if (res.ok) return c.json(await res.json());
  } catch {
    /* cola */
  }
  const cmd = await enqueue(scoped.site.id, "dahua_person_list", {
    deviceId: id,
    fingerprints: true,
    includeFaces: true,
  });
  const done = await waitCommand(cmd, 90);
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
    cardType?: number;
    useTime?: number;
  }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "Falta el nombre" }, 400);
  const userId = (body.userId?.trim() || `u${Date.now().toString().slice(-8)}`).slice(0, 16);
  const cardNo = toAsiCardNo((body.cardNo?.trim() || userId).slice(0, 32));
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
    cardType: Number(body.cardType || 0),
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
  const u = c.get("user");
  return c.json(
    await fireActuator(scoped.site, c.req.param("id"), "open", {
      reason: "manual",
      openedByUserId: u.id,
      openedByName: u.name,
      openedVia: openViaOf(c),
    }),
  );
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
  const ordered = [...rows].sort((a, b) => a.name.localeCompare(b.name, "es"));
  return c.json({ actuators: ordered });
});

hardware.post("/actuators", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "actuators");
  if ("error" in scoped) return scoped.error;
  const parsed = parseActuatorBody(await c.req.json().catch(() => ({})));
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
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
        name: "attach AccessControl",
        path: "/cgi-bin/eventManager.cgi?action=attach&codes=[AccessControl]&heartbeat=5",
        uso: "Stream vivo de pases. Un hilo. Si late, NO se usa RecordFinder.",
      },
      {
        name: "openDoor",
        path: "/cgi-bin/accessControl.cgi?action=openDoor&channel={n}",
        uso: "Pulso del relé del terminal. Puntual, no en bucle.",
      },
      {
        name: "RecordFinder RPC",
        path: "RPC RecordFinder.doSeekFind (solo si el attach cayó)",
        uso: "Respaldo de eventos. Con attach sano queda apagado: martillaba el SoC cada 8 s.",
      },
      {
        name: "FileManager foto",
        path: "RPC FileManager + /RPC2_Loadfile (al tocar un evento)",
        uso: "Captura de evidencia. El historial ya no las pide en lote.",
      },
      {
        name: "getSystemInfo",
        path: "/cgi-bin/magicBox.cgi?action=getSystemInfo",
        uso: "Probar equipo (botón en Acceso Dahua). No es ping de cara.",
      },
    ],
    comandosAccesoPro: [
      { action: "open", via: "cola del agent", uso: "Abrir actuador Dahua o IP" },
      { action: "probe_dahua", via: "cola del agent", uso: "Leer modelo/serial del equipo" },
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
  const types = type ? type.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const rawLimit = Number(c.req.query("limit") || 24);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 24;
  const rows = types.length
    ? await db
        .select()
        .from(events)
        .where(and(eq(events.siteId, scoped.site.id), types.length === 1 ? eq(events.type, types[0]!) : inArray(events.type, types)))
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

/** Foto local del evento. 404 si aún no se copió; no proxy al ASI. */
hardware.get("/events/:id/photo", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  const row = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, id), eq(events.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Evento no encontrado" }, 404);
  const buf = readEventPhoto(scoped.site.id, id);
  if (!buf) {
    return new Response("missing", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
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
    if (!typeFilter || typeFilter === "dahua_access") {
      clearSiteEventPhotos(scoped.site.id);
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
  if (!driver) return { error: "Elegí driver: Dahua o IP" };
  const kind = raw.kind === "gate" || raw.kind === "barrier" ? raw.kind : "door";
  const engineSentido = raw.engineSentido === "out" ? "out" : raw.engineSentido === "in" ? "in" : null;
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
    triggerAlpr: flag(raw, "triggerAlpr", false),
    triggerDahua: flag(raw, "triggerDahua", driver === "dahua"),
    triggerQr: flag(raw, "triggerQr", false),
    triggerManual: flag(raw, "triggerManual", true),
  };
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

