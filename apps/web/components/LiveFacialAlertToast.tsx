"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, X, DoorOpen, ScanFace } from "lucide-react";

export type FacialEventAlert = {
  id: string;
  createdAt: string | number;
  approved: boolean;
  personName: string;
  method: string;
  deviceName: string;
  deviceId: string;
  snapshotUrl?: string;
  reason?: string;
  doorName?: string;
};

interface Props {
  alert: FacialEventAlert | null;
  onDismiss: () => void;
  onOpenRelay?: (deviceId: string) => void;
}

export function LiveFacialAlertToast({ alert, onDismiss, onOpenRelay }: Props) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const [animKey, setAnimKey] = useState(0);

  // Auto-cierre de 7 segundos sin timers de 50ms en JavaScript
  useEffect(() => {
    if (!alert?.id) return;
    setAnimKey((k) => k + 1);

    const timer = setTimeout(() => {
      onDismissRef.current();
    }, 7000);

    return () => clearTimeout(timer);
  }, [alert?.id]);

  if (!alert) return null;

  const isApproved = alert.approved;
  const photoProxy =
    alert.deviceId && alert.snapshotUrl
      ? `/api/dahua/${alert.deviceId}/record-snapshot?url=${encodeURIComponent(alert.snapshotUrl)}`
      : null;

  const timeStr = alert.createdAt
    ? new Date(alert.createdAt).toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "Ahora";

  return (
    <aside
      aria-label="Alerta de reconocimiento facial en vivo"
      className="fixed bottom-6 right-6 z-50 w-full max-w-md animate-in slide-in-from-bottom-5 duration-300 pointer-events-auto"
    >
      <style>{`
        @keyframes toastProgressAnim {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
      <div
        className={`relative overflow-hidden rounded-2xl border-2 shadow-2xl backdrop-blur-xl transition-all ${
          isApproved
            ? "border-emerald-500/80 bg-white/95 dark:bg-slate-900/95 shadow-emerald-500/10"
            : "border-rose-500/80 bg-white/95 dark:bg-slate-900/95 shadow-rose-500/10"
        }`}
      >
        {/* Barra de progreso de auto-cierre animada por CSS (GPU) sin forzar reflows ni re-renders */}
        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div
            key={animKey}
            className={`h-full ${isApproved ? "bg-emerald-500" : "bg-rose-500"}`}
            style={{
              animation: "toastProgressAnim 7s linear forwards",
            }}
          />
        </div>

        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide uppercase ${
                  isApproved
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300"
                    : "bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300"
                }`}
              >
                {isApproved ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Acceso Aprobado
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Acceso Denegado
                  </>
                )}
              </span>
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                {timeStr}
              </span>
            </div>

            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg p-1 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Cerrar notificación"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-4">
            {/* Foto del snapshot capturado por Dahua ASI (Proporción pantalla según datasheet: 272(H) × 480(V)) */}
            <div
              className={`relative w-20 aspect-[272/480] flex-shrink-0 overflow-hidden rounded-xl border-2 shadow-inner ${
                isApproved
                  ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/50"
                  : "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/50"
              }`}
            >
              {photoProxy ? (
                <img
                  src={photoProxy}
                  alt={alert.personName}
                  className="h-full w-full object-cover object-center"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : null}
              <div className="absolute inset-0 -z-10 flex flex-col items-center justify-center p-2 text-center text-slate-400 dark:text-slate-600">
                <ScanFace className="h-7 w-7 mb-1 opacity-50" />
                <span className="text-[9px] font-mono leading-tight">Sin Foto</span>
              </div>
            </div>

            {/* Detalles filiatorios y de ubicación */}
            <div className="min-w-0 flex-1">
              <h4 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                {alert.personName}
              </h4>

              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400 truncate">
                Lector: <span className="font-semibold">{alert.deviceName}</span>
              </p>

              <p className="text-xs text-slate-600 dark:text-slate-400">
                Método:{" "}
                <span className="font-mono text-slate-700 dark:text-slate-300 uppercase">
                  {alert.method === "facial"
                    ? "Rostro Facial"
                    : alert.method === "qr"
                    ? "Código QR"
                    : alert.method === "card"
                    ? "Tarjeta RFID"
                    : alert.method}
                </span>
              </p>

              <div className="mt-1.5">
                {isApproved ? (
                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    Identidad validada correctamente
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-rose-700 dark:text-rose-400">
                    Motivo: {alert.reason || "Rostro no registrado en el sistema"}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Acciones de guardia si fue rechazado */}
          {!isApproved && onOpenRelay && (
            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenRelay(alert.deviceId)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600 transition-colors shadow-sm"
              >
                <DoorOpen className="h-3.5 w-3.5" />
                Apertura Manual Guardia
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
