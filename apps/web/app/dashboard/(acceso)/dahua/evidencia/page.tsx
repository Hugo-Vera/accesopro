"use client";

import { useEffect, useState } from "react";
import { Camera, X } from "lucide-react";
import { FeatureGate, PageHeader } from "@/components/PageHeader";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { snapshotProxyUrl } from "@/components/ops/parseFacialEvent";

type EventRow = {
  id: string;
  type: string;
  createdAt: string | number;
  payload: Record<string, unknown>;
};

export default function DahuaEvidenciaPage() {
  const { tenantId } = useDash();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selected, setSelected] = useState<EventRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEscapeKey(() => setSelected(null), !!selected);

  useEffect(() => {
    if (!tenantId) return;
    api<{ events: EventRow[] }>(withTenant("/api/events?type=dahua_access&limit=80", tenantId))
      .then((d) => setEvents(d.events || []))
      .catch((err) => setError(err instanceof Error ? err.message : "Error"));
  }, [tenantId]);

  const withPhoto = events.filter((e) => {
    const url = String(e.payload.snapshotUrl || e.payload.FilePath || e.payload.filePath || "");
    return Boolean(url) || Boolean(e.payload.deviceId);
  });

  return (
    <FeatureGate feature="dahua.evidence" capability="dahua.evidence">
      <PageHeader
        title="Evidencia del lector"
        subtitle="Fotos copiadas al historial del barrio (más retenible que el SD del ASI)."
      />
      {error ? <p className="mb-3 text-sm text-rose-600">{error}</p> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {withPhoto.length === 0 ? (
          <p className="col-span-full rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-600">
            Todavía no hay fotos en el historial. Los pases faciales con snapshot aparecen acá.
          </p>
        ) : (
          withPhoto.map((e) => {
            const deviceId = String(e.payload.deviceId || "");
            const snap = String(e.payload.snapshotUrl || e.payload.FilePath || "");
            const src = snapshotProxyUrl(deviceId, snap, tenantId);
            const name = String(e.payload.personName || e.payload.CardName || "Acceso");
            return (
              <button
                key={e.id}
                type="button"
                className="overflow-hidden rounded-xl border border-slate-200 bg-white text-left dark:border-slate-700 dark:bg-slate-900"
                onClick={() => setSelected(e)}
              >
                <div className="aspect-[3/4] bg-slate-100 dark:bg-slate-800">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-slate-400">
                      <Camera className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="truncate text-[12px] font-semibold text-slate-800 dark:text-slate-100">{name}</p>
                  <p className="font-mono text-[10px] text-slate-400">
                    {new Date(e.createdAt).toLocaleString("es-AR", { hour12: false })}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
      {selected ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setSelected(null)}>
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-4 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex justify-end">
              <button type="button" onClick={() => setSelected(null)}>
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={
                snapshotProxyUrl(
                  String(selected.payload.deviceId || ""),
                  String(selected.payload.snapshotUrl || selected.payload.FilePath || ""),
                  tenantId,
                ) || ""
              }
              alt=""
              className="w-full rounded-lg"
            />
            <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              {String(selected.payload.personName || selected.payload.CardName || "Acceso")}
            </p>
          </div>
        </div>
      ) : null}
    </FeatureGate>
  );
}
