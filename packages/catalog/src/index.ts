export type ModuleKey =
  | "core"
  | "actuators"
  | "dahua_access"
  | "visitors"
  | "dni_enroll"
  | "alpr"
  | "panic"
  | "fire"
  | "attendance";

export type ModuleDef = {
  key: ModuleKey;
  name: string;
  summary: string;
  alwaysOn: boolean;
  dependsOn: ModuleKey[];
};

export const MODULE_CATALOG: ModuleDef[] = [
  {
    key: "core",
    name: "Núcleo",
    summary: "Sitios, usuarios, roles, plano del predio, auditoría y KPIs.",
    alwaysOn: true,
    dependsOn: [],
  },
  {
    key: "actuators",
    name: "Actuadores",
    summary: "Relés con nombre: barrera, portón o puerta. Pulso o hold. Dahua o IP.",
    alwaysOn: false,
    dependsOn: [],
  },
  {
    key: "dahua_access",
    name: "Acceso Dahua",
    summary: "Terminales faciales, eventos y openDoor como driver de actuador.",
    alwaysOn: false,
    dependsOn: ["actuators"],
  },
  {
    key: "visitors",
    name: "Visitas",
    summary: "QR firmado para visita, personal o jardinero. Dispara el actuador ligado.",
    alwaysOn: false,
    dependsOn: ["actuators"],
  },
  {
    key: "dni_enroll",
    name: "Alta por DNI",
    summary: "Enrolar con DNI argentino (PDF417 / QR) en portería.",
    alwaysOn: false,
    dependsOn: ["visitors"],
  },
  {
    key: "alpr",
    name: "Chapas (ALPR)",
    summary: "Lecturas de chapa en AccesoPro. Patente en lista blanca dispara el actuador.",
    alwaysOn: false,
    dependsOn: ["actuators"],
  },
  {
    key: "panic",
    name: "Pánico",
    summary: "Pulsadores y SOS en la app. Cola de alarmas sobre el plano.",
    alwaysOn: false,
    dependsOn: [],
  },
  {
    key: "fire",
    name: "Fuego (supervisión)",
    summary: "Contacto del panel existente. No reemplaza el sistema certificado.",
    alwaysOn: false,
    dependsOn: [],
  },
  {
    key: "attendance",
    name: "Fichadas",
    summary: "Asistencia a partir de eventos de los terminales Dahua.",
    alwaysOn: false,
    dependsOn: ["dahua_access"],
  },
];

export type PlanLimits = {
  maxGuards: number;
  maxProperties: number;
  maxOwners: number;
};

export type PlanDef = {
  id: string;
  slug: string;
  name: string;
  summary: string;
  /** Módulos incluidos (además de `core`, siempre on). */
  moduleKeys: ModuleKey[];
  /** Capabilities futuras (Fase 2+). Se guardan en el plan ya. */
  capabilityKeys: string[];
  limits: PlanLimits;
  sortOrder: number;
};

