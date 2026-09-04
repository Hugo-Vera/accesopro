"use client";

import { useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { FeatureGate, PageHeader } from "@/components/PageHeader";

type EventRow = {
  id: string;
  type: string;
  createdAt: string | number;
  payload: Record<string, string>;
};

export default function DahuaEventosPage() {
  const { tenantId, can } = useDash();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    const load = () =>
      api<{ events: EventRow[] }>(withTenant("/api/events?type=dahua_access", tenantId))
        .then((d) => setEvents(d.events))
        .catch((err) => setError(err instanceof Error ? err.message : "Error"));
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [tenantId]);

  return (
    <FeatureGate feature="dahua.events" capability="dahua.events">
      <PageHeader
        title="Eventos Dahua"
        subtitle="Accesos por cara, tarjeta, huella o PIN. La foto al pasar llega en la próxima iteración."
      />
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
      {!can("dahua.open") ? (
        <p className="mb-3 text-[12px] text-muted">Sin permiso dahua.open: solo lectura de eventos.</p>
      ) : null}
      <div className="card overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-ink/40 text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2">Cuándo</th>
              <th className="px-3 py-2">Equipo</th>
              <th className="px-3 py-2">Usuario</th>
              <th className="px-3 py-2">Método</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {events.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-muted">
                  Todavía no hay eventos. Con el agent arriba, el lector los manda al pasar.
                </td>
              </tr>
            ) : (
              events.map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 text-muted">
                    {new Date(e.createdAt).toLocaleString("es-AR")}
                  </td>
                  <td className="px-3 py-2">{e.payload.deviceName || e.payload.deviceId || "—"}</td>
                  <td className="px-3 py-2">
                    {e.payload.CardName || e.payload.UserID || e.payload.userName || "—"}
                  </td>
                  <td className="px-3 py-2">{e.payload.Method || e.payload.method || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </FeatureGate>
  );
}
