import { existsSync, unlinkSync } from "node:fs";
import { and, eq, inArray, lt } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "./db/client.js";
import {
  events,
  sites,
  tenantSettings,
  visitCompanions,
  visitPasses,
  visitRecords,
  visitorIdentities,
} from "./db/schema.js";
import type { AuthUser } from "./auth.js";
import { denyUnlessCapability } from "./grants.js";
import { nid } from "./scope.js";
import { expireOwnerNotices } from "./ownerNotices.js";
import { expireTimedCredentialsAndPasses } from "./accessQr.js";

type Env = { Variables: { user: AuthUser } };

export const retentionApi = new Hono<Env>();

const CLOSED = ["completed", "denied", "revoked", "expired"] as const;

export const VISIT_AUTH_HOURS = [4, 8, 12, 24, 48, 72] as const;

export function normalizeVisitAuthHours(n: number): number {
  return (VISIT_AUTH_HOURS as readonly number[]).includes(n) ? n : 24;
}

export async function getRetentionDays(tenantId: string): Promise<number> {
  const row = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)).get();
  return row?.retentionDays ?? 90;
}

export async function getVisitAuthDefaultHours(tenantId: string): Promise<number> {
  const row = await db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)).get();
  return normalizeVisitAuthHours(row?.visitAuthDefaultHours ?? 24);
}

export function resolveVisitPassWindow(input: {
  now?: Date;
  defaultHours: number;
  validFrom?: string;
  validUntil?: string;
  useDefaultHours?: boolean;
  twentyFourHours?: boolean;
}): { validFrom: Date; validUntil: Date } {
  const now = input.now ?? new Date();
  const hours = normalizeVisitAuthHours(input.defaultHours);
  const hasFrom = Boolean(input.validFrom?.trim());
  const hasUntil = Boolean(input.validUntil?.trim());
  const useDefault =
    input.useDefaultHours === true || input.twentyFourHours === true || (!hasFrom && !hasUntil);

  const parse = (raw: string | undefined, fallback: Date) => {
    if (!raw?.trim()) return fallback;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) throw new Error("Fecha inválida");
    return d;
  };

  if (useDefault) {
    return { validFrom: now, validUntil: new Date(now.getTime() + hours * 60 * 60 * 1000) };
  }
  const validFrom = parse(input.validFrom, now);
  const validUntil = parse(input.validUntil, new Date(validFrom.getTime() + hours * 60 * 60 * 1000));
  return { validFrom, validUntil };
}

export async function setRetentionDays(tenantId: string, days: number) {
  const n = [30, 60, 90, 180, 0].includes(days) ? days : 90;
  const now = new Date();
  const hours = await getVisitAuthDefaultHours(tenantId);
  await db
    .insert(tenantSettings)
    .values({ tenantId, retentionDays: n, visitAuthDefaultHours: hours, updatedAt: now })
    .onConflictDoUpdate({
      target: tenantSettings.tenantId,
      set: { retentionDays: n, updatedAt: now },
    });
  return n;
}

export async function setVisitAuthDefaultHours(tenantId: string, hours: number) {
  const n = normalizeVisitAuthHours(hours);
  const now = new Date();
  const days = await getRetentionDays(tenantId);
  await db
    .insert(tenantSettings)
    .values({ tenantId, retentionDays: days, visitAuthDefaultHours: n, updatedAt: now })
    .onConflictDoUpdate({
      target: tenantSettings.tenantId,
      set: { visitAuthDefaultHours: n, updatedAt: now },
    });
  return n;
}

function anonymizeName(name: string) {
  const t = name.trim();
  if (!t) return "Visita";
  return `${t.slice(0, 1)}.`;
}