export const PLAN_CATALOG: PlanDef[] = [
  {
    id: "plan_esencial",
    slug: "esencial",
    name: "Esencial",
    summary: "Barreras y plano. Sin ALPR ni portal de visitas.",
    moduleKeys: ["actuators"],
    capabilityKeys: [
      "ops.dashboard",
      "ops.plano",
      "ops.relay",
      "core.config",
      "core.users.read",
      "core.users.write",
      "tenant.grants",
    ],
    limits: { maxGuards: 2, maxProperties: 50, maxOwners: 50 },
    sortOrder: 10,
  },
  {
    id: "plan_acceso_pro",
    slug: "acceso-pro",
    name: "Acceso Pro",
    summary: "ALPR, visitas, Dahua y portal propietario. Plan recomendado.",
    moduleKeys: ["actuators", "dahua_access", "alpr", "visitors"],
    capabilityKeys: [
      "ops.dashboard",
      "ops.plano",
      "ops.relay",
      "ops.alarms",
      "core.config",
      "core.users.read",
      "core.users.write",
      "access.alpr",
      "access.dahua",
      "dahua.events",
      "dahua.open",
      "dahua.persons",
      "dahua.face",
      "dahua.fingerprint",
      "dahua.card",
      "dahua.password",
      "dahua.qr",
      "dahua.schedules",
      "dahua.door",
      "dahua.alarm",
      "dahua.evidence",
      "dahua.live",
      "dahua.intercom",
      "access.visitors.manage",
      "access.owners.invite",
      "staff.employees",
      "tenant.grants",
    ],
    limits: { maxGuards: 5, maxProperties: 200, maxOwners: 200 },
    sortOrder: 20,
  },
  {
    id: "plan_seguridad_total",
    slug: "seguridad-total",
    name: "Seguridad total",
    summary: "Todo el catálogo: pánico, fuego, fichadas, alta DNI y cronogramas.",
    moduleKeys: ["actuators", "dahua_access", "alpr", "visitors", "dni_enroll", "panic", "fire", "attendance"],
    capabilityKeys: [
      "ops.dashboard",
      "ops.plano",
      "ops.relay",
      "ops.alarms",
      "core.config",
      "core.users.read",
      "core.users.write",
      "access.alpr",
      "access.dahua",
      "dahua.events",
      "dahua.open",
      "dahua.persons",
      "dahua.face",
      "dahua.fingerprint",
      "dahua.card",
      "dahua.password",
      "dahua.qr",
      "dahua.schedules",
      "dahua.door",
      "dahua.alarm",
      "dahua.evidence",
      "dahua.live",
      "dahua.intercom",
      "access.visitors.manage",
      "access.owners.invite",
      "access.dni_enroll",
      "access.attendance",
      "staff.employees",
      "staff.schedules",
      "tenant.grants",
    ],
    limits: { maxGuards: 20, maxProperties: 1000, maxOwners: 1000 },
    sortOrder: 30,
  },
];

export function moduleByKey(key: string): ModuleDef | undefined {
  return MODULE_CATALOG.find((m) => m.key === key);
}

export function isModuleKey(value: string): value is ModuleKey {
  return MODULE_CATALOG.some((m) => m.key === value);
}

export function planById(id: string): PlanDef | undefined {
  return PLAN_CATALOG.find((p) => p.id === id);
}

export function planBySlug(slug: string): PlanDef | undefined {
  return PLAN_CATALOG.find((p) => p.slug === slug);
}

export function planIncludesModule(plan: PlanDef, key: string): boolean {
  if (key === "core") return true;
  return plan.moduleKeys.includes(key as ModuleKey);
}

export type CapabilityKey =
  | "ops.dashboard"
  | "ops.plano"
  | "ops.alarms"
  | "ops.relay"
  | "core.config"
  | "core.users.read"
  | "core.users.write"
  | "access.alpr"
  | "access.dahua"
  | "dahua.events"
  | "dahua.open"
  | "dahua.persons"
  | "dahua.face"
  | "dahua.fingerprint"
  | "dahua.card"
  | "dahua.password"
  | "dahua.qr"
  | "dahua.schedules"
  | "dahua.door"
  | "dahua.alarm"
  | "dahua.evidence"
  | "dahua.live"
  | "dahua.intercom"
  | "access.visitors.manage"
  | "access.owners.invite"
  | "access.dni_enroll"
  | "access.attendance"
  | "staff.employees"
  | "staff.schedules"
  | "tenant.grants"
  | "platform.plans"
  | "platform.tenants";

export type CapabilityDef = {
  key: CapabilityKey;
  group: string;
  name: string;
  summary: string;
  /** Módulo que debe estar on (además del grant). */
  moduleKey?: ModuleKey;
};

