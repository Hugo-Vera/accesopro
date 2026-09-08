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
  deviceType: text("device_type").notNull().default("asi_facial"),
  model: text("model"),
  serialNumber: text("serial_number"),
  location: text("location"),
  lastStatus: text("last_status").notNull().default("unknown"),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
  rtspUrl: text("rtsp_url"),
  host: text("host").notNull(),
  port: integer("port").notNull().default(80),
  username: text("username").notNull(),
  password: text("password").notNull(),
  /** in | out — carril de portería. Sin both: un ASI por sentido. */
  sentido: text("sentido").notNull().default("in"),
  useLive: integer("use_live", { mode: "boolean" }).notNull().default(true),
  useLocalRelay: integer("use_local_relay", { mode: "boolean" }).notNull().default(true),
  /** vehicular | peatonal — tipo de carril; no es la ubicación física. */
  laneSector: text("lane_sector").notNull().default("vehicular"),
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
  /** in | out — carril al momento del pase (no el rol actual del ASI). */
  sentido: text("sentido"),
  /** 1 = entrada, 2 = salida. */
  laneCode: integer("lane_code"),
  accessPointId: text("access_point_id"),
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

/**
 * Punto de acceso = topología del predio (sector vehicular|peatonal|servicio + sentido).
 * No mezcla módulos: solo agrupa cableados. Los módulos (ALPR, Dahua, visitas)
 * se enganchan vía tablas de vínculo reutilizables.
 */
export const accessPoints = sqliteTable("access_points", {
  id: text("id").primaryKey(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  name: text("name").notNull(),
  /** vehicular | peatonal | servicio */
  sector: text("sector").notNull().default("peatonal"),
  /** in | out | both */
  sentido: text("sentido").notNull().default("both"),
  sortOrder: integer("sort_order").notNull().default(0),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  mapX: text("map_x"),
  mapY: text("map_y"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Cableado: punto ↔ actuador (relé físico). */
export const accessPointActuators = sqliteTable(
  "access_point_actuators",
  {
    accessPointId: text("access_point_id")
      .notNull()
      .references(() => accessPoints.id),
    actuatorId: text("actuator_id")
      .notNull()
      .references(() => actuators.id),
    /** primary | aux */
    role: text("role").notNull().default("primary"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accessPointId, t.actuatorId] }),
  }),
);

/** Cableado: punto ↔ equipo Dahua (validador / live). */
export const accessPointDevices = sqliteTable(
  "access_point_devices",
  {
    accessPointId: text("access_point_id")
      .notNull()
      .references(() => accessPoints.id),
    dahuaDeviceId: text("dahua_device_id")
      .notNull()
      .references(() => dahuaDevices.id),
    /** validator | live | both */
    role: text("role").notNull().default("both"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accessPointId, t.dahuaDeviceId] }),
  }),
);

