"use client";

import { useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { ScanFace, X, CheckCircle2, AlertTriangle, QrCode } from "lucide-react";
import { IconUserCheck } from "@/components/DashboardIcons";
import { useDash } from "@/components/DashboardProvider";
import { parseFacialEvent, type EventRow } from "@/components/ops/parseFacialEvent";
import { EventPhoto } from "@/components/ops/EventPhoto";
import type { FacialEventAlert } from "@/components/LiveFacialAlertToast";
import { useEscapeKey } from "@/hooks/useEscapeKey";

type Props = {
  events: EventRow[];
  streamLive: boolean;
  title?: string;
  emptyHint?: string;
  compact?: boolean;
};

type CardTone = "pending" | "approved" | "denied";

function cardTone(alert: FacialEventAlert): CardTone {
  if (alert.kind === "visit") {
    if (alert.visitStatus === "denied") return "denied";
    if (alert.approved || alert.visitStatus === "approved") return "approved";
    return "pending";
  }
  return alert.approved ? "approved" : "denied";
}

/** Fecha + hora 24 h (sin segundos) — historial ingreso y salida. */
function timeLabel(createdAt: string | number | undefined) {
  if (!createdAt) return "--/-- --:--";
  const d = new Date(createdAt);
  if (!Number.isFinite(d.getTime())) return "--/-- --:--";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${min}`;
}

function FeedThumb({
  alert,
  className,
  tenantId,
}: {
  alert: FacialEventAlert;
  className?: string;
  tenantId?: string | null;
}) {
  const isVisit = alert.kind === "visit";
  const tone = cardTone(alert);
  const border =
    tone === "pending"
      ? "border-amber-400 dark:border-amber-600"
      : tone === "approved"
        ? "border-emerald-400 dark:border-emerald-600"
        : "border-rose-400 dark:border-rose-600";
  return (
    <div className={`relative flex-shrink-0 overflow-hidden bg-slate-900 ${className ?? ""} ${border}`}>
      <EventPhoto
        eventId={alert.id}
        tenantId={tenantId}
        photoStored={alert.photoStored}
        createdAt={alert.createdAt}
        alt={alert.personName}
        className="h-full w-full object-cover object-top"
        style={{ position: "relative", zIndex: 1, height: "100%", width: "100%", objectFit: "cover", objectPosition: "center top" }}
        placeholderApproved={tone === "approved"}
      />
      {!alert.photoStored ? (
        <div className="pointer-events-none absolute inset-0 -z-10 grid place-items-center bg-slate-100 text-slate-400 dark:bg-slate-800">
          {isVisit ? (
            <QrCode className={`h-6 w-6 ${tone === "approved" ? "text-emerald-600" : tone === "denied" ? "text-rose-500" : "text-amber-600"}`} />
          ) : tone === "approved" ? (
            <IconUserCheck className="h-6 w-6 text-emerald-600" />
          ) : (
            <ScanFace className="h-6 w-6 text-rose-500" />
          )}
        </div>
      ) : null}
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
  const isVisit = alert.kind === "visit";
  const tone = cardTone(alert);
  const isApproved = tone === "approved";
  const accent = tone === "pending" ? "#d97706" : isApproved ? "#10b981" : "#f43f5e";
  const accentSoft = tone === "pending" ? "#fbbf24" : isApproved ? "#34d399" : "#fb7185";
  const bg = tone === "pending" ? "#fffbeb" : isApproved ? "#ecfdf5" : "#fff1f2";
  const badgeBg = tone === "pending" ? "#fde68a" : isApproved ? "#a7f3d0" : "#fecdd3";
  const badgeFg = tone === "pending" ? "#92400e" : isApproved ? "#065f46" : "#9f1239";
  const badgeLabel =
    tone === "pending" ? "Identificado" : isApproved ? "Acceso Aprobado" : isVisit ? "Visita denegada" : "Acceso Denegado";

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
            <EventPhoto
              eventId={alert.id}
              tenantId={tenantId}
              photoStored={alert.photoStored}
              createdAt={createdAt}
              alt={alert.personName}
              forceRetry={!alert.photoStored}
              placeholderApproved={isApproved}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "center top",
                display: "block",
                position: "relative",
                zIndex: 1,
              }}
            />
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
                    background: badgeBg,
                    color: badgeFg,
                  }}
                >
                  {tone === "pending" ? <QrCode size={15} /> : isApproved ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                  {badgeLabel}
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
              {isVisit || alert.isRemote || (alert.qrHint && !alert.snapshotUrl) ? (
                <div style={{ marginTop: 8, fontSize: 15, color: "#334155", lineHeight: 1.4 }}>
                  {alert.guestDni ? <div>DNI {alert.guestDni}</div> : isVisit ? <div>DNI pendiente</div> : null}
                  {alert.qrHint ? <div>QR que lo acredita: {alert.qrHint}</div> : null}
                  {alert.scanChannelLabel ? (
                    <div style={{ fontSize: 13, color: "#64748b" }}>
                      {alert.scanChannelLabel}
                      {alert.scannedByName ? ` · ${alert.scannedByName}` : ""}
                    </div>
                  ) : null}
                  {alert.approvedByName ? (
                    <div style={{ fontSize: 13, color: "#64748b" }}>
                      Aprobó {alert.approvedByName}
                      {alert.approvedVia === "login" ? " (sesión)" : ""}
                      {alert.approvedVia === "guard_code" ? " (código de guardia)" : ""}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div style={{ marginTop: 8, fontSize: 15, color: "#475569", lineHeight: 1.35 }}>
                {alert.deviceName}
                <span style={{ opacity: 0.55 }}> · </span>
                {alert.method}
              </div>
              {isVisit && tone === "pending" ? (
                <div style={{ marginTop: 10, fontSize: 15, fontWeight: 700, color: "#b45309", lineHeight: 1.35 }}>
                  QR visita · espera aprobación
                  {alert.lotNumber ? ` · Lote ${alert.lotNumber}` : ""}
                </div>
              ) : isVisit && isApproved ? (
                <div style={{ marginTop: 10, fontSize: 15, fontWeight: 600, color: "#047857" }}>
                  {alert.method}
                  {alert.lotNumber ? ` · Lote ${alert.lotNumber}` : ""}
                </div>
              ) : isVisit ? (
                <div style={{ marginTop: 10, fontSize: 15, fontWeight: 700, color: "#be123c", lineHeight: 1.35 }}>
                  Visita denegada
                  {alert.lotNumber ? ` · Lote ${alert.lotNumber}` : ""}
                </div>
              ) : !isApproved ? (
                <div style={{ marginTop: 10, fontSize: 15, fontWeight: 700, color: "#be123c", lineHeight: 1.35 }}>
                  {alert.reason || "Rostro no registrado"}
                </div>
              ) : (
                <div style={{ marginTop: 10, fontSize: 15, fontWeight: 600, color: "#047857" }}>
                  {alert.isRemote ? "Relé abierto desde portería" : "Identidad validada"}
                </div>
              )}
              {alert.doorName ? (
                <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>Punto: {alert.doorName}</div>
              ) : null}
              {isVisit && tone === "pending" && alert.passId ? (
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("ap:open-visit-approval", { detail: { passId: alert.passId } }),
                    );
                    onClose();
                  }}
                  style={{
                    marginTop: 14,
                    display: "inline-flex",
                    alignItems: "center",
                    border: "none",
                    borderRadius: 10,
                    padding: "9px 12px",
                    background: "#d97706",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Abrir ficha
                </button>
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
          events.map((e) => {
            const alert = parseFacialEvent(e);
            if (!alert) return null;
            const tone = cardTone(alert);
            const rowTone =
              tone === "pending"
                ? "border-amber-200/90 bg-amber-50/80 dark:border-amber-900/60 dark:bg-amber-950/25"
                : tone === "approved"
                  ? "border-emerald-200/90 bg-emerald-50/80 dark:border-emerald-900/60 dark:bg-emerald-950/25"
                  : "border-rose-200/90 bg-rose-50/80 dark:border-rose-900/60 dark:bg-rose-950/25";
            const badgeTone =
              tone === "pending"
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                : tone === "approved"
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                  : "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300";
            const badgeLabel = tone === "pending" ? "Pendiente" : tone === "approved" ? "Aprobado" : "Denegado";

            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelected({ alert, createdAt: e.createdAt })}
                className={`ops-hist-row flex w-full items-stretch overflow-hidden rounded-lg border text-left shadow-sm transition hover:brightness-[0.98] dark:hover:brightness-110 ${rowTone}`}
              >
                <FeedThumb
                  alert={alert}
                  tenantId={tenantId}
                  className={`self-stretch border-r-2 ${compact ? "w-[96px] min-h-[128px]" : "w-[88px] min-h-[116px]"}`}
                />
                <div
                  className={`flex min-w-0 flex-1 flex-col justify-center gap-1 ${
                    compact ? "px-2.5 py-2" : "px-3 py-2.5"
                  }`}
                >
                  <p
                    className={`min-w-0 truncate font-bold leading-tight text-slate-900 dark:text-white ${
                      compact ? "text-[15px]" : "text-[14px]"
                    }`}
                  >
                    {alert.personName}
                  </p>
                  {alert.kind === "visit" || alert.isRemote ? (
                    <p
                      className={`min-w-0 truncate text-slate-600 dark:text-slate-400 ${
                        compact ? "text-[11.5px]" : "text-[12px]"
                      }`}
                    >
                      {[
                        alert.guestDni ? `DNI ${alert.guestDni}` : null,
                        alert.qrHint ? `QR ${alert.qrHint}` : null,
                        compact ? null : alert.scanChannelLabel,
                      ]
                        .filter(Boolean)
                        .join(" · ") || alert.method}
                    </p>
                  ) : (
                  <p
                    className={`min-w-0 truncate text-slate-600 dark:text-slate-400 ${
                      compact ? "text-[11.5px]" : "text-[12px]"
                    }`}
                  >
                    {compact ? alert.method : `${alert.deviceName} · ${alert.method}`}
                  </p>
                  )}
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <time
                      dateTime={new Date(e.createdAt).toISOString()}
                      className="ops-hist-time shrink-0 font-mono tabular-nums text-slate-500 dark:text-slate-400"
                    >
                      {timeLabel(e.createdAt)}
                    </time>
                    <span
                      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-bold tracking-wide ${
                        compact ? "text-[11px]" : "text-[10px]"
                      } ${badgeTone}`}
                    >
                      {badgeLabel}
                    </span>
                  </div>
                  {!compact && tone === "denied" && alert.reason ? (
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
          alert={(() => {
            const row = events.find((e) => String(e.id) === String(selected.alert.id));
            return (row && parseFacialEvent(row)) || selected.alert;
          })()}
          createdAt={selected.createdAt}
          tenantId={tenantId}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