export const CAPABILITY_CATALOG: CapabilityDef[] = [
  { key: "ops.dashboard", group: "Monitoreo", name: "Dashboard", summary: "Ver KPIs y live del predio." },
  { key: "ops.plano", group: "Monitoreo", name: "Plano", summary: "Ver el plano del predio." },
  { key: "ops.alarms", group: "Monitoreo", name: "Alarmas", summary: "Cola de alarmas (pánico / fuego)." },
  { key: "ops.relay", group: "Monitoreo", name: "Abrir barreras", summary: "Abrir y cerrar actuadores.", moduleKey: "actuators" },
  { key: "core.config", group: "General", name: "Configuración", summary: "Editar motor, actuadores y equipos." },
  { key: "core.users.read", group: "General", name: "Ver usuarios", summary: "Listar usuarios del barrio." },
  { key: "core.users.write", group: "General", name: "Editar usuarios", summary: "Alta y edición de usuarios." },
  { key: "access.alpr", group: "Acceso", name: "Detecciones ALPR", summary: "Ver lecturas de chapas.", moduleKey: "alpr" },
  { key: "access.dahua", group: "Dahua", name: "Equipos Dahua", summary: "Ver y administrar terminales del sitio.", moduleKey: "dahua_access" },
  { key: "dahua.events", group: "Dahua", name: "Eventos faciales", summary: "Cola de accesos y foto al pasar.", moduleKey: "dahua_access" },
  { key: "dahua.open", group: "Dahua", name: "Abrir desde Dahua", summary: "openDoor / relé del terminal.", moduleKey: "dahua_access" },
  { key: "dahua.persons", group: "Dahua", name: "Personas en el lector", summary: "Padrón: quién existe, vigencia y baja.", moduleKey: "dahua_access" },
  { key: "dahua.face", group: "Dahua", name: "Facial", summary: "Desbloqueo por cara y carga de foto.", moduleKey: "dahua_access" },
  { key: "dahua.fingerprint", group: "Dahua", name: "Huella", summary: "Se enrola en el lector. AccesoPro lee el conteo.", moduleKey: "dahua_access" },
  { key: "dahua.card", group: "Dahua", name: "Tarjeta", summary: "Desbloqueo por tarjeta / CardNo.", moduleKey: "dahua_access" },
  { key: "dahua.password", group: "Dahua", name: "Contraseña del lector", summary: "PIN / clave en el ASI.", moduleKey: "dahua_access" },
  { key: "dahua.qr", group: "Dahua", name: "QR en el lector", summary: "QR nativo del ASI (paso por puerta).", moduleKey: "dahua_access" },
  { key: "dahua.schedules", group: "Dahua", name: "Periodos Dahua", summary: "Franjas horarias y festivos del equipo.", moduleKey: "dahua_access" },
  { key: "dahua.door", group: "Dahua", name: "Parámetros de puerta", summary: "Estado normal, pulso y siempre abierto/cerrado.", moduleKey: "dahua_access" },
  { key: "dahua.alarm", group: "Dahua", name: "Alarma del lector", summary: "Forzada / tamper del ASI.", moduleKey: "dahua_access" },
  {
    key: "dahua.evidence",
    group: "Dahua",
    name: "Evidencia del lector",
    summary: "Ver y conservar fotos/eventos copiados del equipo al barrio.",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.live",
    group: "Dahua",
    name: "Live del lector",
    summary: "Video continuo del terminal (substream) en portería.",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.intercom",
    group: "Dahua",
    name: "Intercom SIP",
    summary: "Llamar / contestar por FreePBX local (LAN del barrio).",
    moduleKey: "dahua_access",
  },
  { key: "access.visitors.manage", group: "Acceso", name: "Visitas", summary: "Gestionar visitas y propiedades.", moduleKey: "visitors" },
  { key: "access.owners.invite", group: "Acceso", name: "Invitar propietario", summary: "Alta de vecino (email + WhatsApp) al lote.", moduleKey: "visitors" },
  { key: "access.dni_enroll", group: "Acceso", name: "Alta DNI", summary: "Enrolar con DNI en portería.", moduleKey: "dni_enroll" },
  { key: "access.attendance", group: "Personal", name: "Fichadas", summary: "Asistencia a partir de eventos Dahua.", moduleKey: "attendance" },
  { key: "staff.employees", group: "Personal", name: "Empleados", summary: "Alta de personal del lote (portal)." },
  { key: "staff.schedules", group: "Personal", name: "Cronogramas", summary: "Horarios de servicios (portal)." },
  { key: "tenant.grants", group: "Admin", name: "Otorgar permisos", summary: "Asignar permisos a guardias y vecinos." },
  { key: "platform.plans", group: "Plataforma", name: "Planes", summary: "Asignar planes comerciales." },
  { key: "platform.tenants", group: "Plataforma", name: "Barrios", summary: "Alta y gestión de tenants." },
];

