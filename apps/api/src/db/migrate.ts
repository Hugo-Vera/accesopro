import { sql } from "drizzle-orm";
import { client, db } from "./client.js";
import { eq } from "drizzle-orm";
import {
  accessPointActuators,
  accessPointCameras,
  accessPointDevices,
  accessPoints,
  actuators,
  cameras,
  dahuaDevices,
} from "./schema.js";
import { syncDeviceLaneWiring } from "../accessPoints.js";

async function addColumn(table: string, column: string, def: string): Promise<boolean> {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
    return true;
  } catch {
    return false;
  }
}

export async function ensureSchema() {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT REFERENCES tenants(id),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      invite_token TEXT,
      invite_expires_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS tenant_modules (
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      module_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      UNIQUE (tenant_id, module_key)
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      module_keys_json TEXT NOT NULL,
      capability_keys_json TEXT NOT NULL,
      limits_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS tenant_subscriptions (
      tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
      plan_id TEXT NOT NULL REFERENCES plans(id),
      assigned_at INTEGER NOT NULL,
      assigned_by_user_id TEXT REFERENCES users(id)
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS user_grants (
      user_id TEXT NOT NULL REFERENCES users(id),
      capability_key TEXT NOT NULL,
      granted_at INTEGER NOT NULL,
      granted_by_user_id TEXT REFERENCES users(id),
      PRIMARY KEY (user_id, capability_key)
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS tenant_features (
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      feature_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id, feature_key)
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  await addColumn("sites", "agent_token", "TEXT");
  await addColumn("sites", "last_seen_at", "INTEGER");
  await addColumn("sites", "map_lat", "TEXT");
  await addColumn("sites", "map_lng", "TEXT");
  await addColumn("sites", "map_zoom", "INTEGER");
  await addColumn("sites", "map_bearing", "INTEGER");
  await addColumn("sites", "map_view_saved", "INTEGER");
  await addColumn("sites", "map_overlays", "TEXT");

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS dahua_devices (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id),
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 80,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  await addColumn("dahua_devices", "device_type", "TEXT NOT NULL DEFAULT 'asi_facial'");
  await addColumn("dahua_devices", "model", "TEXT");
  await addColumn("dahua_devices", "serial_number", "TEXT");
  await addColumn("dahua_devices", "location", "TEXT");
  await addColumn("dahua_devices", "last_status", "TEXT NOT NULL DEFAULT 'unknown'");
  await addColumn("dahua_devices", "last_seen_at", "INTEGER");
  await addColumn("dahua_devices", "rtsp_url", "TEXT");
  await addColumn("dahua_devices", "rtsp_port", "INTEGER NOT NULL DEFAULT 554");
  await addColumn("dahua_devices", "pss_port", "INTEGER NOT NULL DEFAULT 37777");
  const addedSentido = await addColumn("dahua_devices", "sentido", "TEXT NOT NULL DEFAULT 'in'");
  await addColumn("dahua_devices", "use_live", "INTEGER NOT NULL DEFAULT 1");
  await addColumn("dahua_devices", "use_local_relay", "INTEGER NOT NULL DEFAULT 1");
  const addedLaneSector = await addColumn("dahua_devices", "lane_sector", "TEXT NOT NULL DEFAULT 'vehicular'");
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS actuators (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id),
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'door',
      driver TEXT NOT NULL,
      dahua_device_id TEXT REFERENCES dahua_devices(id),
      dahua_channel INTEGER NOT NULL DEFAULT 1,
      http_url TEXT,
      pulse_ms INTEGER NOT NULL DEFAULT 1000,
      created_at INTEGER NOT NULL
    )
  `);
  await addColumn("actuators", "engine_sentido", "TEXT");
  await addColumn("actuators", "trigger_alpr", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("actuators", "trigger_dahua", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("actuators", "trigger_qr", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("actuators", "trigger_manual", "INTEGER NOT NULL DEFAULT 1");
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS cameras (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id),
      name TEXT NOT NULL,
      rtsp_url TEXT NOT NULL,
      actuator_id TEXT REFERENCES actuators(id),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS plates (
      site_id TEXT NOT NULL REFERENCES sites(id),
      plate TEXT NOT NULL,
      list TEXT NOT NULL,
      note TEXT,
      PRIMARY KEY (site_id, plate)
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id),
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  await addColumn("events", "sentido", "TEXT");
  await addColumn("events", "lane_code", "INTEGER");
  await addColumn("events", "access_point_id", "TEXT");
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_events_site_type_created
    ON events (site_id, type, created_at DESC)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_events_site_lane_created
    ON events (site_id, lane_code, created_at DESC)
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id),
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      lot_number TEXT NOT NULL,
      label TEXT NOT NULL,
      address TEXT,
      map_lat TEXT,
      map_lng TEXT,
      lot_polygon TEXT,
      notes TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (site_id, lot_number)
    )
  `);
  await addColumn("properties", "lot_polygon", "TEXT");
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS owner_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
      property_id TEXT NOT NULL REFERENCES properties(id),
      dni TEXT,
      phone TEXT,
      phone_alt TEXT,
      emergency_name TEXT,
      emergency_phone TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS property_services (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id),
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      dni TEXT,
      patente TEXT,
      phone TEXT,
      hora_desde TEXT,
      hora_hasta TEXT,
      dias_semana TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS visit_authorizations (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      kind TEXT NOT NULL,
      guest_name TEXT NOT NULL,
      guest_dni TEXT,
      patente TEXT,
      fecha_desde INTEGER NOT NULL,
      fecha_hasta INTEGER NOT NULL,
      hora_desde TEXT,
      hora_hasta TEXT,
      dias_semana TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS visit_passes (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      authorization_id TEXT REFERENCES visit_authorizations(id),
      token TEXT NOT NULL UNIQUE,
      guest_name TEXT NOT NULL,
      guest_dni TEXT,
      patente TEXT,
      valid_from INTEGER NOT NULL,
      valid_until INTEGER NOT NULL,
      hora_desde TEXT,
      hora_hasta TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      scanned_in_at INTEGER,
      scanned_out_at INTEGER,
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    )
  `);
  await addColumn("owner_profiles", "full_name", "TEXT");
  await addColumn("owner_profiles", "photo_base64", "TEXT");
  await addColumn("owner_profiles", "dahua_user_id", "TEXT");
  await addColumn("owner_profiles", "dahua_synced", "INTEGER DEFAULT 0");

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS property_family_members (
      id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL REFERENCES properties(id),
      name TEXT NOT NULL,
      dni TEXT,
      relationship TEXT NOT NULL DEFAULT 'familiar',
      phone TEXT,
      photo_base64 TEXT,
      dahua_user_id TEXT,
      dahua_synced INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);

  await addColumn("property_services", "photo_base64", "TEXT");
  await addColumn("property_services", "dahua_user_id", "TEXT");
  await addColumn("property_services", "dahua_synced", "INTEGER DEFAULT 0");

  await addColumn("visit_passes", "dahua_synced", "INTEGER DEFAULT 0");
  await addColumn("visit_passes", "dahua_card_no", "TEXT");
  await addColumn("visit_passes", "arrival_mode", "TEXT NOT NULL DEFAULT 'peatonal'");
  await addColumn("visit_passes", "visit_kind", "TEXT NOT NULL DEFAULT 'social'");
  await addColumn("visit_passes", "completeness", "TEXT NOT NULL DEFAULT 'basic'");
  await addColumn("visit_passes", "vehicle_id", "TEXT");
  await addColumn("visit_passes", "insurance_id", "TEXT");
  await addColumn("visit_passes", "visit_record_id", "TEXT");
  await addColumn("visit_passes", "notes", "TEXT");
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS visit_companions (
      id TEXT PRIMARY KEY,
      pass_id TEXT NOT NULL REFERENCES visit_passes(id),
      name TEXT NOT NULL,
      dni TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS guard_approvals (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id),
      pass_id TEXT NOT NULL REFERENCES visit_passes(id),
      sentido TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'ok',
      status TEXT NOT NULL DEFAULT 'pending',
      trunk_checked INTEGER NOT NULL DEFAULT 0,
      comment TEXT,
      guard_user_id TEXT REFERENCES users(id),
      device_id TEXT,
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    )
  `);
  await db.run(sql`
    UPDATE visit_passes
    SET status = CASE
      WHEN status IN ('revoked', 'cancelled') THEN 'revoked'
      WHEN status IN ('completed', 'used') OR scanned_out_at IS NOT NULL THEN 'completed'
      WHEN scanned_in_at IS NOT NULL THEN 'in_site'
      WHEN status IN ('preauthorized', 'awaiting_entry', 'awaiting_exit', 'denied', 'expired', 'in_site') THEN status
      ELSE 'preauthorized'
    END
    WHERE status IN ('active', 'pending', 'used')
  `);

  // —— Puntos de acceso + cableados (modulares; no mezclan módulos comerciales) ——
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS access_points (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id),
      name TEXT NOT NULL,
      sector TEXT NOT NULL DEFAULT 'peatonal',
      sentido TEXT NOT NULL DEFAULT 'both',
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      map_x TEXT,
      map_y TEXT,
      notes TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS access_point_actuators (
      access_point_id TEXT NOT NULL REFERENCES access_points(id),
      actuator_id TEXT NOT NULL REFERENCES actuators(id),
      role TEXT NOT NULL DEFAULT 'primary',
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (access_point_id, actuator_id)
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS access_point_devices (
      access_point_id TEXT NOT NULL REFERENCES access_points(id),
      dahua_device_id TEXT NOT NULL REFERENCES dahua_devices(id),
      role TEXT NOT NULL DEFAULT 'both',
      PRIMARY KEY (access_point_id, dahua_device_id)
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS access_point_cameras (
      access_point_id TEXT NOT NULL REFERENCES access_points(id),
      camera_id TEXT NOT NULL REFERENCES cameras(id),
      role TEXT NOT NULL DEFAULT 'live',
      sentido TEXT,
      PRIMARY KEY (access_point_id, camera_id)
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      dahua_dept_id TEXT NOT NULL DEFAULT '1',
      name TEXT NOT NULL,
      default_period_index INTEGER NOT NULL DEFAULT 255,
      description TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS visitor_identities (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      dni_number TEXT NOT NULL,
      tramite_number TEXT,
      last_name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      gender TEXT,
      birth_date TEXT,
      issue_date TEXT,
      address TEXT,
      raw_pdf417 TEXT,
      phone TEXT,
      blacklisted INTEGER NOT NULL DEFAULT 0,
      blacklist_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS person_insurances (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      person_id TEXT NOT NULL REFERENCES visitor_identities(id),
      kind TEXT NOT NULL DEFAULT 'life',
      company TEXT,
      policy_number TEXT,
      valid_until INTEGER NOT NULL,
      document_path TEXT,
      document_mime TEXT,
      source TEXT NOT NULL DEFAULT 'upload',
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      plate TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      color TEXT,
      vehicle_type TEXT NOT NULL DEFAULT 'car',
      notes TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vehicle_insurances (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
      company TEXT NOT NULL,
      policy_number TEXT NOT NULL,
      valid_from INTEGER,
      valid_until INTEGER NOT NULL,
      coverage_type TEXT NOT NULL DEFAULT 'responsabilidad_civil',
      card_photo_url TEXT,
      verified_by TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS driver_licenses (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      person_id TEXT NOT NULL REFERENCES visitor_identities(id),
      license_number TEXT NOT NULL,
      classes TEXT NOT NULL DEFAULT 'B.1',
      jurisdiction TEXT,
      valid_until INTEGER NOT NULL,
      photo_url TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS visit_records (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      site_id TEXT NOT NULL REFERENCES sites(id),
      property_id TEXT NOT NULL REFERENCES properties(id),
      person_id TEXT NOT NULL REFERENCES visitor_identities(id),
      vehicle_id TEXT REFERENCES vehicles(id),
      insurance_id TEXT REFERENCES vehicle_insurances(id),
      person_insurance_id TEXT,
      license_id TEXT REFERENCES driver_licenses(id),
      visit_type TEXT NOT NULL DEFAULT 'social',
      status TEXT NOT NULL DEFAULT 'in_site',
      authorized_by TEXT NOT NULL,
      pass_token TEXT,
      scanned_in_at INTEGER,
      scanned_out_at INTEGER,
      notes TEXT,
      created_by_user_id TEXT REFERENCES users(id),
      created_at INTEGER NOT NULL
    )
  `);
  await addColumn("visit_records", "person_insurance_id", "TEXT");

  // Columnas de invite / reset: siempre, aunque no haya actuadores (backfill sale temprano).
  await addColumn("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("users", "invite_token", "TEXT");
  await addColumn("users", "invite_expires_at", "INTEGER");
  await addColumn("owner_profiles", "whatsapp", "TEXT");
  await addColumn("property_family_members", "fecha_desde", "INTEGER");
  await addColumn("property_family_members", "fecha_hasta", "INTEGER");
  await addColumn("property_family_members", "hora_desde", "TEXT");
  await addColumn("property_family_members", "hora_hasta", "TEXT");
  await addColumn("property_family_members", "dias_semana", "TEXT");
  await addColumn("property_services", "fecha_desde", "INTEGER");
  await addColumn("property_services", "fecha_hasta", "INTEGER");

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS dahua_period_slots (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES dahua_devices(id),
      fingerprint TEXT NOT NULL,
      period_index INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (device_id, fingerprint)
    )
  `);
  // Padrón maestro de credenciales: tarjeta y QR son cosas distintas, no el mismo número.
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS person_credentials (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id),
      dahua_user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      label TEXT,
      valid_from INTEGER,
      valid_until INTEGER,
      max_uses INTEGER NOT NULL DEFAULT 0,
      used_count INTEGER NOT NULL DEFAULT 0,
      validation_mode TEXT NOT NULL DEFAULT 'local',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    )
  `);
  await db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS person_credentials_payload_uq
      ON person_credentials (site_id, kind, payload)
  `);
  await db.run(sql`
    CREATE INDEX IF NOT EXISTS person_credentials_user_idx
      ON person_credentials (site_id, dahua_user_id)
  `);
  // Backfill: los pases de visita ya existentes son credenciales QR (hoy cargadas en el CardNo
  // del lector). El userId espeja `v_${passId.slice(-8)}` de residents.ts.
  await db.run(sql`
    INSERT OR IGNORE INTO person_credentials (
      id, site_id, dahua_user_id, kind, payload, label,
      valid_from, valid_until, max_uses, used_count, validation_mode, status, created_at
    )
    SELECT
      'cred_vp_' || vp.id,
      vp.site_id,
      'v_' || substr(vp.id, -8),
      'qr',
      COALESCE(vp.dahua_card_no, vp.token),
      vp.guest_name,
      vp.valid_from,
      vp.valid_until,
      0,
      0,
      'local',
      CASE WHEN vp.status = 'active' THEN 'active' ELSE 'revoked' END,
      vp.created_at
    FROM visit_passes vp
    WHERE COALESCE(vp.dahua_card_no, vp.token) IS NOT NULL
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS credential_device_sync (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id),
      dahua_user_id TEXT NOT NULL,
      device_id TEXT NOT NULL REFERENCES dahua_devices(id),
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      last_synced_at INTEGER,
      UNIQUE (dahua_user_id, device_id)
    )
  `);

  await backfillAccessPointsFromLegacy();
  await backfillDeviceLaneFields(addedSentido, addedLaneSector);
}

async function backfillDeviceLaneFields(guessFromName: boolean, recableSector: boolean) {
  const rows = await db.select().from(dahuaDevices);
  const wired = await db.select().from(accessPointDevices);
  const camWired = await db.select().from(accessPointCameras);
  const wiredIds = new Set(wired.map((w) => w.dahuaDeviceId));
  const camWiredIds = new Set(
    camWired.map((w) => (w.cameraId.startsWith("cam_") ? w.cameraId.slice(4) : w.cameraId)),
  );
  for (const d of rows) {
    const isCam = d.deviceType === "camera_ip";
    if (isCam && d.useLocalRelay) {
      await db.update(dahuaDevices).set({ useLocalRelay: false }).where(eq(dahuaDevices.id, d.id));
    }
    const blob = `${d.name} ${d.location ?? ""}`.toLowerCase();
    let sentido = parseDeviceSentidoLocal(d.sentido);
    if (guessFromName && /salid|egres|\bout\b/.test(blob) && !/ingres|entrad/.test(blob)) {
      sentido = "out";
    }
    let laneSector = parseDeviceLaneSectorLocal(d.laneSector);
    if (recableSector) {
      if (/peaton|torniquete|molinete/.test(blob) && !/vehicul|barrera|port[oó]n/.test(blob)) {
        laneSector = "peatonal";
      } else {
        laneSector = "vehicular";
      }
    }
    const useLive = d.useLive !== false;
    const useLocalRelay = isCam ? false : d.useLocalRelay !== false;
    if (
      d.sentido !== sentido ||
      d.laneSector !== laneSector ||
      d.useLive !== useLive ||
      d.useLocalRelay !== useLocalRelay
    ) {
      await db
        .update(dahuaDevices)
        .set({ sentido, laneSector, useLive, useLocalRelay })
        .where(eq(dahuaDevices.id, d.id));
    }
    const alreadyWired = wiredIds.has(d.id) || (isCam && camWiredIds.has(d.id));
    if (!recableSector && alreadyWired) continue;
    try {
      await syncDeviceLaneWiring(d.siteId, {
        id: d.id,
        name: d.name,
        deviceType: d.deviceType || "asi_facial",
        sentido,
        laneSector,
        useLive,
        useLocalRelay,
      });
    } catch {
      // no bloquear arranque
    }
  }
}

function parseDeviceSentidoLocal(v: unknown): "in" | "out" {
  return String(v || "").trim() === "out" ? "out" : "in";
}

function parseDeviceLaneSectorLocal(v: unknown): "vehicular" | "peatonal" {
  return String(v || "").trim() === "peatonal" ? "peatonal" : "vehicular";
}

/** Crea un punto por actuador aún no cableado, y engancha device/cámara legacy. */
async function backfillAccessPointsFromLegacy() {
  const acts = await db.select().from(actuators);
  if (acts.length === 0) return;

  const wired = await db.select().from(accessPointActuators);
  const wiredActIds = new Set(wired.map((w) => w.actuatorId));

  for (const a of acts) {
    if (wiredActIds.has(a.id)) continue;

    const nameLower = a.name.toLowerCase();
    let sector = "peatonal";
    if (a.driver === "engine" || a.kind === "barrier" || a.kind === "gate" || /barrera|port[oó]n|veh[ií]cul/i.test(nameLower)) {
      sector = "vehicular";
    } else if (/basura|riego|sirena|emergencia|servicio|ilumin/i.test(nameLower)) {
      sector = "servicio";
    }

    let sentido = "both";
    if (a.engineSentido === "in" || a.engineSentido === "out") {
      sentido = a.engineSentido;
    } else if (/entrada|ingreso|\bin\b/i.test(nameLower)) {
      sentido = "in";
    } else if (/salida|egreso|\bout\b/i.test(nameLower)) {
      sentido = "out";
    }

    const pointId = crypto.randomUUID();
    const now = Date.now();
    await db.insert(accessPoints).values({
      id: pointId,
      siteId: a.siteId,
      name: a.name,
      sector,
      sentido,
      sortOrder: 0,
      enabled: true,
      mapX: null,
      mapY: null,
      notes: "Creado automáticamente desde actuador legacy",
      createdAt: new Date(now),
    });
    await db.insert(accessPointActuators).values({
      accessPointId: pointId,
      actuatorId: a.id,
      role: "primary",
      sortOrder: 0,
    });

    if (a.dahuaDeviceId) {
      const exists = await db
        .select()
        .from(dahuaDevices)
        .where(eq(dahuaDevices.id, a.dahuaDeviceId))
        .get();
      if (exists) {
        try {
          await db.insert(accessPointDevices).values({
            accessPointId: pointId,
            dahuaDeviceId: a.dahuaDeviceId,
            role: "both",
          });
        } catch {
          // ya cableado
        }
      }
    }

    const cams = await db.select().from(cameras).where(eq(cameras.actuatorId, a.id));
    for (const cam of cams) {
      try {
        await db.insert(accessPointCameras).values({
          accessPointId: pointId,
          cameraId: cam.id,
          role: a.triggerAlpr ? "alpr" : "live",
          sentido: a.engineSentido === "in" || a.engineSentido === "out" ? a.engineSentido : null,
        });
      } catch {
        // ya cableado
      }
    }
  }

  await addColumn("property_family_members", "birth_date", "TEXT");
  await addColumn("visit_companions", "birth_date", "TEXT");
  await addColumn("visit_companions", "is_minor", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("visit_companions", "situation", "TEXT NOT NULL DEFAULT 'acompanante'");
  await addColumn("guard_approvals", "owner_auth_status", "TEXT NOT NULL DEFAULT 'none'");
  await addColumn("guard_approvals", "owner_auth_expires_at", "INTEGER");
  await addColumn("guard_approvals", "owner_authorized_by_user_id", "TEXT");
  await addColumn("guard_approvals", "goods_alert", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("guard_approvals", "goods_description", "TEXT");
  await addColumn("guard_approvals", "goods_photo_path", "TEXT");
  await addColumn("guard_approvals", "goods_authorized_by_user_id", "TEXT");
  await addColumn("guard_approvals", "exit_adults_count", "INTEGER");
  await addColumn("guard_approvals", "exit_minors_count", "INTEGER");
  await addColumn("guard_approvals", "origin_property_id", "TEXT");
  await addColumn("guard_approvals", "minor_transfer_authorized_by_user_id", "TEXT");

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS owner_notices (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id),
      property_id TEXT NOT NULL REFERENCES properties(id),
      pass_id TEXT REFERENCES visit_passes(id),
      approval_id TEXT REFERENCES guard_approvals(id),
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      decided_at INTEGER,
      decided_by_user_id TEXT REFERENCES users(id)
    )
  `);
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS tenant_settings (
      tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
      retention_days INTEGER NOT NULL DEFAULT 90,
      updated_at INTEGER NOT NULL
    )
  `);
  await addColumn("users", "guard_code", "TEXT");
}

