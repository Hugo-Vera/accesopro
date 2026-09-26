import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  /** PIN de portería: autorizar por llamada al titular. Editable en Usuarios. */
  guardCode: text("guard_code"),
  inviteToken: text("invite_token"),
  inviteExpiresAt: integer("invite_expires_at", { mode: "timestamp_ms" }),
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

/** Directorio del concentrador: cada fila apunta a un Ubuntu/predio con su propia SQLite. */
export const hubSites = sqliteTable("hub_sites", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  planId: text("plan_id").notNull(),
  baseUrl: text("base_url").notNull(),
  cloudUrl: text("cloud_url"),
  hubToken: text("hub_token").notNull().unique(),
  adminName: text("admin_name").notNull(),
  adminEmail: text("admin_email").notNull(),
  /** bcrypt; solo para reintentar bootstrap si el predio estaba offline. */
  adminPasswordHash: text("admin_password_hash"),
  status: text("status").notNull().default("pending"),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
  lastSnapshotJson: text("last_snapshot_json"),
  /** Tenant sombra en esta SQLite (precarga / replica). */
  replicaTenantId: text("replica_tenant_id").references(() => tenants.id),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp_ms" }),
  lastSyncJson: text("last_sync_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const sites = sqliteTable("sites", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  name: text("name").notNull(),
  agentToken: text("agent_token"),
  /** Token del concentrador para snapshot/bootstrap (distinto del agent Dahua). */
  hubToken: text("hub_token"),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
  /** Centro del plano OSM (lat/lng WGS84). */
  mapLat: text("map_lat"),
  mapLng: text("map_lng"),
  mapZoom: integer("map_zoom"),
  /** Giro del plano en grados (0 = norte arriba). */
  mapBearing: integer("map_bearing"),
  /** 1 si el admin guardó centro/zoom/giro (no pisar con fit de lotes). */
  mapViewSaved: integer("map_view_saved", { mode: "boolean" }),
  /** Capas KML importadas (JSON: OverlayLayer[]). */
  mapOverlays: text("map_overlays"),
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
  /** Puerto RTSP público (554 de fábrica; en NAT el desvío, ej. 8554). */
  rtspPort: integer("rtsp_port").notNull().default(554),
  /** Puerto SmartPSS / SDK (37777 de fábrica; en NAT el desvío). */
  pssPort: integer("pss_port").notNull().default(37777),
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
  /** GeoJSON Polygon del lote (coordenadas [lng, lat]). */
  lotPolygon: text("lot_polygon"),
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
  whatsapp: text("whatsapp"),
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
  /** YYYY-MM-DD. Menor de 18: no se manda cara al ASI. */
  birthDate: text("birth_date"),
  fechaDesde: integer("fecha_desde", { mode: "timestamp_ms" }),
  fechaHasta: integer("fecha_hasta", { mode: "timestamp_ms" }),
  horaDesde: text("hora_desde"),
  horaHasta: text("hora_hasta"),
  diasSemana: text("dias_semana"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  /** Login de app/portal si el titular lo invitó (adultos). */
  userId: text("user_id").references(() => users.id),
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
  fechaDesde: integer("fecha_desde", { mode: "timestamp_ms" }),
  fechaHasta: integer("fecha_hasta", { mode: "timestamp_ms" }),
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
  /** preauthorized | awaiting_entry | in_site | awaiting_exit | temp_out | completed | denied | expired | revoked | active (legacy) */
  status: text("status").notNull().default("preauthorized"),
  /** peatonal | plataforma | vehiculo */
  arrivalMode: text("arrival_mode").notNull().default("peatonal"),
  /** social | service | delivery (`contractor` legado = service: canonicalVisitKind) */
  visitKind: text("visit_kind").notNull().default("social"),
  /** basic | full */
  completeness: text("completeness").notNull().default("basic"),
  vehicleId: text("vehicle_id").references(() => vehicles.id),
  insuranceId: text("insurance_id").references(() => vehicleInsurances.id),
  personInsuranceId: text("person_insurance_id").references(() => personInsurances.id),
  licenseId: text("license_id").references(() => driverLicenses.id),
  visitRecordId: text("visit_record_id"),
  notes: text("notes"),
  dahuaSynced: integer("dahua_synced", { mode: "boolean" }).notNull().default(false),
  dahuaCardNo: text("dahua_card_no"),
  scannedInAt: integer("scanned_in_at", { mode: "timestamp_ms" }),
  scannedOutAt: integer("scanned_out_at", { mode: "timestamp_ms" }),
  /** Menores vistos en el ingreso (solo cantidad, sin identificar). */
  minorsInCount: integer("minors_in_count").notNull().default(0),
  /** in | out_temp | out. Solo tiene sentido después del primer ingreso. */
  guestPresence: text("guest_presence").notNull().default("in"),
  /** Menores que salieron con "Sale y vuelve" (default del reingreso). */
  minorsOutTemp: integer("minors_out_temp").notNull().default(0),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const visitCompanions = sqliteTable("visit_companions", {
  id: text("id").primaryKey(),
  passId: text("pass_id")
    .notNull()
    .references(() => visitPasses.id),
  name: text("name").notNull(),
  dni: text("dni"),
  birthDate: text("birth_date"),
  isMinor: integer("is_minor", { mode: "boolean" }).notNull().default(false),
  /** acompanante | queda_a_jugar | traslado */
  situation: text("situation").notNull().default("acompanante"),
  /** in | out_temp | out */
  presence: text("presence").notNull().default("in"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const guardApprovals = sqliteTable("guard_approvals", {
  id: text("id").primaryKey(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  passId: text("pass_id")
    .notNull()
    .references(() => visitPasses.id),
  /** in | out */
  sentido: text("sentido").notNull(),
  /** ok | expired | incomplete */
  reason: text("reason").notNull().default("ok"),
  /** pending | approved | denied */
  status: text("status").notNull().default("pending"),
  trunkChecked: integer("trunk_checked", { mode: "boolean" }).notNull().default(false),
  comment: text("comment"),
  guardUserId: text("guard_user_id").references(() => users.id),
  deviceId: text("device_id"),
  /** totem | web | app */
  scanChannel: text("scan_channel"),
  scannedByUserId: text("scanned_by_user_id").references(() => users.id),
  /** login | guard_code */
  approvedVia: text("approved_via"),
  phoneAuthVia: text("phone_auth_via"),
  /** Carril del lector ASI si el QR se presentó en un tótem (puede diferir del sentido de la visita). */
  readerSentido: text("reader_sentido"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
  /** none | pending_owner | owner_approved | owner_denied | owner_expired */
  ownerAuthStatus: text("owner_auth_status").notNull().default("none"),
  ownerAuthExpiresAt: integer("owner_auth_expires_at", { mode: "timestamp_ms" }),
  ownerAuthorizedByUserId: text("owner_authorized_by_user_id").references(() => users.id),
  goodsAlert: integer("goods_alert", { mode: "boolean" }).notNull().default(false),
  goodsDescription: text("goods_description"),
  goodsPhotoPath: text("goods_photo_path"),
  goodsAuthorizedByUserId: text("goods_authorized_by_user_id").references(() => users.id),
  exitAdultsCount: integer("exit_adults_count"),
  exitMinorsCount: integer("exit_minors_count"),
  /** Cantidad de menores observada en esta presentación (ingreso o egreso). */
  minorsCount: integer("minors_count"),
  minorsMismatchNotified: integer("minors_mismatch_notified", { mode: "boolean" }).notNull().default(false),
  originPropertyId: text("origin_property_id").references(() => properties.id),
  minorTransferAuthorizedByUserId: text("minor_transfer_authorized_by_user_id").references(() => users.id),
  /** JSON { guest, companionIds, vehicle } de quién cruza en esta presentación (salida o reingreso). */
  exitPeople: text("exit_people"),
  /** Salida con "Sale y vuelve". */
  returns: integer("returns", { mode: "boolean" }).notNull().default(false),
  /** Ingreso de alguien que había salido con "Sale y vuelve". */
  reentry: integer("reentry", { mode: "boolean" }).notNull().default(false),
});

/** Revisión de baúl por pase y sentido: descripción + fotos en data/evidence/<site>/trunk-<id>-<n>.jpg */
export const visitTrunkChecks = sqliteTable("visit_trunk_checks", {
  id: text("id").primaryKey(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  passId: text("pass_id")
    .notNull()
    .references(() => visitPasses.id),
  approvalId: text("approval_id").references(() => guardApprovals.id),
  /** in | out */
  sentido: text("sentido").notNull(),
  description: text("description"),
  /** JSON string[] con los ids de foto */
  photoIds: text("photo_ids").notNull().default("[]"),
  guardUserId: text("guard_user_id").references(() => users.id),
  /** 0 = primer cruce; cada sale y vuelve suma una vuelta. */
  round: integer("round").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
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

/** Seguro de vida / ART de la persona (técnicos y obra). Constancia en disco. */
export const personInsurances = sqliteTable("person_insurances", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  personId: text("person_id")
    .notNull()
    .references(() => visitorIdentities.id),
  /** life = seguro de vida; art = ART */
  kind: text("kind").notNull().default("life"),
  company: text("company"),
  policyNumber: text("policy_number"),
  validUntil: integer("valid_until", { mode: "timestamp_ms" }).notNull(),
  documentPath: text("document_path"),
  documentMime: text("document_mime"),
  source: text("source").notNull().default("upload"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
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
  personInsuranceId: text("person_insurance_id").references(() => personInsurances.id),
  licenseId: text("license_id").references(() => driverLicenses.id),
  visitType: text("visit_type").notNull().default("social"),
  /** awaiting_entry | in_site | awaiting_exit | completed | denied */
  status: text("status").notNull().default("awaiting_entry"),
  authorizedBy: text("authorized_by").notNull(),
  passToken: text("pass_token"),
  scannedInAt: integer("scanned_in_at", { mode: "timestamp_ms" }),
  scannedOutAt: integer("scanned_out_at", { mode: "timestamp_ms" }),
  notes: text("notes"),
  createdByUserId: text("created_by_user_id").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Plantilla AccessTimeSchedule reutilizada por huella de horario. */
export const dahuaPeriodSlots = sqliteTable("dahua_period_slots", {
  id: text("id").primaryKey(),
  deviceId: text("device_id")
    .notNull()
    .references(() => dahuaDevices.id),
  fingerprint: text("fingerprint").notNull(),
  periodIndex: integer("period_index").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Padrón maestro de credenciales. AccesoPro es el dueño de la verdad y el ASI recibe una copia.
 * Tarjeta y QR son credenciales distintas (el ASI las trata en nodos distintos), no el mismo número.
 * Una persona admite varias: el lector soporta hasta 5 tarjetas, 3 huellas y 2 caras.
 */
export const personCredentials = sqliteTable(
  "person_credentials",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => sites.id),
    /** UserID de la persona en el padrón del lector. */
    dahuaUserId: text("dahua_user_id").notNull(),
    /** card | qr | pin */
    kind: text("kind").notNull(),
    /** Lo que el lector coteja: CardNo, string del QR o PIN. */
    payload: text("payload").notNull(),
    label: text("label"),
    validFrom: integer("valid_from", { mode: "timestamp_ms" }),
    validUntil: integer("valid_until", { mode: "timestamp_ms" }),
    /** Usos permitidos; 0 = sin límite. Viaja al equipo como UseTime. */
    maxUses: integer("max_uses").notNull().default(0),
    usedCount: integer("used_count").notNull().default(0),
    /** local = decide el lector con su copia. passthrough = el lector consulta a AccesoPro. */
    validationMode: text("validation_mode").notNull().default("local"),
    /** active | revoked */
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (t) => ({
    uniqPayload: uniqueIndex("person_credentials_payload_uq").on(t.siteId, t.kind, t.payload),
  }),
);

/** Resultado de enroll por lector (ingreso / salida). */
export const credentialDeviceSync = sqliteTable("credential_device_sync", {
  id: text("id").primaryKey(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  dahuaUserId: text("dahua_user_id").notNull(),
  deviceId: text("device_id")
    .notNull()
    .references(() => dahuaDevices.id),
  status: text("status").notNull().default("pending"),
  lastError: text("last_error"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
});

/** Avisos al titular del lote (walk-in, QR preautorizado, bien no registrado, traslado de menor). */
export const ownerNotices = sqliteTable("owner_notices", {
  id: text("id").primaryKey(),
  siteId: text("site_id")
    .notNull()
    .references(() => sites.id),
  propertyId: text("property_id")
    .notNull()
    .references(() => properties.id),
  passId: text("pass_id").references(() => visitPasses.id),
  approvalId: text("approval_id").references(() => guardApprovals.id),
  /** walk_in | goods | minor_transfer | visit_qr | expired_docs */
  kind: text("kind").notNull(),
  /** pending | approved | denied | expired */
  status: text("status").notNull().default("pending"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  payload: text("payload"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
  decidedByUserId: text("decided_by_user_id").references(() => users.id),
});

/** Retención comercial por barrio (días). 0 = no purgar. */
export const tenantSettings = sqliteTable("tenant_settings", {
  tenantId: text("tenant_id")
    .primaryKey()
    .references(() => tenants.id),
  retentionDays: integer("retention_days").notNull().default(90),
  /** Validez del QR de visita si el titular no arma ventana. 4|8|12|24|48|72. */
  visitAuthDefaultHours: integer("visit_auth_default_hours").notNull().default(24),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Regla de ingreso por tipo × medio (Sistema → Reglas de ingreso). Sin fila = valores por defecto del catálogo. */
export const tenantEntryRules = sqliteTable(
  "tenant_entry_rules",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    /** social | service | delivery */
    visitKind: text("visit_kind").notNull(),
    /** peatonal | vehiculo */
    arrivalMode: text("arrival_mode").notNull(),
    /** JSON { dni: true, patente: false, … } (EntryRuleItemKey → boolean). */
    items: text("items").notNull(),
    openBarrier: integer("open_barrier", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.visitKind, t.arrivalMode] }),
  }),
);

/** Tokens FCM (web / Android) por usuario del lote. */
export const pushDevices = sqliteTable(
  "push_devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    platform: text("platform").notNull().default("web"),
    token: text("token").notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({ tokenUq: uniqueIndex("push_devices_token_uq").on(t.token) }),
);

