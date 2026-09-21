import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { client, dataDir, db } from "./db/client.js";
import {
  events,
  hubSites,
  ownerNotices,
  properties,
  sites,
  tenants,
} from "./db/schema.js";
import { eventPhotoPath, listEventPhotoIds, looksLikeJpeg, readEventPhoto, saveEventPhoto } from "./eventPhotos.js";
import { getRetentionDays } from "./retention.js";
import { fanoutLotNotice } from "./pushNotify.js";
import { broadcastRealtimeEvent } from "./eventStream.js";
import { nid } from "./scope.js";

export const hubSyncApi = new Hono();

const DUMP_ORDER = [
  "tenants",
  "sites",
  "users",
  "user_grants",
  "tenant_modules",
  "tenant_subscriptions",
  "tenant_features",
  "tenant_settings",
  "properties",
  "owner_profiles",
  "property_family_members",
  "property_services",
  "dahua_devices",
  "actuators",
  "cameras",
  "access_points",
  "access_point_actuators",
  "access_point_devices",
  "access_point_cameras",
  "plates",
  "person_credentials",
  "credential_device_sync",
  "dahua_period_slots",
  "departments",
  "visitor_identities",
  "vehicles",
  "vehicle_insurances",
  "person_insurances",
  "driver_licenses",
  "visit_authorizations",
  "visit_records",
  "visit_passes",
  "visit_companions",
  "guard_approvals",
  "owner_notices",
  "events",
] as const;

const COMPOSITE_PK: Record<string, string[]> = {
  user_grants: ["user_id", "capability_key"],
  tenant_modules: ["tenant_id", "module_key"],
  tenant_features: ["tenant_id", "feature_key"],
  tenant_subscriptions: ["tenant_id"],
  tenant_settings: ["tenant_id"],
  access_point_actuators: ["access_point_id", "actuator_id"],
  access_point_devices: ["access_point_id", "device_id"],
  access_point_cameras: ["access_point_id", "camera_id"],
  plates: ["site_id", "plate"],
};

const RETAINED = new Set(["events", "visit_passes", "visit_companions", "visit_records", "guard_approvals", "owner_notices"]);

export type ReplicaDump = {
  rev: number;
  tenantId: string;
  tables: Record<string, Record<string, unknown>[]>;
  photos: { siteId: string; eventId: string }[];
};

function hubHeader(c: { req: { header: (n: string) => string | undefined } }) {
  return (c.req.header("x-accesopro-hub-token") || c.req.header("authorization")?.replace(/^Bearer\s+/i, "") || "").trim();
}

export async function resolveHubRowByToken(token: string) {
  if (!token) return null;
  const row = await db.select().from(hubSites).where(eq(hubSites.hubToken, token)).get();
  if (row) return row;
  const site = await db.select().from(sites).where(eq(sites.hubToken, token)).get();
  if (!site) return null;
  const byReplica = await db.select().from(hubSites).where(eq(hubSites.replicaTenantId, site.tenantId)).get();
  return byReplica ?? null;
}

async function tokenOk(token: string) {
  if (!token) return false;
  const envTok = (process.env.ACCESOPRO_HUB_TOKEN ?? "").trim();
  if (envTok && envTok === token) return true;
  return Boolean(await resolveHubRowByToken(token));
}

async function replicaTenantIdForToken(token: string): Promise<string | null> {
  const row = await resolveHubRowByToken(token);
  if (row?.replicaTenantId) return row.replicaTenantId;
  const envTok = (process.env.ACCESOPRO_HUB_TOKEN ?? "").trim();
  if (envTok && envTok === token) {
    const site = await db.select().from(sites).where(eq(sites.hubToken, token)).get();
    return site?.tenantId ?? null;
  }
  const site = await db.select().from(sites).where(eq(sites.hubToken, token)).get();
  return site?.tenantId ?? null;
}

const pragmaCache = new Map<string, string[]>();

