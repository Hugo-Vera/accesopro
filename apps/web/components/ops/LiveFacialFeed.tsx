"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { ScanFace, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { IconUserCheck } from "@/components/DashboardIcons";
import { useDash } from "@/components/DashboardProvider";
import {
  markSnapshotFailed,
  parseFacialEvent,
  snapshotProxyUrl,
  type EventRow,
} from "@/components/ops/parseFacialEvent";
import type { FacialEventAlert } from "@/components/LiveFacialAlertToast";
import { useEscapeKey } from "@/hooks/useEscapeKey";

type Props = {
  events: EventRow[];
  streamLive: boolean;
  title?: string;
  emptyHint?: string;
  compact?: boolean;
};

/** Hora 24 h — mismo formato en historial ingreso y salida. */
function timeLabel(createdAt: string | number | undefined) {
  if (!createdAt) return "--:--:--";
  return new Date(createdAt).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function methodLabel(method: string) {
  return method === "facial" ? "Rostro" : method;
}

function FeedThumb({
  alert,
  className,
  tenantId,
  loadPhoto,
}: {
  alert: FacialEventAlert;
  className?: string;
  tenantId?: string | null;
  /** Solo pedir al ASI cuando la fila es visible (evita 40×400 al cargar). */
  loadPhoto: boolean;
}) {
  const photoProxy =
    loadPhoto ? snapshotProxyUrl(alert.deviceId, alert.snapshotUrl, tenantId) : null;
  return (
    <div
      className={`relative flex-shrink-0 overflow-hidden bg-slate-900 ${className ?? ""} ${
        alert.approved
          ? "border-emerald-400 dark:border-emerald-600"
          : "border-rose-400 dark:border-rose-600"
      }`}
    >
      {photoProxy ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoProxy}
          alt={alert.personName}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover object-top"
          onError={(ev) => {
            markSnapshotFailed(alert.deviceId, alert.snapshotUrl);
            ev.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <div className="absolute inset-0 -z-10 grid place-items-center bg-slate-100 text-slate-400 dark:bg-slate-800">
        {alert.approved ? (
          <IconUserCheck className="h-6 w-6 text-emerald-600" />
        ) : (
          <ScanFace className="h-6 w-6 text-rose-500" />
        )}
      </div>
    </div>
  );
}

function EventDetailModal({
  alert,
  createdAt,
  tenantId,
  onClose,
}: {
  alert: FacialEventAlert;
  createdAt: string | number;
  tenantId?: string | null;
  onClose: () => void;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const photoProxy = !photoFailed ? snapshotProxyUrl(alert.deviceId, alert.snapshotUrl, tenantId) : null;
  const isApproved = alert.approved;
  const accent = isApproved ? "#10b981" : "#f43f5e";
  const accentSoft = isApproved ? "#34d399" : "#fb7185";
  const bg = isApproved ? "#ecfdf5" : "#fff1f2";

  useEscapeKey(onClose, true);

  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="facial-detail-title"
        style={{
          position: "relative",
          width: "min(640px, calc(100vw - 24px))",
          borderRadius: 18,
          border: `3px solid ${accent}`,
          background: bg,
          boxShadow: "0 22px 55px rgba(0,0,0,0.38)",
          overflow: "hidden",
          color: "#0f172a",
        }}
      >
        <div style={{ display: "flex", alignItems: "stretch", minHeight: 340 }}>
          <div
            style={{
              width: 230,
              flexShrink: 0,
              alignSelf: "stretch",
              minHeight: 340,
              borderRight: `2px solid ${accentSoft}`,
              background: "#0b1220",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {photoProxy ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoProxy}
                alt={alert.personName}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "center top",
                  display: "block",
                }}
                onError={() => {
                  markSnapshotFailed(alert.deviceId, alert.snapshotUrl);
                  setPhotoFailed(true);
                }}
              />
            ) : (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  color: "#64748b",
                  background: isApproved ? "#d1fae5" : "#ffe4e6",
                }}
              >
                <ScanFace size={48} strokeWidth={1.5} />
              </div>
            )}
          </div>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              padding: "20px 20px 20px 22px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    background: isApproved ? "#a7f3d0" : "#fecdd3",
                    color: isApproved ? "#065f46" : "#9f1239",
                  }}
                >
                  {isApproved ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                  {isApproved ? "Acceso Aprobado" : "Acceso Denegado"}
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  title="Cerrar"
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    padding: 2,
                    color: "#64748b",
                    flexShrink: 0,
                  }}
                >
                  <X size={20} />
                </button>
              </div>

              <div
                style={{
                  marginTop: 10,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 12,
                  color: "#64748b",
                }}
              >
                {timeLabel(createdAt)}
              </div>

              <h2
                id="facial-detail-title"
                style={{
                  marginTop: 14,
                  fontSize: 26,
                  fontWeight: 800,
                  lineHeight: 1.15,
                  wordBreak: "break-word",
                }}
              >
                {alert.personName}
              </h2>
              <div style={{ marginTop: 8, fontSize: 15, color: "#475569", lineHeight: 1.35 }}>
                {alert.deviceName}
                <span style={{ opacity: 0.55 }}> · </span>
                {alert.method === "facial" ? "Rostro" : alert.method}
              </div>
              {!isApproved ? (
                <div style={{ marginTop: 10, fontSize: 15, fontWeight: 700, color: "#be123c", lineHeight: 1.35 }}>
                  {alert.reason || "Rostro no registrado"}
                </div>
              ) : (
                <div style={{ marginTop: 10, fontSize: 15, fontWeight: 600, color: "#047857" }}>
                  Identidad validada
                </div>
              )}
              {alert.doorName ? (
                <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>Punto: {alert.doorName}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function LiveFacialFeed({
  events,
  streamLive,
  title = "ACTIVIDAD EN VIVO · LECTOR FACIAL",
  emptyHint = "Esperando movimiento en el lector facial",
  compact,
}: Props) {
  const { tenantId } = useDash();
  const [selected, setSelected] = useState<{ alert: FacialEventAlert; createdAt: string | number } | null>(
    null,
  );
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => new Set());
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setVisibleIds(new Set(events.map((e) => String(e.id))));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        setVisibleIds((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.eventId;
            if (!id) continue;
            if (entry.isIntersecting) next.add(id);
          }
          return next;
        });
      },
      { root: null, rootMargin: "80px 0px", threshold: 0.01 },
    );
    for (const el of rowRefs.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [events]);

  return (
    <div className={`ops-subpanel flex min-h-0 flex-1 flex-col ${compact ? "ops-feed--compact" : ""}`}>
      <div className="mb-2 flex flex-shrink-0 items-center justify-between border-b border-slate-200 pb-1.5 dark:border-[#172d3e]">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`h-2 w-2 flex-shrink-0 rounded-full ${streamLive ? "animate-pulse bg-emerald-500" : "bg-slate-400"}`}
          />
          <p className="ops-section-title truncate">{title}</p>
        </div>
        <Link
          href="/dashboard/dahua/eventos"
          className="flex-shrink-0 font-mono text-[9px] font-bold text-blue-600 transition-colors hover:text-blue-700 dark:text-[#38bdf8] dark:hover:text-white"
        >
          →
        </Link>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain ops-scroll-hidden">
        {events.length === 0 ? (
          <div className={`text-center text-slate-400 dark:text-slate-500 ${compact ? "py-4" : "py-7"}`}>
            <ScanFace className={`mx-auto mb-1 animate-pulse text-blue-500 opacity-40 ${compact ? "h-5 w-5" : "h-7 w-7"}`} />
            <p className={`font-semibold text-slate-700 dark:text-slate-300 ${compact ? "text-[10px]" : "text-[11px]"}`}>
              {emptyHint}
            </p>
            {!compact ? (
              <p className="text-[9.5px] opacity-75">Solo eventos de este sentido</p>
            ) : null}
          </div>
        ) : (
          events.map((e, idx) => {
            const alert = parseFacialEvent(e);
            if (!alert) return null;
            const id = String(e.id);
            // Primeras 4 filas cargan ya; el resto espera IntersectionObserver
            const loadPhoto = idx < 4 || visibleIds.has(id);

            return (
              <button
                key={e.id}
                type="button"
                data-event-id={id}
                ref={(node) => {
                  if (node) rowRefs.current.set(id, node);
                  else rowRefs.current.delete(id);
                }}
                onClick={() => setSelected({ alert, createdAt: e.createdAt })}
                className={`ops-hist-row flex w-full items-stretch overflow-hidden rounded-lg border text-left shadow-sm transition hover:brightness-[0.98] dark:hover:brightness-110 ${
                  alert.approved
                    ? "border-emerald-200/90 bg-emerald-50/80 dark:border-emerald-900/60 dark:bg-emerald-950/25"
                    : "border-rose-200/90 bg-rose-50/80 dark:border-rose-900/60 dark:bg-rose-950/25"
                }`}
              >
                <FeedThumb
                  alert={alert}
                  tenantId={tenantId}
                  loadPhoto={loadPhoto}
                  className={`self-stretch border-r-2 ${compact ? "w-[44px] min-h-[56px]" : "w-[72px] min-h-[96px]"}`}
                />
                <div
                  className={`flex min-w-0 flex-1 flex-col justify-center gap-0.5 ${
                    compact ? "px-2 py-1.5" : "px-3 py-2.5"
                  }`}
                >
                  <div className="flex min-w-0 items-baseline justify-between gap-2">
                    <p
                      className={`min-w-0 truncate font-bold leading-tight text-slate-900 dark:text-white ${
                        compact ? "text-[12.5px]" : "text-[14px]"
                      }`}
                    >
                      {alert.personName}
                    </p>
                    <time
                      dateTime={new Date(e.createdAt).toISOString()}
                      className="ops-hist-time shrink-0 font-mono tabular-nums text-slate-500 dark:text-slate-400"
                    >
                      {timeLabel(e.createdAt)}
                    </time>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <p
                      className={`min-w-0 truncate text-slate-600 dark:text-slate-400 ${
                        compact ? "text-[10.5px]" : "text-[12px]"
                      }`}
                    >
                      {compact
                        ? methodLabel(alert.method)
                        : `${alert.deviceName} · ${methodLabel(alert.method)}`}
                    </p>
                    <span
                      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-extrabold uppercase tracking-wider ${
                        compact ? "text-[9px]" : "text-[10px]"
                      } ${
                        alert.approved
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                          : "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300"
                      }`}
                    >
                      {alert.approved ? "OK" : "NO"}
                    </span>
                  </div>
                  {!compact && alert.reason ? (
                    <p className="truncate text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                      {alert.reason}
                    </p>
                  ) : null}
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="mt-1.5 flex flex-shrink-0 items-center justify-between border-t border-slate-200 pt-1 text-[9px] text-slate-500 dark:border-[#172d3e] dark:text-[#7892a7]">
        <span className="flex items-center gap-1">
          <span
            className={`h-1.5 w-1.5 rounded-full ${streamLive ? "animate-pulse bg-emerald-500" : "bg-slate-400"}`}
          />
          {streamLive ? "Live" : "Sondeo"}
        </span>
        {events.length > 0 ? <span>{events.length}</span> : null}
      </div>

      {selected ? (
        <EventDetailModal
          alert={selected.alert}
          createdAt={selected.createdAt}
          tenantId={tenantId}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