/** Feature packs: funciones de un módulo (config + dashboard + permiso). */
export type FeaturePackDef = {
  key: string;
  parentModule: ModuleKey;
  name: string;
  summary: string;
  capabilityKey: CapabilityKey;
  /** Ruta del dashboard de este pack (si aplica). */
  href?: string;
  /** Encendido por defecto cuando se tilda el módulo padre. */
  defaultOn: boolean;
  sortOrder: number;
};

export const FEATURE_PACK_CATALOG: FeaturePackDef[] = [
  {
    key: "dahua.devices",
    parentModule: "dahua_access",
    name: "Equipos",
    summary: "Alta, probe y vínculo con actuadores.",
    capabilityKey: "access.dahua",
    href: "/dashboard/dahua",
    defaultOn: true,
    sortOrder: 10,
  },
  {
    key: "dahua.events",
    parentModule: "dahua_access",
    name: "Eventos y foto",
    summary: "Cola de accesos faciales/tarjeta/huella y snapshot al pasar.",
    capabilityKey: "dahua.events",
    href: "/dashboard/dahua/eventos",
    defaultOn: true,
    sortOrder: 20,
  },
  {
    key: "dahua.open",
    parentModule: "dahua_access",
    name: "Abrir puerta",
    summary: "Comando openDoor desde el dashboard o reglas.",
    capabilityKey: "dahua.open",
    href: "/dashboard/dahua",
    defaultOn: true,
    sortOrder: 30,
  },
  {
    key: "dahua.persons",
    parentModule: "dahua_access",
    name: "Personas",
    summary: "Padrón en el lector: alta, vigencia y baja. Los métodos (cara, QR, etc.) se venden aparte.",
    capabilityKey: "dahua.persons",
    href: "/dashboard/dahua/personas",
    defaultOn: true,
    sortOrder: 40,
  },
  {
    key: "dahua.face",
    parentModule: "dahua_access",
    name: "Facial",
    summary: "Desbloqueo por cara y carga de foto en portal y dashboard.",
    capabilityKey: "dahua.face",
    href: "/dashboard/dahua/personas",
    defaultOn: true,
    sortOrder: 42,
  },
  {
    key: "dahua.fingerprint",
    parentModule: "dahua_access",
    name: "Huella",
    summary: "Se enrola en el menú del ASI. AccesoPro lee el conteo y da de baja con la persona.",
    capabilityKey: "dahua.fingerprint",
    href: "/dashboard/dahua/personas",
    defaultOn: false,
    sortOrder: 44,
  },
  {
    key: "dahua.card",
    parentModule: "dahua_access",
    name: "Tarjeta",
    summary: "Método tarjeta / CardNo en el ASI.",
    capabilityKey: "dahua.card",
    href: "/dashboard/dahua/personas",
    defaultOn: false,
    sortOrder: 46,
  },
  {
    key: "dahua.password",
    parentModule: "dahua_access",
    name: "Contraseña ASI",
    summary: "PIN / clave en el lector.",
    capabilityKey: "dahua.password",
    href: "/dashboard/dahua/personas",
    defaultOn: false,
    sortOrder: 48,
  },
  {
    key: "dahua.qr",
    parentModule: "dahua_access",
    name: "QR del equipo",
    summary: "QR nativo del ASI: réplica local o pass-through a AccesoPro.",
    capabilityKey: "dahua.qr",
    href: "/dashboard/dahua/qr",
    defaultOn: false,
    sortOrder: 50,
  },
  {
    key: "dahua.schedules",
    parentModule: "dahua_access",
    name: "Periodos",
    summary: "Franjas horarias y días festivos del terminal.",
    capabilityKey: "dahua.schedules",
    href: "/dashboard/dahua/periodos",
    defaultOn: false,
    sortOrder: 60,
  },
  {
    key: "dahua.evidence",
    parentModule: "dahua_access",
    name: "Evidencia",
    summary: "Copiar al barrio eventos y fotos del lector (más retenible que el SD del equipo).",
    capabilityKey: "dahua.evidence",
    href: "/dashboard/dahua/evidencia",
    defaultOn: false,
    sortOrder: 70,
  },
  {
    key: "dahua.live",
    parentModule: "dahua_access",
    name: "Live",
    summary: "Video continuo por substream. No usa el main stream para no cargar el ASI.",
    capabilityKey: "dahua.live",
    href: "/dashboard/dahua/live",
    defaultOn: false,
    sortOrder: 80,
  },
  {
    key: "dahua.intercom",
    parentModule: "dahua_access",
    name: "Intercom",
    summary: "Softphone hacia FreePBX/Asterisk en la LAN del barrio. El audio no sale a internet.",
    capabilityKey: "dahua.intercom",
    href: "/dashboard",
    defaultOn: false,
    sortOrder: 90,
  },
  {
    key: "dahua.door",
    parentModule: "dahua_access",
    name: "Parámetros de puerta",
    summary: "Estado de puerta, pulso y siempre abierto/cerrado (instalador).",
    capabilityKey: "dahua.door",
    href: "/dashboard/dahua",
    defaultOn: true,
    sortOrder: 15,
  },
  {
    key: "dahua.alarm",
    parentModule: "dahua_access",
    name: "Alarma del lector",
    summary: "Forzada y tamper del ASI.",
    capabilityKey: "dahua.alarm",
    href: "/dashboard/dahua/eventos",
    defaultOn: false,
    sortOrder: 95,
  },
];

