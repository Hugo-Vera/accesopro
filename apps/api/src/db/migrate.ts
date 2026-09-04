import { sql } from "drizzle-orm";
import { client, db } from "./client.js";

async function addColumn(table: string, column: string, def: string) {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  } catch {
    // ya existe
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
      notes TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (site_id, lot_number)
    )
  `);
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
}