export async function purgeTenantRetention(tenantId: string): Promise<{ passes: number; events: number }> {
  const days = await getRetentionDays(tenantId);
  if (days <= 0) return { passes: 0, events: 0 };
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const site = await db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
  if (!site) return { passes: 0, events: 0 };

  const oldPasses = await db
    .select()
    .from(visitPasses)
    .where(and(eq(visitPasses.siteId, site.id), inArray(visitPasses.status, [...CLOSED]), lt(visitPasses.createdAt, cutoff)));

  let passes = 0;
  for (const pass of oldPasses) {
    await db
      .update(visitPasses)
      .set({
        guestName: anonymizeName(pass.guestName),
        guestDni: pass.guestDni ? "ANON" : null,
        patente: pass.patente ? "ANON" : null,
        notes: null,
      })
      .where(eq(visitPasses.id, pass.id));
    const comps = await db.select().from(visitCompanions).where(eq(visitCompanions.passId, pass.id));
    for (const c of comps) {
      await db
        .update(visitCompanions)
        .set({ name: anonymizeName(c.name), dni: c.dni ? "ANON" : null, birthDate: null })
        .where(eq(visitCompanions.id, c.id));
    }
    if (pass.visitRecordId) {
      await db
        .update(visitRecords)
        .set({ notes: null, status: pass.status === "completed" ? "completed" : pass.status })
        .where(eq(visitRecords.id, pass.visitRecordId));
    }
    passes += 1;
  }

  const oldEvents = await db
    .select()
    .from(events)
    .where(and(eq(events.siteId, site.id), lt(events.createdAt, cutoff)));
  let eventCount = 0;
  for (const ev of oldEvents) {
    if (ev.type === "panic_sos" || ev.type === "fire_contact") continue;
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(ev.payload || "{}") as Record<string, unknown>;
    } catch {
      payload = {};
    }
    if (typeof payload.guestDni === "string") payload.guestDni = "ANON";
    if (typeof payload.dni === "string") payload.dni = "ANON";
    if (typeof payload.guestName === "string") payload.guestName = anonymizeName(String(payload.guestName));
    if (typeof payload.personName === "string") payload.personName = anonymizeName(String(payload.personName));
    if (typeof payload.photoPath === "string" && existsSync(payload.photoPath)) {
      try {
        unlinkSync(payload.photoPath);
      } catch {
        /* ignore */
      }
      delete payload.photoPath;
    }
    await db.update(events).set({ payload: JSON.stringify(payload) }).where(eq(events.id, ev.id));
    eventCount += 1;
  }

  const identities = await db.select().from(visitorIdentities).where(eq(visitorIdentities.tenantId, tenantId));
  for (const person of identities) {
    if (person.updatedAt instanceof Date ? person.updatedAt.getTime() > cutoff.getTime() : Number(person.updatedAt) > cutoff.getTime()) {
      continue;
    }
    const linked = await db.select().from(visitRecords).where(eq(visitRecords.personId, person.id)).get();
    if (linked) continue;
    await db
      .update(visitorIdentities)
      .set({
        firstName: anonymizeName(person.firstName),
        lastName: anonymizeName(person.lastName),
        dniNumber: person.dniNumber ? "ANON" : person.dniNumber,
        rawPdf417: null,
        address: null,
        phone: null,
      })
      .where(eq(visitorIdentities.id, person.id));
  }

  return { passes, events: eventCount };
}

let started = false;
export function startRetentionPoller() {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      await expireOwnerNotices();
      await expireTimedCredentialsAndPasses();
      const sitesRows = await db.select().from(sites);
      for (const site of sitesRows) {
        await purgeTenantRetention(site.tenantId);
      }
    } catch (err) {
      console.error("retention", err);
    }
  };
  setTimeout(() => void tick(), 20_000);
  setInterval(() => void tick(), 6 * 60 * 60 * 1000);
}

retentionApi.get("/tenants/:id/retention", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const user = c.get("user");
  const tenantId = c.req.param("id");
  if (user.role !== "platform_admin" && user.tenantId !== tenantId) {
    return c.json({ error: "Sin acceso a este barrio" }, 403);
  }
  const days = await getRetentionDays(tenantId);
  return c.json({ tenantId, retentionDays: days });
});

retentionApi.put("/tenants/:id/retention", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const user = c.get("user");
  const tenantId = c.req.param("id");
  if (user.role !== "platform_admin" && user.tenantId !== tenantId) {
    return c.json({ error: "Sin acceso a este barrio" }, 403);
  }
  const body = await c.req.json<{ retentionDays?: number }>();
  const days = await setRetentionDays(tenantId, Number(body.retentionDays));
  return c.json({ ok: true, tenantId, retentionDays: days, id: nid() });
});

function assertSameTenant(user: AuthUser, tenantId: string) {
  if (user.role !== "platform_admin" && user.tenantId !== tenantId) {
    return false;
  }
  return true;
}

retentionApi.get("/tenants/:id/visit-auth-policy", async (c) => {
  const user = c.get("user");
  const tenantId = c.req.param("id");
  if (!assertSameTenant(user, tenantId)) return c.json({ error: "Sin acceso a este barrio" }, 403);
  const defaultHours = await getVisitAuthDefaultHours(tenantId);
  return c.json({ tenantId, defaultHours, allowedHours: VISIT_AUTH_HOURS });
});

retentionApi.put("/tenants/:id/visit-auth-policy", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const user = c.get("user");
  const tenantId = c.req.param("id");
  if (!assertSameTenant(user, tenantId)) return c.json({ error: "Sin acceso a este barrio" }, 403);
  const body = await c.req.json<{ defaultHours?: number }>();
  const defaultHours = await setVisitAuthDefaultHours(tenantId, Number(body.defaultHours));
  return c.json({ ok: true, tenantId, defaultHours, id: nid() });
});
