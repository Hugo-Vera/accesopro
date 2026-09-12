import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import { db } from "./db/client.js";
import { sessions, users } from "./db/schema.js";

export const COOKIE = "accesopro_session";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthUser = {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  role: string;
  mustChangePassword?: boolean;
};

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    id: randomBytes(16).toString("hex"),
    userId,
    token,
    expiresAt: new Date(Date.now() + WEEK_MS),
  });
  return token;
}

export function attachCookie(c: Context, token: string) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: WEEK_MS / 1000,
  });
}

export async function userFromToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const row = await db
    .select({
      id: users.id,
      tenantId: users.tenantId,
      email: users.email,
      name: users.name,
      role: users.role,
      mustChangePassword: users.mustChangePassword,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, token))
    .get();
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    name: row.name,
    role: row.role,
    mustChangePassword: Boolean(row.mustChangePassword),
  };
}

export async function requireAuth(c: Context, next: Next) {
  const token =
    getCookie(c, COOKIE) ??
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ??
    c.req.query("token");
  const user = await userFromToken(token);
  if (!user) return c.json({ error: "No autenticado" }, 401);
  c.set("user", user);
  await next();
}

export function requirePlatform(c: Context, next: Next) {
  const user = c.get("user") as AuthUser;
  if (user.role !== "platform_admin") {
    return c.json({ error: "Solo la cuenta de plataforma puede hacer esto" }, 403);
  }
  return next();
}

export async function destroySession(c: Context) {
  const token = getCookie(c, COOKIE);
  if (token) {
    await db.delete(sessions).where(eq(sessions.token, token));
  }
  deleteCookie(c, COOKIE, { path: "/" });
}
