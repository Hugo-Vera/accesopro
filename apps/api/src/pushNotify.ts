import { createSign } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthUser } from "./auth.js";
import { requireAuth } from "./auth.js";
import { db } from "./db/client.js";
import { ownerProfiles, properties, propertyFamilyMembers, pushDevices, userGrants, users } from "./db/schema.js";
import { nid } from "./scope.js";
import { normalizeArWhatsapp } from "./ownerInvite.js";

type Env = { Variables: { user: AuthUser } };

export const pushApi = new Hono<Env>();

function publicWebOrigin() {
  const env = (process.env.WEB_ORIGIN ?? "").split(",")[0]?.trim().replace(/\/$/, "");
  if (env && /^https:\/\//i.test(env) && !/localhost|127\.0\.0\.1/i.test(env)) return env;
  return (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",")[0]?.trim().replace(/\/$/, "") || "http://localhost:3000";
}

export function firebaseWebConfig() {
  const apiKey = (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || process.env.FIREBASE_WEB_API_KEY || "").trim();
  const projectId = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "").trim();
  const appId = (process.env.NEXT_PUBLIC_FIREBASE_APP_ID || process.env.FIREBASE_WEB_APP_ID || "").trim();
  const messagingSenderId = (process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || process.env.FIREBASE_MESSAGING_SENDER_ID || "").trim();
  const vapidKey = (process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || process.env.FIREBASE_VAPID_KEY || "").trim();
  const authDomain = (process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || process.env.FIREBASE_AUTH_DOMAIN || "").trim();
  if (!apiKey || !projectId || !appId || !messagingSenderId || !vapidKey) return null;
  return { apiKey, projectId, appId, messagingSenderId, vapidKey, authDomain: authDomain || `${projectId}.firebaseapp.com` };
}

pushApi.get("/push/config", (c) => {
  const cfg = firebaseWebConfig();
  return c.json({ firebase: cfg, portalPath: "/portal" });
});

pushApi.post("/push/register", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ token?: string; platform?: string }>();
  const token = String(body.token ?? "").trim();
  const platform = body.platform === "android" ? "android" : "web";
  if (!token || token.length < 20) return c.json({ error: "Falta el token de push" }, 400);
  const now = new Date();
  const existing = await db.select().from(pushDevices).where(eq(pushDevices.token, token)).get();
  if (existing) {
    await db
      .update(pushDevices)
      .set({ userId: user.id, platform, lastSeenAt: now })
      .where(eq(pushDevices.id, existing.id));
    return c.json({ ok: true, id: existing.id });
  }
  const id = nid();
  await db.insert(pushDevices).values({
    id,
    userId: user.id,
    platform,
    token,
    lastSeenAt: now,
    createdAt: now,
  });
  return c.json({ ok: true, id });
});

type LotAdult = {
  userId: string;
  name: string;
  phone: string | null;
  hasFcm: boolean;
};

export async function adultsOfLot(propertyId: string): Promise<LotAdult[]> {
  const property = await db.select().from(properties).where(eq(properties.id, propertyId)).get();
  if (!property) return [];
  const titular = await db.select().from(ownerProfiles).where(eq(ownerProfiles.propertyId, propertyId)).get();
  const family = await db
    .select()
    .from(propertyFamilyMembers)
    .where(and(eq(propertyFamilyMembers.propertyId, propertyId), eq(propertyFamilyMembers.active, true)));
  const ids = new Set<string>();
  if (titular?.userId) ids.add(titular.userId);
  for (const f of family) {
    if (f.userId) ids.add(f.userId);
  }
  if (!ids.size) return [];
  const people = await db.select().from(users).where(inArray(users.id, [...ids]));
  const devices = await db.select().from(pushDevices).where(inArray(pushDevices.userId, [...ids]));
  const withFcm = new Set(devices.map((d) => d.userId));
  return people.map((u) => {
    const fam = family.find((f) => f.userId === u.id);
    const phone = titular?.userId === u.id ? titular.whatsapp || titular.phone : fam?.phone;
    return {
      userId: u.id,
      name: u.name,
      phone: phone || null,
      hasFcm: withFcm.has(u.id),
    };
  });
}