/** Plantillas base por rol (se cruzan con el plan del barrio). */
export const ROLE_TEMPLATES: Record<string, CapabilityKey[]> = {
  platform_admin: CAPABILITY_CATALOG.map((c) => c.key),
  tenant_admin: [
    "ops.dashboard",
    "ops.plano",
    "ops.alarms",
    "ops.relay",
    "core.config",
    "core.users.read",
    "core.users.write",
    "access.alpr",
    "access.dahua",
    "dahua.events",
    "dahua.open",
    "dahua.persons",
    "dahua.face",
    "dahua.fingerprint",
    "dahua.card",
    "dahua.password",
    "dahua.qr",
    "dahua.schedules",
    "dahua.door",
    "dahua.alarm",
    "dahua.evidence",
    "dahua.live",
    "dahua.intercom",
    "access.visitors.manage",
    "access.owners.invite",
    "access.dni_enroll",
    "access.attendance",
    "staff.employees",
    "staff.schedules",
    "tenant.grants",
  ],
  guard: [
    "ops.dashboard",
    "ops.plano",
    "ops.alarms",
    "ops.relay",
    "access.alpr",
    "access.dahua",
    "dahua.events",
    "dahua.open",
    "dahua.evidence",
    "dahua.live",
    "dahua.persons",
    "dahua.face",
    "access.visitors.manage",
    "access.owners.invite",
    "access.dni_enroll",
    "access.attendance",
  ],
  resident: ["staff.employees", "staff.schedules"],
};

export function capabilityByKey(key: string): CapabilityDef | undefined {
  return CAPABILITY_CATALOG.find((c) => c.key === key);
}

export function isCapabilityKey(value: string): value is CapabilityKey {
  return CAPABILITY_CATALOG.some((c) => c.key === value);
}

