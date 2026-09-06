import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import {
  ACCESS_POINT_SECTORS,
  ACCESS_POINT_SENTIDOS,
  isAccessPointSector,
  isAccessPointSentido,
  type AccessActuatorWireRole,
  type AccessCameraWireRole,
  type AccessDeviceWireRole,
  type AccessPointSector,
  type AccessPointSentido,
} from "@accesopro/catalog";
import type { AuthUser } from "./auth.js";
import { db } from "./db/client.js";
import {
  accessPointActuators,
  accessPointCameras,
  accessPointDevices,
  accessPoints,
  actuators,
  cameras,
  dahuaDevices,
} from "./db/schema.js";
import { denyUnlessCapability } from "./grants.js";
import { nid, scopedSiteWithModule } from "./scope.js";

type Env = { Variables: { user: AuthUser } };

export const accessPointsApi = new Hono<Env>();

type WireActuatorIn = { actuatorId: string; role?: AccessActuatorWireRole; sortOrder?: number };
type WireDeviceIn = { dahuaDeviceId: string; role?: AccessDeviceWireRole };
type WireCameraIn = {
  cameraId: string;
  role?: AccessCameraWireRole;
  sentido?: AccessPointSentido | null;
};

function serializePoint(
  p: typeof accessPoints.$inferSelect,
  wires: {
    actuators: Array<{
      actuatorId: string;
      role: string;
      sortOrder: number;
      name?: string;
      kind?: string;
      driver?: string;
    }>;
    devices: Array<{ dahuaDeviceId: string; role: string; name?: string; deviceType?: string }>;
    cameras: Array<{
      cameraId: string;
      role: string;
      sentido: string | null;
      name?: string;
    }>;
  },
) {
  return {
    id: p.id,
    siteId: p.siteId,
    name: p.name,
    sector: p.sector,
    sentido: p.sentido,
    sortOrder: p.sortOrder,
    enabled: p.enabled,
    mapX: p.mapX,
    mapY: p.mapY,
    notes: p.notes,
    createdAt: p.createdAt instanceof Date ? p.createdAt.getTime() : p.createdAt,
    actuators: wires.actuators,
    devices: wires.devices,
    cameras: wires.cameras,
  };
}

async function loadWires(pointIds: string[]) {
  if (pointIds.length === 0) {
    return {
      actuators: [] as (typeof accessPointActuators.$inferSelect)[],
      devices: [] as (typeof accessPointDevices.$inferSelect)[],
      cameras: [] as (typeof accessPointCameras.$inferSelect)[],
    };
  }
  const [actWires, devWires, camWires] = await Promise.all([
    db.select().from(accessPointActuators),
    db.select().from(accessPointDevices),
    db.select().from(accessPointCameras),
  ]);
  const idSet = new Set(pointIds);
  return {
    actuators: actWires.filter((w) => idSet.has(w.accessPointId)),
    devices: devWires.filter((w) => idSet.has(w.accessPointId)),
    cameras: camWires.filter((w) => idSet.has(w.accessPointId)),
  };
}

accessPointsApi.get("/access-points/meta", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.relay");
  if (denied) return denied;
  return c.json({
    sectors: ACCESS_POINT_SECTORS,
    sentidos: ACCESS_POINT_SENTIDOS,
    actuatorRoles: [
      { key: "primary", name: "Principal" },
      { key: "aux", name: "Auxiliar" },
    ],
    deviceRoles: [
      { key: "validator", name: "Validador" },
      { key: "live", name: "Live / evidencia" },
      { key: "both", name: "Validador y live" },
    ],
    cameraRoles: [
      { key: "alpr", name: "ALPR" },
      { key: "evidence", name: "Evidencia" },
      { key: "live", name: "Live" },
    ],
  });
});

accessPointsApi.get("/access-points", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.relay");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "actuators");
  if ("error" in scoped) return scoped.error;

  const points = await db
    .select()
    .from(accessPoints)
    .where(eq(accessPoints.siteId, scoped.site.id))
    .orderBy(asc(accessPoints.sortOrder), asc(accessPoints.name));

  const wires = await loadWires(points.map((p) => p.id));
  const [acts, devices, cams] = await Promise.all([
    db.select().from(actuators).where(eq(actuators.siteId, scoped.site.id)),
    db.select().from(dahuaDevices).where(eq(dahuaDevices.siteId, scoped.site.id)),
    db.select().from(cameras).where(eq(cameras.siteId, scoped.site.id)),
  ]);
  const actById = new Map(acts.map((a) => [a.id, a]));
  const devById = new Map(devices.map((d) => [d.id, d]));
  const camById = new Map(cams.map((c) => [c.id, c]));

  return c.json({
    accessPoints: points.map((p) =>
      serializePoint(p, {
        actuators: wires.actuators
          .filter((w) => w.accessPointId === p.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((w) => {
            const a = actById.get(w.actuatorId);
            return {
              actuatorId: w.actuatorId,
              role: w.role,
              sortOrder: w.sortOrder,
              name: a?.name,
              kind: a?.kind,
              driver: a?.driver,
            };
          }),
        devices: wires.devices
          .filter((w) => w.accessPointId === p.id)
          .map((w) => {
            const d = devById.get(w.dahuaDeviceId);
            return {
              dahuaDeviceId: w.dahuaDeviceId,
              role: w.role,
              name: d?.name,
              deviceType: d?.deviceType,
            };
          }),
        cameras: wires.cameras
          .filter((w) => w.accessPointId === p.id)
          .map((w) => {
            const cam = camById.get(w.cameraId);
            return {
              cameraId: w.cameraId,
              role: w.role,
              sentido: w.sentido,
              name: cam?.name,
            };
          }),
      }),
    ),
  });
});

