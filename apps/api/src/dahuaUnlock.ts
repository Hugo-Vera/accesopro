import { ASI_UNLOCK_METHOD_PACKS } from "@accesopro/catalog";
import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { dahuaDevices, sites } from "./db/schema.js";
import { tenantFeatureEnabled } from "./features.js";
import { enqueue, waitCommand } from "./actuatorExec.js";
import { isEnrollableDeviceType } from "./dahuaSite.js";

export async function syncAsiUnlockMethods(tenantId: string) {
  const site = await db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
  if (!site) return { ok: false, error: "Sitio no encontrado" };

  const methods = {
    face: await tenantFeatureEnabled(tenantId, "dahua.face"),
    fingerprint: await tenantFeatureEnabled(tenantId, "dahua.fingerprint"),
    card: await tenantFeatureEnabled(tenantId, "dahua.card"),
    password: await tenantFeatureEnabled(tenantId, "dahua.password"),
    qr: await tenantFeatureEnabled(tenantId, "dahua.qr"),
  };

  const devices = await db.select().from(dahuaDevices).where(eq(dahuaDevices.siteId, site.id));
  const targets = devices.filter((d) => isEnrollableDeviceType(d.deviceType));
  const results = [];
  for (const d of targets) {
    const cmd = await enqueue(site.id, "dahua_unlock_set", { deviceId: d.id, ...methods });
    const done = await waitCommand(cmd, 25);
    results.push({ deviceId: d.id, name: d.name, ok: done.ok, error: done.error });
  }
  return { ok: results.every((r) => r.ok), methods, results };
}

export function isUnlockMethodPack(key: string) {
  return (ASI_UNLOCK_METHOD_PACKS as readonly string[]).includes(key);
}