async function tableColumns(table: string): Promise<string[]> {
  const hit = pragmaCache.get(table);
  if (hit) return hit;
  const r = await client.execute(`PRAGMA table_info(${table})`);
  const cols = r.rows.map((row) => String((row as unknown as { name: string }).name));
  pragmaCache.set(table, cols);
  return cols;
}

function asMs(v: unknown): number {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function rowTime(row: Record<string, unknown>) {
  return Math.max(asMs(row.updated_at), asMs(row.decided_at), asMs(row.last_synced_at), asMs(row.created_at));
}

function pkOf(table: string, row: Record<string, unknown>): { cols: string[]; vals: unknown[] } {
  const cols = COMPOSITE_PK[table] ?? ["id"];
  return { cols, vals: cols.map((c) => row[c]) };
}

async function selectSql(sqlText: string, args: unknown[] = []) {
  const r = await client.execute({ sql: sqlText, args: args as never[] });
  return r.rows.map((row) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) o[k] = v;
    return o;
  });
}

export async function dumpTenant(tenantId: string, sinceMs = 0): Promise<ReplicaDump> {
  const tenant = await db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  if (!tenant) return { rev: Date.now(), tenantId, tables: {}, photos: [] };
  const days = await getRetentionDays(tenantId);
  const cutoff = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
  const siteRows = await db.select().from(sites).where(eq(sites.tenantId, tenantId));
  const siteIds = siteRows.map((s) => s.id);
  const propRows = await db.select({ id: properties.id }).from(properties).where(eq(properties.tenantId, tenantId));
  const propIds = propRows.map((p) => p.id);

  const inList = (ids: string[]) => ids.map(() => "?").join(",") || "''";

  const tables: Record<string, Record<string, unknown>[]> = {};
  tables.tenants = await selectSql("SELECT * FROM tenants WHERE id = ?", [tenantId]);
  tables.sites = await selectSql("SELECT * FROM sites WHERE tenant_id = ?", [tenantId]);
  tables.users = await selectSql("SELECT * FROM users WHERE tenant_id = ? AND role != 'platform_admin'", [tenantId]);
  const userIds = tables.users.map((u) => String(u.id));
  tables.user_grants = userIds.length
    ? await selectSql(`SELECT * FROM user_grants WHERE user_id IN (${inList(userIds)})`, userIds)
    : [];
  tables.tenant_modules = await selectSql("SELECT * FROM tenant_modules WHERE tenant_id = ?", [tenantId]);
  tables.tenant_subscriptions = await selectSql("SELECT * FROM tenant_subscriptions WHERE tenant_id = ?", [tenantId]);
  tables.tenant_features = await selectSql("SELECT * FROM tenant_features WHERE tenant_id = ?", [tenantId]);
  tables.tenant_settings = await selectSql("SELECT * FROM tenant_settings WHERE tenant_id = ?", [tenantId]);
  tables.properties = await selectSql("SELECT * FROM properties WHERE tenant_id = ?", [tenantId]);
  tables.owner_profiles = propIds.length
    ? await selectSql(`SELECT * FROM owner_profiles WHERE property_id IN (${inList(propIds)})`, propIds)
    : [];
  tables.property_family_members = propIds.length
    ? await selectSql(`SELECT * FROM property_family_members WHERE property_id IN (${inList(propIds)})`, propIds)
    : [];
  tables.property_services = propIds.length
    ? await selectSql(`SELECT * FROM property_services WHERE property_id IN (${inList(propIds)})`, propIds)
    : [];

  if (siteIds.length) {
    const sIn = inList(siteIds);
    tables.dahua_devices = await selectSql(`SELECT * FROM dahua_devices WHERE site_id IN (${sIn})`, siteIds);
    tables.actuators = await selectSql(`SELECT * FROM actuators WHERE site_id IN (${sIn})`, siteIds);
    tables.cameras = await selectSql(`SELECT * FROM cameras WHERE site_id IN (${sIn})`, siteIds);
    tables.access_points = await selectSql(`SELECT * FROM access_points WHERE site_id IN (${sIn})`, siteIds);
    const apIds = (tables.access_points || []).map((r) => String(r.id));
    tables.access_point_actuators = apIds.length
      ? await selectSql(`SELECT * FROM access_point_actuators WHERE access_point_id IN (${inList(apIds)})`, apIds)
      : [];
    tables.access_point_devices = apIds.length
      ? await selectSql(`SELECT * FROM access_point_devices WHERE access_point_id IN (${inList(apIds)})`, apIds)
      : [];
    tables.access_point_cameras = apIds.length
      ? await selectSql(`SELECT * FROM access_point_cameras WHERE access_point_id IN (${inList(apIds)})`, apIds)
      : [];
    tables.plates = await selectSql(`SELECT * FROM plates WHERE site_id IN (${sIn})`, siteIds);
    tables.person_credentials = await selectSql(`SELECT * FROM person_credentials WHERE site_id IN (${sIn})`, siteIds);
    tables.credential_device_sync = await selectSql(`SELECT * FROM credential_device_sync WHERE site_id IN (${sIn})`, siteIds);
    tables.dahua_period_slots = await selectSql(`SELECT * FROM dahua_period_slots WHERE site_id IN (${sIn})`, siteIds);
    tables.departments = await selectSql(`SELECT * FROM departments WHERE site_id IN (${sIn})`, siteIds);
    tables.visitor_identities = await selectSql(`SELECT * FROM visitor_identities WHERE site_id IN (${sIn})`, siteIds);
    tables.vehicles = await selectSql(`SELECT * FROM vehicles WHERE site_id IN (${sIn})`, siteIds);
    const vehIds = (tables.vehicles || []).map((r) => String(r.id));
    tables.vehicle_insurances = vehIds.length
      ? await selectSql(`SELECT * FROM vehicle_insurances WHERE vehicle_id IN (${inList(vehIds)})`, vehIds)
      : [];
    tables.person_insurances = await selectSql(`SELECT * FROM person_insurances WHERE site_id IN (${sIn})`, siteIds);
    tables.driver_licenses = await selectSql(`SELECT * FROM driver_licenses WHERE site_id IN (${sIn})`, siteIds);
    tables.visit_authorizations = await selectSql(`SELECT * FROM visit_authorizations WHERE site_id IN (${sIn})`, siteIds);
    tables.visit_records = await selectSql(`SELECT * FROM visit_records WHERE site_id IN (${sIn})`, siteIds);
    tables.visit_passes = await selectSql(`SELECT * FROM visit_passes WHERE site_id IN (${sIn})`, siteIds);
    const passIds = (tables.visit_passes || []).map((r) => String(r.id));
    tables.visit_companions = passIds.length
      ? await selectSql(`SELECT * FROM visit_companions WHERE pass_id IN (${inList(passIds)})`, passIds)
      : [];
    tables.guard_approvals = await selectSql(`SELECT * FROM guard_approvals WHERE site_id IN (${sIn})`, siteIds);
    tables.owner_notices = await selectSql(`SELECT * FROM owner_notices WHERE site_id IN (${sIn})`, siteIds);
    tables.events = await selectSql(`SELECT * FROM events WHERE site_id IN (${sIn})`, siteIds);
  }

  const since = Math.max(sinceMs, cutoff);
  if (since > 0) {
    for (const [name, rows] of Object.entries(tables)) {
      if (name === "tenants" || name === "sites") continue;
      tables[name] = rows.filter((r) => rowTime(r) >= since || !RETAINED.has(name));
      if (RETAINED.has(name) && cutoff > 0) {
        tables[name] = tables[name].filter((r) => rowTime(r) >= cutoff || name === "owner_notices");
      }
    }
  } else if (cutoff > 0) {
    for (const name of RETAINED) {
      if (name === "owner_notices") continue;
      tables[name] = (tables[name] || []).filter((r) => rowTime(r) >= cutoff);
    }
  }

  const photos: { siteId: string; eventId: string }[] = [];
  for (const siteId of siteIds) {
    for (const eventId of listEventPhotoIds(siteId)) {
      if (cutoff > 0) {
        const ev = await db.select({ createdAt: events.createdAt }).from(events).where(eq(events.id, eventId)).get();
        const t = ev?.createdAt instanceof Date ? ev.createdAt.getTime() : Number(ev?.createdAt || 0);
        if (t && t < cutoff) continue;
      }
      photos.push({ siteId, eventId });
    }
  }
  return { rev: Date.now(), tenantId, tables, photos };
}

