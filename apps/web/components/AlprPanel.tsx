"use client";

import { useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

type Detection = {
  id: number;
  fecha: string;
  sentido: string;
  patente: string;
  ocrConf: number | null;
  detectorConf: number | null;
  region: string | null;
  autorizado: boolean | null;
  thumb: string | null;
  scene: string | null;
  evidence: string | null;
};

type CamStatus = {
  running?: boolean;
  source?: string;
  detections_total?: number;
};

type Live = {
  engineOnline: boolean;
  engineUrl: string;
  detections: Detection[];
  total?: number;
  in?: CamStatus | null;
  out?: CamStatus | null;
  error?: string;
};

export function AlprPanel({ tenantId }: { tenantId: string }) {
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Detection | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api<Live>(withTenant("/api/alpr/live", tenantId));
        if (!cancelled) {
          setLive(data);
          setError(data.error ?? null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error");
      }
    }
    load();
    const id = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tenantId]);

  const engineUrl = live?.engineUrl ?? "http://192.168.33.13:5051";

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge ok={live?.engineOnline} label={live?.engineOnline ? "Motor en línea" : "Motor offline"} />
          <Badge ok={live?.in?.running} label={`Ingreso ${live?.in?.running ? "vivo" : "sin señal"}`} />
          <Badge ok={live?.out?.running} label={`Salida ${live?.out?.running ? "viva" : "sin señal"}`} />
        </div>
        <a
          href={engineUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-line px-3 py-1.5 text-sm text-slate-300 hover:border-accent"
        >
          Abrir AccesoSeguro
        </a>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="rounded-2xl border border-line bg-panel p-6">
        <h2 className="text-sm font-medium text-slate-300">Últimas lecturas</h2>
        {!live?.detections.length ? (
          <p className="mt-2 text-sm text-slate-500">
            {live?.engineOnline ? "Todavía no hay detecciones." : "En espera del motor en :5051."}
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {live.detections.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-ink p-2 text-left hover:border-accent"
                  onClick={() => setOpen(d)}
                >
                  <SiteImage
                    path={d.thumb}
                    tenantId={tenantId}
                    className="h-14 w-24 shrink-0 rounded-md object-cover bg-slate-800"
                  />
                  <span className="min-w-0">
                    <span className="block font-mono text-sm">{d.patente || "—"}</span>
                    <span className="block text-xs text-slate-500">
                      {d.sentido === "out" ? "salida" : "ingreso"}
                      {d.ocrConf != null ? ` · ${Math.round(d.ocrConf * 100)}%` : ""}
                      {d.autorizado === true ? " · autorizado" : d.autorizado === false ? " · no autorizado" : ""}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{formatWhen(d.fecha)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl border border-line bg-panel p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-mono text-lg">
                {open.patente}{" "}
                <span className="text-sm font-sans text-slate-400">
                  {open.sentido === "out" ? "salida" : "ingreso"} · {formatWhen(open.fecha)}
                </span>
              </p>
              <button className="text-slate-400" type="button" onClick={() => setOpen(null)}>
                Cerrar
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <figure>
                <figcaption className="mb-1 text-xs text-slate-400">Patente</figcaption>
                <SiteImage path={open.thumb} tenantId={tenantId} className="w-full rounded-lg bg-slate-800" />
              </figure>
              <figure>
                <figcaption className="mb-1 text-xs text-slate-400">Escena</figcaption>
                <SiteImage path={open.scene} tenantId={tenantId} className="w-full rounded-lg bg-slate-800" />
              </figure>
              <figure>
                <figcaption className="mb-1 text-xs text-slate-400">Evidencia</figcaption>
                <SiteImage path={open.evidence} tenantId={tenantId} className="w-full rounded-lg bg-slate-800" />
              </figure>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Badge({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-1 ${
        ok ? "border-accent/40 text-accent" : "border-line text-slate-500"
      }`}
    >
      {label}
    </span>
  );
}

function formatWhen(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-AR");
}

function SiteImage({
  path,
  tenantId,
  className,
}: {
  path: string | null;
  tenantId: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setSrc(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    const url = `${API}${withTenant(`/api/alpr/media?p=${encodeURIComponent(path)}`, tenantId)}`;
    fetch(url, { credentials: "include" })
      .then((res) => (res.ok ? res.blob() : Promise.reject()))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, tenantId]);

  if (!src) {
    return <div className={className} />;
  }
  return <img src={src} alt="" className={className} />;
}
