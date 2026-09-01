const FETCH_MS = 4000;

type DetectionRow = {
  id: number;
  fecha: string;
  sentido: string;
  patente: string;
  ocr_conf: number | null;
  detector_conf: number | null;
  region: string | null;
  thumb_b64: string;
  foto_b64: string;
  foto_evidencia_b64: string;
  autorizado: boolean | null;
};

let cachedToken: string | null = null;
let cachedAt = 0;

export function engineBaseUrl() {
  return (process.env.SITE_ENGINE_URL ?? "http://192.168.33.13:5051").replace(/\/$/, "");
}

function engineUser() {
  return process.env.SITE_ENGINE_USER ?? "admin";
}

function enginePassword() {
  return process.env.SITE_ENGINE_PASSWORD ?? "admin";
}

async function login(): Promise<string> {
  const res = await fetch(`${engineBaseUrl()}/api/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: engineUser(),
      password: enginePassword(),
    }),
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (!res.ok) {
    throw new Error("No se pudo entrar al motor de LAN (AccesoSeguro)");
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("AccesoSeguro no devolvió token");
  }
  cachedToken = data.access_token;
  cachedAt = Date.now();
  return cachedToken;
}

async function bearer(): Promise<string> {
  if (cachedToken && Date.now() - cachedAt < 6 * 60 * 60 * 1000) return cachedToken;
  return login();
}

export async function siteFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${await bearer()}`);
  const url = path.startsWith("http") ? path : `${engineBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers,
    signal: init?.signal ?? AbortSignal.timeout(FETCH_MS),
  });
  if (res.status !== 401) return res;
  cachedToken = null;
  headers.set("Authorization", `Bearer ${await login()}`);
  return fetch(url, {
    ...init,
    headers,
    signal: init?.signal ?? AbortSignal.timeout(FETCH_MS),
  });
}

function publicCam(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const cam = raw as Record<string, unknown>;
  return {
    running: Boolean(cam.running),
    detections_total: cam.detections_total ?? 0,
    last_error: typeof cam.last_error === "string" ? cam.last_error : "",
    sentido: cam.sentido === "out" ? "out" : "in",
    alpr_active: Boolean(cam.alpr_active),
    frame_id: Number(cam.frame_id ?? 0),
    processed_frames: Number(cam.processed_frames ?? 0),
    last_inference_ms: Number(cam.last_inference_ms ?? 0),
    dedup_skipped: Number(cam.dedup_skipped ?? 0),
    cameraHost: hostFromSource(cam.source),
  };
}

function hostFromSource(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "";
  const m = raw.match(/@([^/:]+)/) || raw.match(/\/\/([^/:]+)/);
  return m?.[1] ?? "";
}

export async function engineOps() {
  const [health, statsRes, relayRes, eventsRes] = await Promise.all([
    engineHealth(),
    siteFetch("/api/accesos/stats/totales").catch(() => null),
    siteFetch("/api/relay/status").catch(() => null),
    siteFetch("/api/events/recent").catch(() => null),
  ]);
  const stats = statsRes && statsRes.ok ? ((await statsRes.json()) as Record<string, number>) : null;
  const relay = relayRes && relayRes.ok ? ((await relayRes.json()) as Record<string, unknown>) : null;
  const eventsJson = eventsRes && eventsRes.ok ? ((await eventsRes.json()) as { events?: unknown[] }) : { events: [] };
  return { health, stats, relay, events: eventsJson.events ?? [] };
}

export async function engineGet(path: string) {
  const res = await siteFetch(path, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Motor LAN ${res.status}`);
  return res.json() as Promise<unknown>;
}

async function engineWrite(method: "POST" | "PUT", path: string, body: unknown) {
  const res = await siteFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text || `Motor LAN ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { detail?: unknown; error?: string };
      if (typeof parsed.detail === "string") msg = parsed.detail;
      else if (parsed.error) msg = parsed.error;
    } catch {
      /* texto plano */
    }
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) return res.json() as Promise<unknown>;
  return { ok: true };
}

export async function enginePost(path: string, body: unknown) {
  return engineWrite("POST", path, body);
}

export async function enginePut(path: string, body: unknown) {
  return engineWrite("PUT", path, body);
}

export function maskSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/rtsp:\/\/([^:/@]+):([^@/]*)@/gi, "rtsp://$1:****@");
  }
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^(password|pass|secret|token)$/i.test(k) && typeof v === "string") out[k] = "";
      else out[k] = maskSecrets(v);
    }
    return out;
  }
  return value;
}

export async function engineRelay(action: "open" | "close", sentido: "in" | "out") {
  const res = await siteFetch(`/api/relay/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sentido }),
  });
  if (!res.ok) {
    throw new Error(action === "open" ? "No se pudo abrir la barrera" : "No se pudo cerrar la barrera");
  }
  return res.json();
}

export async function engineHealth() {
  try {
    const res = await siteFetch("/api/status");
    if (!res.ok) return { online: false as const };
    const data = (await res.json()) as { in?: unknown; out?: unknown };
    return { online: true as const, in: publicCam(data.in), out: publicCam(data.out) };
  } catch {
    return { online: false as const };
  }
}

export async function engineDetections(limit = 40) {
  const res = await siteFetch(`/api/detections?limit=${limit}`);
  if (!res.ok) {
    throw new Error("AccesoSeguro no devolvió detecciones");
  }
  const data = (await res.json()) as { total?: number; items?: DetectionRow[] };
  return {
    total: data.total ?? 0,
    items: (data.items ?? []).map((row) => ({
      id: row.id,
      fecha: row.fecha,
      sentido: row.sentido,
      patente: row.patente,
      ocrConf: row.ocr_conf,
      detectorConf: row.detector_conf,
      region: row.region,
      autorizado: row.autorizado,
      thumb: mediaPath(row.thumb_b64),
      scene: mediaPath(row.foto_b64),
      evidence: mediaPath(row.foto_evidencia_b64),
    })),
  };
}

export function safeMediaPath(raw: string | null | undefined): string | null {
  const path = mediaPath(raw);
  if (!path) return null;
  if (path.includes("..") || path.includes("\\")) return null;
  if (!path.startsWith("evidencia/")) return null;
  return path;
}

function mediaPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^\/+/, "");
  return trimmed || null;
}
