"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { withTenant, api } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { IconFullscreen, IconRefresh } from "@/components/DashboardIcons";

type DeviceType = "asi_facial" | "camera_ip" | "vto_intercom" | "access_controller";

export type LiveDevice = {
  id: string;
  name: string;
  host: string;
  deviceType?: DeviceType | string;
  model?: string | null;
  location?: string | null;
  rtspUrl?: string | null;
};

export type LiveLane = "in" | "out";

const API = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

/** Clasifica la tecnología del equipo y define su resolución nativa */
function getDeviceTech(d: LiveDevice | null) {
  if (!d) return { type: "asi_facial", label: "Lector Facial", badge: "ASI 272×480", isFacial: true, subtype: 2 };
  const dt = d.deviceType;
  if (dt === "camera_ip" || /cam|ip|camara|cámara|nvr|dvr/i.test(d.name)) {
    return { type: "camera_ip", label: "Cámara IP", badge: "CAM IP 16:9", isFacial: false, subtype: 1 };
  }
  if (dt === "vto_intercom" || /vto|intercom|portero/i.test(d.name)) {
    return { type: "vto_intercom", label: "Videoportero", badge: "VTO 16:9", isFacial: false, subtype: 1 };
  }
  return { type: "asi_facial", label: "Lector Facial", badge: "ASI 272×480", isFacial: true, subtype: 2 };
}

function laneGuess(d: LiveDevice): LiveLane | null {
  const blob = `${d.name} ${d.location ?? ""}`.toLowerCase();
  if (/salid|egres|exit|\bout\b/.test(blob)) return "out";
  if (/entrad|ingres|entry|\bin\b/.test(blob)) return "in";
  return null;
}

/** Asigna un equipo a entrada y otro a salida (cableado del punto o heurística por nombre). */
export function assignLiveLanes(
  devices: LiveDevice[],
  wired?: { deviceId: string; sentido: LiveLane | "both" }[],
): { inId: string | null; outId: string | null } {
  const liveable = devices.filter((d) => d.deviceType !== "access_controller");
  let inId: string | null = null;
  let outId: string | null = null;

  if (wired?.length) {
    for (const w of wired) {
      if (!liveable.some((d) => d.id === w.deviceId)) continue;
      if ((w.sentido === "in" || w.sentido === "both") && !inId) inId = w.deviceId;
      if ((w.sentido === "out" || w.sentido === "both") && !outId && w.deviceId !== inId) outId = w.deviceId;
    }
  }

  for (const d of liveable) {
    const g = laneGuess(d);
    if (g === "in" && !inId) inId = d.id;
    if (g === "out" && !outId) outId = d.id;
  }

  for (const d of liveable) {
    if (!inId) inId = d.id;
    else if (!outId && d.id !== inId) outId = d.id;
  }

  return { inId, outId };
}

const LANE_LABEL: Record<LiveLane, string> = {
  in: "Entrada",
  out: "Salida",
};

