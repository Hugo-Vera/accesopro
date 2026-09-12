import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import {
  dahuaDevices,
  ownerProfiles,
  properties,
  propertyFamilyMembers,
  propertyServices,
  sites,
  visitPasses,
} from "./db/schema.js";
import { enrollPersonOnSiteDevicesWait, enrollableDevices, isEnrollableDeviceType } from "./dahuaSite.js";
import { enqueue, waitCommand } from "./actuatorExec.js";
import { tenantFeatureEnabled } from "./features.js";

const PREFIXES = ["own_", "u_", "fam_", "svc_", "v_", "vis_"];

function managedId(userId: string) {
  return PREFIXES.some((p) => userId.startsWith(p));
}

async function expectedRoster(siteId: string) {
  const site = await db.select().from(sites).where(eq(sites.id, siteId)).get();
  if (!site) return [];
  const faceOn = await tenantFeatureEnabled(site.tenantId, "dahua.face");
  const qrOn = await tenantFeatureEnabled(site.tenantId, "dahua.qr");
  const siteProps = await db.select().from(properties).where(eq(properties.siteId, siteId));
  const propIds = new Set(siteProps.map((p) => p.id));
  const rows: {
    userId: string;
    name: string;
    cardNo: string;
    photoBase64?: string | null;
    win?: Parameters<typeof enrollPersonOnSiteDevicesWait>[2];
    userType?: number;
  }[] = [];

  const owners = await db.select().from(ownerProfiles);
  for (const o of owners.filter((x) => propIds.has(x.propertyId))) {
    const uid = o.dahuaUserId;
    if (!uid) continue;
    if (faceOn && o.photoBase64) {
      rows.push({ userId: uid, name: o.fullName || uid, cardNo: o.dni || uid, photoBase64: o.photoBase64 });
    }
  }
  const family = await db.select().from(propertyFamilyMembers).where(eq(propertyFamilyMembers.active, true));
  for (const f of family.filter((x) => propIds.has(x.propertyId))) {
    if (!f.dahuaUserId) continue;
    if (faceOn && f.photoBase64) {
      rows.push({
        userId: f.dahuaUserId,
        name: f.name,
        cardNo: f.dni || f.dahuaUserId,
        photoBase64: f.photoBase64,
        win: {
          horaDesde: f.horaDesde,
          horaHasta: f.horaHasta,
          diasSemana: f.diasSemana,
          fechaDesde: f.fechaDesde,
          fechaHasta: f.fechaHasta,
        },
      });
    }
  }
  const services = await db.select().from(propertyServices).where(eq(propertyServices.active, true));
  for (const s of services.filter((x) => propIds.has(x.propertyId))) {
    if (!s.dahuaUserId) continue;
    const photo = faceOn ? s.photoBase64 : null;
    const card = qrOn || faceOn ? s.dni || s.dahuaUserId : null;
    if (!photo && !card) continue;
    rows.push({
      userId: s.dahuaUserId,
      name: s.name,
      cardNo: s.dni || s.dahuaUserId,
      photoBase64: photo,
      win: {
        horaDesde: s.horaDesde,
        horaHasta: s.horaHasta,
        diasSemana: s.diasSemana,
        fechaDesde: s.fechaDesde,
        fechaHasta: s.fechaHasta,
      },
    });
  }
  if (qrOn) {
    const passes = await db.select().from(visitPasses).where(eq(visitPasses.status, "active"));
    for (const p of passes.filter((x) => x.siteId === siteId)) {
      const uid = `v_${p.id.slice(-8)}`;
      rows.push({
        userId: uid,
        name: p.guestName,
        cardNo: p.dahuaCardNo || p.token,
        userType: 1,
        win: { fechaDesde: p.validFrom, fechaHasta: p.validUntil, horaDesde: p.horaDesde, horaHasta: p.horaHasta },
      });
    }
  }
  return rows;
}

export async function reconcileSiteRoster(siteId: string) {
  const devices = (await enrollableDevices(siteId)).filter((d) => isEnrollableDeviceType(d.deviceType));
  const expected = await expectedRoster(siteId);
  const expectedIds = new Set(expected.map((e) => e.userId));
  const report: { deviceId: string; missing: string[]; extra: string[]; repaired: number }[] = [];

  for (const d of devices) {
    const cmd = await enqueue(siteId, "dahua_person_list", { deviceId: d.id, count: 500 });
    const done = await waitCommand(cmd, 35);
    const persons =
      done.ok && done.result && typeof done.result === "object" && "persons" in done.result
        ? ((done.result as { persons?: { userId?: string }[] }).persons ?? [])
        : [];
    const onDevice = new Set(persons.map((p) => String(p.userId || "").trim()).filter(Boolean));
    const missing = [...expectedIds].filter((id) => !onDevice.has(id));
    const extra = [...onDevice].filter((id) => managedId(id) && !expectedIds.has(id));
    let repaired = 0;
    for (const id of missing) {
      const row = expected.find((e) => e.userId === id);
      if (!row) continue;
      await enrollPersonOnSiteDevicesWait(
        siteId,
        {
          userId: row.userId,
          name: row.name,
          cardNo: row.cardNo,
          photoBase64: row.photoBase64 || undefined,
          userType: row.userType ?? 0,
        },
        row.win,
      );
      repaired += 1;
    }
    for (const id of extra) {
      const del = await enqueue(siteId, "dahua_person_delete", { deviceId: d.id, userId: id });
      await waitCommand(del, 20);
    }
    report.push({ deviceId: d.id, missing, extra, repaired });
  }
  return report;
}

export function startRosterReconcilePoller() {
  const ms = Number(process.env.ACCESOPRO_ROSTER_RECONCILE_MS ?? 10 * 60 * 1000);
  const tick = async () => {
    try {
      const allSites = await db.select().from(sites);
      for (const site of allSites) {
        const hasAsi = await db.select().from(dahuaDevices).where(eq(dahuaDevices.siteId, site.id)).get();
        if (!hasAsi) continue;
        await reconcileSiteRoster(site.id);
      }
    } catch (err) {
      console.error("roster reconcile:", err);
    }
  };
  setTimeout(tick, 45_000);
  setInterval(tick, ms);
}
