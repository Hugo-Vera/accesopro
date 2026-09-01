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
    summary: "Lecturas de AccesoSeguro (FastALPR en la LAN). Patente en lista dispara el actuador.",
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

export function moduleByKey(key: string): ModuleDef | undefined {
  return MODULE_CATALOG.find((m) => m.key === key);
}

export function isModuleKey(value: string): value is ModuleKey {
  return MODULE_CATALOG.some((m) => m.key === value);
}
