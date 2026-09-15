import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthUser } from "./auth.js";
import { db } from "./db/client.js";
import { personCredentials } from "./db/schema.js";
import { nid, scopedSiteWithModule } from "./scope.js";
import { denyUnlessCapability } from "./grants.js";
import { assertFeature } from "./features.js";
import { enrollPersonOnSiteDevicesWait, removeCardOnSiteDevicesWait, syncStatusForUser } from "./dahuaSite.js";
import { ASI_USER_TYPES, isAsiCardNo, normalizeAsiCardNo, randomAsiCardNo } from "@accesopro/catalog";

type Env = { Variables: { user: AuthUser } };

export type CredentialKind = "card" | "qr" | "pin";

/** El ASI compara el QR contra un string de menos de 128 bytes (manual, 2.13.5). */
export const QR_PAYLOAD_MAX_BYTES = 128;

const KIND_FEATURE: Record<CredentialKind, "dahua.card" | "dahua.qr" | "dahua.password"> = {
  card: "dahua.card",
  qr: "dahua.qr",
  pin: "dahua.password",
};

const KIND_CAPABILITY: Record<CredentialKind, "dahua.card" | "dahua.qr" | "dahua.password"> = {
  card: "dahua.card",
  qr: "dahua.qr",
  pin: "dahua.password",
};

export function isCredentialKind(v: unknown): v is CredentialKind {
  return v === "card" || v === "qr" || v === "pin";
}

export function qrPayloadBytes(payload: string) {
  return new TextEncoder().encode(payload).length;
}

export type CredentialRow = typeof personCredentials.$inferSelect;

export async function listCredentials(siteId: string, dahuaUserId?: string) {
  const where = dahuaUserId
    ? and(eq(personCredentials.siteId, siteId), eq(personCredentials.dahuaUserId, dahuaUserId))
    : eq(personCredentials.siteId, siteId);
  return db.select().from(personCredentials).where(where).orderBy(desc(personCredentials.createdAt));
}

export async function findCredentialByPayload(siteId: string, payload: string, kind?: CredentialKind) {
  const clauses = [eq(personCredentials.siteId, siteId), eq(personCredentials.payload, payload)];
  if (kind) clauses.push(eq(personCredentials.kind, kind));
  return db
    .select()
    .from(personCredentials)
    .where(and(...clauses))
    .get();
}

/** Alta o reemplazo de una credencial del padrón maestro. Devuelve la fila resultante. */
export async function upsertCredential(input: {
  siteId: string;
  dahuaUserId: string;
  kind: CredentialKind;
  payload: string;
  label?: string | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
  maxUses?: number;
  validationMode?: "local" | "passthrough";
}) {
  const payload = input.payload.trim();
  if (!payload) throw new Error("La credencial no puede estar vacía");
  if (input.kind === "qr" && qrPayloadBytes(payload) > QR_PAYLOAD_MAX_BYTES) {
    throw new Error(`El QR no puede pasar de ${QR_PAYLOAD_MAX_BYTES} bytes: el lector no lo compara`);
  }
  const stored =
    input.kind === "card" || (input.kind === "qr" && (input.validationMode ?? "local") === "local")
      ? normalizeAsiCardNo(payload)
      : payload;
  if (input.kind === "card" || ((input.validationMode ?? "local") === "local" && input.kind === "qr")) {
    if (!isAsiCardNo(stored)) {
      throw new Error(
        "El lector solo acepta QR/tarjeta hexadecimal (0-9 A-F, largo par, 4 a 32). Un texto como un nombre lo marca código QR inválido.",
      );
    }
  }
  const existing = await db
    .select()
    .from(personCredentials)
    .where(
      and(
        eq(personCredentials.siteId, input.siteId),
        eq(personCredentials.kind, input.kind),
        eq(personCredentials.payload, stored),
      ),
    )
    .get();
  const values = {
    siteId: input.siteId,
    dahuaUserId: input.dahuaUserId,
    kind: input.kind,
    payload: stored,
    label: input.label ?? null,
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    maxUses: Math.max(0, Math.trunc(input.maxUses ?? 0)),
    validationMode: input.validationMode ?? "local",
    status: "active" as const,
    revokedAt: null,
  };
  if (existing) {
    if (existing.dahuaUserId !== input.dahuaUserId) {
      throw new Error(`Esa credencial ya está asignada a ${existing.dahuaUserId}`);
    }
    await db.update(personCredentials).set(values).where(eq(personCredentials.id, existing.id));
    return { ...existing, ...values };
  }
  const row = { id: nid(), ...values, usedCount: 0, createdAt: new Date() };
  await db.insert(personCredentials).values(row);
  return row;
}

export async function incrementCredentialUse(id: string) {
  const row = await db.select().from(personCredentials).where(eq(personCredentials.id, id)).get();
  if (!row) return null;
  await db
    .update(personCredentials)
    .set({ usedCount: (row.usedCount || 0) + 1 })
    .where(eq(personCredentials.id, id));
  return { ...row, usedCount: (row.usedCount || 0) + 1 };
}

