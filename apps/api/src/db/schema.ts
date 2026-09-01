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