async function existingRow(table: string, row: Record<string, unknown>) {
  const pk = pkOf(table, row);
  if (pk.vals.some((v) => v == null || v === "")) return null;
  const where = pk.cols.map((c) => `${c} = ?`).join(" AND ");
  const found = await selectSql(`SELECT * FROM ${table} WHERE ${where} LIMIT 1`, pk.vals);
  return found[0] ?? null;
}

async function upsertRow(table: string, row: Record<string, unknown>) {
  const cols = await tableColumns(table);
  const filtered: Record<string, unknown> = {};
  for (const c of cols) {
    if (row[c] !== undefined) filtered[c] = row[c];
  }
  const keys = Object.keys(filtered);
  if (!keys.length) return { applied: false };
  const existing = await existingRow(table, filtered);
  if (existing && rowTime(existing) > rowTime(filtered)) return { applied: false, skipped: true };
  const placeholders = keys.map(() => "?").join(",");
  const assignments = keys.map((k) => `${k} = excluded.${k}`).join(",");
  const pk = pkOf(table, filtered);
  const conflict = pk.cols.join(", ");
  await client.execute({
    sql: `INSERT INTO ${table} (${keys.join(",")}) VALUES (${placeholders}) ON CONFLICT(${conflict}) DO UPDATE SET ${assignments}`,
    args: keys.map((k) => filtered[k]) as never[],
  });
  return { applied: true };
}

