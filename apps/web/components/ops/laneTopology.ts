import type { Actuator, RelaySlot } from "@/components/ops/relayPresets";
import { RELAY_PRESETS } from "@/components/ops/relayPresets";
import type { LiveDevice, LiveLane } from "@/components/DahuaLivePanel";

export type LaneWire = {
  deviceIds: string[];
  actuatorIds: string[];
};

export type AccessPointWireRow = {
  sentido: string;
  devices: Array<{ dahuaDeviceId: string; role: string }>;
  actuators: Array<{ actuatorId: string; role: string }>;
};

/** Actuadores de sitio (sirena, riego…) se muestran en ambos carriles si no hay cableado. */
const SITE_WIDE = /siren|alarma|emerg|pánico|panico|riego|irrig|jard|iluminac|luz|basura|recicl|porter|guarita|reflec|per[ií]metro/i;

function actuatorLaneGuess(a: Actuator): LiveLane | "both" | null {
  const blob = `${a.name} ${a.kind}`.toLowerCase();
  if (/salid|egres|exit|\bout\b/.test(blob)) return "out";
  if (/entrad|ingres|entry|\bin\b|barrera|portón|porton/.test(blob)) return "in";
  if (SITE_WIDE.test(blob)) return "both";
  return null;
}

function deviceLaneGuess(d: LiveDevice): LiveLane | null {
  const blob = `${d.name} ${d.location ?? ""}`.toLowerCase();
  if (/salid|egres|exit|\bout\b/.test(blob)) return "out";
  if (/entrad|ingres|entry|\bin\b/.test(blob)) return "in";
  return null;
}

export function buildLaneTopology(
  devices: LiveDevice[],
  actuators: Actuator[],
  points: AccessPointWireRow[],
): { in: LaneWire; out: LaneWire } {
  const inDev = new Set<string>();
  const outDev = new Set<string>();
  const inAct = new Set<string>();
  const outAct = new Set<string>();

  for (const p of points) {
    const sentido = p.sentido === "in" || p.sentido === "out" || p.sentido === "both" ? p.sentido : "both";
    for (const w of p.devices) {
      if (w.role !== "live" && w.role !== "both" && w.role !== "validator") continue;
      if (sentido === "in" || sentido === "both") inDev.add(w.dahuaDeviceId);
      if (sentido === "out" || sentido === "both") outDev.add(w.dahuaDeviceId);
    }
    for (const w of p.actuators) {
      if (sentido === "in" || sentido === "both") inAct.add(w.actuatorId);
      if (sentido === "out" || sentido === "both") outAct.add(w.actuatorId);
    }
  }

  const liveable = devices.filter((d) => d.deviceType !== "access_controller");
  const wiredAnyDev = inDev.size + outDev.size > 0;
  if (!wiredAnyDev) {
    for (const d of liveable) {
      const g = deviceLaneGuess(d);
      if (g === "out") outDev.add(d.id);
      else if (g === "in") inDev.add(d.id);
    }
    for (const d of liveable) {
      if (!inDev.has(d.id) && !outDev.has(d.id)) {
        if (inDev.size === 0) inDev.add(d.id);
        else if (outDev.size === 0) outDev.add(d.id);
      }
    }
  }

  const wiredAnyAct = inAct.size + outAct.size > 0;
  if (!wiredAnyAct) {
    for (const a of actuators) {
      const g = actuatorLaneGuess(a);
      if (g === "out") outAct.add(a.id);
      else if (g === "in") inAct.add(a.id);
      else if (g === "both") {
        inAct.add(a.id);
        outAct.add(a.id);
      } else {
        inAct.add(a.id);
      }
    }
  }

  return {
    in: { deviceIds: [...inDev], actuatorIds: [...inAct] },
    out: { deviceIds: [...outDev], actuatorIds: [...outAct] },
  };
}

/** Solo actuadores del carril (sin presets vacíos). */
export function buildLaneRelaySlots(manualActs: Actuator[], actuatorIds: string[]): RelaySlot[] {
  const idSet = new Set(actuatorIds);
  const list = manualActs.filter((a) => idSet.has(a.id));
  return list.map((a) => {
    const preset = RELAY_PRESETS.find((p) => p.match.test(a.name) || p.match.test(a.kind));
    return {
      label: a.name,
      kind: preset?.kind ?? a.kind ?? "gate",
      danger: preset?.danger ?? /siren|emerg|pánico|panico/i.test(a.name),
      cam: preset?.cam ?? /barrera|portón|porton|garaje|peaton/i.test(a.name),
      actuator: a,
    };
  });
}

export function filterEventsByDevices<T extends { payload?: Record<string, unknown> }>(
  events: T[],
  deviceIds: string[],
): T[] {
  if (!deviceIds.length) return [];
  const set = new Set(deviceIds.map(String));
  return events.filter((e) => {
    const id = String(e.payload?.deviceId ?? e.payload?.DeviceID ?? "").trim();
    return id !== "" && set.has(id);
  });
}

/** Si no hay match por deviceId, no dejar el historial vacío en prueba. */
export function filterEventsForLane<T extends { payload?: Record<string, unknown> }>(
  events: T[],
  deviceId: string | null,
  opts?: { fallbackAll?: boolean },
): T[] {
  if (!deviceId) {
    return opts?.fallbackAll ? events : [];
  }
  const matched = filterEventsByDevices(events, [deviceId]);
  if (matched.length > 0) return matched;
  // Payload sin deviceId, id distinto o 2 lectores en lab: mostrar todo si se pide fallback
  if (opts?.fallbackAll) return events;
  // Sin fallback estricto: si hay eventos pero ninguno matchea, igual mostrarlos
  // (evita historial vacío por desalineación de IDs tras seed/restore)
  if (events.length > 0) return events;
  return matched;
}