accessPointsApi.post("/access-points", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "actuators");
  if ("error" in scoped) return scoped.error;

  const body = await c.req.json<{
    name?: string;
    sector?: string;
    sentido?: string;
    sortOrder?: number;
    enabled?: boolean;
    mapX?: string | null;
    mapY?: string | null;
    notes?: string | null;
    wiring?: {
      actuators?: WireActuatorIn[];
      devices?: WireDeviceIn[];
      cameras?: WireCameraIn[];
    };
  }>();

  const name = body.name?.trim();
  if (!name) return c.json({ error: "Nombre obligatorio" }, 400);
  const sector: AccessPointSector = isAccessPointSector(String(body.sector || ""))
    ? (body.sector as AccessPointSector)
    : "peatonal";
  const sentido: AccessPointSentido = isAccessPointSentido(String(body.sentido || ""))
    ? (body.sentido as AccessPointSentido)
    : "both";

  const id = nid();
  await db.insert(accessPoints).values({
    id,
    siteId: scoped.site.id,
    name,
    sector,
    sentido,
    sortOrder: Number(body.sortOrder) || 0,
    enabled: body.enabled !== false,
    mapX: body.mapX ?? null,
    mapY: body.mapY ?? null,
    notes: body.notes ?? null,
    createdAt: new Date(),
  });

  if (body.wiring) {
    const err = await replaceWiring(scoped.site.id, id, body.wiring);
    if (err) return c.json({ error: err }, 400);
  }

  return c.json({ ok: true, id });
});

