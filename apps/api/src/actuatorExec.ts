import { and, eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { actuators, commands } from "./db/schema.js";
import { agentOnline, nid } from "./scope.js";
import { engineRelay } from "./siteEngine.js";

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

export async function waitCommand(id: string) {
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    const row = await db.select().from(commands).where(eq(commands.id, id)).get();
    if (!row || row.status === "pending") continue;
    return {
      ok: row.status === "done",
      status: row.status,
      result: row.result ? (JSON.parse(row.result) as unknown) : null,
    };
  }
  return { ok: false, status: "timeout", error: "El agent no respondió a tiempo" };
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
      const sentido = actuator.engineSentido === "out" ? "out" : "in";
      const result = await engineRelay(action, sentido);
      await logDone(site.id, `engine.${action}`, { actuatorId: actuator.id, name: actuator.name, sentido }, result);
      return { ok: true, result };
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
      return waitCommand(cmd);
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
