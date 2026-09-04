import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { actuators, events, properties, visitPasses } from "./db/schema.js";
import { fireActuator } from "./actuatorExec.js";
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
  if (trimmed.startsWith("ACCESOPRO:V1:")) return trimmed.slice("ACCESOPRO:V1:".length);
  return null;
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

  const acts = await db.select().from(actuators).where(eq(actuators.siteId, site.id));
  const property = await db.select().from(properties).where(eq(properties.id, pass.propertyId)).get();
  const fired: string[] = [];
  for (const a of acts.filter((x) => x.triggerQr && (x.driver !== "engine" || x.engineSentido === sentido))) {
    const r = await fireActuator(site, a.id, "open");
    if (r.ok) fired.push(a.name);
  }

  await db.insert(events).values({
    id: nid(),
    siteId: site.id,
    type: "visit_scan",
    payload: JSON.stringify({
      sentido,
      token,
      guestName: pass.guestName,
      lotNumber: property?.lotNumber,
      patente: pass.patente,
      actuatorsFired: fired,
      accessKind: "visita",
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
