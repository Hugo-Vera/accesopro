import { and, eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { dahuaPeriodSlots } from "./db/schema.js";
import { enqueue, waitCommand } from "./actuatorExec.js";
import { nid } from "./scope.js";

export type TimeWindow = {
  horaDesde?: string | null;
  horaHasta?: string | null;
  diasSemana?: number[] | string | null;
  fechaDesde?: Date | string | number | null;
  fechaHasta?: Date | string | number | null;
};

function padTime(raw: string) {
  const t = raw.trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(t)) return t;
  if (/^\d{2}:\d{2}$/.test(t)) return `${t}:00`;
  return t;
}

export function parseWeekdays(raw: number[] | string | null | undefined): number[] | null {
  if (raw == null || raw === "") return null;
  if (Array.isArray(raw)) return raw.map(Number).filter((n) => n >= 0 && n <= 6);
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr.map(Number).filter((n) => n >= 0 && n <= 6);
  } catch {
    return null;
  }
}

export function windowFingerprint(win: TimeWindow): string | null {
  const from = (win.horaDesde || "").trim();
  const to = (win.horaHasta || "").trim();
  if (!from || !to) return null;
  const days = parseWeekdays(win.diasSemana);
  const dayKey = days?.length ? days.slice().sort((a, b) => a - b).join(",") : "*";
  return `${dayKey}|${padTime(from)}|${padTime(to)}`;
}

export function dahuaDate(value: Date | string | number | null | undefined, fallback: string) {
  if (value == null || value === "") return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function scheduleDays(fp: string): string[][] {
  const [dayKey, from, to] = fp.split("|");
  const start = padTime(from);
  const end = padTime(to);
  const active = `1 ${start}-${end}`;
  const off = "1 00:00:00-00:00:00";
  const allowed = dayKey === "*" ? null : new Set(dayKey.split(",").map(Number));
  return Array.from({ length: 7 }, (_, day) => {
    const on = !allowed || allowed.has(day);
    return [on ? active : off, off, off, off];
  });
}

/** Reserva o reusa un índice AccessTimeSchedule (1–31; 0 queda como base). */
export async function resolvePeriodIndex(
  siteId: string,
  deviceId: string,
  win: TimeWindow,
): Promise<number> {
  const fp = windowFingerprint(win);
  if (!fp) return 255;

  const existing = await db
    .select()
    .from(dahuaPeriodSlots)
    .where(and(eq(dahuaPeriodSlots.deviceId, deviceId), eq(dahuaPeriodSlots.fingerprint, fp)))
    .get();
  if (existing) return existing.periodIndex;

  const used = await db.select().from(dahuaPeriodSlots).where(eq(dahuaPeriodSlots.deviceId, deviceId));
  const taken = new Set(used.map((r) => r.periodIndex));
  let idx = 1;
  while (idx <= 31 && taken.has(idx)) idx += 1;
  if (idx > 31) return used[0]?.periodIndex ?? 1;

  const cmd = await enqueue(siteId, "dahua_schedule_set", {
    deviceId,
    index: idx,
    enabled: true,
    days: scheduleDays(fp),
  });
  await waitCommand(cmd, 30);

  await db.insert(dahuaPeriodSlots).values({
    id: nid(),
    deviceId,
    fingerprint: fp,
    periodIndex: idx,
    createdAt: new Date(),
  });
  return idx;
}
