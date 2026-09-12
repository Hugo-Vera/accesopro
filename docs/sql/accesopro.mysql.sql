-- AccesoPro — esquema MySQL 8 / MariaDB 10.5+ (Laragon)
-- La API HOY habla SQLite (libsql). Este SQL deja el mismo modelo en MariaDB/MySQL.
-- IDs VARCHAR(64). Fechas = epoch ms (BIGINT). Booleanos = TINYINT(1) 0/1.
--
--   CREATE DATABASE accesopro CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
--   mysql -u root accesopro < docs/sql/accesopro.mysql.sql

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(128) NOT NULL UNIQUE,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at BIGINT NOT NULL,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tenant_modules (
  tenant_id VARCHAR(64) NOT NULL,
  module_key VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_tenant_module (tenant_id, module_key),
  CONSTRAINT fk_tm_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plans (
  id VARCHAR(64) PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  summary TEXT NOT NULL,
  module_keys_json TEXT NOT NULL,
  capability_keys_json TEXT NOT NULL,
  limits_json TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  tenant_id VARCHAR(64) PRIMARY KEY,
  plan_id VARCHAR(64) NOT NULL,
  assigned_at BIGINT NOT NULL,
  assigned_by_user_id VARCHAR(64) NULL,
  CONSTRAINT fk_ts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_ts_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_ts_user FOREIGN KEY (assigned_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_grants (
  user_id VARCHAR(64) NOT NULL,
  capability_key VARCHAR(64) NOT NULL,
  granted_at BIGINT NOT NULL,
  granted_by_user_id VARCHAR(64) NULL,
  PRIMARY KEY (user_id, capability_key),
  CONSTRAINT fk_ug_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_ug_by FOREIGN KEY (granted_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tenant_features (
  tenant_id VARCHAR(64) NOT NULL,
  feature_key VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, feature_key),
  CONSTRAINT fk_tf_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sites (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  agent_token VARCHAR(255) NULL,
  last_seen_at BIGINT NULL,
  map_lat VARCHAR(32) NULL,
  map_lng VARCHAR(32) NULL,
  map_zoom INT NULL,
  map_overlays TEXT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_sites_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dahua_devices (
  id VARCHAR(64) PRIMARY KEY,
  site_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INT NOT NULL DEFAULT 80,
  rtsp_port INT NOT NULL DEFAULT 554,
  pss_port INT NOT NULL DEFAULT 37777,
  username VARCHAR(128) NOT NULL,
  password VARCHAR(255) NOT NULL,
  device_type VARCHAR(64) NOT NULL DEFAULT 'asi_facial',
  model VARCHAR(128) NULL,
  serial_number VARCHAR(128) NULL,
  location VARCHAR(255) NULL,
  last_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  last_seen_at BIGINT NULL,
  rtsp_url TEXT NULL,
  sentido VARCHAR(8) NOT NULL DEFAULT 'in',
  use_live TINYINT(1) NOT NULL DEFAULT 1,
  use_local_relay TINYINT(1) NOT NULL DEFAULT 1,
  lane_sector VARCHAR(32) NOT NULL DEFAULT 'vehicular',
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_dahua_site FOREIGN KEY (site_id) REFERENCES sites(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS actuators (
  id VARCHAR(64) PRIMARY KEY,
  site_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  kind VARCHAR(32) NOT NULL DEFAULT 'door',
  driver VARCHAR(32) NOT NULL,
  dahua_device_id VARCHAR(64) NULL,
  dahua_channel INT NOT NULL DEFAULT 1,
  http_url TEXT NULL,
  pulse_ms INT NOT NULL DEFAULT 1000,
  engine_sentido VARCHAR(8) NULL,
  trigger_alpr TINYINT(1) NOT NULL DEFAULT 0,
  trigger_dahua TINYINT(1) NOT NULL DEFAULT 0,
  trigger_qr TINYINT(1) NOT NULL DEFAULT 0,
  trigger_manual TINYINT(1) NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_act_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_act_dahua FOREIGN KEY (dahua_device_id) REFERENCES dahua_devices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cameras (
  id VARCHAR(64) PRIMARY KEY,
  site_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  rtsp_url TEXT NOT NULL,
  actuator_id VARCHAR(64) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_cam_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_cam_act FOREIGN KEY (actuator_id) REFERENCES actuators(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plates (
  site_id VARCHAR(64) NOT NULL,
  plate VARCHAR(16) NOT NULL,
  list VARCHAR(16) NOT NULL,
  note TEXT NULL,
  PRIMARY KEY (site_id, plate),
  CONSTRAINT fk_plates_site FOREIGN KEY (site_id) REFERENCES sites(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(64) PRIMARY KEY,
  site_id VARCHAR(64) NOT NULL,
  type VARCHAR(64) NOT NULL,
  payload TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  sentido VARCHAR(8) NULL,
  lane_code INT NULL,
  access_point_id VARCHAR(64) NULL,
  KEY idx_events_site_type_created (site_id, type, created_at),
  KEY idx_events_site_lane_created (site_id, lane_code, created_at),
  CONSTRAINT fk_events_site FOREIGN KEY (site_id) REFERENCES sites(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS commands (
  id VARCHAR(64) PRIMARY KEY,
  site_id VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  payload TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  result TEXT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_cmd_site FOREIGN KEY (site_id) REFERENCES sites(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS properties (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  site_id VARCHAR(64) NOT NULL,
  lot_number VARCHAR(32) NOT NULL,
  label VARCHAR(255) NOT NULL,
  address TEXT NULL,
  map_lat VARCHAR(32) NULL,
  map_lng VARCHAR(32) NULL,
  lot_polygon TEXT NULL,
  notes TEXT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY uq_prop_lot (site_id, lot_number),
  CONSTRAINT fk_prop_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_prop_site FOREIGN KEY (site_id) REFERENCES sites(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS owner_profiles (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL UNIQUE,
  property_id VARCHAR(64) NOT NULL,
  dni VARCHAR(32) NULL,
  phone VARCHAR(32) NULL,
  phone_alt VARCHAR(32) NULL,
  emergency_name VARCHAR(255) NULL,
  emergency_phone VARCHAR(32) NULL,
  full_name VARCHAR(255) NULL,
  photo_base64 MEDIUMTEXT NULL,
  dahua_user_id VARCHAR(64) NULL,
  dahua_synced TINYINT(1) DEFAULT 0,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_op_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_op_prop FOREIGN KEY (property_id) REFERENCES properties(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS property_services (
  id VARCHAR(64) PRIMARY KEY,
  property_id VARCHAR(64) NOT NULL,
  role VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  dni VARCHAR(32) NULL,
  patente VARCHAR(16) NULL,
  phone VARCHAR(32) NULL,
  hora_desde VARCHAR(8) NULL,
  hora_hasta VARCHAR(8) NULL,
  dias_semana VARCHAR(32) NULL,
  notes TEXT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  photo_base64 MEDIUMTEXT NULL,
  dahua_user_id VARCHAR(64) NULL,
  dahua_synced TINYINT(1) DEFAULT 0,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_ps_prop FOREIGN KEY (property_id) REFERENCES properties(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS visit_authorizations (
  id VARCHAR(64) PRIMARY KEY,
  property_id VARCHAR(64) NOT NULL,
  site_id VARCHAR(64) NOT NULL,
  kind VARCHAR(32) NOT NULL,
  guest_name VARCHAR(255) NOT NULL,
  guest_dni VARCHAR(32) NULL,
  patente VARCHAR(16) NULL,
  fecha_desde BIGINT NOT NULL,
  fecha_hasta BIGINT NOT NULL,
  hora_desde VARCHAR(8) NULL,
  hora_hasta VARCHAR(8) NULL,
  dias_semana VARCHAR(32) NULL,
  notes TEXT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_user_id VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_va_prop FOREIGN KEY (property_id) REFERENCES properties(id),
  CONSTRAINT fk_va_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_va_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS visit_passes (
  id VARCHAR(64) PRIMARY KEY,
  property_id VARCHAR(64) NOT NULL,
  site_id VARCHAR(64) NOT NULL,
  authorization_id VARCHAR(64) NULL,
  token VARCHAR(128) NOT NULL UNIQUE,
  guest_name VARCHAR(255) NOT NULL,
  guest_dni VARCHAR(32) NULL,
  patente VARCHAR(16) NULL,
  valid_from BIGINT NOT NULL,
  valid_until BIGINT NOT NULL,
  hora_desde VARCHAR(8) NULL,
  hora_hasta VARCHAR(8) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  scanned_in_at BIGINT NULL,
  scanned_out_at BIGINT NULL,
  created_by_user_id VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  dahua_synced TINYINT(1) DEFAULT 0,
  dahua_card_no VARCHAR(64) NULL,
  CONSTRAINT fk_vp_prop FOREIGN KEY (property_id) REFERENCES properties(id),
  CONSTRAINT fk_vp_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_vp_auth FOREIGN KEY (authorization_id) REFERENCES visit_authorizations(id),
  CONSTRAINT fk_vp_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS property_family_members (
  id VARCHAR(64) PRIMARY KEY,
  property_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  dni VARCHAR(32) NULL,
  relationship VARCHAR(64) NOT NULL DEFAULT 'familiar',
  phone VARCHAR(32) NULL,
  photo_base64 MEDIUMTEXT NULL,
  dahua_user_id VARCHAR(64) NULL,
  dahua_synced TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_pfm_prop FOREIGN KEY (property_id) REFERENCES properties(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS access_points (
  id VARCHAR(64) PRIMARY KEY,
  site_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  sector VARCHAR(32) NOT NULL DEFAULT 'peatonal',
  sentido VARCHAR(8) NOT NULL DEFAULT 'both',
  sort_order INT NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  map_x VARCHAR(32) NULL,
  map_y VARCHAR(32) NULL,
  notes TEXT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_ap_site FOREIGN KEY (site_id) REFERENCES sites(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS access_point_actuators (
  access_point_id VARCHAR(64) NOT NULL,
  actuator_id VARCHAR(64) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'primary',
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (access_point_id, actuator_id),
  CONSTRAINT fk_apa_ap FOREIGN KEY (access_point_id) REFERENCES access_points(id),
  CONSTRAINT fk_apa_act FOREIGN KEY (actuator_id) REFERENCES actuators(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS access_point_devices (
  access_point_id VARCHAR(64) NOT NULL,
  dahua_device_id VARCHAR(64) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'both',
  PRIMARY KEY (access_point_id, dahua_device_id),
  CONSTRAINT fk_apd_ap FOREIGN KEY (access_point_id) REFERENCES access_points(id),
  CONSTRAINT fk_apd_dev FOREIGN KEY (dahua_device_id) REFERENCES dahua_devices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS access_point_cameras (
  access_point_id VARCHAR(64) NOT NULL,
  camera_id VARCHAR(64) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'live',
  sentido VARCHAR(8) NULL,
  PRIMARY KEY (access_point_id, camera_id),
  CONSTRAINT fk_apc_ap FOREIGN KEY (access_point_id) REFERENCES access_points(id),
  CONSTRAINT fk_apc_cam FOREIGN KEY (camera_id) REFERENCES cameras(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS departments (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  site_id VARCHAR(64) NOT NULL,
  dahua_dept_id VARCHAR(32) NOT NULL DEFAULT '1',
  name VARCHAR(255) NOT NULL,
  default_period_index INT NOT NULL DEFAULT 255,
  description TEXT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_dept_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_dept_site FOREIGN KEY (site_id) REFERENCES sites(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS visitor_identities (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  dni_number VARCHAR(32) NOT NULL,
  tramite_number VARCHAR(32) NULL,
  last_name VARCHAR(128) NOT NULL,
  first_name VARCHAR(128) NOT NULL,
  gender VARCHAR(8) NULL,
  birth_date VARCHAR(16) NULL,
  issue_date VARCHAR(16) NULL,
  address TEXT NULL,
  raw_pdf417 TEXT NULL,
  phone VARCHAR(32) NULL,
  blacklisted TINYINT(1) NOT NULL DEFAULT 0,
  blacklist_reason TEXT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT fk_vi_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vehicles (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  plate VARCHAR(16) NOT NULL,
  brand VARCHAR(64) NULL,
  model VARCHAR(64) NULL,
  color VARCHAR(32) NULL,
  vehicle_type VARCHAR(32) NOT NULL DEFAULT 'car',
  notes TEXT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_veh_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vehicle_insurances (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  vehicle_id VARCHAR(64) NOT NULL,
  company VARCHAR(128) NOT NULL,
  policy_number VARCHAR(64) NOT NULL,
  valid_from BIGINT NULL,
  valid_until BIGINT NOT NULL,
  coverage_type VARCHAR(64) NOT NULL DEFAULT 'responsabilidad_civil',
  card_photo_url TEXT NULL,
  verified_by VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_ins_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_ins_veh FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS driver_licenses (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  person_id VARCHAR(64) NOT NULL,
  license_number VARCHAR(64) NOT NULL,
  classes VARCHAR(64) NOT NULL DEFAULT 'B.1',
  jurisdiction VARCHAR(64) NULL,
  valid_until BIGINT NOT NULL,
  photo_url TEXT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_lic_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_lic_person FOREIGN KEY (person_id) REFERENCES visitor_identities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS visit_records (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  site_id VARCHAR(64) NOT NULL,
  property_id VARCHAR(64) NOT NULL,
  person_id VARCHAR(64) NOT NULL,
  vehicle_id VARCHAR(64) NULL,
  insurance_id VARCHAR(64) NULL,
  license_id VARCHAR(64) NULL,
  visit_type VARCHAR(32) NOT NULL DEFAULT 'social',
  status VARCHAR(32) NOT NULL DEFAULT 'in_site',
  authorized_by VARCHAR(255) NOT NULL,
  pass_token VARCHAR(128) NULL,
  scanned_in_at BIGINT NULL,
  scanned_out_at BIGINT NULL,
  notes TEXT NULL,
  created_by_user_id VARCHAR(64) NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_vr_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_vr_site FOREIGN KEY (site_id) REFERENCES sites(id),
  CONSTRAINT fk_vr_prop FOREIGN KEY (property_id) REFERENCES properties(id),
  CONSTRAINT fk_vr_person FOREIGN KEY (person_id) REFERENCES visitor_identities(id),
  CONSTRAINT fk_vr_veh FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_vr_ins FOREIGN KEY (insurance_id) REFERENCES vehicle_insurances(id),
  CONSTRAINT fk_vr_lic FOREIGN KEY (license_id) REFERENCES driver_licenses(id),
  CONSTRAINT fk_vr_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
