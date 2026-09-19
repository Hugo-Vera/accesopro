import { and, desc, eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { guardApprovals, ownerNotices, properties } from "./db/schema.js";
import { broadcastRealtimeEvent } from "./eventStream.js";
import { nid } from "./scope.js";

export type OwnerNoticeKind = "walk_in" | "goods" | "minor_transfer";

export async function expireOwnerNotices(now = new Date()) {
  const pending = await db.select().from(ownerNotices).where(eq(ownerNotices.status, "pending"));
  const t = now.getTime();
  for (const row of pending) {
    const exp = row.expiresAt instanceof Date ? row.expiresAt.getTime() : Number(row.expiresAt || 0);
    if (!exp || exp > t) continue;
    await db.update(ownerNotices).set({ status: "expired" }).where(eq(ownerNotices.id, row.id));
    if (row.approvalId && row.kind === "walk_in") {
      await db
        .update(guardApprovals)
        .set({ ownerAuthStatus: "owner_expired" })
        .where(and(eq(guardApprovals.id, row.approvalId), eq(guardApprovals.ownerAuthStatus, "pending_owner")));
    }
  }
}

export async function createOwnerNotice(input: {
  siteId: string;
  tenantId?: string | null;
  propertyId: string;
  passId?: string | null;
  approvalId?: string | null;
  kind: OwnerNoticeKind;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
  ttlMs: number;
}) {
  await expireOwnerNotices();
  const now = new Date();
  const id = nid();
  await db.insert(ownerNotices).values({
    id,
    siteId: input.siteId,
    propertyId: input.propertyId,
    passId: input.passId || null,
    approvalId: input.approvalId || null,
    kind: input.kind,
    status: "pending",
    title: input.title,
    message: input.message,
    payload: input.payload ? JSON.stringify(input.payload) : null,
    expiresAt: new Date(now.getTime() + input.ttlMs),
    createdAt: now,
    decidedAt: null,
    decidedByUserId: null,
  });
  const property = await db.select().from(properties).where(eq(properties.id, input.propertyId)).get();
  broadcastRealtimeEvent({
    id,
    siteId: input.siteId,
    tenantId: input.tenantId ?? undefined,
    type: "owner_notice",
    payload: {
      noticeId: id,
      kind: input.kind,
      propertyId: input.propertyId,
      lotNumber: property?.lotNumber,
      title: input.title,
      passId: input.passId,
      approvalId: input.approvalId,
    },
    createdAt: now.getTime(),
  });
  return id;
}

export async function listOwnerNoticesForProperty(propertyId: string) {
  await expireOwnerNotices();
  return db
    .select()
    .from(ownerNotices)
    .where(eq(ownerNotices.propertyId, propertyId))
    .orderBy(desc(ownerNotices.createdAt))
    .limit(40);
}

export async function decideOwnerNotice(input: {
  noticeId: string;
  propertyId: string;
  userId: string;
  decision: "approved" | "denied";
}): Promise<{ ok: true; kind: string; approvalId: string | null } | { ok: false; error: string }> {
  await expireOwnerNotices();
  const row = await db
    .select()
    .from(ownerNotices)
    .where(and(eq(ownerNotices.id, input.noticeId), eq(ownerNotices.propertyId, input.propertyId)))
    .get();
  if (!row) return { ok: false, error: "Aviso no encontrado" };
  if (row.status !== "pending") return { ok: false, error: "Ese aviso ya se resolvió" };
  const now = new Date();
  await db
    .update(ownerNotices)
    .set({
      status: input.decision === "approved" ? "approved" : "denied",
      decidedAt: now,
      decidedByUserId: input.userId,
    })
    .where(eq(ownerNotices.id, row.id));

  if (row.approvalId) {
    if (row.kind === "walk_in") {
      await db
        .update(guardApprovals)
        .set({
          ownerAuthStatus: input.decision === "approved" ? "owner_approved" : "owner_denied",
          ownerAuthorizedByUserId: input.decision === "approved" ? input.userId : null,
        })
        .where(eq(guardApprovals.id, row.approvalId));
    } else if (row.kind === "goods" && input.decision === "approved") {
      await db
        .update(guardApprovals)
        .set({ goodsAuthorizedByUserId: input.userId })
        .where(eq(guardApprovals.id, row.approvalId));
    } else if (row.kind === "minor_transfer" && input.decision === "approved") {
      await db
        .update(guardApprovals)
        .set({ minorTransferAuthorizedByUserId: input.userId })
        .where(eq(guardApprovals.id, row.approvalId));
    }
  }

  broadcastRealtimeEvent({
    id: nid(),
    siteId: row.siteId,
    type: "owner_notice",
    payload: {
      noticeId: row.id,
      kind: row.kind,
      decided: input.decision,
      approvalId: row.approvalId,
      passId: row.passId,
    },
    createdAt: now.getTime(),
  });
  return { ok: true, kind: row.kind, approvalId: row.approvalId };
}
