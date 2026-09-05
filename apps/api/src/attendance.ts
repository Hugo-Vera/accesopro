import { and, desc, eq, inArray, gte, lte } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "./db/client.js";
import { events } from "./db/schema.js";
import { nid, scopedSiteWithModule } from "./scope.js";
import type { AuthUser } from "./auth.js";

type AttendanceEnv = { Variables: { user: AuthUser } };

export const attendanceApi = new Hono<AttendanceEnv>();

export type NormalizedAttendance = {
  id: string;
  timestamp: number;
  dateStr: string;
  timeStr: string;
  personName: string;
  personId: string;
  direction: "in" | "out";
  method: "facial" | "card" | "fingerprint" | "qr" | "manual" | "password" | "other";
  device: string;
  authorized: boolean;
  notes?: string;
};

function parseMethod(rawMethod: unknown): NormalizedAttendance["method"] {
  const m = String(rawMethod ?? "").trim();
  if (m === "15" || m.toLowerCase().includes("face") || m.toLowerCase().includes("facial")) return "facial";
  if (m === "1" || m.toLowerCase().includes("card") || m.toLowerCase().includes("tarjeta")) return "card";
  if (m === "2" || m.toLowerCase().includes("finger") || m.toLowerCase().includes("huella")) return "fingerprint";
  if (m === "6" || m.toLowerCase().includes("qr")) return "qr";
  if (m === "3" || m.toLowerCase().includes("pass") || m.toLowerCase().includes("pin")) return "password";
  if (m.toLowerCase().includes("manual")) return "manual";
  return "other";
}

function parseDirection(rawType: unknown, rawState: unknown, rawSentido: unknown): "in" | "out" {
  const s = String(rawSentido ?? "").toLowerCase();
  if (s === "out" || s === "salida") return "out";
  if (s === "in" || s === "entrada" || s === "ingreso") return "in";

  const t = String(rawType ?? "").toLowerCase();
  if (t.includes("exit") || t.includes("salida")) return "out";
  if (t.includes("entry") || t.includes("entrada") || t.includes("ingreso")) return "in";

  const state = String(rawState ?? "");
  if (state === "1") return "out";
  return "in";
}

attendanceApi.get("/attendance", async (c) => {
  const scoped = await scopedSiteWithModule(c, "attendance");
  if ("error" in scoped) return scoped.error;

  const siteId = scoped.site.id;
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");

  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.siteId, siteId),
        inArray(events.type, ["dahua_access", "manual_attendance", "dni_access", "qr_access"]),
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(400);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfDayTs = startOfDay.getTime();

  let totalToday = 0;
  let entriesToday = 0;
  let exitsToday = 0;
  const lastStateTodayByPerson: Record<string, "in" | "out"> = {};

  const normalized: NormalizedAttendance[] = [];

  for (const row of rows) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }

    const ts =
      typeof row.createdAt === "number"
        ? row.createdAt
        : row.createdAt instanceof Date
          ? row.createdAt.getTime()
          : Number(row.createdAt) || Date.now();

    const d = new Date(ts);
    const dateStr = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const timeStr = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    const personName = String(
      payload.personName ||
        payload.CardName ||
        payload.userName ||
        payload.name ||
        payload.UserID ||
        "Personal / Visita",
    ).trim();

    const personId = String(
      payload.personId || payload.UserID || payload.cardNo || payload.CardNo || payload.dni || "—",
    ).trim();

    const direction = parseDirection(payload.Type, payload.AttendanceState, payload.sentido);
    const method = row.type === "manual_attendance" ? "manual" : parseMethod(payload.Method || payload.method);
    const device = String(payload.deviceName || payload.deviceId || (row.type === "manual_attendance" ? "Manual" : "Terminal")).trim();

    const authorized =
      row.type === "manual_attendance"
        ? true
        : String(payload.Status ?? payload.status ?? "1") !== "0" && payload.resultado !== "denegado";

    const notes = typeof payload.notes === "string" ? payload.notes : undefined;

    // Métricas de hoy
    if (ts >= startOfDayTs) {
      totalToday++;
      if (direction === "in") entriesToday++;
      else exitsToday++;

      const key = personId !== "—" ? personId : personName;
      if (!(key in lastStateTodayByPerson)) {
        // Como vienen ordenados desc por fecha, el primero que encontramos es su último estado
        lastStateTodayByPerson[key] = direction;
      }
    }

    // Filtros de fecha si se proporcionan
    if (fromStr) {
      const fromTs = new Date(fromStr).getTime();
      if (!Number.isNaN(fromTs) && ts < fromTs) continue;
    }
    if (toStr) {
      const toTs = new Date(toStr).getTime();
      if (!Number.isNaN(toTs) && ts > toTs) continue;
    }

    // Filtro por texto
    if (q) {
      const matchName = personName.toLowerCase().includes(q);
      const matchId = personId.toLowerCase().includes(q);
      const matchDevice = device.toLowerCase().includes(q);
      if (!matchName && !matchId && !matchDevice) continue;
    }

    normalized.push({
      id: row.id,
      timestamp: ts,
      dateStr,
      timeStr,
      personName,
      personId,
      direction,
      method,
      device,
      authorized,
      notes,
    });
  }

  // Personas actualmente dentro: aquellas cuyo último evento hoy fue "in"
  const presentNow = Object.values(lastStateTodayByPerson).filter((dir) => dir === "in").length;

  return c.json({
    ok: true,
    summary: {
      totalToday,
      entriesToday,
      exitsToday,
      presentNow,
    },
    records: normalized,
  });
});

attendanceApi.post("/attendance/manual", async (c) => {
  const scoped = await scopedSiteWithModule(c, "attendance");
  if ("error" in scoped) return scoped.error;

  const user = c.get("user");
  const body = await c.req.json<{
    personName?: string;
    personId?: string;
    direction?: "in" | "out";
    timestamp?: string | number;
    notes?: string;
  }>();

  if (!body.personName) {
    return c.json({ error: "El nombre de la persona es obligatorio" }, 400);
  }

  const direction = body.direction === "out" ? "out" : "in";
  const ts = body.timestamp ? new Date(body.timestamp).getTime() : Date.now();

  const id = nid();
  await db.insert(events).values({
    id,
    siteId: scoped.site.id,
    type: "manual_attendance",
    payload: JSON.stringify({
      personName: body.personName.trim(),
      personId: (body.personId || "").trim() || "—",
      sentido: direction,
      notes: (body.notes || "").trim() || "Fichada manual registrada por operador",
      registeredBy: user.email || user.name,
      manual: true,
    }),
    createdAt: new Date(ts),
  });

  return c.json({ ok: true, id });
});
