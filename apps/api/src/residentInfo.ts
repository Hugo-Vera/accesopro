import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { ownerProfiles, properties, propertyFamilyMembers, propertyServices } from "./db/schema.js";

/** Lo que el guardia necesita ver cuando entra o sale alguien del padrón (titular, familiar, servicio). */
export type ResidentInfo = {
  residentRole: "owner" | "family" | "service";
  residentRoleLabel: string;
  residentName: string | null;
  lotNumber: string | null;
  lotLabel: string | null;
  titularName: string | null;
  titularPhone: string | null;
  residentPhone: string | null;
  residentSchedule: string | null;
  residentNotes: string | null;
};

function cap(s: string | null | undefined) {
  const t = String(s ?? "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

async function lotOf(propertyId: string) {
  const prop = await db.select().from(properties).where(eq(properties.id, propertyId)).get();
  const titular = await db.select().from(ownerProfiles).where(eq(ownerProfiles.propertyId, propertyId)).get();
  const label = prop?.label?.trim() || null;
  return {
    lotNumber: prop?.lotNumber ?? null,
    lotLabel: label && prop && label.toLowerCase() !== `lote ${prop.lotNumber}`.toLowerCase() ? label : null,
    lotNotes: prop?.notes?.trim() || null,
    titular,
  };
}

function schedule(row: { horaDesde?: string | null; horaHasta?: string | null }) {
  if (!row.horaDesde && !row.horaHasta) return null;
  return `${row.horaDesde || "00:00"} a ${row.horaHasta || "23:59"}`;
}

const cache = new Map<string, { at: number; info: ResidentInfo | null }>();
const TTL_MS = 20_000;

export async function residentInfoFor(dahuaUserId: string | null | undefined): Promise<ResidentInfo | null> {
  const uid = String(dahuaUserId ?? "").trim();
  if (!uid || !/^(own_|fam_|svc_)/.test(uid)) return null;
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.info;
  const info = await resolve(uid);
  cache.set(uid, { at: Date.now(), info });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return info;
}

async function resolve(uid: string): Promise<ResidentInfo | null> {
  const owner = await db.select().from(ownerProfiles).where(eq(ownerProfiles.dahuaUserId, uid)).get();
  if (owner) {
    const lot = await lotOf(owner.propertyId);
    return {
      residentRole: "owner",
      residentRoleLabel: "Propietario",
      residentName: owner.fullName || null,
      lotNumber: lot.lotNumber,
      lotLabel: lot.lotLabel,
      titularName: null,
      titularPhone: null,
      residentPhone: owner.phone || owner.whatsapp || owner.phoneAlt || null,
      residentSchedule: null,
      residentNotes: lot.lotNotes,
    };
  }
  const fam = await db.select().from(propertyFamilyMembers).where(eq(propertyFamilyMembers.dahuaUserId, uid)).get();
  if (fam) {
    const lot = await lotOf(fam.propertyId);
    const rel = cap(fam.relationship);
    return {
      residentRole: "family",
      residentRoleLabel: rel && rel.toLowerCase() !== "familiar" ? `Familiar · ${rel}` : "Familiar",
      residentName: fam.name || null,
      lotNumber: lot.lotNumber,
      lotLabel: lot.lotLabel,
      titularName: lot.titular?.fullName || null,
      titularPhone: lot.titular?.phone || lot.titular?.whatsapp || null,
      residentPhone: fam.phone || null,
      residentSchedule: schedule(fam),
      residentNotes: lot.lotNotes,
    };
  }
  const svc = await db.select().from(propertyServices).where(eq(propertyServices.dahuaUserId, uid)).get();
  if (svc) {
    const lot = await lotOf(svc.propertyId);
    const role = cap(svc.role);
    return {
      residentRole: "service",
      residentRoleLabel: role ? `Personal del lote · ${role}` : "Personal del lote",
      residentName: svc.name || null,
      lotNumber: lot.lotNumber,
      lotLabel: lot.lotLabel,
      titularName: lot.titular?.fullName || null,
      titularPhone: lot.titular?.phone || lot.titular?.whatsapp || null,
      residentPhone: svc.phone || null,
      residentSchedule: schedule(svc),
      residentNotes: [svc.notes?.trim(), lot.lotNotes].filter(Boolean).join(" · ") || null,
    };
  }
  return null;
}

/** Pega los datos del residente al payload del evento sin pisar lo que ya trae. */
export async function stampResidentInfo(payload: Record<string, unknown>, dahuaUserId: string | null | undefined) {
  const info = await residentInfoFor(dahuaUserId);
  if (!info) return;
  payload.dahuaUserId = payload.dahuaUserId || dahuaUserId;
  for (const [k, v] of Object.entries(info)) {
    if (k === "residentName") continue;
    if (v != null && (payload[k] == null || payload[k] === "")) payload[k] = v;
  }
  if (info.residentName && !String(payload.personName ?? "").trim()) payload.personName = info.residentName;
}