async function replicaCredentialToDevices(
  siteId: string,
  cred: {
    dahuaUserId: string;
    kind: CredentialKind;
    payload: string;
    label?: string | null;
    validFrom?: Date | null;
    validUntil?: Date | null;
    maxUses?: number;
  },
) {
  const others = await listCredentials(siteId, cred.dahuaUserId);
  const cardRow = others.find((c) => c.kind === "card" && c.status === "active");
  const pinRow = others.find((c) => c.kind === "pin" && c.status === "active");
  const cardNo =
    cred.kind === "card" || cred.kind === "qr"
      ? cred.payload
      : cardRow?.payload || cred.dahuaUserId;
  return enrollPersonOnSiteDevicesWait(
    siteId,
    {
      userId: cred.dahuaUserId,
      name: cred.label || cred.dahuaUserId,
      cardNo,
      password: cred.kind === "pin" ? cred.payload : pinRow?.payload || undefined,
      userType:
        cred.dahuaUserId.startsWith("v_") || (cred.kind === "qr" && (cred.maxUses ?? 0) > 0)
          ? ASI_USER_TYPES.guest
          : ASI_USER_TYPES.general,
      useTime: cred.kind === "pin" ? 0 : cred.maxUses ?? 0,
    },
    cred.validFrom || cred.validUntil
      ? { fechaDesde: cred.validFrom ?? undefined, fechaHasta: cred.validUntil ?? undefined }
      : undefined,
  );
}

/** Baja de todas las credenciales de una persona (pase revocado, alguien que se va). */
export async function revokeCredentialsForUser(siteId: string, dahuaUserId: string) {
  await db
    .update(personCredentials)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(
      and(
        eq(personCredentials.siteId, siteId),
        eq(personCredentials.dahuaUserId, dahuaUserId),
        eq(personCredentials.status, "active"),
      ),
    );
}

export async function revokeCredential(siteId: string, id: string) {
  const row = await db
    .select()
    .from(personCredentials)
    .where(and(eq(personCredentials.siteId, siteId), eq(personCredentials.id, id)))
    .get();
  if (!row) return null;
  await db
    .update(personCredentials)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(eq(personCredentials.id, id));
  return row;
}

export const credentialsApi = new Hono<Env>();

credentialsApi.get("/credentials", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "dahua.persons");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const userId = c.req.query("userId")?.trim();
  const rows = await listCredentials(scoped.site.id, userId || undefined);
  return c.json({ credentials: rows });
});

credentialsApi.get("/credentials/sync", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "dahua.persons");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const userId = c.req.query("userId")?.trim();
  if (!userId) return c.json({ error: "Falta userId" }, 400);
  const rows = await syncStatusForUser(userId);
  return c.json({
    sync: rows.filter((r) => r.siteId === scoped.site.id),
  });
});

credentialsApi.post("/credentials", async (c) => {
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{
    userId?: string;
    kind?: string;
    payload?: string;
    label?: string;
    validUntil?: number | string | null;
    maxUses?: number;
    validationMode?: string;
  }>();
  const kind = body.kind;
  if (!isCredentialKind(kind)) return c.json({ error: "Tipo de credencial inválido" }, 400);
  const denied = await denyUnlessCapability(c.get("user"), KIND_CAPABILITY[kind]);
  if (denied) return denied;
  const blocked = await assertFeature(scoped.tenantId, KIND_FEATURE[kind]);
  if (blocked) return c.json({ error: blocked }, 403);
  const userId = String(body.userId || "").trim();
  const validationMode = body.validationMode === "passthrough" ? "passthrough" : "local";
  let payload = String(body.payload || "").trim();
  if (!userId) return c.json({ error: "Falta userId" }, 400);
  if (!payload && kind === "qr" && validationMode === "local") {
    payload = randomAsiCardNo();
  }
  if (!payload) return c.json({ error: "Faltan userId y credencial" }, 400);
  const until = body.validUntil ? new Date(body.validUntil) : null;
  try {
    const row = await upsertCredential({
      siteId: scoped.site.id,
      dahuaUserId: userId,
      kind,
      payload,
      label: body.label?.trim() || null,
      validUntil: until && !Number.isNaN(until.getTime()) ? until : null,
      maxUses: Number(body.maxUses ?? 0),
      validationMode,
    });
    let deviceSync: Awaited<ReturnType<typeof replicaCredentialToDevices>> | undefined;
    const replicaLocal = kind === "card" || kind === "pin" || (kind === "qr" && validationMode === "local");
    if (replicaLocal) {
      deviceSync = await replicaCredentialToDevices(scoped.site.id, row);
    }
    return c.json({ ok: true, credential: row, deviceSync });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo guardar" }, 400);
  }
});

credentialsApi.delete("/credentials/:id", async (c) => {
  const scoped = await scopedSiteWithModule(c, "dahua_access");
  if ("error" in scoped) return scoped.error;
  const id = c.req.param("id");
  const row = await db
    .select()
    .from(personCredentials)
    .where(and(eq(personCredentials.siteId, scoped.site.id), eq(personCredentials.id, id)))
    .get();
  if (!row) return c.json({ error: "Credencial no encontrada" }, 404);
  const kind = isCredentialKind(row.kind) ? row.kind : "card";
  const denied = await denyUnlessCapability(c.get("user"), KIND_CAPABILITY[kind]);
  if (denied) return denied;
  await revokeCredential(scoped.site.id, id);
  if (kind === "card" || kind === "qr") {
    try {
      await removeCardOnSiteDevicesWait(scoped.site.id, {
        userId: row.dahuaUserId,
        cardNo: row.payload,
      });
    } catch {
      /* la baja en el padrón maestro ya está */
    }
  }
  return c.json({ ok: true });
});
