/**
 * Tipos de ingreso y reglas de documentación por tipo × medio.
 * Una sola definición para API, web y app: el admin tilda qué se pide y si la barrera abre al aprobar.
 */

export type VisitKindKey = "social" | "service" | "delivery";
export type ArrivalModeKey = "peatonal" | "vehiculo";

export const VISIT_KIND_CATALOG: { key: VisitKindKey; label: string; short: string }[] = [
  { key: "social", label: "Visita", short: "Visita" },
  { key: "service", label: "Obra / Servicio", short: "Obra / Servicio" },
  { key: "delivery", label: "Delivery", short: "Delivery" },
];

export const ARRIVAL_MODE_CATALOG: { key: ArrivalModeKey; label: string }[] = [
  { key: "peatonal", label: "A pie" },
  { key: "vehiculo", label: "Vehículo" },
];

/** `contractor` quedó de antes: es el mismo tipo que `service` (Obra / Servicio). */
export function canonicalVisitKind(v: unknown): VisitKindKey {
  const s = String(v ?? "").trim();
  if (s === "service" || s === "contractor") return "service";
  if (s === "delivery") return "delivery";
  return "social";
}

export function isKnownVisitKind(v: unknown): boolean {
  return v === "social" || v === "service" || v === "contractor" || v === "delivery";
}

/** `plataforma` (remís) cuenta como A pie: el auto no entra. */
export function canonicalArrivalMode(v: unknown): ArrivalModeKey {
  return v === "vehiculo" ? "vehiculo" : "peatonal";
}

export function visitKindText(v: unknown) {
  const k = canonicalVisitKind(v);
  return VISIT_KIND_CATALOG.find((x) => x.key === k)?.label ?? "Visita";
}

export function arrivalModeText(v: unknown) {
  const k = canonicalArrivalMode(v);
  return ARRIVAL_MODE_CATALOG.find((x) => x.key === k)?.label ?? "A pie";
}

export type EntryRuleItemKey =
  | "dni"
  | "patente"
  | "seguro"
  | "seguro_foto"
  | "licencia"
  | "licencia_foto"
  | "art"
  | "art_vida"
  | "art_constancia"
  | "baul";

export type EntryRuleGroup = "identity" | "vehicle" | "person_insurance";

export const ENTRY_RULE_ITEMS: {
  key: EntryRuleItemKey;
  label: string;
  group: EntryRuleGroup;
  /** Solo en reglas de Vehículo. */
  vehicleOnly?: boolean;
  /** Solo se puede tildar si el padre está tildado. */
  parent?: EntryRuleItemKey;
}[] = [
  { key: "dni", label: "DNI", group: "identity" },
  { key: "patente", label: "Patente", group: "vehicle", vehicleOnly: true },
  { key: "seguro", label: "Seguro del vehículo", group: "vehicle", vehicleOnly: true },
  { key: "seguro_foto", label: "Foto de la tarjeta del seguro", group: "vehicle", vehicleOnly: true, parent: "seguro" },
  { key: "licencia", label: "Licencia de conducir", group: "vehicle", vehicleOnly: true },
  { key: "licencia_foto", label: "Foto de la licencia", group: "vehicle", vehicleOnly: true, parent: "licencia" },
  { key: "baul", label: "Revisión del baúl", group: "vehicle", vehicleOnly: true },
  { key: "art", label: "ART", group: "person_insurance" },
  { key: "art_vida", label: "Acepta seguro de vida en lugar de ART", group: "person_insurance", parent: "art" },
  { key: "art_constancia", label: "Foto de la constancia", group: "person_insurance", parent: "art" },
];

export const ENTRY_RULE_GROUP_LABEL: Record<EntryRuleGroup, string> = {
  identity: "Identidad",
  vehicle: "Vehículo",
  person_insurance: "Seguro de la persona",
};

export type EntryRuleItems = Record<EntryRuleItemKey, boolean>;

