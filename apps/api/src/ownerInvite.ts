import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

export function normalizeArWhatsapp(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  let n = digits;
  if (n.startsWith("54")) {
    if (!n.startsWith("549") && n.length >= 12) n = `549${n.slice(2)}`;
  } else if (n.startsWith("9") && n.length >= 11) {
    n = `54${n}`;
  } else if (n.length === 10) {
    n = `549${n}`;
  } else if (n.length === 8) {
    n = `54911${n}`;
  }
  if (n.length < 12 || n.length > 15) return null;
  return n;
}

export function newInviteToken() {
  return randomBytes(24).toString("hex");
}

export function inviteExpiresAt() {
  return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

/** Hash interno: el vecino no lo ve ni lo usa. La clave la arma en /activar. */
export async function unusableInviteHash() {
  return hashPassword(randomBytes(32).toString("hex"));
}

export function activationUrl(base: string, token: string) {
  const root = base.replace(/\/$/, "");
  return `${root}/activar?token=${encodeURIComponent(token)}`;
}

export function inviteShareText(opts: {
  name: string;
  lotNumber: string;
  url: string;
}) {
  const who = opts.name || "vecino";
  return `Hola ${who}, te invitamos al portal de AccesoPro (lote ${opts.lotNumber}). Armá tu clave en este enlace: ${opts.url}`;
}
