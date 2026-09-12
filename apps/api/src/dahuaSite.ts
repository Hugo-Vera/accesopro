import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { dahuaDevices } from "./db/schema.js";
import { enqueue } from "./actuatorExec.js";

export function isEnrollableDeviceType(deviceType: string | null | undefined) {
  const t = String(deviceType || "");
  return t !== "camera_ip" && t !== "access_controller";
}

/** Encola enroll/sync en todos los ASI del sitio (el agent exige deviceId). */
export async function enrollPersonOnSiteDevices(
  siteId: string,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const devices = await db.select().from(dahuaDevices).where(eq(dahuaDevices.siteId, siteId));
  const targets = devices.filter((d) => isEnrollableDeviceType(d.deviceType));
  const list = targets.length ? targets : devices;
  const ids: string[] = [];
  for (const d of list) {
    ids.push(await enqueue(siteId, "dahua_person_enroll", { ...payload, deviceId: d.id }));
  }
  return ids;
}

export async function deletePersonOnSiteDevices(
  siteId: string,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const devices = await db.select().from(dahuaDevices).where(eq(dahuaDevices.siteId, siteId));
  const targets = devices.filter((d) => isEnrollableDeviceType(d.deviceType));
  const list = targets.length ? targets : devices;
  const ids: string[] = [];
  for (const d of list) {
    ids.push(await enqueue(siteId, "dahua_person_delete", { ...payload, deviceId: d.id }));
  }
  return ids;
}
