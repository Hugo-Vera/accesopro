import { and, desc, eq } from "drizzle-orm";
import type { EntryRule } from "@accesopro/catalog";
import { db } from "./db/client.js";
import {
  driverLicenses,
  personInsurances,
  sites,
  vehicleInsurances,
  visitPasses,
  visitTrunkChecks,
} from "./db/schema.js";
import { entryRuleFor } from "./entryRules.js";

type PassRow = typeof visitPasses.$inferSelect;
type TrunkCheckRow = typeof visitTrunkChecks.$inferSelect;

export type VisitFieldGaps = { missing: string[]; expired: string[] };

function untilMs(v: Date | number | null | undefined) {
  if (v == null) return 0;
  return v instanceof Date ? v.getTime() : Number(v) || 0;
}

function isPast(v: Date | number | null | undefined, now = Date.now()) {
  const t = untilMs(v);
  return t > 0 && t < now;
}

/** Regla del barrio para el tipo y medio actuales del pase. */
export async function ruleForPass(pass: Pick<PassRow, "siteId" | "visitKind" | "arrivalMode">): Promise<EntryRule> {
  const site = await db.select({ tenantId: sites.tenantId }).from(sites).where(eq(sites.id, pass.siteId)).get();
  return entryRuleFor(site?.tenantId ?? "", pass.visitKind, pass.arrivalMode);
}

export function trunkPhotoIdsOf(row: TrunkCheckRow | null | undefined): string[] {
  if (!row?.photoIds) return [];
  try {
    const v = JSON.parse(row.photoIds) as unknown;
    return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function trunkCheckOf(passId: string, sentido: "in" | "out") {
  return (
    (await db
      .select()
      .from(visitTrunkChecks)
      .where(and(eq(visitTrunkChecks.passId, passId), eq(visitTrunkChecks.sentido, sentido)))
      .orderBy(desc(visitTrunkChecks.updatedAt))
      .get()) ?? null
  );
}

export async function linkedVehicleInsurance(pass: PassRow) {
  if (pass.insuranceId) {
    return (await db.select().from(vehicleInsurances).where(eq(vehicleInsurances.id, pass.insuranceId)).get()) ?? null;
  }
  return null;
}

/** Faltantes y vencidos según la regla del barrio. En la salida no se re-exigen documentos: solo baúl (tilde), bienes y menores en decide. */
export async function visitFieldGaps(passId: string, sentido: "in" | "out" = "in"): Promise<VisitFieldGaps> {
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.id, passId)).get();
  if (!pass) return { missing: ["pase"], expired: [] };
  const missing: string[] = [];
  const expired: string[] = [];
  if (sentido === "out") return { missing, expired };
  const it = (await ruleForPass(pass)).items;
  if (it.dni && !String(pass.guestDni || "").replace(/\D/g, "")) missing.push("dni");
  if (it.patente && !String(pass.patente || "").trim()) missing.push("patente");
  if (it.seguro) {
    const ins = await linkedVehicleInsurance(pass);
    if (!ins?.company || !ins.policyNumber || !ins.validUntil) missing.push("seguro_vehiculo");
    else {
      if (it.seguro_foto && !ins.cardPhotoUrl) missing.push("seguro_foto");
      if (isPast(ins.validUntil)) expired.push("seguro_vehiculo");
    }
  }
  if (it.licencia) {
    const lic = pass.licenseId
      ? await db.select().from(driverLicenses).where(eq(driverLicenses.id, pass.licenseId)).get()
      : null;
    if (!lic?.validUntil) missing.push("licencia");
    else {
      if (it.licencia_foto && !lic.photoUrl) missing.push("licencia_foto");
      if (isPast(lic.validUntil)) expired.push("licencia");
    }
  }
  if (it.art) {
    const pi = pass.personInsuranceId
      ? await db.select().from(personInsurances).where(eq(personInsurances.id, pass.personInsuranceId)).get()
      : null;
    // Un seguro de vida no reemplaza la ART si la regla no lo acepta.
    if (!pi?.validUntil || (pi.kind === "life" && !it.art_vida)) missing.push("art");
    else {
      if (it.art_constancia && !pi.documentPath) missing.push("art_constancia");
      if (isPast(pi.validUntil)) expired.push("art");
    }
  }
  if (it.baul) {
    const trunk = await trunkCheckOf(pass.id, "in");
    if (!trunk || (!String(trunk.description || "").trim() && !trunkPhotoIdsOf(trunk).length)) missing.push("baul");
  }
  return { missing, expired };
}

export function expiredKeyLabel(k: string) {
  return k === "licencia" ? "licencia_vencida" : `${k}_vencido`;
}

export async function missingVisitFields(passId: string, sentido: "in" | "out" = "in"): Promise<string[]> {
  const gaps = await visitFieldGaps(passId, sentido);
  return [...gaps.missing, ...gaps.expired.map(expiredKeyLabel)];
}

/** Seguro o licencia vencidos se resuelven dejando el auto afuera; la ART vencida no tiene salida. */
export function canSwitchToPedestrian(expired: string[]) {
  return expired.length > 0 && !expired.includes("art") && expired.every((k) => k === "seguro_vehiculo" || k === "licencia");
}
