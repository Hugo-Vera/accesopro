import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "./db/client.js";
import { actuators, cameras, commands, dahuaDevices, events, plates, sites } from "./db/schema.js";
import { nid, normalizePlate } from "./scope.js";
import { actuatorsForDahuaDevice, actuatorsForSentido, resolveDeviceLane } from "./accessPoints.js";
import { enqueue, fireActuator, waitCommand } from "./actuatorExec.js";
import { matchesSentido, sentidoOf } from "./engineBridge.js";
import { broadcastRealtimeEvent } from "./eventStream.js";
import { looksLikeJpeg, saveEventPhoto } from "./eventPhotos.js";
import { markVisitStayByCard } from "./visitPass.js";
import { findCredentialByPayload, incrementCredentialUse } from "./credentials.js";
import { asiMethodKey } from "@accesopro/catalog";

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

/** Evita insertar el mismo RecNo del ASI dos veces (stream + poll / restart). */
const recentAccessKeys = new Set<string>();

function accessDedupeKey(payload: Record<string, unknown>): string | null {
  const deviceId = String(payload.deviceId ?? "").trim();
  const recNo = String(payload.recNo ?? payload.RecNo ?? "").trim();
  if (deviceId && recNo) return `${deviceId}:rec:${recNo}`;
  const stamp = String(payload.rawTime ?? payload.CreateTime ?? payload.RealUTC ?? "").trim();
  const qr = String(payload.qrPayload ?? payload.QRCode ?? payload.QRCodeEx ?? "").trim().toUpperCase();
  if (deviceId && qr && stamp) return `${deviceId}:qr:${qr}:${stamp}`;
  const uid = String(payload.userId ?? payload.UserID ?? payload.personName ?? "").trim();
  if (deviceId && stamp && uid) return `${deviceId}:t:${uid}:${stamp}`;
  return null;
}

function rememberAccessKey(key: string) {
  recentAccessKeys.add(key);
  if (recentAccessKeys.size > 800) {
    const drop = [...recentAccessKeys].slice(0, 400);
    for (const k of drop) recentAccessKeys.delete(k);
  }
}

