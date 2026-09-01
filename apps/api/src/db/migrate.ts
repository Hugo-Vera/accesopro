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
}