export function roleTemplate(role: string): CapabilityKey[] {
  return ROLE_TEMPLATES[role] ? [...ROLE_TEMPLATES[role]] : [];
}

export function featureByKey(key: string): FeaturePackDef | undefined {
  return FEATURE_PACK_CATALOG.find((f) => f.key === key);
}

export function featuresForModule(moduleKey: ModuleKey): FeaturePackDef[] {
  return FEATURE_PACK_CATALOG.filter((f) => f.parentModule === moduleKey).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
}

export function isFeatureKey(value: string): boolean {
  return FEATURE_PACK_CATALOG.some((f) => f.key === value);
}

/**
 * Métodos de desbloqueo que se escriben en el nodo `AccessControl` del ASI.
 * El QR no está acá a propósito: vive en el nodo `QRCode` y su toggle
 * (`TransmissionEnable`) es pass-through al back-end, no "habilitar QR".
 */
export const ASI_UNLOCK_METHOD_PACKS = [
  "dahua.face",
  "dahua.fingerprint",
  "dahua.card",
  "dahua.password",
] as const;

/* —— Códigos del campo `Method` del ASI (manual de integración Dahua) —— */

export type AsiMethodKey =
  | "password"
  | "card"
  | "password_after_card"
  | "card_after_password"
  | "remote"
  | "fingerprint"
  | "facial"
  | "qr";

export type AsiMethodDef = {
  code: number;
  key: AsiMethodKey;
  label: string;
  /** `manual`: documentado por Dahua. `observado`: medido en este firmware, sin línea en el manual. */
  source: "manual" | "observado";
};

/**
 * Única fuente de verdad de los códigos que emite el ASI. Nadie más arma su propia tabla.
 * El código del QR no está documentado: se mide en Diagnóstico (eventos crudos del lector)
 * y se declara en `ASI_QR_METHOD_CODE`.
 */
export const METHOD_CODE_ROWS: AsiMethodDef[] = [
  { code: 0, key: "password", label: "Clave PIN", source: "manual" },
  { code: 1, key: "card", label: "Tarjeta", source: "manual" },
  { code: 2, key: "password_after_card", label: "Tarjeta + clave", source: "manual" },
  { code: 3, key: "card_after_password", label: "Clave + tarjeta", source: "manual" },
  { code: 4, key: "remote", label: "Apertura remota", source: "observado" },
  { code: 6, key: "fingerprint", label: "Huella", source: "manual" },
  { code: 15, key: "facial", label: "Rostro", source: "manual" },
];

/** Código de `Method` con el que este firmware reporta el QR. `null` hasta medirlo en el equipo. */
export const ASI_QR_METHOD_CODE: number | null = null;

/**
 * El ASI guarda QR y tarjeta en `AccessControlCard.CardNo`. Ese campo es hexadecimal
 * (0-9A-F, largo par, 4 a 32). Un texto tipo "Hugo" el lector lo marca "código QR inválido"
 * y el CGI responde Bad Request.
 */
export function isAsiCardNo(value: string) {
  const s = value.trim();
  return /^[0-9A-Fa-f]{4,32}$/.test(s) && s.length % 2 === 0;
}

export function normalizeAsiCardNo(value: string) {
  return value.trim().toUpperCase();
}

