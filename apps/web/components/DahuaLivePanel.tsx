"use client";

import { useEffect, useMemo, useState } from "react";
import { withTenant, api } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { IconFullscreen, IconRefresh } from "@/components/DashboardIcons";

type DeviceType = "asi_facial" | "camera_ip" | "vto_intercom" | "access_controller";

type Device = {
  id: string;
  name: string;
  host: string;
  deviceType?: DeviceType | string;
  model?: string | null;
  location?: string | null;
  rtspUrl?: string | null;
};

const API = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

/** Clasifica la tecnología del equipo y define su resolución nativa */
function getDeviceTech(d: Device | null) {
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

function pickLiveDevice(devices: Device[], prev: string | null) {
  if (prev && devices.some((x) => x.id === prev)) return prev;
  const lector = devices.find((d) => /lector|facial|asi|huella/i.test(d.name));
  return lector?.id ?? devices[0]?.id ?? null;
}

export function DahuaLivePanel({
  compact = false,
  minimalChrome = false,
}: {
  compact?: boolean;
  minimalChrome?: boolean;
}) {
  const { tenantId, status } = useDash();
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [channel, setChannel] = useState(1);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Filtra solo equipos con soporte de video RTSP (excluye controladores de acceso puros sin video)
  const rtspDevices = useMemo(() => {
    return devices.filter((d) => d.deviceType !== "access_controller");
  }, [devices]);

  const selected = rtspDevices.find((d) => d.id === deviceId) ?? rtspDevices[0] ?? null;
  const tech = getDeviceTech(selected);

  // Subtype adaptado al hardware: 2 para facial ASI (vertical nativo), 1 para cámara IP (panorámico 16:9)
  const subtype = tech.subtype;

  const streamSrc = useMemo(() => {
    if (!tenantId || !selected?.id || !status.agentOnline) return null;
    const q = withTenant(
      `/api/dahua/${selected.id}/live?channel=${channel}&subtype=${subtype}&_=${tick}`,
      tenantId,
    );
    return `${API}${q}`;
  }, [tenantId, selected?.id, channel, subtype, tick, status.agentOnline]);

  useEffect(() => {
    if (!tenantId) return;
    api<{ devices: Device[] }>(withTenant("/api/dahua", tenantId))
      .then((d) => {
        setDevices(d.devices);
        setDeviceId((prev) => pickLiveDevice(d.devices, prev));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Sin equipos"));
  }, [tenantId]);

  return (
    <section className="ops-panel-accent flex h-full min-h-0 flex-col overflow-hidden rounded border border-[var(--ap-line)] bg-[var(--ap-panel)]">
      {/* Barra superior con selector dinámico de tecnologías agregadas en la lista de equipos */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-200 dark:border-[#142838] bg-slate-100 dark:bg-[#081724] px-2.5 py-1.5 text-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="ops-brand text-[10.5px] font-extrabold tracking-wide">AccesoCam</span>
          <span
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
              tech.isFacial
                ? "bg-blue-100 text-blue-800 dark:bg-[#102434] dark:text-[#67e8f9]"
                : "bg-emerald-100 text-emerald-800 dark:bg-[#0d2a24] dark:text-[#34d399]"
            }`}
            title={tech.isFacial ? "Resolución de pantalla según datasheet: 272(H) × 480(V)" : "Resolución de cámara IP estándar: 16:9 HD"}
          >
            {tech.badge}
          </span>
        </div>

        {/* Pestañas de cámaras y accesos agregados para ver en vivo con su resolución propia */}
        {rtspDevices.length > 0 ? (
          <div className="flex items-center gap-1 overflow-x-auto max-w-[calc(100%-140px)] py-0.5">
            {rtspDevices.map((d) => {
              const active = d.id === selected?.id;
              const devTech = getDeviceTech(d);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setDeviceId(d.id);
                    setTick((n) => n + 1);
                  }}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold tracking-tight transition-all shrink-0 ${
                    active
                      ? "bg-cyan-600 text-white shadow-xs font-extrabold"
                      : "bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-[#0f2334] dark:text-slate-300 dark:hover:bg-[#1a384f]"
                  }`}
                  title={`${d.name} (${devTech.label} · ${devTech.badge})`}
                >
                  <span
                    className={`text-[7.5px] font-extrabold uppercase px-1 py-0.2 rounded ${
                      active
                        ? "bg-black/25 text-white"
                        : "bg-slate-300/80 dark:bg-[#18364d] text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {devTech.isFacial ? "FACIAL" : "CAM IP"}
                  </span>
                  <span className="truncate max-w-[120px]">{d.name}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Contenedor de video ajustado estrictamente a la resolución nativa de cada tecnología sin deformar */}
      <div
        className={`relative min-h-0 flex-1 bg-[var(--ap-ink-deep)] flex items-center justify-center overflow-hidden p-1 ${
          tech.isFacial
            ? "aspect-[272/480] max-h-[380px] w-auto mx-auto"
            : "aspect-[16/9] w-full max-h-[380px] mx-auto"
        }`}
      >
        {streamSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={streamSrc}
            alt={selected?.name || "Live feed"}
            className="h-full w-full object-contain select-none rounded-md"
            onLoad={() => setError(null)}
            onError={() => {
              setError("Se cortó el live.");
              setTimeout(() => setTick((n) => n + 1), 2500);
            }}
          />
        ) : (
          <div className="grid h-full min-h-[160px] place-items-center px-4 text-center text-[13px] text-[var(--ap-muted)]">
            {!status.agentOnline
              ? "Agent offline"
              : !selected?.id
                ? "Sin equipo"
                : "Preparando stream…"}
          </div>
        )}
      </div>

      {/* HUD inferior limpio: estado del stream, nombre del equipo activo y controles útiles */}
      <div className="ops-cam-bottom-hud flex items-center justify-between px-2.5 py-1 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center gap-1 font-mono text-[9px] font-extrabold text-[#3dcf7a]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#3dcf7a] animate-pulse" />
            LIVE
          </span>
          <span className="font-mono text-[8.5px] font-semibold text-[#55819e]">
            {tech.isFacial ? "272×480 (ASI)" : "16:9 HD"}
          </span>
          <span className="font-semibold text-[10.5px] text-slate-200 truncate max-w-[150px]">
            {selected?.name || "AccesoCam"}
          </span>
        </div>

        {/* Acciones útiles: Refrescar y Pantalla completa */}
        <div className="flex items-center gap-2 text-[#8fa6b8]">
          <button
            type="button"
            className="hover:text-[#2bb8d9] transition-colors"
            title="Refrescar stream"
            onClick={() => setTick((n) => n + 1)}
          >
            <IconRefresh className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="hover:text-white transition-colors"
            title="Pantalla completa"
            onClick={() => {
              const el = document.querySelector(".ops-cam-live-wrap") || document.querySelector(".ops-panel-accent");
              if (el && !document.fullscreenElement) {
                el.requestFullscreen?.().catch(() => {});
              } else if (document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
              }
            }}
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
