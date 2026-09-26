import { and, eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { actuators, commands } from "./db/schema.js";
import { agentOnline, nid } from "./scope.js";
export async function enqueue(siteId: string, action: string, payload: unknown) {
  const id = nid();
  await db.insert(commands).values({
    id,
    siteId,
    action,
    payload: JSON.stringify(payload),
    status: "pending",
    createdAt: new Date(),
  });
  return id;
}

/** Acciones que el agent corre en su hilo rápido (`GET /agent/commands?lane=fast`). */
export const FAST_COMMAND_ACTIONS = ["open", "dahua_open"];

export async function waitCommand(id: string, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    await sleep(400);
    const row = await db.select().from(commands).where(eq(commands.id, id)).get();
    if (!row || row.status === "pending" || row.status === "running") continue;
    const result = row.result ? (JSON.parse(row.result) as unknown) : null;
    const err =
      row.status === "error" && result && typeof result === "object" && "error" in result
        ? String((result as { error?: unknown }).error ?? "")
        : undefined;
    return {
      ok: row.status === "done",
      status: row.status,
      result,
      error: err || undefined,
    };
  }
  return { ok: false, status: "timeout", error: "El agent no respondió a tiempo" };
}

/**
 * Apertura: nunca dejar un pulso huérfano. Si el agent no lo tomó a tiempo se cancela (no abre más tarde
 * con la ficha pendiente); si ya lo tomó, se da por enviado para cerrar la aprobación.
 */
export async function waitOpenCommand(id: string, attempts = 20) {
  const done = await waitCommand(id, attempts);
  if (done.status !== "timeout") return done;
  const cancelled = await db
    .update(commands)
    .set({ status: "cancelled", result: JSON.stringify({ error: "Sin respuesta del agent: cancelado" }) })
    .where(and(eq(commands.id, id), eq(commands.status, "pending")))
    .returning({ id: commands.id });
  if (cancelled.length) {
    return { ok: false, status: "cancelled", error: "No se abrió: el agent no respondió. Reintentá." };
  }
  const row = await db.select().from(commands).where(eq(commands.id, id)).get();
  if (row?.status === "running") return { ok: true, status: "sent", result: null, error: undefined };
  return waitCommand(id, 1);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function logDone(
  siteId: string,
  action: string,
  payload: unknown,
  result: unknown,
  status: "done" | "error" = "done",
) {
  await db.insert(commands).values({
    id: nid(),
    siteId,
    action,
    payload: JSON.stringify(payload),
    status,
    result: JSON.stringify(result ?? null),
    createdAt: new Date(),
  });
}

export async function fireActuator(
  site: { id: string; lastSeenAt: Date | number | null },
  id: string,
  action: "open" | "close",
) {
  const actuator = await db
    .select()
    .from(actuators)
    .where(and(eq(actuators.id, id), eq(actuators.siteId, site.id)))
    .get();
  if (!actuator) return { ok: false, error: "Actuador no encontrado" };
  try {
    if (actuator.driver === "engine") {
      return {
        ok: false,
        error: "Este relé quedó de un motor externo. Reasignalo a Dahua o IP en Actuadores.",
      };
    }
    if (action === "close") {
      return { ok: false, error: "Este driver solo pulsa abrir" };
    }
    if (actuator.driver === "ip") {
      if (!actuator.httpUrl) return { ok: false, error: "Falta la URL del relé IP" };
      const res = await fetch(actuator.httpUrl, { signal: AbortSignal.timeout(4000) });
      await logDone(site.id, "ip.open", { actuatorId: actuator.id, name: actuator.name }, { status: res.status });
      return { ok: res.ok, status: res.status };
    }
    if (actuator.driver === "dahua") {
      if (!agentOnline(site.lastSeenAt)) {
        return { ok: false, error: "El agent del sitio no está en línea. Arrancalo en la LAN." };
      }
      const cmd = await enqueue(site.id, "open", {
        actuatorId: actuator.id,
        name: actuator.name,
        channel: actuator.dahuaChannel,
      });
      return waitOpenCommand(cmd);
    }
    return { ok: false, error: `Driver no soportado: ${actuator.driver}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : "No se pudo disparar el actuador";
    await logDone(
      site.id,
      `${actuator.driver}.${action}`,
      { actuatorId: actuator.id, name: actuator.name },
      { error },
      "error",
    );
    return { ok: false, error };
  }
}
