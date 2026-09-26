import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "./db/client.js";
import { actuators, cameras, commands, dahuaDevices, events, plates, sites } from "./db/schema.js";
import { nid, normalizePlate } from "./scope.js";
import { actuatorsForDahuaDevice, actuatorsForSentido, resolveDeviceLane } from "./accessPoints.js";
import { FAST_COMMAND_ACTIONS, enqueue, fireActuator, waitCommand, waitOpenCommand } from "./actuatorExec.js";
import { openContextPayload, openViaLabel, rememberOpen, takeOpen } from "./openContext.js";
import { matchesSentido, sentidoOf } from "./engineBridge.js";
import { broadcastRealtimeEvent } from "./eventStream.js";
import { copyEventPhoto, looksLikeJpeg, saveEventPhoto } from "./eventPhotos.js";
import { markVisitStayByCard } from "./visitPass.js";
import { findVisitPassByCard, holdVisitQr } from "./visitHold.js";
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

/**
 * lane=fast: solo aperturas (hilo propio del agent, no esperan detrás de un enrolamiento lento).
 * lane=slow: el resto. Sin lane (agent viejo): todo, aperturas primero.
 * Lo entregado pasa a `running` para que ningún hilo lo ejecute dos veces.
 */
agentRoutes.get("/commands", async (c) => {
  const siteId = c.get("siteId");
  const lane = c.req.query("lane");
  const byLane =
    lane === "fast"
      ? inArray(commands.action, FAST_COMMAND_ACTIONS)
      : lane === "slow"
        ? notInArray(commands.action, FAST_COMMAND_ACTIONS)
        : undefined;
  const pending = await db
    .select()
    .from(commands)
    .where(and(eq(commands.siteId, siteId), eq(commands.status, "pending"), byLane))
    .orderBy(asc(commands.createdAt));
  const claimed = pending.length
    ? await db
        .update(commands)
        .set({ status: "running" })
        .where(and(inArray(commands.id, pending.map((r) => r.id)), eq(commands.status, "pending")))
        .returning({ id: commands.id })
    : [];
  const ids = new Set(claimed.map((r) => r.id));
  const fast = new Set(FAST_COMMAND_ACTIONS);
  const rows = pending
    .filter((r) => ids.has(r.id))
    .sort((a, b) => Number(fast.has(b.action)) - Number(fast.has(a.action)));
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
  const eventId = nid();
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
    const visitPass = await findVisitPassByCard(siteId, qrString || card);
    const isVisitQr = Boolean(visitPass) || Boolean(matchedCred?.dahuaUserId?.startsWith("v_"));

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

    // QR en ASI-6214S: el lector pita, manda ErrorCode 96 y no abre. AccesoPro decide.
    // Visitas/proveedores: el QR solo identifica; abre el guardia. Propietarios: openDoor.
    if (isVisitQr && site) {
      const sentido = eventSentido || "in";
      const hold = await holdVisitQr({
        siteId,
        tenantId: site.tenantId,
        cardRaw: qrString || card,
        sentido,
        deviceId: deviceId || null,
        scanChannel: "totem",
        at: eventDate,
      });
      payload.accessKind = "visita";
      payload.visitHold = true;
      payload.visitPassId = hold.passId;
      payload.approvalId = hold.approvalId;
      payload.holdReason = hold.reason;
      payload.guestName = hold.guestName;
      payload.guestDni = hold.guestDni;
      payload.qrHint = hold.qrHint;
      payload.lotNumber = hold.lotNumber;
      payload.scanChannel = "totem";
      payload.scanChannelLabel = hold.scanChannelLabel;
      payload.sentido = hold.sentido || sentido;
      payload.laneCode = hold.sentido === "out" ? 2 : 1;
      payload.visitHoldEventId = hold.eventId;
      if (hold.guestName) payload.personName = hold.guestName;
      payload.approved = false;
      failed = true;
      if (hold.denied || hold.reason === "expired" || hold.reason === "too_early") {
        payload.denied = true;
        payload.expired = hold.reason !== "too_early";
        payload.holdReason = hold.reason;
        payload.validFrom = hold.validFrom;
        payload.validUntil = hold.validUntil;
        payload.horaDesde = hold.horaDesde;
        payload.horaHasta = hold.horaHasta;
      }
      eventSentido = hold.sentido || eventSentido;
      eventLaneCode = hold.sentido === "out" ? 2 : 1;
    } else if (
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
      const tooEarly = Boolean(from && now < from);
      const expired = Boolean(until && now > until);
      const inWindow = !tooEarly && !expired;
      const usesOk = !matchedCred.maxUses || matchedCred.usedCount < matchedCred.maxUses;
      const isAccessQr =
        matchedCred.kind === "qr" &&
        (matchedCred.dahuaUserId.startsWith("own_") || matchedCred.dahuaUserId.startsWith("fam_"));
      if (!inWindow && isAccessQr && site) {
        payload.denied = true;
        payload.expired = expired;
        payload.holdReason = tooEarly ? "too_early" : "expired";
        payload.validFrom = matchedCred.validFrom;
        payload.validUntil = matchedCred.validUntil;
        payload.accessKind = "access_qr";
        if (expired) {
          try {
            const { revokeAccessQr } = await import("./accessQr.js");
            await revokeAccessQr({
              siteId,
              dahuaUserId: matchedCred.dahuaUserId,
              deletePersonIfOrphan: true,
            });
          } catch {
            /* ignore */
          }
        }
      } else if (inWindow && usesOk && site) {
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
          const qrCtx = {
            reason: "access_qr" as const,
            eventId,
            personName: String(payload.personName ?? payload.CardName ?? "") || matchedCred.label || null,
          };
          if (targets.length) {
            for (const a of targets) {
              await fireActuator(site, a.id, "open", qrCtx);
              openActuatorId = a.id;
            }
          } else if (deviceId) {
            rememberOpen(site.id, deviceId, qrCtx);
            const cmd = await enqueue(site.id, "dahua_open", { deviceId, channel: 1 });
            await waitOpenCommand(cmd);
          }
        } catch {
          /* el evento se guarda igual */
        }
      }
    }

    // Evitamos bucle infinito: si ya es una apertura remota (Method 4), no disparamos actuadores.
    // Además, el terminal Dahua ya acciona su propio relé localmente al reconocer la cara;
    // solo se disparan actuadores vinculados distintos (barreras auxiliares u otros relés).
    if (!failed && !isRemoteUnlock && !payload.passthroughGranted && site && !isVisitQr) {
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

    if (!failed && !isRemoteUnlock && eventSentido && !isVisitQr) {
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

  // Method 4 = el pulso que pidió AccesoPro. Si ya hay tarjeta (QR de visita o Mi QR) se le pega la foto;
  // si no, la fila nueva lleva quién entra, a qué lote y qué guardia abrió desde dónde.
  if (isReaderAccess) {
    const method = String(payload.Method ?? payload.methodCode ?? payload.method ?? "");
    const isRemoteUnlock = method === "4" || method === "remote";
    const deviceId = String(payload.deviceId ?? "").trim();
    if (isRemoteUnlock && deviceId) {
      const ctx = takeOpen(siteId, deviceId);
      const ctxBound = Boolean(ctx && (ctx.eventId || ctx.passId || ctx.approvalId));
      const since = Date.now() - 20_000;
      const recent = await db
        .select()
        .from(events)
        .where(and(eq(events.siteId, siteId), inArray(events.type, ["dahua_access", "qr_access"])))
        .orderBy(desc(events.createdAt))
        .limit(40);
      for (const row of recent) {
        const created =
          row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt) || 0;
        if (created && created < since) continue;
        let prev: Record<string, unknown> = {};
        try {
          prev = JSON.parse(row.payload) as Record<string, unknown>;
        } catch {
          continue;
        }
        const sameDevice = String(prev.deviceId ?? "") === deviceId;
        const isVisit =
          prev.visitHold === true ||
          String(prev.accessKind ?? "") === "visita" ||
          Boolean(prev.visitPassId) ||
          Boolean(prev.approvalId);
        const ctxHit =
          ctx &&
          ((ctx.eventId && row.id === ctx.eventId) ||
            (ctx.passId && (String(prev.visitPassId ?? prev.passId ?? "") === ctx.passId)) ||
            (ctx.approvalId && String(prev.approvalId ?? "") === ctx.approvalId));
        if (ctxBound ? !ctxHit : ctx || !sameDevice || !isVisit) continue;
        const snap = String(payload.snapshotUrl ?? payload.URL ?? "").trim();
        if (snap && !String(prev.snapshotUrl ?? "").trim()) prev.snapshotUrl = snap;
        if (ctx) {
          prev.openedByName = prev.openedByName || ctx.openedByName || null;
          prev.openedVia = prev.openedVia || ctx.openedVia || null;
          prev.openedViaLabel = prev.openedViaLabel || openViaLabel(ctx.openedVia);
          prev.actuatorName = prev.actuatorName || ctx.actuatorName || null;
        }
        await db.update(events).set({ payload: JSON.stringify(prev) }).where(eq(events.id, row.id));
        broadcastRealtimeEvent({
          id: row.id,
          siteId,
          tenantId: site?.tenantId,
          type: row.type,
          payload: prev,
          createdAt: created || Date.now(),
        });
        return c.json({ ok: true, id: row.id, merged: true, openActuatorId: null });
      }
      // Mi QR: la tarjeta se inserta cuando vuelve la apertura, puede llegar después que este Method 4.
      if (ctx?.eventId) return c.json({ ok: true, id: ctx.eventId, merged: true, openActuatorId: null });
      if (ctx) Object.assign(payload, openContextPayload(ctx, eventDate.getTime()));
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
  const findRow = () =>
    db
      .select()
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.siteId, siteId)))
      .get();
  let row = await findRow();
  // La foto del pulso de Mi QR puede llegar antes de que se inserte su tarjeta.
  for (let i = 0; !row && i < 8; i++) {
    await new Promise((r) => setTimeout(r, 400));
    row = await findRow();
  }
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

  const holdId = String(payload.visitHoldEventId || "").trim();
  if (holdId) {
    copyEventPhoto(siteId, eventId, holdId);
    const holdRow = await db
      .select()
      .from(events)
      .where(and(eq(events.id, holdId), eq(events.siteId, siteId)))
      .get();
    if (holdRow) {
      let hp: Record<string, unknown> = {};
      try {
        hp = JSON.parse(holdRow.payload) as Record<string, unknown>;
      } catch {
        hp = {};
      }
      hp.photoStored = true;
      await db.update(events).set({ payload: JSON.stringify(hp) }).where(eq(events.id, holdId));
      const siteHold = await db.select().from(sites).where(eq(sites.id, siteId)).get();
      const holdCreated =
        holdRow.createdAt instanceof Date ? holdRow.createdAt.getTime() : Number(holdRow.createdAt) || Date.now();
      broadcastRealtimeEvent({
        id: holdId,
        siteId,
        tenantId: siteHold?.tenantId,
        type: "visit_hold",
        payload: hp,
        createdAt: holdCreated,
      });
    }
  }

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