/** Cableado: punto ↔ cámara IP / evidencia / ALPR. */
export const accessPointCameras = sqliteTable(
  "access_point_cameras",
  {
    accessPointId: text("access_point_id")
      .notNull()
      .references(() => accessPoints.id),
    cameraId: text("camera_id")
      .notNull()
      .references(() => cameras.id),
    /** alpr | evidence | live */
    role: text("role").notNull().default("live"),
    /** override opcional de sentido para ALPR (in|out); null = hereda del punto */
    sentido: text("sentido"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accessPointId, t.cameraId] }),
  }),
);

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
  fullName: text("full_name"),
  dni: text("dni"),
  phone: text("phone"),
  phoneAlt: text("phone_alt"),
  emergencyName: text("emergency_name"),
  emergencyPhone: text("emergency_phone"),
  photoBase64: text("photo_base64"),
  dahuaUserId: text("dahua_user_id"),
  dahuaSynced: integer("dahua_synced", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Grupo familiar que reside en el lote/propiedad (con soporte de foto facial) */
export const propertyFamilyMembers = sqliteTable("property_family_members", {
  id: text("id").primaryKey(),
  propertyId: text("property_id")
    .notNull()
    .references(() => properties.id),
  name: text("name").notNull(),
  dni: text("dni"),
  relationship: text("relationship").notNull().default("familiar"),
  phone: text("phone"),
  photoBase64: text("photo_base64"),
  dahuaUserId: text("dahua_user_id"),
  dahuaSynced: integer("dahua_synced", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
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
  photoBase64: text("photo_base64"),
  dahuaUserId: text("dahua_user_id"),
  dahuaSynced: integer("dahua_synced", { mode: "boolean" }).notNull().default(false),
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
  dahuaSynced: integer("dahua_synced", { mode: "boolean" }).notNull().default(false),
  dahuaCardNo: text("dahua_card_no"),
  scannedInAt: integer("scanned_in_at", { mode: "timestamp_ms" }),
  scannedOutAt: integer("scanned_out_at", { mode: "timestamp_ms" }),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const departments = sqliteTable("departments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  dahuaDeptId: text("dahua_dept_id").notNull().default("1"),
  name: text("name").notNull(),
  defaultPeriodIndex: integer("default_period_index").notNull().default(255),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Identidad filiatoria DNI Argentino (normalizada e independiente) */
export const visitorIdentities = sqliteTable("visitor_identities", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  dniNumber: text("dni_number").notNull(),
  tramiteNumber: text("tramite_number"),
  lastName: text("last_name").notNull(),
  firstName: text("first_name").notNull(),
  gender: text("gender"),
  birthDate: text("birth_date"),
  issueDate: text("issue_date"),
  address: text("address"),
  rawPdf417: text("raw_pdf417"),
  phone: text("phone"),
  blacklisted: integer("blacklisted", { mode: "boolean" }).notNull().default(false),
  blacklistReason: text("blacklist_reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Parque automotor identificado por patente única */
export const vehicles = sqliteTable("vehicles", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  plate: text("plate").notNull(),
  brand: text("brand"),
  model: text("model"),
  color: text("color"),
  vehicleType: text("vehicle_type").notNull().default("car"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Pólizas y vigencias de seguro automotor en Argentina (Ley 24.449 / SSN) */
export const vehicleInsurances = sqliteTable("vehicle_insurances", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  vehicleId: text("vehicle_id")
    .notNull()
    .references(() => vehicles.id),
  company: text("company").notNull(),
  policyNumber: text("policy_number").notNull(),
  validFrom: integer("valid_from", { mode: "timestamp_ms" }),
  validUntil: integer("valid_until", { mode: "timestamp_ms" }).notNull(),
  coverageType: text("coverage_type").notNull().default("responsabilidad_civil"),
  cardPhotoUrl: text("card_photo_url"),
  verifiedBy: text("verified_by"),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Licencias nacionales de conducir asociadas a la persona */
export const driverLicenses = sqliteTable("driver_licenses", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  personId: text("person_id")
    .notNull()
    .references(() => visitorIdentities.id),
  licenseNumber: text("license_number").notNull(),
  classes: text("classes").notNull().default("B.1"),
  jurisdiction: text("jurisdiction"),
  validUntil: integer("valid_until", { mode: "timestamp_ms" }).notNull(),
  photoUrl: text("photo_url"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Registro transaccional de visita que cablea y vincula todas las entidades */
export const visitRecords = sqliteTable("visit_records", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  propertyId: text("property_id")
    .notNull()
    .references(() => properties.id),
  personId: text("person_id")
    .notNull()
    .references(() => visitorIdentities.id),
  vehicleId: text("vehicle_id").references(() => vehicles.id),
  insuranceId: text("insurance_id").references(() => vehicleInsurances.id),
  licenseId: text("license_id").references(() => driverLicenses.id),
  visitType: text("visit_type").notNull().default("social"),
  status: text("status").notNull().default("in_site"),
  authorizedBy: text("authorized_by").notNull(),
  passToken: text("pass_token"),
  scannedInAt: integer("scanned_in_at", { mode: "timestamp_ms" }),
  scannedOutAt: integer("scanned_out_at", { mode: "timestamp_ms" }),
  notes: text("notes"),
  createdByUserId: text("created_by_user_id").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});