accessPointsApi.put("/access-points/:id", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "actuators");
  if ("error" in scoped) return scoped.error;

  const id = c.req.param("id");
  const row = await db
    .select()
    .from(accessPoints)
    .where(and(eq(accessPoints.id, id), eq(accessPoints.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Punto no encontrado" }, 404);

  const body = await c.req.json<{
    name?: string;
    sector?: string;
    sentido?: string;
    sortOrder?: number;
    enabled?: boolean;
    mapX?: string | null;
    mapY?: string | null;
    notes?: string | null;
  }>();

  const patch: Partial<typeof accessPoints.$inferInsert> = {};
  if (body.name?.trim()) patch.name = body.name.trim();
  if (body.sector !== undefined) {
    if (!isAccessPointSector(body.sector)) return c.json({ error: "Sector inválido" }, 400);
    patch.sector = body.sector;
  }
  if (body.sentido !== undefined) {
    if (!isAccessPointSentido(body.sentido)) return c.json({ error: "Sentido inválido" }, 400);
    patch.sentido = body.sentido;
  }
  if (body.sortOrder !== undefined) patch.sortOrder = Number(body.sortOrder) || 0;
  if (body.enabled !== undefined) patch.enabled = !!body.enabled;
  if (body.mapX !== undefined) patch.mapX = body.mapX;
  if (body.mapY !== undefined) patch.mapY = body.mapY;
  if (body.notes !== undefined) patch.notes = body.notes;

  if (Object.keys(patch).length) {
    await db.update(accessPoints).set(patch).where(eq(accessPoints.id, id));
  }
  return c.json({ ok: true });
});

accessPointsApi.put("/access-points/:id/wiring", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "actuators");
  if ("error" in scoped) return scoped.error;

  const id = c.req.param("id");
  const row = await db
    .select()
    .from(accessPoints)
    .where(and(eq(accessPoints.id, id), eq(accessPoints.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Punto no encontrado" }, 404);

  const body = await c.req.json<{
    actuators?: WireActuatorIn[];
    devices?: WireDeviceIn[];
    cameras?: WireCameraIn[];
  }>();

  const err = await replaceWiring(scoped.site.id, id, body);
  if (err) return c.json({ error: err }, 400);
  return c.json({ ok: true });
});

accessPointsApi.delete("/access-points/:id", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "actuators");
  if ("error" in scoped) return scoped.error;

  const id = c.req.param("id");
  const row = await db
    .select()
    .from(accessPoints)
    .where(and(eq(accessPoints.id, id), eq(accessPoints.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Punto no encontrado" }, 404);

  await db.delete(accessPointActuators).where(eq(accessPointActuators.accessPointId, id));
  await db.delete(accessPointDevices).where(eq(accessPointDevices.accessPointId, id));
  await db.delete(accessPointCameras).where(eq(accessPointCameras.accessPointId, id));
  await db.delete(accessPoints).where(eq(accessPoints.id, id));
  return c.json({ ok: true });
});

async function replaceWiring(
  siteId: string,
  pointId: string,
  wiring: {
    actuators?: WireActuatorIn[];
    devices?: WireDeviceIn[];
    cameras?: WireCameraIn[];
  },
): Promise<string | null> {
  if (wiring.actuators) {
    for (const w of wiring.actuators) {
      const a = await db
        .select()
        .from(actuators)
        .where(and(eq(actuators.id, w.actuatorId), eq(actuators.siteId, siteId)))
        .get();
      if (!a) return `Actuador no encontrado: ${w.actuatorId}`;
    }
  }
  if (wiring.devices) {
    for (const w of wiring.devices) {
      const d = await db
        .select()
        .from(dahuaDevices)
        .where(and(eq(dahuaDevices.id, w.dahuaDeviceId), eq(dahuaDevices.siteId, siteId)))
        .get();
      if (!d) return `Equipo Dahua no encontrado: ${w.dahuaDeviceId}`;
    }
  }
  if (wiring.cameras) {
    for (const w of wiring.cameras) {
      const cam = await db
        .select()
        .from(cameras)
        .where(and(eq(cameras.id, w.cameraId), eq(cameras.siteId, siteId)))
        .get();
      if (!cam) return `Cámara no encontrada: ${w.cameraId}`;
      if (w.sentido != null && w.sentido !== "in" && w.sentido !== "out" && w.sentido !== "both") {
        return "Sentido de cámara inválido";
      }
    }
  }

  if (wiring.actuators) {
    await db.delete(accessPointActuators).where(eq(accessPointActuators.accessPointId, pointId));
    for (const [i, w] of wiring.actuators.entries()) {
      await db.insert(accessPointActuators).values({
        accessPointId: pointId,
        actuatorId: w.actuatorId,
        role: w.role === "aux" ? "aux" : "primary",
        sortOrder: w.sortOrder ?? i,
      });
    }
  }
  if (wiring.devices) {
    await db.delete(accessPointDevices).where(eq(accessPointDevices.accessPointId, pointId));
    for (const w of wiring.devices) {
      const role =
        w.role === "validator" || w.role === "live" || w.role === "both" ? w.role : "both";
      await db.insert(accessPointDevices).values({
        accessPointId: pointId,
        dahuaDeviceId: w.dahuaDeviceId,
        role,
      });
    }
  }
  if (wiring.cameras) {
    await db.delete(accessPointCameras).where(eq(accessPointCameras.accessPointId, pointId));
    for (const w of wiring.cameras) {
      const role =
        w.role === "alpr" || w.role === "evidence" || w.role === "live" ? w.role : "live";
      await db.insert(accessPointCameras).values({
        accessPointId: pointId,
        cameraId: w.cameraId,
        role,
        sentido: w.sentido ?? null,
      });
    }
  }
  return null;
}

/** Resuelve actuadores a disparar por equipo Dahua (vía cableado; fallback legacy). */
export async function actuatorsForDahuaDevice(siteId: string, deviceId: string) {
  const wires = await db
    .select()
    .from(accessPointDevices)
    .where(eq(accessPointDevices.dahuaDeviceId, deviceId));

  const pointIds = wires
    .filter((w) => w.role === "validator" || w.role === "both")
    .map((w) => w.accessPointId);

  if (pointIds.length > 0) {
    const actWires = await db.select().from(accessPointActuators);
    const linkedIds = new Set(
      actWires.filter((w) => pointIds.includes(w.accessPointId)).map((w) => w.actuatorId),
    );
    const acts = await db.select().from(actuators).where(eq(actuators.siteId, siteId));
    return acts.filter((a) => linkedIds.has(a.id));
  }

  // Legacy: triggerDahua en actuadores del sitio (comportamiento anterior)
  const acts = await db.select().from(actuators).where(eq(actuators.siteId, siteId));
  return acts.filter((a) => a.triggerDahua);
}

/** Resuelve actuadores por cámara ALPR cableada. */
export async function actuatorsForCamera(siteId: string, cameraId: string) {
  const wires = await db
    .select()
    .from(accessPointCameras)
    .where(and(eq(accessPointCameras.cameraId, cameraId), eq(accessPointCameras.role, "alpr")));

  if (wires.length > 0) {
    const pointIds = wires.map((w) => w.accessPointId);
    const actWires = await db.select().from(accessPointActuators);
    const linkedIds = new Set(
      actWires.filter((w) => pointIds.includes(w.accessPointId)).map((w) => w.actuatorId),
    );
    const acts = await db.select().from(actuators).where(eq(actuators.siteId, siteId));
    return acts.filter((a) => linkedIds.has(a.id));
  }

  const cam = await db.select().from(cameras).where(eq(cameras.id, cameraId)).get();
  if (cam?.actuatorId) {
    const a = await db.select().from(actuators).where(eq(actuators.id, cam.actuatorId)).get();
    return a ? [a] : [];
  }
  return [];
}
