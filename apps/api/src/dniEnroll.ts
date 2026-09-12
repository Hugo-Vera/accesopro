import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "./db/client.js";
import { events } from "./db/schema.js";
import type { AuthUser } from "./auth.js";
import { denyUnlessCapability } from "./grants.js";
import { nid, scopedSiteWithModule } from "./scope.js";
import { enrollPersonOnSiteDevices } from "./dahuaSite.js";

type Env = { Variables: { user: AuthUser } };

export const dniEnrollApi = new Hono<Env>();

/** DNI argentino PDF417/QR: @tramite@apellido@nombre@sexo@dni@ejemplar@fechaNac@... */
export function parseArgentineDni(raw: string) {
  const text = raw.trim();
  if (!text) return null;
  if (text.includes("@")) {
    const chunks = text.split("@");
    const dni = chunks.find((c) => /^\d{7,8}$/.test(c.trim()))?.trim() || "";
    const apellido = (chunks[1] || "").trim();
    const nombre = (chunks[2] || "").trim();
    if (!dni && !apellido) return null;
    return {
      dni,
      apellido,
      nombre,
      fullName: `${apellido} ${nombre}`.trim() || `DNI ${dni}`,
      sexo: (chunks[3] || "").trim(),
      ejemplar: (chunks[5] || "").trim(),
      fechaNac: (chunks[6] || "").trim(),
      raw: text.slice(0, 240),
    };
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 7 && digits.length <= 8) {
    return {
      dni: digits,
      apellido: "",
      nombre: "",
      fullName: `DNI ${digits}`,
      sexo: "",
      ejemplar: "",
      fechaNac: "",
      raw: text.slice(0, 240),
    };
  }
  return null;
}

dniEnrollApi.get("/dni-enroll", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.dni_enroll");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dni_enroll");
  if ("error" in scoped) return scoped.error;
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.siteId, scoped.site.id), eq(events.type, "dni_enroll")))
    .orderBy(desc(events.createdAt))
    .limit(40);
  return c.json({
    records: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
      payload: JSON.parse(row.payload) as unknown,
    })),
  });
});

dniEnrollApi.post("/dni-enroll", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.dni_enroll");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "dni_enroll");
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{ raw?: string; enrollDahua?: boolean }>();
  const parsed = parseArgentineDni(String(body.raw || ""));
  if (!parsed) return c.json({ error: "No se pudo leer el DNI. Pegá el QR/PDF417 o el número." }, 400);

  const id = nid();
  await db.insert(events).values({
    id,
    siteId: scoped.site.id,
    type: "dni_enroll",
    payload: JSON.stringify({
      ...parsed,
      enrolledBy: c.get("user").email,
      dahuaQueued: Boolean(body.enrollDahua),
    }),
    createdAt: new Date(),
  });

  let dahuaCommands: string[] = [];
  if (body.enrollDahua) {
    dahuaCommands = await enrollPersonOnSiteDevices(scoped.site.id, {
      userId: `d${parsed.dni}`.slice(0, 16),
      name: parsed.fullName || parsed.dni,
      cardNo: parsed.dni,
      userType: 0,
    });
  }

  return c.json({ ok: true, id, parsed, dahuaCommands: dahuaCommands.length });
});