/** CardNo aleatorio válido para el ASI (8 bytes → 16 hex). */
export function randomAsiCardNo(byteLen = 8) {
  const n = Math.max(2, Math.min(16, byteLen));
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Si el valor ya es hex válido lo deja; si no, genera uno. No usar para un QR que el usuario escribió a propósito. */
export function toAsiCardNo(value: string) {
  const n = normalizeAsiCardNo(value);
  return isAsiCardNo(n) ? n : randomAsiCardNo();
}

/* —— UserType / CardType del padrón del ASI —— */

/**
 * Orden del manual: General, Blocklist, Guest, Patrol, VIP. Confirmar con el volcado crudo del
 * padrón (Diagnóstico → Volcar padrón crudo) antes de cambiarlo: un invitado cargado como
 * `blocklist` entra directo a la lista negra del lector.
 *
 * `guest` es el único tipo que el manual habilita para abrir "dentro de un período o por una
 * cantidad de veces": es el que corresponde a un pase de visita.
 */
export const ASI_USER_TYPES = {
  general: 0,
  blocklist: 1,
  guest: 2,
  patrol: 3,
  vip: 4,
} as const;

export type AsiUserTypeKey = keyof typeof ASI_USER_TYPES;

/** Tipo de tarjeta en `AccessControlCard`. Misma enumeración que `UserType`, mismo pendiente. */
export const ASI_CARD_TYPES = ASI_USER_TYPES;

export function asiMethodByCode(code: unknown): AsiMethodDef | null {
  const raw = String(code ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (ASI_QR_METHOD_CODE !== null && n === ASI_QR_METHOD_CODE) {
    return { code: n, key: "qr", label: "Código QR", source: "observado" };
  }
  return METHOD_CODE_ROWS.find((m) => m.code === n) ?? null;
}

/**
 * Clave del método de un evento. El código crudo manda: así el historial viejo se corrige solo
 * sin reescribir evidencia. El nombre guardado solo se usa cuando no hay código.
 */
export function asiMethodKey(code: unknown, storedName?: unknown): AsiMethodKey | "manual" | "unknown" {
  const hit = asiMethodByCode(code);
  if (hit) return hit.key;
  const name = String(storedName ?? "").trim().toLowerCase();
  if (name === "manual") return "manual";
  if (name === "qr") return "qr";
  const byName = METHOD_CODE_ROWS.find((m) => m.key === name);
  return byName ? byName.key : "unknown";
}

/** Etiqueta del historial. Lo que no está medido se muestra como desconocido, no se adivina. */
export function asiMethodLabel(code: unknown, storedName?: unknown): string {
  const key = asiMethodKey(code, storedName);
  if (key === "manual") return "Manual";
  if (key === "qr") return "Código QR";
  if (key !== "unknown") {
    const hit = METHOD_CODE_ROWS.find((m) => m.key === key);
    if (hit) return hit.label;
  }
  const raw = String(code ?? "").trim();
  return raw ? `Desconocido (código ${raw})` : "Desconocido";
}

/* —— Puntos de acceso (topología del predio; no es un módulo comercial) —— */

/** Sector operativo: agrupa UI/plano sin mezclar módulos. */
export type AccessPointSector = "vehicular" | "peatonal" | "servicio";

export type AccessPointSentido = "in" | "out" | "both";

export type AccessActuatorWireRole = "primary" | "aux";
export type AccessDeviceWireRole = "validator" | "live" | "both";
export type AccessCameraWireRole = "alpr" | "evidence" | "live";

export const ACCESS_POINT_SECTORS: {
  key: AccessPointSector;
  name: string;
  summary: string;
}[] = [
  {
    key: "vehicular",
    name: "Vehicular",
    summary: "Barreras y portones de ingreso/egreso. Suele ligarse a ALPR.",
  },
  {
    key: "peatonal",
    name: "Peatonal",
    summary: "Puertas y torniquetes. Suele ligarse a facial/tarjeta/QR Dahua.",
  },
  {
    key: "servicio",
    name: "Servicio",
    summary: "Accesos auxiliares (basura, mantenimiento, emergencia).",
  },
];

export const ACCESS_POINT_SENTIDOS: {
  key: AccessPointSentido;
  name: string;
}[] = [
  { key: "in", name: "Entrada" },
  { key: "out", name: "Salida" },
  { key: "both", name: "Entrada y salida" },
];

export function isAccessPointSector(v: string): v is AccessPointSector {
  return ACCESS_POINT_SECTORS.some((s) => s.key === v);
}

export function isAccessPointSentido(v: string): v is AccessPointSentido {
  return ACCESS_POINT_SENTIDOS.some((s) => s.key === v);
}

