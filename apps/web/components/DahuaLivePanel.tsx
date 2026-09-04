"use client";

import { useEffect, useMemo, useState } from "react";
import { withTenant } from "@/lib/api";
import { api } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";

type Device = { id: string; name: string; host: string };

const API = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

/** Live fluido: MJPEG desde RTSP del stream extra (subtype 1). */
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
  /** Cabecera chica estilo panel portería */
  minimalChrome?: boolean;
}) {
  const { tenantId, status } = useDash();
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  /** 1 = extra (fluido / recomendado), 0 = principal */
  const [subtype, setSubtype] = useState(1);
  const [channel, setChannel] = useState(1);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const selected = devices.find((d) => d.id === deviceId) ?? null;

  const streamSrc = useMemo(() => {
    if (!tenantId || !deviceId || !status.agentOnline) return null;
    const q = withTenant(
      `/api/dahua/${deviceId}/live?channel=${channel}&subtype=${subtype}&_=${tick}`,
      tenantId,
    );
    return `${API}${q}`;
  }, [tenantId, deviceId, channel, subtype, tick, status.agentOnline]);

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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ap-line-soft)] bg-[#0a1826] px-2.5 py-1.5">
        <div className="min-w-0">
          <p className="ops-brand leading-none">AccesoCam</p>
          {!minimalChrome ? (
            <p className="truncate text-[13px] text-[var(--ap-text-dim)]">
              {selected ? `${selected.name} · ${selected.host}` : "Sin equipo"}
              {` · ${subtype === 1 ? "extra" : "principal"}`}
              {` · ch${channel}`}
            </p>
          ) : selected ? (
            <p className="truncate text-[10px] text-[var(--ap-muted)]">{selected.name}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {devices.length > 1 ? (
            <select
              className="rounded border border-[var(--ap-line)] bg-[var(--ap-ink)] px-2 py-1 text-[11px]"
              value={deviceId ?? ""}
              onChange={(e) => {
                setDeviceId(e.target.value);
                setTick((n) => n + 1);
              }}
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          ) : null}
          {!minimalChrome ? (
            <>
              <select
                className="rounded border border-[var(--ap-line)] bg-[var(--ap-ink)] px-2 py-1 text-[11px]"
                value={subtype}
                onChange={(e) => {
                  setSubtype(Number(e.target.value) === 0 ? 0 : 1);
                  setTick((n) => n + 1);
                }}
              >
                <option value={1}>Extra</option>
                <option value={0}>Principal</option>
              </select>
              <select
                className="rounded border border-[var(--ap-line)] bg-[var(--ap-ink)] px-2 py-1 text-[11px]"
                value={channel}
                onChange={(e) => {
                  setChannel(Number(e.target.value) || 1);
                  setTick((n) => n + 1);
                }}
              >
                <option value={1}>Ch1</option>
                <option value={2}>Ch2</option>
              </select>
            </>
          ) : null}
          <button
            type="button"
            className="rounded border border-[var(--ap-line)] px-2 py-1 text-[11px] text-[var(--ap-muted)] hover:border-[var(--ap-accent)] hover:text-[var(--ap-accent-bright)]"
            onClick={() => setTick((n) => n + 1)}
          >
            ↻
          </button>
        </div>
      </div>
      <div
        className={`relative min-h-0 flex-1 bg-[var(--ap-ink-deep)] ${
          compact && !minimalChrome ? "aspect-[16/10]" : ""
        }`}
      >
        {streamSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={streamSrc}
            alt="Live del lector"
            className="h-full w-full object-contain"
            onLoad={() => setError(null)}
            onError={() => {
              setError("Se cortó el live.");
              setTimeout(() => setTick((n) => n + 1), 2000);
            }}
          />
        ) : (
          <div className="grid h-full min-h-[160px] place-items-center px-4 text-center text-[13px] text-[var(--ap-muted)]">
            {!status.agentOnline
              ? "Agent offline"
              : !deviceId
                ? "Sin equipo"
                : "Preparando stream…"}
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
          <span className="font-mono text-[10px] tracking-wider text-[var(--ap-ok)] drop-shadow">LIVE</span>
          <span className="flex gap-2 text-[11px] text-white/80">
            <span title="Pantalla completa">⛶</span>
            <span title="Captura">▣</span>
            <span title="Favorito">☆</span>
          </span>
        </div>
      </div>
      {error ? (
        <p className="border-t border-[var(--ap-line-soft)] px-3 py-1.5 text-[11px] text-danger">{error}</p>
      ) : null}
    </section>
  );
}
