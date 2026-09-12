"use client";

import { useEffect, useState } from "react";
import { api, apiUrl, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { useEscapeKey } from "@/hooks/useEscapeKey";

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
  configured?: boolean;
  cameraHost?: string;
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
  const { status } = useDash();
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Detection | null>(null);
  useEscapeKey(() => setOpen(null), !!open);

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

  const engineUrl = live?.engineUrl ?? "http://127.0.0.1:5051";
  const outOn = Boolean(live?.out?.configured || live?.out?.running || status.cameraOut?.configured);
  const evidenceOn = Boolean(status.evidenceIn || status.evidenceOut);
  const evidenceForOpen =
    open &&
    ((open.sentido === "out" && status.evidenceOut) || (open.sentido !== "out" && status.evidenceIn)) &&
    Boolean(open.evidence);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge ok={live?.engineOnline} label={live?.engineOnline ? "Motor en línea" : "Motor offline"} />
          <Badge ok={live?.in?.running} label={`Ingreso ${live?.in?.running ? "vivo" : "sin señal"}`} />
          {outOn ? <Badge ok={live?.out?.running} label={`Salida ${live?.out?.running ? "viva" : "sin señal"}`} /> : null}
          {evidenceOn ? <Badge ok label="Evidencia on" /> : null}
        </div>
        <a
          href={engineUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:border-[#3a3a3a] hover:text-[#e6e6e6]"
        >
          Abrir AccesoSeguro
        </a>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <p className="text-[12px] text-muted">
        Live del motor AccesoSeguro ({live?.in?.cameraHost || "LAN"}). Si ves «Entrada Libertad», es esa cámara RTSP, no
        AccesoPro.
      </p>
      {live?.engineOnline && live?.in?.configured !== false ? (
        <img
          src={`${engineUrl}/video_feed/in`}
          alt="Live ALPR ingreso"
          className="aspect-video max-h-64 w-full rounded-md border border-line bg-black object-contain"
        />
      ) : null}

      <div className="card p-5">
        <h2 className="text-sm font-medium text-[#e6e6e6]">Últimas lecturas</h2>
        {!live?.detections.length ? (
          <p className="mt-2 text-sm text-muted">
            {live?.engineOnline ? "Todavía no hay detecciones." : "En espera del motor en :5051."}
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {live.detections
              .filter((d) => outOn || d.sentido !== "out")
              .map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md border border-line bg-ink p-2 text-left hover:border-[#3a3a3a]"
                    onClick={() => setOpen(d)}
                  >
                    <SiteImage path={d.thumb} tenantId={tenantId} className="h-14 w-24 shrink-0 rounded-md bg-panel2 object-cover" />
                    <span className="min-w-0">
                      <span className="block font-mono text-sm">{d.patente || "—"}</span>
                      <span className="block text-xs text-muted">
                        {d.sentido === "out" ? "salida" : "ingreso"}
                        {d.ocrConf != null ? ` · ${Math.round(d.ocrConf * 100)}%` : ""}
                        {d.autorizado === true ? " · autorizado" : d.autorizado === false ? " · no autorizado" : ""}
                      </span>
                      <span className="block truncate text-xs text-muted">{formatWhen(d.fecha)}</span>
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(null)}>
          <div
            className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-lg border border-line bg-panel p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-mono text-lg">
                {open.patente}{" "}
                <span className="font-sans text-sm text-muted">
                  {open.sentido === "out" ? "salida" : "ingreso"} · {formatWhen(open.fecha)}
                </span>
              </p>
              <button className="btn-ghost" type="button" onClick={() => setOpen(null)}>
                Cerrar
              </button>
            </div>
            <div className={`grid gap-3 ${evidenceForOpen ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
              <figure>
                <figcaption className="mb-1 text-xs text-muted">Patente</figcaption>
                <SiteImage path={open.thumb} tenantId={tenantId} className="w-full rounded-md bg-ink" />
              </figure>
              <figure>
                <figcaption className="mb-1 text-xs text-muted">Escena</figcaption>
                <SiteImage path={open.scene} tenantId={tenantId} className="w-full rounded-md bg-ink" />
              </figure>
              {evidenceForOpen ? (
                <figure>
                  <figcaption className="mb-1 text-xs text-muted">Evidencia</figcaption>
                  <SiteImage path={open.evidence} tenantId={tenantId} className="w-full rounded-md bg-ink" />
                </figure>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Badge({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <span className={`rounded-md border px-2 py-1 ${ok ? "border-ok/30 text-ok" : "border-line text-muted"}`}>{label}</span>
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
    const url = apiUrl(withTenant(`/api/alpr/media?p=${encodeURIComponent(path)}`, tenantId));
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
