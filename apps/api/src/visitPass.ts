import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { visitPasses, visitRecords } from "./db/schema.js";

export function qrSecret() {
  return process.env.JWT_SECRET ?? "accesopro-dev";
}

export function makeVisitToken(propertyId: string, passId: string) {
  return createHmac("sha256", qrSecret()).update(`${propertyId}:${passId}`).digest("hex").slice(0, 16).toUpperCase();
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

/** Marca IN/OUT si el QR ya fue aprobado. No abre relés. */
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

export async function scanVisitPass(
  site: { id: string; tenantId?: string | null; lastSeenAt: Date | number | null },
  token: string,
  sentido: "in" | "out",
) {
  const { holdVisitQr } = await import("./visitHold.js");
  const hold = await holdVisitQr({
    siteId: site.id,
    tenantId: site.tenantId,
    cardRaw: token,
    scanChannel: "web",
  });
  if (!hold.held) return { ok: false, error: "QR no encontrado" };
  if (hold.reason === "closed") return { ok: false, error: "QR revocado o denegado" };
  return {
    ok: true,
    held: true,
    valid: true,
    guestName: hold.guestName,
    approvalId: hold.approvalId,
    passId: hold.passId,
    reason: hold.reason,
    sentido: hold.sentido || sentido,
    actuatorsFired: [] as string[],
    accessKind: "visita",
    message:
      hold.reason === "expired"
        ? "El pase está vencido. El guardia tiene que autorizar o denegar."
        : "Identificado. Esperá la aprobación del guardia.",
  };
}
