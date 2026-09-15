"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { FeatureGate, PageHeader } from "@/components/PageHeader";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { eventPhotoUrl } from "@/components/ops/parseFacialEvent";
import { EventPhoto } from "@/components/ops/EventPhoto";

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
    api<{ events: EventRow[] }>(withTenant("/api/events?type=dahua_access,qr_access&limit=80", tenantId))
      .then((d) => setEvents(d.events || []))
      .catch((err) => setError(err instanceof Error ? err.message : "Error"));
  }, [tenantId]);

  const withPhoto = events.filter((e) => e.payload.photoStored === true);

  return (
    <FeatureGate feature="dahua.evidence" capability="dahua.evidence">
      <PageHeader
        title="Evidencia del lector"
        subtitle="Fotos copiadas al historial del barrio (no se vuelven a pedir al ASI)."
      />
      {error ? <p className="mb-3 text-sm text-rose-600">{error}</p> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {withPhoto.length === 0 ? (
          <p className="col-span-full rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-600">
            Todavía no hay fotos locales. Los pases nuevos copian el JPEG al barrio una sola vez.
          </p>
        ) : (
          withPhoto.map((e) => {
            const name = String(e.payload.personName || e.payload.CardName || "Acceso");
            return (
              <button
                key={e.id}
                type="button"
                className="overflow-hidden rounded-xl border border-slate-200 bg-white text-left dark:border-slate-700 dark:bg-slate-900"
                onClick={() => setSelected(e)}
              >
                <div className="relative aspect-[3/4] bg-slate-100 dark:bg-slate-800">
                  <EventPhoto
                    eventId={e.id}
                    tenantId={tenantId}
                    photoStored
                    createdAt={e.createdAt}
                    alt=""
                    className="h-full w-full object-cover"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      objectPosition: "center top",
                      position: "relative",
                      zIndex: 1,
                    }}
                  />
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
            <div className="relative min-h-[240px]">
              <EventPhoto
                eventId={selected.id}
                tenantId={tenantId}
                photoStored
                createdAt={selected.createdAt}
                alt=""
                className="w-full rounded-lg"
                style={{ width: "100%", display: "block", position: "relative", zIndex: 1 }}
              />
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              {String(selected.payload.personName || selected.payload.CardName || "Acceso")}
            </p>
            {eventPhotoUrl(selected.id, tenantId) ? (
              <a
                href={eventPhotoUrl(selected.id, tenantId) || ""}
                download={`captura_${selected.id}.jpg`}
                className="mt-2 inline-block text-xs font-semibold text-blue-600"
              >
                Descargar JPG
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </FeatureGate>
  );
}