export type EntryRule = {
  visitKind: VisitKindKey;
  arrivalMode: ArrivalModeKey;
  items: EntryRuleItems;
  /** false = aprobar registra el ingreso sin pulsar el relé (el guardia puede «Abrir igual»). */
  openBarrier: boolean;
};

function emptyItems(): EntryRuleItems {
  return Object.fromEntries(ENTRY_RULE_ITEMS.map((i) => [i.key, false])) as EntryRuleItems;
}

export function defaultEntryRule(kind: unknown, mode: unknown): EntryRule {
  const visitKind = canonicalVisitKind(kind);
  const arrivalMode = canonicalArrivalMode(mode);
  const vehicle = arrivalMode === "vehiculo";
  const items = emptyItems();
  items.dni = true;
  if (vehicle) {
    items.patente = true;
    items.seguro = true;
    items.seguro_foto = true;
    items.licencia = true;
    items.licencia_foto = true;
    items.baul = true;
  }
  if (visitKind === "service") {
    items.art = true;
    items.art_vida = true;
    items.art_constancia = true;
  }
  return { visitKind, arrivalMode, items, openBarrier: vehicle };
}

export const DEFAULT_ENTRY_RULES: EntryRule[] = VISIT_KIND_CATALOG.flatMap((k) =>
  ARRIVAL_MODE_CATALOG.map((m) => defaultEntryRule(k.key, m.key)),
);

/** Limpia tildes incoherentes: foto sin documento, vehículo en A pie. */
export function normalizeEntryRule(rule: {
  visitKind: unknown;
  arrivalMode: unknown;
  items?: Partial<Record<string, unknown>> | null;
  openBarrier?: unknown;
}): EntryRule {
  const base = defaultEntryRule(rule.visitKind, rule.arrivalMode);
  const vehicle = base.arrivalMode === "vehiculo";
  const items = emptyItems();
  for (const def of ENTRY_RULE_ITEMS) {
    const raw = rule.items?.[def.key];
    items[def.key] = typeof raw === "boolean" ? raw : base.items[def.key];
    if (def.vehicleOnly && !vehicle) items[def.key] = false;
  }
  for (const def of ENTRY_RULE_ITEMS) {
    if (def.parent && !items[def.parent]) items[def.key] = false;
  }
  return {
    visitKind: base.visitKind,
    arrivalMode: base.arrivalMode,
    items,
    openBarrier: typeof rule.openBarrier === "boolean" ? rule.openBarrier : base.openBarrier,
  };
}

export function resolveEntryRule(rules: EntryRule[] | null | undefined, kind: unknown, mode: unknown): EntryRule {
  const visitKind = canonicalVisitKind(kind);
  const arrivalMode = canonicalArrivalMode(mode);
  return (
    rules?.find((r) => r.visitKind === visitKind && r.arrivalMode === arrivalMode) ??
    defaultEntryRule(visitKind, arrivalMode)
  );
}

/** Qué secciones arma la ficha a partir de la regla. */
export function entryRuleSections(rule: EntryRule) {
  const it = rule.items;
  return {
    dni: it.dni,
    vehicle: it.patente || it.seguro || it.licencia || it.baul,
    plate: it.patente,
    insurance: it.seguro,
    insurancePhoto: it.seguro_foto,
    license: it.licencia,
    licensePhoto: it.licencia_foto,
    trunk: it.baul,
    art: it.art,
    artLife: it.art_vida,
    artPhoto: it.art_constancia,
  };
}

/** Lista corta legible: «DNI · Patente · Seguro (foto) · ART o seguro de vida». */
export function entryRuleSummary(rule: EntryRule) {
  const it = rule.items;
  const out: string[] = [];
  if (it.dni) out.push("DNI");
  if (it.patente) out.push("Patente");
  if (it.seguro) out.push(it.seguro_foto ? "Seguro con foto" : "Seguro");
  if (it.licencia) out.push(it.licencia_foto ? "Licencia con foto" : "Licencia");
  if (it.baul) out.push("Baúl");
  if (it.art) out.push(`${it.art_vida ? "ART o seguro de vida" : "ART"}${it.art_constancia ? " con constancia" : ""}`);
  return out;
}
