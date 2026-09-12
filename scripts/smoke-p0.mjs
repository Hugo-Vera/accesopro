import assert from "node:assert/strict";

function parseVisitQrPayload(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("ACCESOPRO:V1:")) return trimmed.slice("ACCESOPRO:V1:".length);
  return trimmed;
}

function resolveOpenActuatorId(opts) {
  const acts = opts.actuators;
  if (!acts.length) return null;
  const byDev = acts.find((a) => a.driver === "dahua" && a.dahuaDeviceId === opts.deviceId);
  if (byDev) return byDev.id;
  const inHit = opts.inDeviceIds.includes(opts.deviceId) || opts.inDeviceId === opts.deviceId;
  const outHit = opts.outDeviceIds.includes(opts.deviceId) || opts.outDeviceId === opts.deviceId;
  const sameLab = Boolean(opts.inDeviceId && opts.inDeviceId === opts.outDeviceId);
  let poolIds = [];
  if (sameLab && (inHit || outHit)) poolIds = [...new Set([...opts.inActuatorIds, ...opts.outActuatorIds])];
  else if (inHit) poolIds = opts.inActuatorIds;
  else if (outHit) poolIds = opts.outActuatorIds;
  const pool = poolIds.length ? acts.filter((a) => poolIds.includes(a.id)) : acts;
  const target =
    pool.find((a) => a.driver === "dahua") ||
    pool.find((a) => a.kind === "gate" || a.kind === "door" || a.kind === "barrier") ||
    pool[0] ||
    acts[0];
  return target?.id ?? null;
}

function mergeLaneActuatorIds(outIds, inIds, sameDevice) {
  if (!sameDevice) return outIds;
  return [...new Set([...outIds, ...inIds])];
}

assert.equal(parseVisitQrPayload("ACCESOPRO:V1:abc.sig"), "abc.sig");
assert.equal(parseVisitQrPayload("abc.sig"), "abc.sig");
assert.equal(parseVisitQrPayload("  "), null);

const acts = [
  { id: "a1", driver: "dahua", kind: "door", dahuaDeviceId: "dev-in" },
  { id: "a2", driver: "engine", kind: "barrier", dahuaDeviceId: null },
];
assert.equal(
  resolveOpenActuatorId({
    deviceId: "dev-in",
    actuators: acts,
    inDeviceIds: ["dev-in"],
    outDeviceIds: [],
    inActuatorIds: ["a1"],
    outActuatorIds: ["a2"],
    inDeviceId: "dev-in",
    outDeviceId: "dev-in",
  }),
  "a1",
);

assert.deepEqual(mergeLaneActuatorIds(["a2"], ["a1"], true).sort(), ["a1", "a2"]);
assert.deepEqual(mergeLaneActuatorIds(["a2"], ["a1"], false), ["a2"]);

function parseArgentineDni(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (text.includes("@")) {
    const chunks = text.split("@");
    const dni = chunks.find((c) => /^\d{7,8}$/.test(c.trim()))?.trim() || "";
    const apellido = (chunks[1] || "").trim();
    const nombre = (chunks[2] || "").trim();
    if (!dni && !apellido) return null;
    return { dni, fullName: `${apellido} ${nombre}`.trim() || `DNI ${dni}` };
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 7 && digits.length <= 8) return { dni: digits, fullName: `DNI ${digits}` };
  return null;
}

assert.equal(parseArgentineDni("@PEREZ@JUAN@M@30123456@A@")?.dni, "30123456");
assert.equal(parseArgentineDni("30.123.456")?.dni, "30123456");

console.log("smoke-p0 ok");