function b64url(buf: Buffer | string) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString("base64url");
}

let cachedGoogleToken: { token: string; exp: number } | null = null;

async function googleAccessToken(): Promise<string | null> {
  const email = (process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const rawKey = (process.env.FIREBASE_PRIVATE_KEY || "").trim().replace(/\\n/g, "\n");
  if (!email || !rawKey) return null;
  if (cachedGoogleToken && cachedGoogleToken.exp - 60 > Date.now() / 1000) return cachedGoogleToken.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3500,
    }),
  );
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${sign.sign(rawKey, "base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!json.access_token) return null;
  cachedGoogleToken = { token: json.access_token, exp: now + (json.expires_in || 3500) };
  return json.access_token;
}

async function sendFcm(token: string, title: string, body: string, data: Record<string, string>) {
  const projectId = (process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
  const access = await googleAccessToken();
  if (!projectId || !access) return false;
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data,
        webpush: { fcmOptions: { link: data.link || `${publicWebOrigin()}/portal` } },
      },
    }),
  });
  return res.ok;
}

async function notifyWhatsappFallback(phone: string | null, text: string) {
  const n = phone ? normalizeArWhatsapp(phone) : null;
  if (!n) return false;
  const hook = (process.env.WHATSAPP_NOTIFY_URL || "").trim();
  if (!hook) return false;
  try {
    const res = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: n, text, waUrl: `https://wa.me/${n}?text=${encodeURIComponent(text)}` }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fanoutLotNotice(input: {
  propertyId: string;
  title: string;
  message: string;
  noticeId: string;
}) {
  const property = await db.select().from(properties).where(eq(properties.id, input.propertyId)).get();
  const lot = property?.lotNumber || "";
  const adults = await adultsOfLot(input.propertyId);
  const origin = publicWebOrigin();
  const portal = `${origin}/portal`;
  const text = `${input.title} (lote ${lot}). ${input.message} Abrí el portal: ${portal}`;
  let fcm = 0;
  let whatsapp = 0;
  for (const adult of adults) {
    const tokens = await db.select().from(pushDevices).where(eq(pushDevices.userId, adult.userId));
    let sent = false;
    for (const d of tokens) {
      const ok = await sendFcm(d.token, input.title, `${lot ? `Lote ${lot} · ` : ""}${input.message}`, {
        noticeId: input.noticeId,
        propertyId: input.propertyId,
        link: portal,
      });
      if (ok) {
        sent = true;
        fcm += 1;
      }
    }
    if (!sent) {
      if (await notifyWhatsappFallback(adult.phone, text)) whatsapp += 1;
    }
  }
  return { fcm, whatsapp, adults: adults.length, waHint: `https://wa.me/?text=${encodeURIComponent(text)}`, link: portal };
}

export async function notifyStaff(input: {
  tenantId?: string | null;
  title: string;
  message: string;
  data?: Record<string, string>;
}) {
  if (!input.tenantId) return { fcm: 0 };
  const staff = await db.select().from(users).where(eq(users.tenantId, input.tenantId));
  const grants = await db
    .select({ userId: userGrants.userId })
    .from(userGrants)
    .where(eq(userGrants.capabilityKey, "access.visitors.manage"));
  const granted = new Set(grants.map((g) => g.userId));
  const ids = staff
    .filter((u) => u.role === "guard" || u.role === "admin" || granted.has(u.id))
    .filter((u) => u.role !== "resident")
    .map((u) => u.id);
  if (!ids.length) return { fcm: 0 };
  const origin = publicWebOrigin();
  const link = `${origin}/dashboard`;
  let fcm = 0;
  const devices = await db.select().from(pushDevices).where(inArray(pushDevices.userId, ids));
  for (const d of devices) {
    const ok = await sendFcm(d.token, input.title, input.message, {
      ...(input.data || {}),
      link,
    });
    if (ok) fcm += 1;
  }
  return { fcm };
}
