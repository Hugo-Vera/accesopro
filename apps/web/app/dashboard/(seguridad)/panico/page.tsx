"use client";

import { FormEvent, useEffect, useState } from "react";
import { Bell, CheckCircle2, Siren, X } from "lucide-react";
import { ModuleGate, PageHeader } from "@/components/PageHeader";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";

type Alarm = {
  id: string;
  type: string;
  createdAt: number;
  status: string;
  source: string;
  message: string;
  lotNumber?: string | null;
  ownerName?: string | null;
};

export default function PanicoPage() {
  const { tenantId } = useDash();
  const [rows, setRows] = useState<Alarm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const t = (path: string) => withTenant(path, tenantId);

  async function load() {
    if (!tenantId) return;
    const d = await api<{ alarms: Alarm[] }>(t("/api/alarms?kind=panic"));
    setRows(d.alarms || []);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Error"));
    const id = setInterval(() => load().catch(() => null), 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function raise(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(t("/api/alarms/panic"), {
        method: "POST",
        body: JSON.stringify({ message: "SOS desde portería", source: "manual" }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModuleGate module="panic">
      <PageHeader
        title="Pánico / SOS"
        subtitle="Cola de alarmas del barrio. El vecino dispara SOS desde el portal si el módulo está contratado."
      />
      {error ? <p className="mb-3 text-sm text-rose-600">{error}</p> : null}
      <form onSubmit={raise} className="mb-4">
        <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy}>
          <Siren className="h-4 w-4" />
          Registrar SOS de portería
        </button>
      </form>
      <div className="space-y-2">
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-600">
            No hay alarmas. Cuando un vecino pulse SOS aparecen acá.
          </p>
        ) : (
          rows.map((a) => (
            <article
              key={a.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
            >
              <div>
                <p className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                  <Bell className="h-4 w-4 text-rose-500" />
                  {a.ownerName || "SOS"} {a.lotNumber ? `· lote ${a.lotNumber}` : ""}
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{a.message}</p>
                <p className="mt-1 font-mono text-[11px] text-slate-400">
                  {new Date(a.createdAt).toLocaleString("es-AR")} · {a.source} · {a.status}
                </p>
              </div>
              {a.status !== "closed" ? (
                <div className="flex gap-2">
                  {a.status === "open" ? (
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 px-2 py-1 text-[12px] dark:border-slate-600"
                      onClick={() => api(t(`/api/alarms/${a.id}/ack`), { method: "POST" }).then(load)}
                    >
                      <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                      Acusar
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-2 py-1 text-[12px] dark:border-slate-600"
                    onClick={() => api(t(`/api/alarms/${a.id}/close`), { method: "POST" }).then(load)}
                  >
                    <X className="mr-1 inline h-3.5 w-3.5" />
                    Cerrar
                  </button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    </ModuleGate>
  );
}
