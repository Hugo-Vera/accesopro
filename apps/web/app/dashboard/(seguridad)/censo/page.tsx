"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Printer } from "lucide-react";
import { ModuleGate, PageHeader } from "@/components/PageHeader";
import { api, apiUrl, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";

type LotRow = {
  lotNumber: string;
  label: string;
  adults: number;
  minors: number;
  occupants: number;
  ownerName: string | null;
  phone: string | null;
  emergencyPhone: string | null;
  guests: { name: string; dni: string | null; patente: string | null; adults: number; minors: number }[];
};

export default function CensoPage() {
  const { tenantId } = useDash();
  const [data, setData] = useState<{
    generatedAt: number;
    lotsWithPeople: number;
    adults: number;
    minors: number;
    total: number;
    lots: LotRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const d = await api<{
      generatedAt: number;
      lotsWithPeople: number;
      adults: number;
      minors: number;
      total: number;
      lots: LotRow[];
    }>(withTenant("/api/census", tenantId));
    setData(d);
  }, [tenantId]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Error"));
    const id = window.setInterval(() => load().catch(() => null), 8000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <ModuleGate module="visitors">
      <PageHeader
        title="Censo de evacuación"
        subtitle="Visitas en predio lote a lote, con teléfonos del titular. Para Bomberos / Defensa Civil."
      />
      {error ? <p className="mb-3 text-sm text-rose-600">{error}</p> : null}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {data ? `${data.total} vidas · ${data.adults} adultas · ${data.minors} menores · ${data.lotsWithPeople} lotes` : "Cargando…"}
        </p>
        {tenantId ? (
          <a
            href={apiUrl(withTenant("/api/census/export", tenantId))}
            target="_blank"
            rel="noreferrer"
            className="btn-primary inline-flex items-center gap-2"
          >
            <Printer className="h-4 w-4" />
            Imprimir / PDF
          </a>
        ) : null}
      </div>
      <div className="space-y-2">
        {!data?.lots.length ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-600">
            No hay visitas marcadas en predio. El vecino con cara no entra en este conteo.
          </p>
        ) : (
          data.lots.map((lot) => (
            <article
              key={lot.lotNumber}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
            >
              <p className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                <ClipboardList className="h-4 w-4" />
                Lote {lot.lotNumber} · {lot.label}
              </p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {lot.adults} adultas · {lot.minors} menores · {lot.ownerName || "Sin titular"} · tel. {lot.phone || "—"} · emerg. {lot.emergencyPhone || "—"}
              </p>
              <ul className="mt-2 list-disc pl-5 text-xs text-slate-500 dark:text-slate-400">
                {lot.guests.map((g, i) => (
                  <li key={i}>
                    {g.name}
                    {g.dni ? ` · DNI ${g.dni}` : ""}
                    {g.patente ? ` · ${g.patente}` : ""} ({g.adults} ad. / {g.minors} men.)
                  </li>
                ))}
              </ul>
            </article>
          ))
        )}
      </div>
    </ModuleGate>
  );
}
