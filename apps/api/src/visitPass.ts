import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { events, properties, visitPasses, visitRecords } from "./db/schema.js";
import { fireActuator } from "./actuatorExec.js";
import { actuatorsForSentido } from "./accessPoints.js";
import { nid } from "./scope.js";

export function qrSecret() {
  return process.env.JWT_SECRET ?? "accesopro-dev";
}

export function makeVisitToken(propertyId: string, passId: string) {
  const sig = createHmac("sha256", qrSecret()).update(`${propertyId}:${passId}`).digest("hex").slice(0, 16);
  return `${passId}.${sig}`;
}

export function parseVisitQrPayload(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("ACCESOPRO:V1:")) return trimmed.slice("ACCESOPRO:V1:".length);
  return trimmed;
}

function ts(v: Date | number | null | undefined): number | null {
  if (v == null) return null;
  return v instanceof Date ? v.getTime() : Number(v) || null;
}

function dwellMs(inAt: Date | number | null | undefined, outAt: Date | number | null | undefined): number | null {
  const a = ts(inAt);
  const b = ts(outAt);
  if (a == null || b == null || b < a) return null;
  return b - a;
}

function laneCodeOf(sentido: "in" | "out"): 1 | 2 {
  return sentido === "out" ? 2 : 1;
}

/**
 * Marca ingreso (carril 1) o egreso (carril 2) de una visita por CardNo/token del ASI.
 * No abre relés: el lector ya pulsó su chapa. Propietarios no matchean pases de visita.
 */
export async function markVisitStayByCard(
  siteId: string,
  cardRaw: string,
  sentido: "in" | "out",
  at: Date,
): Promise<{ passId: string; guestName: string; dwellMs: number | null } | null> {
  const card = parseVisitQrPayload(cardRaw) ?? cardRaw.trim();
  if (!card) return null;
  const rows = await db.select().from(visitPasses).where(eq(visitPasses.siteId, siteId));
  const pass = rows.find((p) => {
    if (p.dahuaCardNo && p.dahuaCardNo === card) return true;
    if (p.token === card) return true;
    if (card.startsWith("v_") && p.id.endsWith(card.slice(2))) return true;
    return false;
  });
  if (!pass) {
    const recs = await db.select().from(visitRecords).where(eq(visitRecords.siteId, siteId));
    const rec = recs.find((r) => r.passToken && (r.passToken === card || card.includes(r.passToken)));
    if (!rec) return null;
    if (sentido === "in") {
      if (!rec.scannedInAt) {
        await db.update(visitRecords).set({ scannedInAt: at, status: "in_site" }).where(eq(visitRecords.id, rec.id));
      }
    } else if (!rec.scannedOutAt) {
      await db
        .update(visitRecords)
        .set({ scannedOutAt: at, status: rec.scannedInAt ? "completed" : rec.status })
        .where(eq(visitRecords.id, rec.id));
    }
    return { passId: rec.id, guestName: "", dwellMs: dwellMs(rec.scannedInAt ?? at, sentido === "out" ? at : rec.scannedOutAt) };
  }
  if (pass.status === "revoked" || pass.status === "cancelled") return null;
  if (sentido === "in") {
    if (!pass.scannedInAt) {
      await db.update(visitPasses).set({ scannedInAt: at }).where(eq(visitPasses.id, pass.id));
    }
  } else if (!pass.scannedOutAt) {
    await db
      .update(visitPasses)
      .set({
        scannedOutAt: at,
        status: pass.scannedInAt || pass.status === "active" ? "completed" : pass.status,
      })
      .where(eq(visitPasses.id, pass.id));
  }
  const inAt = pass.scannedInAt ?? (sentido === "in" ? at : null);
  const outAt = sentido === "out" ? at : pass.scannedOutAt;
  return { passId: pass.id, guestName: pass.guestName, dwellMs: dwellMs(inAt, outAt) };
}

function withinTimeWindow(horaDesde: string | null, horaHasta: string | null, now: Date) {
  if (!horaDesde || !horaHasta) return true;
  const [h1, m1] = horaDesde.split(":").map(Number);
  const [h2, m2] = horaHasta.split(":").map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  const from = h1 * 60 + m1;
  const to = h2 * 60 + m2;
  return mins >= from && mins <= to;
}

export async function scanVisitPass(
  site: { id: string; lastSeenAt: Date | number | null },
  token: string,
  sentido: "in" | "out",
) {
  const pass = await db.select().from(visitPasses).where(eq(visitPasses.token, token)).get();
  if (!pass) return { ok: false, error: "QR no encontrado" };
  if (pass.siteId !== site.id) return { ok: false, error: "QR de otro sitio" };
  if (pass.status !== "active") return { ok: false, error: "QR revocado o usado" };

  const now = new Date();
  if (now < pass.validFrom) return { ok: false, error: "QR todavía no vigente" };
  if (now > pass.validUntil) return { ok: false, error: "QR vencido" };
  if (!withinTimeWindow(pass.horaDesde, pass.horaHasta, now)) {
    return { ok: false, error: "Fuera del horario permitido" };
  }

  if (sentido === "in") {
    if (!pass.scannedInAt) {
      await db.update(visitPasses).set({ scannedInAt: now }).where(eq(visitPasses.id, pass.id));
    }
  } else {
    await db
      .update(visitPasses)
      .set({
        scannedOutAt: now,
        status: pass.scannedInAt ? "completed" : pass.status,
      })
      .where(eq(visitPasses.id, pass.id));
  }

  const property = await db.select().from(properties).where(eq(properties.id, pass.propertyId)).get();
  const fired: string[] = [];
  const targets = await actuatorsForSentido(site.id, sentido);
  for (const a of targets) {
    const r = await fireActuator(site, a.id, "open");
    if (r.ok) fired.push(a.name);
  }

  await db.insert(events).values({
    id: nid(),
    siteId: site.id,
    type: "visit_scan",
    sentido,
    laneCode: laneCodeOf(sentido),
    payload: JSON.stringify({
      sentido,
      laneCode: laneCodeOf(sentido),
      token,
      guestName: pass.guestName,
      lotNumber: property?.lotNumber,
      patente: pass.patente,
      actuatorsFired: fired,
      accessKind: "visita",
      dwellMs: dwellMs(sentido === "in" ? now : pass.scannedInAt, sentido === "out" ? now : pass.scannedOutAt),
    }),
    createdAt: now,
  });

  return {
    ok: true,
    valid: true,
    guestName: pass.guestName,
    lotNumber: property?.lotNumber,
    patente: pass.patente,
    sentido,
    actuatorsFired: fired,
    accessKind: "visita",
  };
}
