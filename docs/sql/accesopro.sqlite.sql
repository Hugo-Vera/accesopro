-- AccesoPro — esquema SQLite (espejo de apps/api/src/db/migrate.ts)
-- Uso: sqlite3 apps/api/data/accesopro.db < docs/sql/accesopro.sqlite.sql
--
-- Convención: fechas = epoch ms (INTEGER). Booleanos = 0/1.
-- La API crea esto sola al arrancar (ensureSchema). Este archivo es referencia / restore.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_modules (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  module_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, module_key)
);

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
);

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  assigned_at INTEGER NOT NULL,
  assigned_by_user_id TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_grants (
  user_id TEXT NOT NULL REFERENCES users(id),
  capability_key TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  granted_by_user_id TEXT REFERENCES users(id),
  PRIMARY KEY (user_id, capability_key)
);

CREATE TABLE IF NOT EXISTS tenant_features (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  feature_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, feature_key)
);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  agent_token TEXT,
  last_seen_at INTEGER,
  map_lat TEXT,
  map_lng TEXT,
  map_zoom INTEGER,
  map_overlays TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dahua_devices (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 80,
  rtsp_port INTEGER NOT NULL DEFAULT 554,
  pss_port INTEGER NOT NULL DEFAULT 37777,
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'asi_facial',
  model TEXT,
  serial_number TEXT,
  location TEXT,
  last_status TEXT NOT NULL DEFAULT 'unknown',
  last_seen_at INTEGER,
  rtsp_url TEXT,
  sentido TEXT NOT NULL DEFAULT 'in',
  use_live INTEGER NOT NULL DEFAULT 1,
  use_local_relay INTEGER NOT NULL DEFAULT 1,
  lane_sector TEXT NOT NULL DEFAULT 'vehicular',
  created_at INTEGER NOT NULL
);

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
  engine_sentido TEXT,
  trigger_alpr INTEGER NOT NULL DEFAULT 0,
  trigger_dahua INTEGER NOT NULL DEFAULT 0,
  trigger_qr INTEGER NOT NULL DEFAULT 0,
  trigger_manual INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cameras (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  name TEXT NOT NULL,
  rtsp_url TEXT NOT NULL,
  actuator_id TEXT REFERENCES actuators(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plates (
  site_id TEXT NOT NULL REFERENCES sites(id),
  plate TEXT NOT NULL,
  list TEXT NOT NULL,
  note TEXT,
  PRIMARY KEY (site_id, plate)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sentido TEXT,
  lane_code INTEGER,
  access_point_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_site_type_created
  ON events (site_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_site_lane_created
  ON events (site_id, lane_code, created_at DESC);

CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  action TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  created_at INTEGER NOT NULL
);

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
);

CREATE TABLE IF NOT EXISTS owner_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  dni TEXT,
  phone TEXT,
  phone_alt TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  full_name TEXT,
  photo_base64 TEXT,
  dahua_user_id TEXT,
  dahua_synced INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

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
  photo_base64 TEXT,
  dahua_user_id TEXT,
  dahua_synced INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

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
);

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
  created_at INTEGER NOT NULL,
  dahua_synced INTEGER DEFAULT 0,
  dahua_card_no TEXT
);

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
);

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
);

CREATE TABLE IF NOT EXISTS access_point_actuators (
  access_point_id TEXT NOT NULL REFERENCES access_points(id),
  actuator_id TEXT NOT NULL REFERENCES actuators(id),
  role TEXT NOT NULL DEFAULT 'primary',
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (access_point_id, actuator_id)
);

CREATE TABLE IF NOT EXISTS access_point_devices (
  access_point_id TEXT NOT NULL REFERENCES access_points(id),
  dahua_device_id TEXT NOT NULL REFERENCES dahua_devices(id),
  role TEXT NOT NULL DEFAULT 'both',
  PRIMARY KEY (access_point_id, dahua_device_id)
);

CREATE TABLE IF NOT EXISTS access_point_cameras (
  access_point_id TEXT NOT NULL REFERENCES access_points(id),
  camera_id TEXT NOT NULL REFERENCES cameras(id),
  role TEXT NOT NULL DEFAULT 'live',
  sentido TEXT,
  PRIMARY KEY (access_point_id, camera_id)
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  dahua_dept_id TEXT NOT NULL DEFAULT '1',
  name TEXT NOT NULL,
  default_period_index INTEGER NOT NULL DEFAULT 255,
  description TEXT,
  created_at INTEGER NOT NULL
);

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
);

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
);

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
);

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
);

CREATE TABLE IF NOT EXISTS visit_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  site_id TEXT NOT NULL REFERENCES sites(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  person_id TEXT NOT NULL REFERENCES visitor_identities(id),
  vehicle_id TEXT REFERENCES vehicles(id),
  insurance_id TEXT REFERENCES vehicle_insurances(id),
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
);
