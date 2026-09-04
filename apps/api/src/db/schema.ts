import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").references(() => tenants.id),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export const tenantModules = sqliteTable(
  "tenant_modules",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    moduleKey: text("module_key").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.moduleKey] }),
  }),
);

/** Plan comercial (espejo de PLAN_CATALOG; caps/limits en JSON). */
export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  summary: text("summary").notNull(),
  moduleKeysJson: text("module_keys_json").notNull(),
  capabilityKeysJson: text("capability_keys_json").notNull(),
  limitsJson: text("limits_json").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Suscripción activa del barrio a un plan. */
export const tenantSubscriptions = sqliteTable("tenant_subscriptions", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id),
  assignedAt: integer("assigned_at", { mode: "timestamp_ms" }).notNull(),
  assignedByUserId: text("assigned_by_user_id").references(() => users.id),
});

/** Permisos granulares por usuario (capa C). */
export const userGrants = sqliteTable(
  "user_grants",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    capabilityKey: text("capability_key").notNull(),
    grantedAt: integer("granted_at", { mode: "timestamp_ms" }).notNull(),
    grantedByUserId: text("granted_by_user_id").references(() => users.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.capabilityKey] }),
  }),
);

/** Feature packs tildados por barrio (capa B bis: funciones dentro de un módulo). */
export const tenantFeatures = sqliteTable(
  "tenant_features",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    featureKey: text("feature_key").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.featureKey] }),
  }),
);

export const sites = sqliteTable("sites", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  name: text("name").notNull(),
  agentToken: text("agent_token"),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const dahuaDevices = sqliteTable("dahua_devices", {
  id: text("id").primaryKey(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(80),
  username: text("username").notNull(),
  password: text("password").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const actuators = sqliteTable("actuators", {
  id: text("id").primaryKey(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("door"),
  driver: text("driver").notNull(),
  dahuaDeviceId: text("dahua_device_id").references(() => dahuaDevices.id),
  dahuaChannel: integer("dahua_channel").notNull().default(1),
  httpUrl: text("http_url"),
  pulseMs: integer("pulse_ms").notNull().default(1000),
  engineSentido: text("engine_sentido"),
  triggerAlpr: integer("trigger_alpr", { mode: "boolean" }).notNull().default(false),
  triggerDahua: integer("trigger_dahua", { mode: "boolean" }).notNull().default(false),
  triggerQr: integer("trigger_qr", { mode: "boolean" }).notNull().default(false),
  triggerManual: integer("trigger_manual", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const cameras = sqliteTable("cameras", {
  id: text("id").primaryKey(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  name: text("name").notNull(),
  rtspUrl: text("rtsp_url").notNull(),
  actuatorId: text("actuator_id").references(() => actuators.id),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const plates = sqliteTable(
  "plates",
  {
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    plate: text("plate").notNull(),
    list: text("list").notNull(),
    note: text("note"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.siteId, t.plate] }),
  }),
);

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  type: text("type").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const commands = sqliteTable("commands", {
  id: text("id").primaryKey(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  action: text("action").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("pending"),
  result: text("result"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const properties = sqliteTable("properties", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  lotNumber: text("lot_number").notNull(),
  label: text("label").notNull(),
  address: text("address"),
  mapLat: text("map_lat"),
  mapLng: text("map_lng"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const ownerProfiles = sqliteTable("owner_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id),
  propertyId: text("property_id")
    .notNull()
    .references(() => properties.id),
  dni: text("dni"),
  phone: text("phone"),
  phoneAlt: text("phone_alt"),
  emergencyName: text("emergency_name"),
  emergencyPhone: text("emergency_phone"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const propertyServices = sqliteTable("property_services", {
  id: text("id").primaryKey(),
  propertyId: text("property_id")
    .notNull()
    .references(() => properties.id),
  role: text("role").notNull(),
  name: text("name").notNull(),
  dni: text("dni"),
  patente: text("patente"),
  phone: text("phone"),
  horaDesde: text("hora_desde"),
  horaHasta: text("hora_hasta"),
  diasSemana: text("dias_semana"),
  notes: text("notes"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const visitAuthorizations = sqliteTable("visit_authorizations", {
  id: text("id").primaryKey(),
  propertyId: text("property_id")
    .notNull()
    .references(() => properties.id),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  kind: text("kind").notNull(),
  guestName: text("guest_name").notNull(),
  guestDni: text("guest_dni"),
  patente: text("patente"),
  fechaDesde: integer("fecha_desde", { mode: "timestamp_ms" }).notNull(),
  fechaHasta: integer("fecha_hasta", { mode: "timestamp_ms" }).notNull(),
  horaDesde: text("hora_desde"),
  horaHasta: text("hora_hasta"),
  diasSemana: text("dias_semana"),
  notes: text("notes"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const visitPasses = sqliteTable("visit_passes", {
  id: text("id").primaryKey(),
  propertyId: text("property_id")
    .notNull()
    .references(() => properties.id),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  authorizationId: text("authorization_id").references(() => visitAuthorizations.id),
  token: text("token").notNull().unique(),
  guestName: text("guest_name").notNull(),
  guestDni: text("guest_dni"),
  patente: text("patente"),
  validFrom: integer("valid_from", { mode: "timestamp_ms" }).notNull(),
  validUntil: integer("valid_until", { mode: "timestamp_ms" }).notNull(),
  horaDesde: text("hora_desde"),
  horaHasta: text("hora_hasta"),
  status: text("status").notNull().default("active"),
  scannedInAt: integer("scanned_in_at", { mode: "timestamp_ms" }),
  scannedOutAt: integer("scanned_out_at", { mode: "timestamp_ms" }),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
