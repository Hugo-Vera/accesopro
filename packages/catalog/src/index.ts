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
  /** Texto del icono i en Configuración → Módulos. */
  help: string;
  alwaysOn: boolean;
  dependsOn: ModuleKey[];
};

export const MODULE_CATALOG: ModuleDef[] = [
  {
    key: "core",
    name: "Núcleo",
    summary: "Sitios, usuarios, roles, plano del predio, auditoría y KPIs.",
    help: "Siempre encendido. Usuarios, plano, auditoría y KPIs del predio. No se apaga ni se vende aparte.",
    alwaysOn: true,
    dependsOn: [],
  },
  {
    key: "actuators",
    name: "Actuadores",
    summary: "Relés con nombre: barrera, portón o puerta. Pulso o hold. Dahua o IP.",
    help: "Relés con nombre libre (barrera, portón, puerta). Pulso o hold. Driver Dahua o IP. El guardia abre los cableados al punto, no un relé suelto del predio.",
    alwaysOn: false,
    dependsOn: [],
  },
  {
    key: "dahua_access",
    name: "Acceso Dahua",
    summary: "Terminales faciales, eventos y openDoor como driver de actuador.",
    help: "Terminales ASI (cara, tarjeta, huella, PIN, QR nativo). Las funciones se tildan aparte en packs. openDoor es el relé del lector, distinto de los actuadores AccesoPro.",
    alwaysOn: false,
    dependsOn: ["actuators"],
  },
  {
    key: "visitors",
    name: "Visitas",
    summary: "QR de visita, cola de portería y portal del lote.",
    help: "Pases QR del titular, cola de portería, walk-in al lote y portal. El QR identifica; no abre solo. Lotes e invitación de vecinos viven acá. No es el QR nativo del ASI.",
    alwaysOn: false,
    dependsOn: ["actuators"],
  },
  {
    key: "dni_enroll",
    name: "Alta por DNI",
    summary: "Enrolar con DNI argentino (PDF417 / QR) en portería.",
    help: "Pistola o cámara de DNI argentino (PDF417 / QR) para empadronar en portería. Requiere el módulo Visitas. No reemplaza el check-in de un invitado con QR.",
    alwaysOn: false,
    dependsOn: ["visitors"],
  },
  {
    key: "alpr",
    name: "Chapas (ALPR)",
    summary: "Lecturas de chapa en AccesoPro. Patente en lista blanca dispara el actuador.",
    help: "Lecturas de patente Mercosur en AccesoPro. Lista blanca puede disparar el actuador del punto. No es un pack Dahua: es módulo propio.",
    alwaysOn: false,
    dependsOn: ["actuators"],
  },
  {
    key: "panic",
    name: "Pánico",
    summary: "Pulsadores y SOS en la app. Cola de alarmas sobre el plano.",
    help: "SOS del portal o app y cola de pánico sobre el plano. Lo ve quien tiene el permiso Alarmas. No es la alarma de tamper del ASI.",
    alwaysOn: false,
    dependsOn: [],
  },
  {
    key: "fire",
    name: "Fuego (supervisión)",
    summary: "Contacto del panel existente. No reemplaza el sistema certificado.",
    help: "Supervisa un contacto del panel contra incendio que ya está en el predio. No es un sistema certificado ni reemplaza Bomberos.",
    alwaysOn: false,
    dependsOn: [],
  },
  {
    key: "attendance",
    name: "Fichadas",
    summary: "Asistencia a partir de eventos de los terminales Dahua.",
    help: "Planilla de ingresos y egresos del personal a partir de eventos Dahua, más carga manual. Hace falta el módulo Dahua y el permiso Fichadas.",
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
      "access.lot.authorize",
      "access.family.manage",
      "ops.census",
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
      "access.lot.authorize",
      "access.family.manage",
      "ops.census",
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
  | "ops.census"
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
  | "access.lot.authorize"
  | "access.family.manage"
  | "access.dni_enroll"
  | "access.attendance"
  | "staff.employees"
  | "staff.schedules"
  | "tenant.grants"
  | "platform.plans"
  | "platform.tenants";

export type CapabilityAudience = "staff" | "resident" | "both";

export type CapabilityDef = {
  key: CapabilityKey;
  group: string;
  name: string;
  summary: string;
  /** Texto del icono i en Sistema → Usuarios. */
  help: string;
  /** staff = dashboard; resident = portal del lote; both = los dos. */
  audience: CapabilityAudience;
  /** Módulo que debe estar on (además del grant). */
  moduleKey?: ModuleKey;
};

export const CAPABILITY_CATALOG: CapabilityDef[] = [
  {
    key: "ops.dashboard",
    group: "Monitoreo",
    name: "Dashboard",
    summary: "Inicio de portería: carriles, KPIs y plano embebido.",
    help: "Pantalla Inicio del guardia: Ingreso, plano y Salida, conteos y toasts. No es el video continuo del ASI (eso es Live del lector). Lo usa portería.",
    audience: "staff",
  },
  {
    key: "ops.plano",
    group: "Monitoreo",
    name: "Plano",
    summary: "Ver el plano del predio.",
    help: "Abre Predio → Plano (mapa OSM o Google, lotes). El admin con Configuración puede dibujar; el guardia solo ve y anuncia visita al lote. No mezcla pánico ni fuego en el permiso.",
    audience: "staff",
  },
  {
    key: "ops.alarms",
    group: "Monitoreo",
    name: "Alarmas",
    summary: "Cola de pánico y fuego.",
    help: "Cola de SOS (pánico) y supervisión de fuego sobre el plano. Hace falta el módulo Pánico o Fuego contratado. No es la alarma de tamper del lector ASI.",
    audience: "staff",
  },
  {
    key: "ops.census",
    group: "Monitoreo",
    name: "Censo de evacuación",
    summary: "Vidas en predio por lote para Bomberos.",
    help: "Conteo de visitas en predio, lote a lote, para Bomberos / Defensa Civil. Pack Censo del módulo Visitas. Si el pack está apagado, tildar esto no abre el menú.",
    audience: "staff",
    moduleKey: "visitors",
  },
  {
    key: "ops.relay",
    group: "Monitoreo",
    name: "Abrir barreras",
    summary: "Abrir y cerrar actuadores AccesoPro.",
    help: "Pulso o hold de relés AccesoPro cableados al punto (barrera, portón, puerta). Distinto de Abrir desde Dahua, que manda openDoor al ASI. Módulo Actuadores.",
    audience: "staff",
    moduleKey: "actuators",
  },
  {
    key: "core.config",
    group: "General",
    name: "Configuración",
    summary: "Módulos, equipos, puntos de acceso y servidor.",
    help: "Configuración → Módulos, actuadores, equipos, puntos de acceso, retención, validez QR y actualizar el servidor. Lo usa el admin del barrio, no el guardia de turno.",
    audience: "staff",
  },
  {
    key: "core.users.read",
    group: "General",
    name: "Ver usuarios",
    summary: "Listar cuentas de staff del barrio.",
    help: "Ver la lista en Sistema → Usuarios (admin y guardias). El propietario no aparece acá: se invita en Personas → Lotes.",
    audience: "staff",
  },
  {
    key: "core.users.write",
    group: "General",
    name: "Editar usuarios",
    summary: "Alta de guardia y código de portería.",
    help: "Crear guardia y cambiar el código para autorizar por teléfono. No invita vecinos. Los tildados de cada guardia los guarda Otorgar permisos.",
    audience: "staff",
  },
  {
    key: "access.alpr",
    group: "Acceso",
    name: "Detecciones ALPR",
    summary: "Ver lecturas de chapas.",
    help: "Portería → Vehículos: lecturas de patente y lista blanca. Módulo Chapas. No controla el relé Dahua.",
    audience: "staff",
    moduleKey: "alpr",
  },
  {
    key: "access.dahua",
    group: "Dahua",
    name: "Equipos Dahua",
    summary: "Alta y prueba de terminales ASI.",
    help: "Instalación → Equipos: alta, probe y vínculo del ASI. Pack Equipos. Si el pack está apagado, tildar esto no abre el menú.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.events",
    group: "Dahua",
    name: "Eventos faciales",
    summary: "Cola de accesos y foto al pasar.",
    help: "Historial de cara, tarjeta, huella y QR del lector, con foto si el agent la copió. Portería lo usa en vivo. Pack Eventos.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.open",
    group: "Dahua",
    name: "Abrir desde Dahua",
    summary: "openDoor del terminal ASI.",
    help: "Comando openDoor / relé del propio ASI. No es Abrir barreras (actuador AccesoPro). Pack Abrir puerta.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.persons",
    group: "Dahua",
    name: "Personas en el lector",
    summary: "Padrón en el ASI: alta, vigencia y baja.",
    help: "Personas → Padrón: quién existe en el lector, vigencia y baja. Cara, tarjeta, PIN y QR se tildan en packs aparte. Pack Personas.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.face",
    group: "Dahua",
    name: "Facial",
    summary: "Desbloqueo por cara y carga de foto.",
    help: "Réplica de foto al ASI (dashboard y portal del titular). Menor de 18 y visita no se enrolan. Pack Facial.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.fingerprint",
    group: "Dahua",
    name: "Huella",
    summary: "Se enrola en el lector. AccesoPro lee el conteo.",
    help: "La huella se carga en el menú del ASI (este firmware no captura por CGI). AccesoPro muestra el conteo y la da de baja con la persona. Pack Huella, apagado por defecto.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.card",
    group: "Dahua",
    name: "Tarjeta",
    summary: "Desbloqueo por tarjeta / CardNo.",
    help: "CardNo hexadecimal en el padrón y réplica al ASI. Pack Tarjeta, apagado por defecto. Un texto suelto el lector lo toma como QR inválido.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.password",
    group: "Dahua",
    name: "Contraseña del lector",
    summary: "PIN / clave en el ASI.",
    help: "PIN del padrón maestro replicado al ASI. Pack Contraseña ASI, apagado por defecto.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.qr",
    group: "Dahua",
    name: "QR en el lector",
    summary: "QR nativo del ASI (no el pase de visita).",
    help: "QR nativo del equipo: réplica local o pass-through a AccesoPro. No es el QR de visita del portal (ese es el módulo Visitas: identifica, no abre solo). Pack QR del equipo, apagado por defecto.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.schedules",
    group: "Dahua",
    name: "Periodos Dahua",
    summary: "Franjas y festivos del terminal.",
    help: "Franjas horarias y días festivos que el ASI aplica offline. Instalación → Periodos. Pack Periodos, apagado por defecto.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.door",
    group: "Dahua",
    name: "Parámetros de puerta",
    summary: "Estado, pulso y siempre abierto/cerrado.",
    help: "Pack de instalador: estado de puerta, pulso y siempre abierto/cerrado. Hoy se consulta el estado en la prueba del equipo; no hay pantalla aparte de siempre abierto. Tildar el grant no inventa esa pantalla.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.alarm",
    group: "Dahua",
    name: "Alarma del lector",
    summary: "Forzada / tamper del ASI.",
    help: "Pack comercial de forzada y tamper del ASI. Todavía no hay cola aparte en el dashboard: los eventos siguen en Eventos si el pack Eventos está on.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.evidence",
    group: "Dahua",
    name: "Evidencia del lector",
    summary: "Fotos copiadas del equipo al barrio.",
    help: "Galería de fotos de pases copiadas del ASI a la SQLite del predio (más retenible que el SD). Pack Evidencia. Si está apagado, no hay pestaña Fotos.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.live",
    group: "Dahua",
    name: "Live del lector",
    summary: "Video continuo del ASI (substream).",
    help: "Video por substream en Instalación → Live. No va en las tres columnas de Inicio (eso satura el ASI). Pack Live, apagado por defecto.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "dahua.intercom",
    group: "Dahua",
    name: "Intercom SIP",
    summary: "Llamar por FreePBX en la LAN del barrio.",
    help: "Softphone hacia FreePBX/Asterisk en la LAN. El audio no sale a internet. Hoy hay un panel de prueba: no llama hasta tener Asterisk local. Pack Intercom, apagado por defecto.",
    audience: "staff",
    moduleKey: "dahua_access",
  },
  {
    key: "access.visitors.manage",
    group: "Acceso",
    name: "Visitas",
    summary: "Cola de portería, check-in y pases QR.",
    help: "Portería: cola ámbar, check-in (DNI y constancias), pases QR y walk-in. No gestiona lotes: eso es Invitar propietario. Módulo Visitas.",
    audience: "staff",
    moduleKey: "visitors",
  },
  {
    key: "access.owners.invite",
    group: "Acceso",
    name: "Invitar propietario",
    summary: "Alta de vecino (email + WhatsApp) al lote.",
    help: "Personas → Lotes: invitar titular con email y WhatsApp (sin clave; la arma en /activar). El guardia invita sobre un lote ya cargado; el admin también da de alta parcelas.",
    audience: "staff",
    moduleKey: "visitors",
  },
  {
    key: "access.lot.authorize",
    group: "Acceso",
    name: "Autorizar lote",
    summary: "Aprobar o denegar avisos de portería del lote.",
    help: "Portal y app del titular o familiar adulto: Autorizar/Denegar el aviso walk-in (120 s) o documentos vencidos. No se tilda al guardia: el guardia abre en portería. Solo portal.",
    audience: "resident",
    moduleKey: "visitors",
  },
  {
    key: "access.family.manage",
    group: "Acceso",
    name: "Familia del lote",
    summary: "Cargar familiares e invitarlos a la app.",
    help: "Portal del titular: grupo familiar, cara (si es mayor de 18) e invitación a la app. El familiar adulto no carga padrón. Solo portal; no se lista al editar un guardia.",
    audience: "resident",
    moduleKey: "visitors",
  },
  {
    key: "access.dni_enroll",
    group: "Acceso",
    name: "Alta DNI",
    summary: "Enrolar con DNI en portería.",
    help: "Pestaña Alta DNI en Visitas: pistola o cámara PDF417/QR. Módulo Alta por DNI. Distinto del check-in de un invitado que ya trae QR.",
    audience: "staff",
    moduleKey: "dni_enroll",
  },
  {
    key: "access.attendance",
    group: "Personal",
    name: "Fichadas",
    summary: "Asistencia a partir de eventos Dahua.",
    help: "Portería → Fichadas: ingresos, egresos y carga manual del personal. Módulo Fichadas (pide Dahua). Sin este permiso la pantalla y la API responden 403.",
    audience: "staff",
    moduleKey: "attendance",
  },
  {
    key: "staff.employees",
    group: "Personal",
    name: "Empleados",
    summary: "Alta de personal del lote (portal).",
    help: "Portal del titular: pestaña Personal y servicios (empleada, jardinero, piletero). No es Fichadas del dashboard. Solo portal.",
    audience: "resident",
  },
  {
    key: "staff.schedules",
    group: "Personal",
    name: "Cronogramas",
    summary: "Horarios de servicios del lote (portal).",
    help: "En el portal, franjas de días y horario del personal de servicio. Sin este permiso se carga la persona pero no el horario. Plan Seguridad total. Solo portal.",
    audience: "resident",
  },
  {
    key: "tenant.grants",
    group: "Admin",
    name: "Otorgar permisos",
    summary: "Asignar permisos a guardias.",
    help: "Guardar los tildados de cada guardia. El admin del barrio usa la plantilla de su rol y no se edita grant a grant. Los vecinos se invitan en Lotes, no acá.",
    audience: "staff",
  },
  {
    key: "platform.plans",
    group: "Plataforma",
    name: "Planes",
    summary: "Asignar planes comerciales.",
    help: "Dueño de plataforma: asignar Esencial / Acceso Pro / Seguridad total al barrio. No es el admin del predio.",
    audience: "staff",
  },
  {
    key: "platform.tenants",
    group: "Plataforma",
    name: "Barrios",
    summary: "Alta y gestión de tenants.",
    help: "Sistema → Barrios en el concentrador: directorio de predios, alta y token. Cuenta de plataforma, no del barrio.",
    audience: "staff",
  },
];

/** Feature packs: funciones de un módulo (config + dashboard + permiso). */
export type FeaturePackDef = {
  key: string;
  parentModule: ModuleKey;
  name: string;
  summary: string;
  help: string;
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
    help: "Alta del ASI, prueba de red y vínculo con actuadores. Lo tilda el admin del barrio. Sin este pack no aparece Instalación → Equipos.",
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
    help: "Cola de pases del lector y foto al pasar. Portería lo ve en Inicio y en Eventos. Si está apagado, el grant Eventos faciales no abre menú.",
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
    help: "openDoor del ASI (relé del terminal). Distinto de los actuadores AccesoPro. Si está apagado, el grant no dispara el comando.",
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
    help: "Quién existe en el ASI, vigencia y baja. Cara, tarjeta, PIN y QR son packs aparte. Sin Personas no hay padrón en el dashboard.",
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
    help: "Foto de cara al ASI (titular y familia mayor de 18). Visita y menor no se enrolan. Apagado = no hay carga de foto.",
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
    help: "La huella se carga en el menú del lector (no hay captura CGI en este firmware). AccesoPro lee el conteo. Apagado por defecto.",
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
    help: "CardNo hexadecimal en el padrón y réplica al ASI. Apagado por defecto.",
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
    help: "PIN del padrón maestro al ASI. Apagado por defecto.",
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
    help: "QR nativo del equipo (réplica o pass-through). No es el QR de visita del portal. Apagado por defecto.",
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
    help: "Franjas y festivos que el ASI aplica offline. Apagado por defecto.",
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
    help: "Fotos de pases copiadas a la SQLite del predio. Sin este pack no hay pestaña Fotos. Apagado por defecto.",
    capabilityKey: "dahua.evidence",
    href: "/dashboard/dahua/eventos?tab=fotos",
    defaultOn: false,
    sortOrder: 70,
  },
  {
    key: "dahua.live",
    parentModule: "dahua_access",
    name: "Live",
    summary: "Video continuo por substream. No usa el main stream para no cargar el ASI.",
    help: "Live RTSP por substream en Instalación → Live, no en las tres columnas de Inicio. Apagado por defecto.",
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
    help: "Llamar por FreePBX en la LAN del barrio. Hoy el panel no llama: falta Asterisk local. Apagado por defecto.",
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
    help: "Pack de instalador. Se consulta el estado en la prueba del equipo; no hay pantalla de siempre abierto/cerrado todavía.",
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
    help: "Pack de forzada y tamper. Todavía no hay cola aparte: si hay eventos, salen en Eventos. Apagado por defecto.",
    capabilityKey: "dahua.alarm",
    href: "/dashboard/dahua/eventos",
    defaultOn: false,
    sortOrder: 95,
  },
  {
    key: "visitors.census",
    parentModule: "visitors",
    name: "Censo de evacuación",
    summary: "Conteo de visitas en predio, lote a lote, para entregar a Bomberos.",
    help: "Censo de evacuación por lote. Sin este pack no aparece Seguridad → Censo.",
    capabilityKey: "ops.census",
    href: "/dashboard/censo",
    defaultOn: true,
    sortOrder: 20,
  },
];

/** Plantillas base por rol (se cruzan con el plan del barrio). */
export const ROLE_TEMPLATES: Record<string, CapabilityKey[]> = {
  platform_admin: CAPABILITY_CATALOG.map((c) => c.key),
  tenant_admin: [
    "ops.dashboard",
    "ops.plano",
    "ops.alarms",
    "ops.census",
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
    "access.lot.authorize",
    "access.family.manage",
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
    "ops.census",
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
  resident: ["access.lot.authorize", "access.family.manage", "staff.employees", "staff.schedules"],
  /** Familiar adulto con login: autoriza el lote, no invita dueños ni carga padrón. */
  family_adult: ["access.lot.authorize"],
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

export {
  NAV_CATALOG,
  navLeafVisible,
  navPathMatches,
  navLeafHrefs,
  visibleNavGroups,
  defaultNavHref,
  opsNavTiles,
  bestNavHref,
  type NavIconKey,
  type NavLeaf,
  type NavGroup,
  type NavCaps,
  type VisibleNavGroup,
  type OpsNavTile,
} from "./nav";

export {
  VISIT_KIND_CATALOG,
  ARRIVAL_MODE_CATALOG,
  ENTRY_RULE_ITEMS,
  ENTRY_RULE_GROUP_LABEL,
  DEFAULT_ENTRY_RULES,
  canonicalVisitKind,
  canonicalArrivalMode,
  isKnownVisitKind,
  visitKindText,
  arrivalModeText,
  defaultEntryRule,
  normalizeEntryRule,
  resolveEntryRule,
  entryRuleSections,
  entryRuleSummary,
  type VisitKindKey,
  type ArrivalModeKey,
  type EntryRuleItemKey,
  type EntryRuleGroup,
  type EntryRuleItems,
  type EntryRule,
} from "./entryRules";

