import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthUser } from "./auth.js";
import { requireAuth } from "./auth.js";
import { db } from "./db/client.js";
import { actuators, cameras, commands, dahuaDevices, events, plates } from "./db/schema.js";
import { enqueue, fireActuator, waitCommand } from "./actuatorExec.js";
import { processEngineAccessEvents } from "./engineBridge.js";
import { agentOnline, nid, normalizePlate, scopedSite, scopedSiteWithModule } from "./scope.js";
import { engineDetections, engineGet, engineHealth, engineOps, enginePost, enginePut, engineRelay, maskSecrets, safeMediaPath, siteFetch } from "./siteEngine.js";

export { fireActuator } from "./actuatorExec.js";

type Env = { Variables: { user: AuthUser } };

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
  return c.json({
    agentOnline: agentOnline(scoped.site.lastSeenAt),
    engineOnline: engine.online,
    engineUrl: process.env.SITE_ENGINE_URL ?? "http://192.168.33.13:5051",
    lastSeenAt: scoped.site.lastSeenAt,
    eventsToday: Number(today?.n ?? 0),
    platesToday: Number(platesToday?.n ?? 0),
  });
});

hardware.get("/alpr/live", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const engine = await engineHealth();
  if (!engine.online) {
    return c.json({
      engineOnline: false,
      engineUrl: process.env.SITE_ENGINE_URL ?? "http://192.168.33.13:5051",
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
      engineUrl: process.env.SITE_ENGINE_URL ?? "http://192.168.33.13:5051",
      in: engine.in,
      out: engine.out,
      detections: detections.items,
      total: detections.total,
    });
  } catch (err) {
    return c.json(
      {
        engineOnline: true,
        engineUrl: process.env.SITE_ENGINE_URL ?? "http://192.168.33.13:5051",
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
      engineUrl: process.env.SITE_ENGINE_URL ?? "http://192.168.33.13:5051",
      in: ops.health.online ? ops.health.in : null,
      out: ops.health.online ? ops.health.out : null,
      stats: ops.stats,
      relay: ops.relay,
      events: ops.events,
    });
  } catch {
    return c.json({
      engineOnline: false,
      engineUrl: process.env.SITE_ENGINE_URL ?? "http://192.168.33.13:5051",
      in: null,
      out: null,
      stats: null,
      relay: null,
      events: [],
    });
  }
});

hardware.post("/alpr/relay/:action", async (c) => {
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
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    actuatorName?: string;
    kind?: string;
  }>();
  if (!body.name || !body.host || !body.username || !body.password) {
    return c.json({ error: "Faltan nombre, IP, usuario o clave" }, 400);
  }
  const now = new Date();
  const deviceId = nid();
  await db.insert(dahuaDevices).values({
    id: deviceId,
    siteId: scoped.site.id,
    name: body.name.trim(),
    host: body.host.trim(),
    port: body.port ?? 80,
    username: body.username.trim(),
    password: body.password,
    createdAt: now,
  });
  const actuatorId = nid();
  await db.insert(actuators).values({
    id: actuatorId,
    siteId: scoped.site.id,
    name: (body.actuatorName ?? body.name).trim(),
    kind: body.kind ?? "door",
    driver: "dahua",
    dahuaDeviceId: deviceId,
    dahuaChannel: 1,
    pulseMs: 1000,
    triggerDahua: true,
    triggerManual: true,
    createdAt: now,
  });
  await enqueue(scoped.site.id, "probe_dahua", { deviceId });
  return c.json({ ok: true, id: deviceId, actuatorId });
});

hardware.delete("/dahua/:id", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  await db.delete(actuators).where(eq(actuators.dahuaDeviceId, id));
  await db.delete(dahuaDevices).where(and(eq(dahuaDevices.id, id), eq(dahuaDevices.siteId, scoped.site.id)));
  return c.json({ ok: true });
});

hardware.post("/dahua/:id/probe", async (c) => {
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  if (!agentOnline(scoped.site.lastSeenAt)) {
    return c.json({ error: "El agent del sitio no está en línea. Arrancalo en la LAN." }, 503);
  }
  const cmd = await enqueue(scoped.site.id, "probe_dahua", { deviceId: c.req.param("id") });
  const done = await waitCommand(cmd);
  return c.json(done);
});

hardware.post("/actuators/:id/open", async (c) => {
  const scoped = await scopedSiteWithModule(c, "actuators");
  if ("error" in scoped) return scoped.error;
  return c.json(await fireActuator(scoped.site, c.req.param("id"), "open"));
});

hardware.post("/actuators/:id/close", async (c) => {
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
    if (res.ok) relay = (await res.json()) as typeof relay;
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
  const rows = type
    ? await db
        .select()
        .from(events)
        .where(and(eq(events.siteId, scoped.site.id), eq(events.type, type)))
        .orderBy(desc(events.createdAt))
        .limit(80)
    : await db
        .select()
        .from(events)
        .where(eq(events.siteId, scoped.site.id))
        .orderBy(desc(events.createdAt))
        .limit(80);
  return c.json({
    events: rows.map((e) => ({
      ...e,
      payload: JSON.parse(e.payload) as unknown,
    })),
  });
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
