"use client";

import { FormEvent, useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { ModuleGate, PageHeader } from "@/components/PageHeader";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";

type Alarm = {
  id: string;
  createdAt: number;
  status: string;
  message: string;
  zone?: string | null;
};

export default function FuegoPage() {
  const { tenantId } = useDash();
  const [rows, setRows] = useState<Alarm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const t = (path: string) => withTenant(path, tenantId);

  async function load() {
    if (!tenantId) return;
    const d = await api<{ alarms: Alarm[] }>(t("/api/alarms?kind=fire"));
    setRows(d.alarms || []);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Error"));
    const id = setInterval(() => load().catch(() => null), 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function setContact(active: boolean, e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(t("/api/alarms/fire"), {
        method: "POST",
        body: JSON.stringify({ active, zone: "Panel principal" }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar");
    } finally {
      setBusy(false);
    }
  }

  const latest = rows[0];

  return (
    <ModuleGate module="fire">
      <PageHeader
        title="Fuego (supervisión)"
        subtitle="Contacto del panel existente. No reemplaza un sistema contra incendio certificado."
      />
      {error ? <p className="mb-3 text-sm text-rose-600">{error}</p> : null}
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <Flame className="h-4 w-4 text-orange-500" />
          Estado del contacto
        </p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {latest?.status === "open" ? "Abierto (alarma)" : "Normalizado / sin evento"}
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-primary" disabled={busy} onClick={(e) => void setContact(true, e)}>
            Simular contacto abierto
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
            disabled={busy}
            onClick={(e) => void setContact(false, e)}
          >
            Normalizar
          </button>
        </div>
      </div>
      <ul className="space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
            {new Date(r.createdAt).toLocaleString("es-AR")} · {r.message} · {r.status}
          </li>
        ))}
      </ul>
    </ModuleGate>
  );
}