agentRoutes.get("/sync-state", async (c) => {
  const siteId = c.get("siteId");
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.siteId, siteId), inArray(events.type, ["dahua_access", "qr_access"])))
    .orderBy(desc(events.createdAt))
    .limit(80);

  const devices: Record<string, { recNo: string; rawTime: string; createdAt: number }> = {};
  for (const row of rows) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    const deviceId = String(payload.deviceId ?? "").trim();
    if (!deviceId || devices[deviceId]) continue;
    const createdAt =
      row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt) || 0;
    devices[deviceId] = {
      recNo: String(payload.recNo ?? payload.RecNo ?? "").trim(),
      rawTime: String(payload.rawTime ?? payload.CreateTime ?? "").trim(),
      createdAt,
    };
  }
  return c.json({ devices });
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
  const eventDate = new Date();
  let eventSentido: "in" | "out" | null = null;
  let eventLaneCode: 1 | 2 | null = null;
  let eventAccessPointId: string | null = null;

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
      for (const a of acts.filter((x) => x.triggerAlpr && x.driver !== "engine")) {
        if (!openActuatorId) openActuatorId = a.id;
      }
    }
    if (row?.list === "black") {
      payload.blocked = true;
    }
  }

  const isReaderAccess = body.type === "dahua_access" || body.type === "qr_access";
  if (isReaderAccess) {
    const dedupeKey = accessDedupeKey(payload);
    if (dedupeKey && recentAccessKeys.has(dedupeKey)) {
      return c.json({ ok: true, duplicate: true, openActuatorId: null });
    }
    if (dedupeKey) {
      const recNo = String(payload.recNo ?? payload.RecNo ?? "").trim();
      const deviceIdHint = String(payload.deviceId ?? "").trim();
      if (recNo && deviceIdHint) {
        const recent = await db
          .select({ payload: events.payload })
          .from(events)
          .where(and(eq(events.siteId, siteId), inArray(events.type, ["dahua_access", "qr_access"])))
          .orderBy(desc(events.createdAt))
          .limit(40);
        for (const row of recent) {
          try {
            const prev = JSON.parse(row.payload) as Record<string, unknown>;
            if (
              String(prev.deviceId ?? "") === deviceIdHint &&
              String(prev.recNo ?? prev.RecNo ?? "") === recNo
            ) {
              rememberAccessKey(dedupeKey);
              return c.json({ ok: true, duplicate: true, openActuatorId: null });
            }
          } catch {
            /* ignore */
          }
        }
      }
    }

    const failedStatus = String(payload.Status ?? payload.status ?? "1") === "0";
    const method = String(payload.Method ?? payload.methodCode ?? payload.method ?? "");
    const isRemoteUnlock = method === "4" || method === "remote";
    const deviceId = String(payload.deviceId ?? "");
    const card = String(payload.cardNo ?? payload.CardNo ?? payload.qrPayload ?? payload.QRCode ?? payload.UserID ?? "")
      .trim()
      .toUpperCase();
    const errorCode = Number(payload.ErrorCode ?? payload.errorCode ?? 0);
    const qrString = String(payload.qrPayload ?? payload.QRCode ?? payload.QRCodeEx ?? "").trim();
    const qrDeniedByAsi = Boolean(qrString) && (failedStatus || errorCode === 96);
    const qrCred = card ? await findCredentialByPayload(siteId, card, "qr") : null;
    const cardCred = !qrCred && card ? await findCredentialByPayload(siteId, card, "card") : null;
    const matchedCred = qrCred ?? cardCred;
    let failed = failedStatus || errorCode === 96;

    if (matchedCred && matchedCred.status === "active") {
      payload.accessKind = payload.accessKind || (qrString || qrCred ? "qr" : "card");
      payload.credentialId = matchedCred.id;
      payload.method =
        asiMethodKey(payload.methodCode ?? payload.Method, qrString ? "qr" : "card") === "unknown"
          ? qrString
            ? "qr"
            : "card"
          : payload.method;
    }

    if (deviceId) {
      const lane = await resolveDeviceLane(deviceId);
      eventSentido = lane.sentido;
      eventLaneCode = lane.laneCode;
      eventAccessPointId = lane.accessPointId;
      payload.sentido = lane.sentido;
      payload.laneCode = lane.laneCode;
      payload.laneSector = lane.laneSector;
      if (lane.accessPointId) payload.accessPointId = lane.accessPointId;
    }

    // QR en ASI-6214S: el lector pita, manda ErrorCode 96 y no abre. AccesoPro decide y manda openDoor.
    if (
      failed &&
      matchedCred &&
      matchedCred.status === "active" &&
      (matchedCred.validationMode === "passthrough" || qrDeniedByAsi)
    ) {
      const now = Date.now();
      const until =
        matchedCred.validUntil instanceof Date ? matchedCred.validUntil.getTime() : Number(matchedCred.validUntil) || 0;
      const from =
        matchedCred.validFrom instanceof Date ? matchedCred.validFrom.getTime() : Number(matchedCred.validFrom) || 0;
      const inWindow = (!from || now >= from) && (!until || now <= until);
      const usesOk = !matchedCred.maxUses || matchedCred.usedCount < matchedCred.maxUses;
      if (inWindow && usesOk && site) {
        failed = false;
        payload.approved = true;
        payload.status = "1";
        payload.passthroughGranted = true;
        payload.asiErrorCode = errorCode || 96;
        try {
          await incrementCredentialUse(matchedCred.id);
          const sentido = eventSentido || "in";
          const wired = deviceId ? await actuatorsForDahuaDevice(siteId, deviceId) : [];
          const byLane = await actuatorsForSentido(siteId, sentido);
          const targets = wired.length ? wired : byLane.filter((x) => x.triggerQr);
          if (targets.length) {
            for (const a of targets) {
              await fireActuator(site, a.id, "open");
              openActuatorId = a.id;
            }
          } else if (deviceId) {
            const cmd = await enqueue(site.id, "dahua_open", { deviceId, channel: 1 });
            await waitCommand(cmd);
          }
        } catch {
          /* el evento se guarda igual */
        }
      }
    }

    // Evitamos bucle infinito: si ya es una apertura remota (Method 4), no disparamos actuadores.
    // Además, el terminal Dahua ya acciona su propio relé localmente al reconocer la cara;
    // solo se disparan actuadores vinculados distintos (barreras auxiliares u otros relés).
    if (!failed && !isRemoteUnlock && !payload.passthroughGranted && site) {
      try {
        const targets = await actuatorsForDahuaDevice(siteId, deviceId);
        for (const a of targets) {
          if (a.driver === "dahua" && a.dahuaDeviceId === deviceId) continue;
          await fireActuator(site, a.id, "open");
        }
      } catch {
        /* el evento se guarda igual */
      }
    }

    if (!failed && !isRemoteUnlock && eventSentido) {
      try {
        const stay = await markVisitStayByCard(siteId, card, eventSentido, eventDate);
        if (stay) {
          payload.accessKind = "visita";
          payload.visitPassId = stay.passId;
          if (stay.dwellMs != null) payload.dwellMs = stay.dwellMs;
        }
      } catch {
        /* propietarios / CardNo desconocido: no bloquear el historial */
      }
    }
  }

  // qr_access del portal / DNI (sin attach del ASI): no pasa por el bloque del lector.
  if ((body.type === "qr_access" && !payload.deviceId) || body.type === "dni_access") {
    const resultado = String(payload.resultado ?? "autorizado");
    const failed = resultado !== "autorizado" && resultado !== "manual";
    const sentido = sentidoOf(String(payload.sentido ?? "in"));
    eventSentido = sentido;
    eventLaneCode = sentido === "out" ? 2 : 1;
    payload.laneCode = eventLaneCode;
    if (!failed && site) {
      for (const a of acts.filter((x) => x.triggerQr && matchesSentido(x, sentido))) {
        await fireActuator(site, a.id, "open");
      }
    }
  }

  const eventId = nid();

  await db.insert(events).values({
    id: eventId,
    siteId,
    type: body.type,
    payload: JSON.stringify(payload),
    createdAt: eventDate,
    sentido: eventSentido,
    laneCode: eventLaneCode,
    accessPointId: eventAccessPointId,
  });

  if (body.type === "dahua_access" || body.type === "qr_access") {
    const k = accessDedupeKey(payload);
    if (k) rememberAccessKey(k);
  }

  // Emisión en tiempo real por SSE al frontend con 0ms de latencia
  broadcastRealtimeEvent({
    id: eventId,
    siteId,
    tenantId: site?.tenantId,
    type: body.type,
    payload,
    createdAt: eventDate.getTime(),
  });

  return c.json({ ok: true, id: eventId, openActuatorId });
});

/** JPEG del evento, copiado por el agent (una vez). El browser no pega al ASI. */
agentRoutes.post("/events/:id/photo", async (c) => {
  const siteId = c.get("siteId");
  const eventId = c.req.param("id");
  const row = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.siteId, siteId)))
    .get();
  if (!row) return c.json({ error: "Evento no encontrado" }, 404);

  const buf = Buffer.from(await c.req.arrayBuffer());
  if (!looksLikeJpeg(buf)) return c.json({ error: "JPEG inválido" }, 400);

  saveEventPhoto(siteId, eventId, buf);

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  payload.photoStored = true;
  await db.update(events).set({ payload: JSON.stringify(payload) }).where(eq(events.id, eventId));

  const site = await db.select().from(sites).where(eq(sites.id, siteId)).get();
  const createdAt =
    row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt) || Date.now();
  broadcastRealtimeEvent({
    id: eventId,
    siteId,
    tenantId: site?.tenantId,
    type: row.type,
    payload,
    createdAt,
  });
  return c.json({ ok: true });
});
