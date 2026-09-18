"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { Plus, X } from "lucide-react";

type Detection = {
  id: string;
  fecha: string;
  sentido: string;
  patente: string;
  ocrConf: number | null;
  autorizado: boolean | null;
  thumb: string | null;
};

type Live = {
  detections: Detection[];
  total?: number;
};

type PlateRow = {
  plate: string;
  list: string;
  note: string | null;
};

export function AlprPanel({ tenantId }: { tenantId: string }) {
  const [live, setLive] = useState<Live | null>(null);
  const [plates, setPlates] = useState<PlateRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Detection | null>(null);
  const [showPlate, setShowPlate] = useState(false);
  const [plateForm, setPlateForm] = useState({ plate: "", list: "white", note: "" });
  const [busy, setBusy] = useState(false);
  useEscapeKey(() => setOpen(null), !!open);
  useEscapeKey(() => setShowPlate(false), showPlate);

  const t = (path: string) => withTenant(path, tenantId);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [data, list] = await Promise.all([
          api<Live>(t("/api/alpr/live")),
          api<{ plates: PlateRow[] }>(t("/api/plates")).catch(() => ({ plates: [] as PlateRow[] })),
        ]);
        if (!cancelled) {
          setLive(data);
          setPlates(list.plates ?? []);
          setError(null);
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

  async function onAddPlate(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(t("/api/plates"), { method: "POST", body: JSON.stringify(plateForm) });
      setShowPlate(false);
      setPlateForm({ plate: "", list: "white", note: "" });
      const list = await api<{ plates: PlateRow[] }>(t("/api/plates"));
      setPlates(list.plates ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la patente");
    } finally {
      setBusy(false);
    }
  }

  async function removePlate(plate: string) {
    setError(null);
    try {
      await api(t(`/api/plates/${encodeURIComponent(plate)}`), { method: "DELETE" });
      setPlates((rows) => rows.filter((r) => r.plate !== plate));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo quitar la patente");
    }
  }

  const detections = live?.detections ?? [];

  return (
    <section className="space-y-5">
      {error ? <p className="text-sm text-rose-600 dark:text-danger">{error}</p> : null}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Lista de patentes</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Blanca dispara el relé con trigger Patente. Negra se registra y no abre.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            onClick={() => setShowPlate(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Nueva patente
          </button>
        </div>
        {!plates.length ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Todavía no hay patentes en lista.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {plates.map((p) => (
              <li key={p.plate} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-mono text-sm text-slate-900 dark:text-white">{p.plate}</span>
                  <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                    {p.list === "black" ? "negra" : "blanca"}
                    {p.note ? ` · ${p.note}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-xs font-medium text-rose-600 hover:underline dark:text-rose-400"
                  onClick={() => removePlate(p.plate)}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Últimas lecturas</h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Eventos de chapa en AccesoPro. Cámaras ALPR se cablean en Puntos de acceso.
        </p>
        {!detections.length ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Sin lecturas todavía.</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {detections.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-left hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950/50 dark:hover:border-slate-600"
                  onClick={() => setOpen(d)}
                >
                  <PlateThumb src={d.thumb} className="h-14 w-24 shrink-0 rounded-md bg-slate-200 object-cover dark:bg-slate-800" />
                  <span className="min-w-0">
                    <span className="block font-mono text-sm text-slate-900 dark:text-white">{d.patente || "—"}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {d.sentido === "out" ? "salida" : "ingreso"}
                      {d.ocrConf != null ? ` · ${Math.round((d.ocrConf > 1 ? d.ocrConf : d.ocrConf * 100))}%` : ""}
                      {d.autorizado === true ? " · autorizado" : d.autorizado === false ? " · no autorizado" : ""}
                    </span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{formatWhen(d.fecha)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showPlate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowPlate(false)}>
          <form
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
            onSubmit={onAddPlate}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Nueva patente</h3>
              <button type="button" className="text-slate-500 hover:text-slate-800 dark:hover:text-white" onClick={() => setShowPlate(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mb-3 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Patente
              <input
                required
                value={plateForm.plate}
                onChange={(e) => setPlateForm({ ...plateForm, plate: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </label>
            <label className="mb-3 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Lista
              <select
                value={plateForm.list}
                onChange={(e) => setPlateForm({ ...plateForm, list: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="white">Blanca (abre)</option>
                <option value="black">Negra (no abre)</option>
              </select>
            </label>
            <label className="mb-4 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Nota
              <input
                value={plateForm.note}
                onChange={(e) => setPlateForm({ ...plateForm, note: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700" onClick={() => setShowPlate(false)}>
                Cancelar
              </button>
              <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(null)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-mono text-lg text-slate-900 dark:text-white">
                {open.patente}{" "}
                <span className="font-sans text-sm text-slate-500 dark:text-slate-400">
                  {open.sentido === "out" ? "salida" : "ingreso"} · {formatWhen(open.fecha)}
                </span>
              </p>
              <button
                className="rounded-lg border border-slate-200 px-3 py-1 text-sm dark:border-slate-700"
                type="button"
                onClick={() => setOpen(null)}
              >
                Cerrar
              </button>
            </div>
            <PlateThumb src={open.thumb} className="w-full rounded-md bg-slate-100 dark:bg-slate-800" />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatWhen(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-AR");
}

function PlateThumb({ src, className }: { src: string | null; className?: string }) {
  if (!src) return <div className={className} />;
  return <img src={src} alt="" className={className} />;
}