export function DahuaLivePanel({
  devices: devicesProp,
  lane,
  preferredDeviceId,
  onDeviceChange,
}: {
  compact?: boolean;
  minimalChrome?: boolean;
  devices?: LiveDevice[];
  /** Carril IN/OUT del predio (tiempo de visita = entrada → salida). */
  lane?: LiveLane;
  preferredDeviceId?: string | null;
  /** Si se setea, la selección define el lector activo de ese sentido (live + historial). */
  onDeviceChange?: (deviceId: string | null) => void;
}) {
  const { tenantId, status } = useDash();
  const wrapRef = useRef<HTMLElement | null>(null);
  const [devicesLocal, setDevicesLocal] = useState<LiveDevice[]>([]);
  const [localId, setLocalId] = useState<string | null>(null);
  const [channel] = useState(1);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const devices = devicesProp ?? devicesLocal;
  const controlled = typeof onDeviceChange === "function";

  const rtspDevices = useMemo(() => {
    return devices.filter((d) => d.deviceType !== "access_controller");
  }, [devices]);

  useEffect(() => {
    if (controlled) return;
    if (localId && rtspDevices.some((d) => d.id === localId)) return;
    setLocalId(rtspDevices[0]?.id ?? null);
  }, [controlled, rtspDevices, localId]);

  const deviceId = controlled
    ? preferredDeviceId && rtspDevices.some((d) => d.id === preferredDeviceId)
      ? preferredDeviceId
      : preferredDeviceId ?? (lane === "out" ? null : rtspDevices[0]?.id ?? null)
    : localId;

  const selected = rtspDevices.find((d) => d.id === deviceId) ?? null;
  const tech = getDeviceTech(selected);
  const subtype = tech.subtype;
  const laneTitle = lane ? LANE_LABEL[lane] : null;

  const streamSrc = useMemo(() => {
    if (!tenantId || !selected?.id || !status.agentOnline) return null;
    const q = withTenant(
      `/api/dahua/${selected.id}/live?channel=${channel}&subtype=${subtype}&_=${tick}`,
      tenantId,
    );
    return `${API}${q}`;
  }, [tenantId, selected?.id, channel, subtype, tick, status.agentOnline]);

  useEffect(() => {
    if (devicesProp) return;
    if (!tenantId) return;
    api<{ devices: LiveDevice[] }>(withTenant("/api/dahua", tenantId))
      .then((d) => setDevicesLocal(d.devices))
      .catch((err) => setError(err instanceof Error ? err.message : "Sin equipos"));
  }, [tenantId, devicesProp]);

  function enterFullscreen() {
    const el = wrapRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  const emptyOut = lane === "out" && !selected;

  function pickDevice(next: string | null) {
    if (controlled) onDeviceChange?.(next);
    else setLocalId(next);
    setTick((n) => n + 1);
  }

  return (
    <section
      ref={wrapRef}
      className="ops-panel-accent flex h-full min-h-0 flex-col overflow-hidden rounded border border-[var(--ap-line)] bg-[var(--ap-panel)]"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-100 px-2.5 py-1.5 text-xs dark:border-[#142838] dark:bg-[#081724]">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="ops-brand text-[10.5px] font-extrabold tracking-wide">AccesoCam</span>
          {laneTitle ? (
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${
                lane === "in"
                  ? "bg-sky-100 text-sky-800 dark:bg-[#0c2a3a] dark:text-[#7dd3fc]"
                  : "bg-amber-100 text-amber-900 dark:bg-[#2a2210] dark:text-[#fbbf24]"
              }`}
            >
              {laneTitle}
            </span>
          ) : null}
          {selected ? (
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${
                tech.isFacial
                  ? "bg-blue-100 text-blue-800 dark:bg-[#102434] dark:text-[#67e8f9]"
                  : "bg-emerald-100 text-emerald-800 dark:bg-[#0d2a24] dark:text-[#34d399]"
              }`}
              title={
                tech.isFacial
                  ? "Resolución de pantalla según datasheet: 272(H) × 480(V)"
                  : "Resolución de cámara IP estándar: 16:9 HD"
              }
            >
              {tech.badge}
            </span>
          ) : null}
        </div>

        {rtspDevices.length > 0 ? (
          <div className="relative min-w-0 max-w-[52%] flex-shrink-0">
            <label className="sr-only" htmlFor={`accesocam-device-${lane ?? "main"}`}>
              Equipo en vivo
            </label>
            <select
              id={`accesocam-device-${lane ?? "main"}`}
              className="w-full appearance-none truncate rounded-md border border-slate-300 bg-white py-1 pl-2 pr-7 text-[11px] font-semibold text-slate-800 outline-none focus:border-sky-500 dark:border-[#1e3a4f] dark:bg-[#0c1c2a] dark:text-slate-100 dark:focus:border-cyan-500"
              value={selected?.id ?? ""}
              onChange={(e) => pickDevice(e.target.value || null)}
            >
              {lane === "out" ? <option value="">Sin lector / elegir…</option> : null}
              {rtspDevices.map((d) => {
                const t = getDeviceTech(d);
                return (
                  <option key={d.id} value={d.id}>
                    {t.isFacial ? "Facial" : "Cam IP"} · {d.name}
                  </option>
                );
              })}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 dark:text-slate-400"
              aria-hidden
            />
          </div>
        ) : null}
      </div>

      <div
        className={`ops-cam-viewport relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#050b12] ${
          tech.isFacial ? "ops-cam-viewport--facial" : "ops-cam-viewport--wide"
        }`}
      >
        {emptyOut ? (
          <div className="grid max-w-[220px] place-items-center px-3 text-center">
            <p className="text-[12px] font-semibold text-slate-300">Lector de salida</p>
            <p className="mt-1.5 text-[11px] leading-snug text-[#6b8498]">
              Elegí un equipo arriba: queda como lector de salida (live + historial). En prueba podés
              usar el mismo ASI que en ingreso. En producción cableá un segundo ASI a un punto con
              sentido salida.
            </p>
          </div>
        ) : streamSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={streamSrc}
            alt={selected?.name || "Live feed"}
            className={tech.isFacial ? "ops-cam-frame-facial select-none" : "ops-cam-frame-wide select-none"}
            onLoad={() => setError(null)}
            onError={() => {
              setError("Se cortó el live.");
              setTimeout(() => setTick((n) => n + 1), 2500);
            }}
          />
        ) : (
          <div className="grid min-h-[160px] place-items-center px-4 text-center text-[13px] text-[var(--ap-muted)]">
            {!status.agentOnline
              ? "Agent offline"
              : !selected?.id
                ? "Sin equipo"
                : "Preparando stream…"}
          </div>
        )}
      </div>

      <div className="ops-cam-bottom-hud flex items-center justify-between px-2.5 py-1 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          {emptyOut ? (
            <span className="font-mono text-[9px] font-extrabold text-[#6b8498]">STANDBY</span>
          ) : (
            <span className="flex items-center gap-1 font-mono text-[9px] font-extrabold text-[#3dcf7a]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#3dcf7a]" />
              LIVE
            </span>
          )}
          {selected ? (
            <>
              <span className="font-mono text-[8.5px] font-semibold text-[#55819e]">
                {tech.isFacial ? "272×480 (ASI)" : "16:9 HD"}
              </span>
              <span className="max-w-[120px] truncate text-[10.5px] font-semibold text-slate-200">
                {selected.name}
              </span>
            </>
          ) : laneTitle ? (
            <span className="truncate text-[10.5px] font-semibold text-slate-400">{laneTitle}</span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 text-[#8fa6b8]">
          <button
            type="button"
            className="transition-colors hover:text-[#2bb8d9] disabled:opacity-40"
            title="Refrescar stream"
            disabled={!selected}
            onClick={() => setTick((n) => n + 1)}
          >
            <IconRefresh className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="transition-colors hover:text-white"
            title="Pantalla completa"
            onClick={enterFullscreen}
          >
            <IconFullscreen className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {error ? (
        <p className="border-t border-[var(--ap-line-soft)] px-3 py-1 text-[11px] text-danger">{error}</p>
      ) : null}
    </section>
  );
}
