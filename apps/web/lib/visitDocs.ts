import {
  ARRIVAL_MODE_CATALOG,
  VISIT_KIND_CATALOG,
  arrivalModeText,
  canonicalArrivalMode,
  canonicalVisitKind,
  entryRuleSections,
  resolveEntryRule,
  visitKindText,
  type ArrivalModeKey,
  type EntryRule,
  type VisitKindKey,
} from "@accesopro/catalog";

export type { EntryRule };

/** Qué pide la ficha: sale de la regla del barrio (Sistema → Reglas de ingreso). */
export type DocReq = ReturnType<typeof entryRuleSections> & { openBarrier: boolean };

export function requirementsFromRule(rule: EntryRule): DocReq {
  return { ...entryRuleSections(rule), openBarrier: rule.openBarrier };
}

/** Sin reglas cargadas usa los valores por defecto del catálogo. */
export function docRequirements(
  visitKind: string | null | undefined,
  arrivalMode: string | null | undefined,
  rules?: EntryRule[] | null,
): DocReq {
  return requirementsFromRule(resolveEntryRule(rules, visitKind, arrivalMode));
}

export const VISIT_KINDS = VISIT_KIND_CATALOG.map((k) => ({ id: k.key, label: k.label }));

export const ARRIVAL_MODES = ARRIVAL_MODE_CATALOG.map((m) => ({ id: m.key, label: m.label }));

export type VisitKindId = VisitKindKey;
export type ArrivalModeId = ArrivalModeKey;

export function normalizeVisitKind(v: string | null | undefined): VisitKindId {
  return canonicalVisitKind(v);
}

export function normalizeArrivalMode(v: string | null | undefined): ArrivalModeId {
  return canonicalArrivalMode(v);
}

export function visitKindLabel(v: string | null | undefined) {
  return visitKindText(v);
}

export function arrivalModeLabel(v: string | null | undefined) {
  return arrivalModeText(v);
}

export function artLabelFor(req: Pick<DocReq, "artLife">) {
  return req.artLife ? "ART o seguro de vida" : "ART";
}

export function personInsuranceKindFor(req: Pick<DocReq, "artLife">): "art" | "life" {
  return req.artLife ? "life" : "art";
}

export type FichaPage = "identity" | "type" | "vehicle" | "art" | "companions" | "exit" | "summary";

/** Etiqueta legible y paso de la ficha para cada faltante o vencido que devuelve la API. */
export function missingInfo(key: string, sentido: string = "in"): { label: string; page: FichaPage } {
  switch (key) {
    case "dni":
      return { label: "Falta DNI", page: "identity" };
    case "patente":
      return { label: "Falta patente", page: "vehicle" };
    case "seguro_vehiculo":
      return { label: "Falta seguro del auto", page: "vehicle" };
    case "seguro_foto":
      return { label: "Falta foto de la tarjeta del seguro", page: "vehicle" };
    case "licencia":
      return { label: "Falta licencia de conducir", page: "vehicle" };
    case "licencia_foto":
      return { label: "Falta foto de la licencia", page: "vehicle" };
    case "art":
      return { label: "Falta ART / seguro de vida", page: "art" };
    case "art_constancia":
      return { label: "Falta foto de la constancia de ART", page: "art" };
    case "baul":
      return { label: "Falta revisar el baúl (descripción o foto)", page: sentido === "out" ? "exit" : "vehicle" };
    case "seguro_vehiculo_vencido":
      return { label: "Seguro del auto vencido", page: "vehicle" };
    case "licencia_vencida":
      return { label: "Licencia vencida", page: "vehicle" };
    case "art_vencido":
      return { label: "ART vencida", page: "art" };
    default:
      return { label: key.replace(/_/g, " "), page: "summary" };
  }
}

export function expiredLabel(key: string) {
  if (key === "seguro_vehiculo") return "Seguro del auto vencido";
  if (key === "licencia") return "Licencia vencida";
  if (key === "art") return "ART vencida";
  return `${key.replace(/_/g, " ")} vencido`;
}

export function isoDay(v: string | number | Date | null | undefined) {
  if (v == null || v === "") return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function fmtDay(v: string | number | Date | null | undefined) {
  const iso = isoDay(v);
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** Portería trabaja en hora argentina aunque el navegador esté en otra zona. */
export const AR_TZ = "America/Argentina/Buenos_Aires";

export function todayAr() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: AR_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function isPastDay(iso: string) {
  if (iso.length < 10) return false;
  return iso < todayAr();
}

/** Instante (pase, ingreso) en hora argentina: dd/mm hh:mm. */
export function fmtStamp(v: string | number | Date | null | undefined) {
  if (v == null || v === "") return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", {
    timeZone: AR_TZ,
    day: "2-digit",
    month: "2-digit",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Edad en años desde AAAA-MM-DD o dd/mm/aaaa (nacimiento del DNI), en día argentino. */
export function ageFrom(birth: string | null | undefined): number | null {
  const s = String(birth || "").trim();
  let y = 0;
  let m = 0;
  let d = 0;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [y, m, d] = [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])];
  else return null;
  const [ty, tm, td] = todayAr().split("-").map(Number);
  let years = ty - y;
  if (tm < m || (tm === m && td < d)) years -= 1;
  return years >= 0 && years <= 130 ? years : null;
}

export function isMinorAge(age: number | null | undefined) {
  return age != null && age < 18;
}

/** Obra / servicio y delivery no ingresan con menores (ni siendo menores). */
export function minorsAllowed(visitKind: string | null | undefined) {
  return canonicalVisitKind(visitKind) === "social";
}

export const MINOR_KIND_TEXT = "Menor de edad: solo puede ingresar como visita";

/** "Solicitar siguientes documentos": solo lo que aplica; el DNI no se repite si ya se leyó. */
export function requiredDocsFor(
  visitKind: string | null | undefined,
  arrivalMode: string | null | undefined,
  dniRead: boolean,
  rules?: EntryRule[] | null,
) {
  const req = docRequirements(visitKind, arrivalMode, rules);
  const docs: string[] = [];
  if (req.dni && !dniRead) docs.push("DNI");
  if (req.art) docs.push(artLabelFor(req));
  if (req.plate) docs.push("Patente");
  if (req.license) docs.push("Licencia");
  if (req.insurance) docs.push("Seguro del vehículo");
  if (req.trunk) docs.push("Revisión de baúl");
  return docs;
}

/** Achica una foto de cámara/archivo a JPEG para no mandar 8 MB por la red. */
export function fileToJpegDataUrl(file: File, maxSide = 1600, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la foto"));
    reader.onload = () => {
      const src = String(reader.result || "");
      const img = new Image();
      img.onerror = () => resolve(src);
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(src);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
