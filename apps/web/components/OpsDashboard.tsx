"use client";

import { useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";

type Cam = {
  running?: boolean;
  alpr_active?: boolean;
  frame_id?: number;
  processed_frames?: number;
  last_inference_ms?: number;
  dedup_skipped?: number;
  detections_total?: number;
  cameraHost?: string;
};

type EventRow = {
  id?: string | number;
  fecha?: string;
  patente?: string;
  resultado?: string;
  motivo?: string;
  sentido?: string;
};

type Actuator = {
  id: string;
  name: string;
  driver: string;
  engineSentido: "in" | "out" | null;
  open: boolean | null;
};

type Ops = {
  engineOnline: boolean;
  engineUrl: string;
  in: Cam | null;
  out: Cam | null;
  stats: { hoy_autorizado?: number; hoy_denegado?: number; hoy_total?: number } | null;
  relay: {
    simulated?: boolean;
    open_in?: boolean;
    open_out?: boolean;
    barrier_in_status?: string;
  } | null;
  events: EventRow[];
};

export function OpsDashboard() {
  const { tenantId } = useDash();
  const [ops, setOps] = useState<Ops | null>(null);
  const [acts, setActs] = useState<Actuator[]>([]);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!tenantId) return;
    const [data, listed] = await Promise.all([
      api<Ops>(withTenant("/api/alpr/ops", tenantId)),
      api<{ actuators: Actuator[] }>(withTenant("/api/actuators", tenantId)).catch(() => ({ actuators: [] as Actuator[] })),
    ]);
    setOps(data);
    setActs(listed.actuators);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Error"));
    const id = setInterval(() => load().catch(() => null), 4000);
    return () => clearInterval(id);
  }, [tenantId]);

  async function relay(action: "open" | "close", sentido: "in" | "out") {
    if (!tenantId) return;
    setBusy(`${action}-${sentido}`);
    setError(null);
    const mapped = acts.find((a) => a.driver === "engine" && a.engineSentido === sentido);
    try {
      if (mapped) {
        const r = await api<{ ok: boolean; error?: string }>(withTenant(`/api/actuators/${mapped.id}/${action}`, tenantId), {
          method: "POST",
        });
        if (!r.ok) setError(r.error || "Fallo el actuador");
      } else {
        await api(withTenant(`/api/alpr/relay/${action}`, tenantId), {
          method: "POST",
          body: JSON.stringify({ sentido }),
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fallo el relé");
    } finally {
      setBusy(null);
    }
  }

  const last = ops?.events.find((e) => e.patente);
  const lastOk = last?.resultado === "autorizado" || last?.resultado === "manual";
  const engineUrl = (ops?.engineUrl ?? "http://192.168.33.13:5051").replace(/\/$/, "");
  const actIn = acts.find((a) => a.driver === "engine" && a.engineSentido === "in");
  const actOut = acts.find((a) => a.driver === "engine" && a.engineSentido === "out");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold">Dashboard</h1>
          <span className={`badge ${ops?.engineOnline ? "badge-green" : "badge-gray"}`}>
            {ops?.engineOnline ? "EN VIVO" : "OFFLINE"}
          </span>
          <span className="badge badge-gray">
            Relé: {ops?.relay?.simulated ? "SIMULADO" : ops?.relay?.open_in || ops?.relay?.open_out ? "ABIERTO" : "CERRADO"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {last?.patente ? (
            <span className={`last-plate-chip ${lastOk ? "ok" : "deny"}`}>
              {last.patente} · {lastOk ? "AUTORIZADO" : (last.resultado ?? "").toUpperCase()}
            </span>
          ) : null}
          <button type="button" className="btn-ghost" onClick={() => setTick(Date.now())}>
            Recargar video
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <CameraCard
          title="Cámara Ingreso (IN)"
          accent="in"
          src={`${engineUrl}/video_feed/in?t=${tick}`}
          running={ops?.in?.running}
          active={ops?.in?.alpr_active}
        />
        <CameraCard
          title="Cámara Salida (OUT)"
          accent="out"
          src={`${engineUrl}/video_feed/out?t=${tick}`}
          running={ops?.out?.running}
          active={ops?.out?.alpr_active}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <BarrierCard
          label={actIn?.name ?? "Barrera IN (Ingreso)"}
          open={actIn?.open ?? !!ops?.relay?.open_in}
          busy={busy}
          onOpen={() => relay("open", "in")}
          onClose={() => relay("close", "in")}
          lado="in"
        />
        <BarrierCard
          label={actOut?.name ?? "Barrera OUT (Salida)"}
          open={actOut?.open ?? !!ops?.relay?.open_out}
          busy={busy}
          onOpen={() => relay("open", "out")}
          onClose={() => relay("close", "out")}
          lado="out"
        />
        <div className="grid grid-cols-3 gap-2">
          <MiniKpi value={ops?.stats?.hoy_autorizado ?? "–"} label="Autorizados" tone="ok" />
          <MiniKpi value={ops?.stats?.hoy_denegado ?? "–"} label="Denegados" tone="danger" />
          <MiniKpi value={ops?.stats?.hoy_total ?? "–"} label="Total hoy" tone="accent" />
        </div>
      </div>

      <section className="card">
        <div className="card-h">Rendimiento del motor de IA</div>
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 lg:grid-cols-7">
          <MiniKpi value={ops?.in?.frame_id ?? "–"} label="Frame ID" />
          <MiniKpi value={ops?.in?.processed_frames ?? "–"} label="Procesados" />
          <MiniKpi value={ops?.in?.last_inference_ms ?? "–"} label="Latencia ms" />
          <MiniKpi value={ops?.in?.dedup_skipped ?? "–"} label="Omitidos dedup" />
          <MiniKpi value={ops?.stats?.hoy_total ?? "–"} label="Detecciones hoy" />
          <MiniKpi value={ops?.in?.detections_total ?? "–"} label="Memoria IN" />
          <MiniKpi value={ops?.out?.detections_total ?? "–"} label="Memoria OUT" />
        </div>
      </section>

      <section className="card">
        <div className="card-h">Eventos recientes en tiempo real</div>
        <ul className="max-h-56 divide-y divide-line overflow-auto">
          {(ops?.events ?? []).slice(0, 12).map((ev, i) => {
            const ok = ev.resultado === "autorizado" || ev.resultado === "manual";
            return (
              <li key={String(ev.id ?? i)} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="font-mono font-semibold">{ev.patente || "—"}</span>
                <span className={`badge ${ok ? "badge-green" : "badge-gray"}`}>{labelResultado(ev.resultado)}</span>
                <span className="truncate text-muted">{ev.motivo}</span>
                <span className="shrink-0 text-xs text-muted">{(ev.fecha ?? "").slice(11, 19)}</span>
              </li>
            );
          })}
          {!ops?.events?.length ? <li className="px-4 py-3 text-sm text-muted">Sin eventos todavía.</li> : null}
        </ul>
      </section>
    </div>
  );
}

function CameraCard({
  title,
  accent,
  src,
  running,
  active,
}: {
  title: string;
  accent: "in" | "out";
  src: string;
  running?: boolean;
  active?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <section className="card overflow-hidden">
      <div className="card-h flex items-center justify-between">
        <span className={`flex items-center gap-2 font-bold ${accent === "in" ? "text-accent" : "text-warn"}`}>
          <span className={`inline-block h-2 w-2 rounded-full ${running ? "bg-ok" : "bg-muted"}`} />
          {title}
        </span>
        <span className="badge badge-blue">ALPR + QR</span>
      </div>
      <div className="relative aspect-video bg-black">
        {failed ? (
          <div className="grid h-full place-items-center text-sm text-muted">Sin señal</div>
        ) : (
          <img
            src={src}
            alt={title}
            className="h-full w-full object-contain"
            onError={() => setFailed(true)}
          />
        )}
        <div className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-xs">
          ALPR: {active ? "ACTIVO" : "STANDBY"}
        </div>
      </div>
    </section>
  );
}

function BarrierCard({
  label,
  open,
  busy,
  onOpen,
  onClose,
  lado,
}: {
  label: string;
  open: boolean;
  busy: string | null;
  onOpen: () => void;
  onClose: () => void;
  lado: string;
}) {
  return (
    <div className={`relay-card ${open ? "open" : ""}`}>
      <div className={`relay-icon ${open ? "on" : ""}`}>{open ? "ON" : "OFF"}</div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {label}: {open ? "Abierta" : "Cerrada"}
        </p>
      </div>
      <div className="flex gap-1.5">
        <button type="button" className="btn-ok" disabled={!!busy} onClick={onOpen}>
          {busy === `open-${lado}` ? "…" : "Abrir"}
        </button>
        <button type="button" className="btn-danger" disabled={!!busy} onClick={onClose}>
          {busy === `close-${lado}` ? "…" : "Cerrar"}
        </button>
      </div>
    </div>
  );
}

function labelResultado(raw?: string) {
  if (!raw) return "";
  if (raw === "autorizado") return "AUTORIZADO";
  if (raw === "manual") return "MANUAL";
  if (raw === "manual_close") return "CIERRE MANUAL";
  if (raw === "sensor_close") return "SENSOR";
  if (raw === "timeout_close") return "TIMEOUT";
  if (raw.startsWith("denegado")) return "DENEGADO";
  return raw.replaceAll("_", " ").toUpperCase();
}

function MiniKpi({
  value,
  label,
  tone,
}: {
  value: string | number;
  label: string;
  tone?: "ok" | "danger" | "accent";
}) {
  const border =
    tone === "ok" ? "border-l-ok" : tone === "danger" ? "border-l-danger" : tone === "accent" ? "border-l-accent" : "border-l-line";
  return (
    <div className={`rounded-[10px] border border-line bg-panel p-2.5 text-center ${tone ? `border-l-4 ${border}` : ""}`}>
      <div className="text-xl font-extrabold leading-none">{value}</div>
      <div className="mt-1 text-[11px] text-muted">{label}</div>
    </div>
  );
}
