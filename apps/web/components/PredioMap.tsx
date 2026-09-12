"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";

type Point = {
  id: string;
  name: string;
  sector: string;
  sentido: string;
  mapX: string | null;
  mapY: string | null;
};

type AlarmPin = {
  id: string;
  type: string;
  status: string;
  lotNumber?: string | null;
  zone?: string | null;
};

const SENTIDO: Record<string, string> = { in: "Entrada", out: "Salida", both: "Ambos" };

export function PredioMap() {
  const { tenantId, enabled, can } = useDash();
  const [points, setPoints] = useState<Point[]>([]);
  const [alarms, setAlarms] = useState<AlarmPin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canEdit = can("core.config");

  const t = (path: string) => withTenant(path, tenantId);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const data = await api<{ accessPoints: Point[] }>(t("/api/access-points")).catch(() => ({
      accessPoints: [] as Point[],
    }));
    setPoints(data.accessPoints || []);
    if (enabled("panic") || enabled("fire")) {
      const a = await api<{ alarms: AlarmPin[] }>(t("/api/alarms")).catch(() => ({ alarms: [] as AlarmPin[] }));
      setAlarms((a.alarms || []).filter((x) => x.status === "open" || x.status === "acked"));
    } else {
      setAlarms([]);
    }
  }, [tenantId, enabled]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Error"));
  }, [load]);

  function pctFromEvent(e: React.PointerEvent) {
    const el = boxRef.current;
    if (!el) return { x: 50, y: 50 };
    const r = el.getBoundingClientRect();
    const x = Math.min(95, Math.max(5, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.min(95, Math.max(5, ((e.clientY - r.top) / r.height) * 100));
    return { x, y };
  }

  async function savePin(id: string, x: number, y: number) {
    if (!tenantId || !canEdit) return;
    await api(t(`/api/access-points/${id}`), {
      method: "PUT",
      body: JSON.stringify({ mapX: String(Math.round(x * 10) / 10), mapY: String(Math.round(y * 10) / 10) }),
    });
  }

  return (
    <div>
      {error ? <p className="mb-2 text-sm text-rose-600">{error}</p> : null}
      <div
        ref={boxRef}
        className="relative min-h-[460px] overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-900"
        onPointerMove={(e) => {
          if (!dragId.current) return;
          const { x, y } = pctFromEvent(e);
          setPoints((prev) => prev.map((p) => (p.id === dragId.current ? { ...p, mapX: String(x), mapY: String(y) } : p)));
        }}
        onPointerUp={(e) => {
          if (!dragId.current) return;
          const id = dragId.current;
          dragId.current = null;
          const { x, y } = pctFromEvent(e);
          void savePin(id, x, y);
        }}
      >
        <div className="pointer-events-none absolute inset-4 rounded-xl border border-slate-200 dark:border-slate-700" />
        <p className="absolute left-4 top-3 text-[11px] uppercase tracking-wide text-slate-400">
          Croquis · {canEdit ? "arrastrá los pines" : "solo lectura"}
        </p>
        {points.map((p, i) => {
          const left = Number(p.mapX);
          const top = Number(p.mapY);
          const x = Number.isFinite(left) ? left : 18 + (i % 4) * 20;
          const y = Number.isFinite(top) ? top : 28 + Math.floor(i / 4) * 18;
          return (
            <button
              key={p.id}
              type="button"
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border border-sky-600 bg-sky-500 px-2 py-1 text-[11px] font-semibold text-white shadow"
              style={{ left: `${x}%`, top: `${y}%` }}
              onPointerDown={(e) => {
                if (!canEdit) return;
                e.preventDefault();
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                dragId.current = p.id;
              }}
              title={`${p.name} · ${SENTIDO[p.sentido] || p.sentido}`}
            >
              {p.name}
            </button>
          );
        })}
        {alarms.map((a, i) => (
          <span
            key={a.id}
            className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[10px] font-bold text-white ${
              a.type === "fire_contact" ? "bg-orange-600" : "bg-rose-600"
            }`}
            style={{ left: `${72 + (i % 3) * 6}%`, top: `${18 + i * 8}%` }}
          >
            {a.type === "fire_contact" ? "Fuego" : "SOS"} {a.lotNumber || a.zone || ""}
          </span>
        ))}
        {points.length === 0 ? (
          <p className="absolute inset-0 grid place-items-center text-sm text-slate-500">
            Cargá puntos de acceso para ver pines acá.
          </p>
        ) : null}
      </div>
    </div>
  );
}
