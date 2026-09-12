import { and, eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { credentialDeviceSync, dahuaDevices } from "./db/schema.js";
import { enqueue, waitCommand } from "./actuatorExec.js";
import { nid } from "./scope.js";
import { dahuaDate, resolvePeriodIndex, type TimeWindow } from "./dahuaPeriod.js";

export type DeviceEnrollResult = {
  deviceId: string;
  name: string;
  sentido: string | null;
  ok: boolean;
  error?: string;
};

export function isEnrollableDeviceType(deviceType: string | null | undefined) {
  const t = String(deviceType || "");
  return t !== "camera_ip" && t !== "access_controller";
}

export async function enrollableDevices(siteId: string) {
  const devices = await db.select().from(dahuaDevices).where(eq(dahuaDevices.siteId, siteId));
  const targets = devices.filter((d) => isEnrollableDeviceType(d.deviceType));
  return targets.length ? targets : devices;
}

async function recordSync(siteId: string, dahuaUserId: string, row: DeviceEnrollResult) {
  const existing = await db
    .select()
    .from(credentialDeviceSync)
    .where(
      and(eq(credentialDeviceSync.dahuaUserId, dahuaUserId), eq(credentialDeviceSync.deviceId, row.deviceId)),
    )
    .get();
  const values = {
    siteId,
    dahuaUserId,
    deviceId: row.deviceId,
    status: row.ok ? "ok" : "error",
    lastError: row.ok ? null : row.error || "Error",
    lastSyncedAt: new Date(),
  };
  if (existing) {
    await db.update(credentialDeviceSync).set(values).where(eq(credentialDeviceSync.id, existing.id));
    return;
  }
  await db.insert(credentialDeviceSync).values({ id: nid(), ...values });
}

export async function syncStatusForUser(dahuaUserId: string) {
  return db.select().from(credentialDeviceSync).where(eq(credentialDeviceSync.dahuaUserId, dahuaUserId));
}

export function summarizeSync(rows: { sentido: string | null; status: string }[], devices: { id: string; sentido: string | null }[]) {
  const byDevice = new Map(rows.map((r) => [r.sentido, r.status]));
  void byDevice;
  const inOk = devices.some((d) => (d.sentido === "in" || d.sentido === "both") && rows.some((r) => r.status === "ok"));
  const outOk = devices.some((d) => (d.sentido === "out" || d.sentido === "both") && rows.some((r) => r.status === "ok"));
  const anyError = rows.some((r) => r.status === "error");
  return {
    allOk: rows.length > 0 && rows.every((r) => r.status === "ok"),
    inOk,
    outOk,
    pending: rows.length === 0,
    error: anyError,
  };
}

/** Encola enroll/sync en todos los ASI del sitio (el agent exige deviceId). */
export async function enrollPersonOnSiteDevices(
  siteId: string,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const list = await enrollableDevices(siteId);
  const ids: string[] = [];
  for (const d of list) {
    ids.push(await enqueue(siteId, "dahua_person_enroll", { ...payload, deviceId: d.id }));
  }
  return ids;
}

export async function enrollPersonOnSiteDevicesWait(
  siteId: string,
  payload: Record<string, unknown> & { userId: string },
  win?: TimeWindow,
): Promise<DeviceEnrollResult[]> {
  const list = await enrollableDevices(siteId);
  const results = await Promise.all(
    list.map(async (d) => {
      let periodIndex = typeof payload.periodIndex === "number" ? payload.periodIndex : 255;
      if (win) {
        try {
          periodIndex = await resolvePeriodIndex(siteId, d.id, win);
        } catch (err) {
          const error = err instanceof Error ? err.message : "No se pudo crear el periodo";
          const row: DeviceEnrollResult = { deviceId: d.id, name: d.name, sentido: d.sentido, ok: false, error };
          await recordSync(siteId, payload.userId, row);
          return row;
        }
      }
      const validDateStart = win ? dahuaDate(win.fechaDesde, "1970-01-01 00:00:00") : payload.validDateStart;
      const validDateEnd = win ? dahuaDate(win.fechaHasta, "2037-12-31 23:59:59") : payload.validDateEnd;
      const cmd = await enqueue(siteId, "dahua_person_enroll", {
        ...payload,
        deviceId: d.id,
        periodIndex,
        validDateStart,
        validDateEnd,
      });
      const done = await waitCommand(cmd, 50);
      const row: DeviceEnrollResult = {
        deviceId: d.id,
        name: d.name,
        sentido: d.sentido,
        ok: done.ok,
        error: done.ok ? undefined : done.error || "El lector no confirmó",
      };
      await recordSync(siteId, payload.userId, row);
      return row;
    }),
  );
  return results;
}

export async function deletePersonOnSiteDevices(
  siteId: string,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const list = await enrollableDevices(siteId);
  const ids: string[] = [];
  for (const d of list) {
    ids.push(await enqueue(siteId, "dahua_person_delete", { ...payload, deviceId: d.id }));
  }
  return ids;
}

export async function deletePersonOnSiteDevicesWait(siteId: string, payload: Record<string, unknown> & { userId?: string }) {
  const list = await enrollableDevices(siteId);
  const results = await Promise.all(
    list.map(async (d) => {
      const cmd = await enqueue(siteId, "dahua_person_delete", { ...payload, deviceId: d.id });
      const done = await waitCommand(cmd, 30);
      if (payload.userId) {
        await db
          .delete(credentialDeviceSync)
          .where(
            and(eq(credentialDeviceSync.dahuaUserId, String(payload.userId)), eq(credentialDeviceSync.deviceId, d.id)),
          );
      }
      return { deviceId: d.id, ok: done.ok, error: done.error };
    }),
  );
  return results;
}

export function enrollOk(results: DeviceEnrollResult[]) {
  return results.length > 0 && results.every((r) => r.ok);
}
