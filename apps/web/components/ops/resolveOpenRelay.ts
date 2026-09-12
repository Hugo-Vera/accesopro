export type OpenableActuator = {
  id: string;
  driver?: string | null;
  kind?: string | null;
  dahuaDeviceId?: string | null;
};

export type OpenRelayPool = {
  deviceId: string;
  actuators: OpenableActuator[];
  inDeviceIds: string[];
  outDeviceIds: string[];
  inActuatorIds: string[];
  outActuatorIds: string[];
  inDeviceId: string | null;
  outDeviceId: string | null;
};

/** Orden OPS_LANES: actuador Dahua del lector → pool del punto → fallback puerta. */
export function resolveOpenActuatorId(opts: OpenRelayPool): string | null {
  const acts = opts.actuators;
  if (!acts.length) return null;

  const byDev = acts.find(
    (a) => a.driver === "dahua" && a.dahuaDeviceId && a.dahuaDeviceId === opts.deviceId,
  );
  if (byDev) return byDev.id;

  const inHit = opts.inDeviceIds.includes(opts.deviceId) || opts.inDeviceId === opts.deviceId;
  const outHit = opts.outDeviceIds.includes(opts.deviceId) || opts.outDeviceId === opts.deviceId;
  const sameLab = Boolean(opts.inDeviceId && opts.inDeviceId === opts.outDeviceId);

  let poolIds: string[] = [];
  if (sameLab && (inHit || outHit)) {
    poolIds = [...new Set([...opts.inActuatorIds, ...opts.outActuatorIds])];
  } else if (inHit) {
    poolIds = opts.inActuatorIds;
  } else if (outHit) {
    poolIds = opts.outActuatorIds;
  }

  const pool = poolIds.length ? acts.filter((a) => poolIds.includes(a.id)) : acts;
  const target =
    pool.find((a) => a.driver === "dahua") ||
    pool.find((a) => a.kind === "gate" || a.kind === "door" || a.kind === "barrier" || a.kind === "underground") ||
    pool[0] ||
    acts[0];
  return target?.id ?? null;
}

export function mergeLaneActuatorIds(outIds: string[], inIds: string[], sameDevice: boolean): string[] {
  if (!sameDevice) return outIds;
  return [...new Set([...outIds, ...inIds])];
}