export async function applyDump(dump: ReplicaDump) {
  let applied = 0;
  let skipped = 0;
  for (const table of DUMP_ORDER) {
    const rows = dump.tables[table] || [];
    for (const row of rows) {
      try {
        const r = await upsertRow(table, row);
        if (r.applied) applied += 1;
        else skipped += 1;
      } catch {
        skipped += 1;
      }
    }
  }
  return { applied, skipped };
}

async function markHubSync(token: string, patch: Record<string, unknown>) {
  const row = await resolveHubRowByToken(token);
  if (!row) return;
  const prev = (() => {
    try {
      return row.lastSyncJson ? (JSON.parse(row.lastSyncJson) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  })();
  const next = { ...prev, ...patch, at: Date.now() };
  await db
    .update(hubSites)
    .set({ lastSyncAt: new Date(), lastSyncJson: JSON.stringify(next) })
    .where(eq(hubSites.id, row.id));
}

hubSyncApi.post("/sync/push", async (c) => {
  const token = hubHeader(c);
  if (!(await tokenOk(token))) return c.json({ error: "Token de hub inválido" }, 401);
  const tenantId = await replicaTenantIdForToken(token);
  if (!tenantId) return c.json({ error: "No hay tenant sombra para este token" }, 409);
  const body = (await c.req.json()) as ReplicaDump;
  body.tenantId = tenantId;
  const result = await applyDump(body);
  await markHubSync(token, { lastPushAt: Date.now(), applied: result.applied });
  return c.json({ ok: true, ...result });
});

hubSyncApi.get("/sync/pull", async (c) => {
  const token = hubHeader(c);
  if (!(await tokenOk(token))) return c.json({ error: "Token de hub inválido" }, 401);
  const tenantId = await replicaTenantIdForToken(token);
  if (!tenantId) return c.json({ error: "No hay tenant sombra para este token" }, 409);
  const since = Number(c.req.query("since") || 0);
  const dump = await dumpTenant(tenantId, since);
  await markHubSync(token, { lastPullAt: Date.now() });
  return c.json(dump);
});

hubSyncApi.get("/sync/restore", async (c) => {
  const token = hubHeader(c);
  if (!(await tokenOk(token))) return c.json({ error: "Token de hub inválido" }, 401);
  const tenantId = await replicaTenantIdForToken(token);
  if (!tenantId) return c.json({ error: "No hay replica para restaurar" }, 409);
  const dump = await dumpTenant(tenantId, 0);
  await markHubSync(token, { lastRestoreAt: Date.now() });
  return c.json(dump);
});

hubSyncApi.post("/sync/notice", async (c) => {
  const token = hubHeader(c);
  if (!(await tokenOk(token))) return c.json({ error: "Token de hub inválido" }, 401);
  const tenantId = await replicaTenantIdForToken(token);
  if (!tenantId) return c.json({ error: "No hay tenant sombra" }, 409);
  const body = await c.req.json<Record<string, unknown>>();
  if (!body?.id) return c.json({ error: "Falta el aviso" }, 400);
  await upsertRow("owner_notices", body);
  if (body.approval_id || body.approvalId) {
    const approvalId = String(body.approval_id || body.approvalId);
    const patch: Record<string, unknown> = { id: approvalId };
    if (body.site_id || body.siteId) patch.site_id = body.site_id || body.siteId;
    if (body.pass_id || body.passId) patch.pass_id = body.pass_id || body.passId;
  }
  const propertyId = String(body.property_id || body.propertyId || "");
  if (propertyId && String(body.status || "pending") === "pending") {
    await fanoutLotNotice({
      propertyId,
      title: String(body.title || "Aviso de portería"),
      message: String(body.message || "Hay un aviso en el lote"),
      noticeId: String(body.id),
    });
  }
  broadcastRealtimeEvent({
    id: nid(),
    siteId: String(body.site_id || body.siteId || ""),
    tenantId,
    type: "owner_notice",
    payload: { noticeId: body.id, synced: true, status: body.status },
    createdAt: Date.now(),
  });
  return c.json({ ok: true });
});

hubSyncApi.get("/sync/photos", async (c) => {
  const token = hubHeader(c);
  if (!(await tokenOk(token))) return c.json({ error: "Token de hub inválido" }, 401);
  const tenantId = await replicaTenantIdForToken(token);
  if (!tenantId) return c.json({ error: "No hay tenant sombra" }, 409);
  const siteRows = await db.select().from(sites).where(eq(sites.tenantId, tenantId));
  const photos: { siteId: string; eventId: string }[] = [];
  for (const s of siteRows) {
    for (const eventId of listEventPhotoIds(s.id)) photos.push({ siteId: s.id, eventId });
  }
  return c.json({ photos });
});

hubSyncApi.post("/sync/photo", async (c) => {
  const token = hubHeader(c);
  if (!(await tokenOk(token))) return c.json({ error: "Token de hub inválido" }, 401);
  const body = await c.req.json<{ siteId?: string; eventId?: string; jpegBase64?: string }>();
  const siteId = String(body.siteId ?? "").trim();
  const eventId = String(body.eventId ?? "").trim();
  const raw = String(body.jpegBase64 ?? "").replace(/^data:image\/\w+;base64,/, "");
  if (!siteId || !eventId || !raw) return c.json({ error: "Falta la foto" }, 400);
  const buf = Buffer.from(raw, "base64");
  if (!looksLikeJpeg(buf)) return c.json({ error: "JPEG inválido" }, 400);
  saveEventPhoto(siteId, eventId, buf);
  return c.json({ ok: true });
});

hubSyncApi.get("/sync/photo/:eventId", async (c) => {
  const token = hubHeader(c);
  if (!(await tokenOk(token))) return c.json({ error: "Token de hub inválido" }, 401);
  const siteId = String(c.req.query("siteId") ?? "").trim();
  const eventId = c.req.param("eventId");
  if (!siteId) return c.json({ error: "Falta siteId" }, 400);
  const buf = readEventPhoto(siteId, eventId);
  if (!buf) return c.json({ error: "Sin foto" }, 404);
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/jpeg" } });
});

const STATE_FILE = join(dataDir, "hub-sync-state.json");

type LoopState = { lastPullMs: number; lastPushMs: number; lastRestoreMs: number; pendingFast: boolean };

function readLoopState(): LoopState {
  try {
    if (!existsSync(STATE_FILE)) return { lastPullMs: 0, lastPushMs: 0, lastRestoreMs: 0, pendingFast: false };
    return { lastPullMs: 0, lastPushMs: 0, lastRestoreMs: 0, pendingFast: false, ...JSON.parse(readFileSync(STATE_FILE, "utf8")) };
  } catch {
    return { lastPullMs: 0, lastPushMs: 0, lastRestoreMs: 0, pendingFast: false };
  }
}

function writeLoopState(s: LoopState) {
  writeFileSync(STATE_FILE, JSON.stringify(s));
}

function hubBaseUrl() {
  return (process.env.ACCESOPRO_HUB_URL || "").trim().replace(/\/$/, "");
}

async function hubFetch(path: string, init?: RequestInit) {
  const base = hubBaseUrl();
  const token = (process.env.ACCESOPRO_HUB_TOKEN || "").trim();
  if (!base || !token) throw new Error("Sin ACCESOPRO_HUB_URL / TOKEN");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-AccesoPro-Hub-Token": token,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(init?.method === "GET" ? 20000 : 60000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `HTTP ${res.status}`);
  return json;
}

async function localTenantId(): Promise<string | null> {
  const tok = (process.env.ACCESOPRO_HUB_TOKEN || "").trim();
  if (tok) {
    const site = await db.select().from(sites).where(eq(sites.hubToken, tok)).get();
    if (site) return site.tenantId;
  }
  const t = await db.select().from(tenants).limit(1).get();
  return t?.id ?? null;
}

async function padronEmpty(tenantId: string) {
  const n = await db.select({ n: sql<number>`count(*)` }).from(properties).where(eq(properties.tenantId, tenantId)).get();
  return Number(n?.n ?? 0) === 0;
}

async function pendingOwnerNotices(tenantId: string) {
  const site = await db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
  if (!site) return 0;
  const n = await db
    .select({ n: sql<number>`count(*)` })
    .from(ownerNotices)
    .where(and(eq(ownerNotices.siteId, site.id), eq(ownerNotices.status, "pending")))
    .get();
  return Number(n?.n ?? 0);
}

async function pushMissingPhotos(tenantId: string) {
  const siteRows = await db.select().from(sites).where(eq(sites.tenantId, tenantId));
  let remote: { photos: { siteId: string; eventId: string }[] } = { photos: [] };
  try {
    remote = (await hubFetch("/api/hub/sync/photos")) as typeof remote;
  } catch {
    return 0;
  }
  const have = new Set((remote.photos || []).map((p) => `${p.siteId}:${p.eventId}`));
  let sent = 0;
  for (const s of siteRows) {
    for (const eventId of listEventPhotoIds(s.id)) {
      if (have.has(`${s.id}:${eventId}`)) continue;
      const buf = readEventPhoto(s.id, eventId);
      if (!buf) continue;
      await hubFetch("/api/hub/sync/photo", {
        method: "POST",
        body: JSON.stringify({ siteId: s.id, eventId, jpegBase64: buf.toString("base64") }),
      });
      sent += 1;
    }
  }
  return sent;
}

async function pullMissingPhotos(dump: ReplicaDump) {
  for (const p of dump.photos || []) {
    if (existsSync(eventPhotoPath(p.siteId, p.eventId))) continue;
    try {
      const base = hubBaseUrl();
      const token = (process.env.ACCESOPRO_HUB_TOKEN || "").trim();
      const res = await fetch(`${base}/api/hub/sync/photo/${encodeURIComponent(p.eventId)}?siteId=${encodeURIComponent(p.siteId)}`, {
        headers: { "X-AccesoPro-Hub-Token": token },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (looksLikeJpeg(buf)) saveEventPhoto(p.siteId, p.eventId, buf);
    } catch {
      /* foto suelta: el próximo ciclo reintenta */
    }
  }
}

export async function publishNoticeToHub(row: Record<string, unknown>) {
  if (!hubBaseUrl() || !(process.env.ACCESOPRO_HUB_TOKEN || "").trim()) return;
  try {
    await hubFetch("/api/hub/sync/notice", { method: "POST", body: JSON.stringify(row) });
  } catch {
    /* el loop de 1–2 s lo sube en el pull/push */
  }
}

async function tickHubSync() {
  const tenantId = await localTenantId();
  if (!tenantId) return;
  const state = readLoopState();
  if (!state.lastRestoreMs && (await padronEmpty(tenantId))) {
    const dump = (await hubFetch("/api/hub/sync/restore")) as ReplicaDump;
    await applyDump(dump);
    await pullMissingPhotos(dump);
    state.lastRestoreMs = Date.now();
    state.lastPullMs = Date.now();
    writeLoopState(state);
    return;
  }
  const dump = await dumpTenant(tenantId, state.lastPushMs);
  await hubFetch("/api/hub/sync/push", { method: "POST", body: JSON.stringify(dump) });
  state.lastPushMs = Date.now();
  const incoming = (await hubFetch(`/api/hub/sync/pull?since=${state.lastPullMs || 0}`)) as ReplicaDump;
  await applyDump(incoming);
  await pullMissingPhotos(incoming);
  await pushMissingPhotos(tenantId);
  state.lastPullMs = Date.now();
  state.pendingFast = (await pendingOwnerNotices(tenantId)) > 0;
  writeLoopState(state);
}

let loopStarted = false;

export function startHubSyncLoop() {
  if (loopStarted) return;
  const url = hubBaseUrl();
  const tok = (process.env.ACCESOPRO_HUB_TOKEN || "").trim();
  if (!url || !tok) return;
  loopStarted = true;
  const run = async () => {
    try {
      await tickHubSync();
    } catch (err) {
      console.warn("[hub-sync]", err instanceof Error ? err.message : err);
    }
    const state = readLoopState();
    const wait = state.pendingFast ? 1500 : 60_000;
    setTimeout(run, wait);
  };
  setTimeout(run, 4000);
}

export async function restoreFromHubIfEmpty() {
  const url = hubBaseUrl();
  const tok = (process.env.ACCESOPRO_HUB_TOKEN || "").trim();
  if (!url || !tok) return { restored: false };
  const tenantCount = await db.select({ n: sql<number>`count(*)` }).from(tenants).get();
  const tenantId = await localTenantId();
  const emptyPadron = tenantId ? await padronEmpty(tenantId) : true;
  if (Number(tenantCount?.n ?? 0) > 0 && !emptyPadron) return { restored: false };
  const dump = (await hubFetch("/api/hub/sync/restore")) as ReplicaDump;
  if (!dump.tables?.tenants?.length) return { restored: false };
  const r = await applyDump(dump);
  await pullMissingPhotos(dump);
  const state = readLoopState();
  state.lastRestoreMs = Date.now();
  state.lastPullMs = Date.now();
  writeLoopState(state);
  return { restored: true, ...r };
}
