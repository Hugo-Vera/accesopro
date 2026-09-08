import { eq } from "drizzle-orm";
import { fireActuator } from "./actuatorExec.js";
import { db } from "./db/client.js";
import { actuators, events, sites } from "./db/schema.js";
import { nid } from "./scope.js";
import { engineOps } from "./siteEngine.js";
import { laneCodeOf } from "./accessPoints.js";

type EngineAccessEvent = {
  id?: string | number;
  fecha?: string;
  sentido?: string;
  patente?: string | null;
  dni?: string | null;
  resultado?: string;
  motivo?: string;
  modo?: string;
};

type SiteRow = { id: string; lastSeenAt: Date | number | null };

type ActuatorRow = typeof actuators.$inferSelect;

const seenBySite = new Map<string, string[]>();
const warmedUp = new Set<string>();
const MAX_SEEN = 300;

function accessOk(resultado?: string) {
  return resultado === "autorizado" || resultado === "manual";
}

export function sentidoOf(raw?: string): "in" | "out" {
  return raw === "out" ? "out" : "in";
}

function eventKey(ev: EngineAccessEvent) {
  if (ev.id != null && String(ev.id).length) return String(ev.id);
  return `${ev.fecha ?? ""}:${ev.sentido ?? ""}:${ev.patente ?? ""}:${ev.dni ?? ""}:${ev.resultado ?? ""}`;
}

function wasSeen(siteId: string, key: string) {
  return (seenBySite.get(siteId) ?? []).includes(key);
}

function markSeen(siteId: string, key: string) {
  const list = [key, ...(seenBySite.get(siteId) ?? []).filter((k) => k !== key)].slice(0, MAX_SEEN);
  seenBySite.set(siteId, list);
}

export function matchesSentido(a: ActuatorRow, sentido: "in" | "out") {
  if (a.driver === "engine") return a.engineSentido === sentido;
  return true;
}

async function fireMatches(
  site: SiteRow,
  acts: ActuatorRow[],
  pred: (a: ActuatorRow) => boolean,
  sentido: "in" | "out",
) {
  const fired: string[] = [];
  for (const a of acts.filter((x) => pred(x) && matchesSentido(x, sentido))) {
    const r = await fireActuator(site, a.id, "open");
    if (r.ok) fired.push(a.name);
  }
  return fired;
}

export async function processEngineAccessEvents(site: SiteRow, rawEvents: unknown[]) {
  if (!rawEvents.length) return;

  if (!warmedUp.has(site.id)) {
    for (const raw of rawEvents) markSeen(site.id, eventKey(raw as EngineAccessEvent));
    warmedUp.add(site.id);
    return;
  }

  const acts = await db.select().from(actuators).where(eq(actuators.siteId, site.id));
  if (!acts.length) return;

  for (const raw of rawEvents) {
    const ev = raw as EngineAccessEvent;
    if (!accessOk(ev.resultado)) continue;
    const key = eventKey(ev);
    if (wasSeen(site.id, key)) continue;
    markSeen(site.id, key);

    const sentido = sentidoOf(ev.sentido);
    const dni = String(ev.dni ?? "").trim();
    const plate = String(ev.patente ?? "").trim();
    const firedQr: string[] = [];
    const firedAlpr: string[] = [];
    const firedManual: string[] = [];

    if (dni) {
      firedQr.push(...(await fireMatches(site, acts, (a) => a.triggerQr, sentido)));
    }
    if (plate) {
      firedAlpr.push(...(await fireMatches(site, acts, (a) => a.triggerAlpr, sentido)));
    }
    if (ev.resultado === "manual" && !dni && !plate) {
      firedManual.push(...(await fireMatches(site, acts, (a) => a.triggerManual, sentido)));
    }

    if (!dni && !plate && !firedManual.length) continue;

    const type = dni ? "qr_access" : plate ? "engine_plate" : "manual_access";
    await db.insert(events).values({
      id: nid(),
      siteId: site.id,
      type,
      sentido,
      laneCode: laneCodeOf(sentido),
      payload: JSON.stringify({
        sentido,
        laneCode: laneCodeOf(sentido),
        patente: plate || null,
        dni: dni || null,
        resultado: ev.resultado,
        motivo: ev.motivo ?? null,
        modo: ev.modo ?? null,
        engineEventId: ev.id ?? null,
        actuatorsFired: { qr: firedQr, alpr: firedAlpr, manual: firedManual },
      }),
      createdAt: new Date(),
    });
  }
}

export function startEngineBridgePoller() {
  const interval = Number(process.env.ENGINE_BRIDGE_POLL_MS ?? 5000);
  setInterval(async () => {
    try {
      const ops = await engineOps();
      if (!ops.health.online) return;
      const allSites = await db.select().from(sites);
      for (const site of allSites) {
        await processEngineAccessEvents(site, ops.events);
      }
    } catch {
      /* motor offline */
    }
  }, interval);
}
