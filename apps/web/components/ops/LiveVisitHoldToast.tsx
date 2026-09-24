"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QrCode, X } from "lucide-react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { EventPhoto } from "@/components/ops/EventPhoto";
import { useDash } from "@/components/DashboardProvider";

export type VisitHoldAlert = {
  id: string;
  passId: string;
  approvalId?: string;
  guestName: string;
  guestDni?: string | null;
  qrHint?: string | null;
  scanChannelLabel?: string | null;
  scannedByName?: string | null;
  lotNumber?: string | null;
  sentido: "in" | "out";
  reason?: string;
  photoStored?: boolean;
  dwellLabel?: string | null;
  denied?: boolean;
  expired?: boolean;
  validFrom?: string | number | null;
  validUntil?: string | number | null;
};

type Props = {
  alert: VisitHoldAlert | null;
  onDismiss: () => void;
  onOpenFicha: (alert: VisitHoldAlert) => void;
};

export function LiveVisitHoldToast({ alert, onDismiss, onOpenFicha }: Props) {
  const { tenantId } = useDash();
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const [animKey, setAnimKey] = useState(0);
  const [mounted, setMounted] = useState(false);

  const dismiss = () => onDismissRef.current();
  useEscapeKey(dismiss, Boolean(alert));

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!alert?.id) return;
    setAnimKey((k) => k + 1);
    const timer = setTimeout(() => dismiss(), 12000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert?.id]);

  if (!mounted || !alert) return null;

  const isOut = alert.sentido === "out";
  const isExpired = Boolean(alert.denied || alert.expired || alert.reason === "expired" || alert.reason === "too_early");
  const isDark =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const timeStr = new Date().toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const fmt = (v: string | number | null | undefined) => {
    if (v == null || v === "") return "—";
    const d = new Date(typeof v === "number" ? v : v);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const node = (
    <aside
      aria-label={isExpired ? "QR de visita vencido" : "Visita identificada en el lector"}
      data-testid="visit-hold-toast"
      style={{
        position: "fixed",
        top: 72,
        ...(isOut ? { right: 16, left: "auto" } : { left: 16, right: "auto" }),
        zIndex: 2147483646,
        width: "min(380px, calc(100vw - 24px))",
        pointerEvents: "auto",
      }}
    >
      <style>{`
        @keyframes apToastIn {
          from { opacity: 0; transform: translateY(-12px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes apToastBar {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
      <button
        type="button"
        onClick={() => (isExpired ? dismiss() : onOpenFicha(alert))}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          animation: "apToastIn 0.22s ease-out",
          borderRadius: 16,
          border: isExpired ? "3px solid #e11d48" : "3px solid #d97706",
          background: isExpired
            ? isDark
              ? "#4c0519"
              : "#fff1f2"
            : isDark
              ? "#422006"
              : "#fffbeb",
          boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
          overflow: "hidden",
          color: isDark ? "#e2e8f0" : "#0f172a",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <div style={{ height: 4, background: "rgba(0,0,0,0.08)" }}>
          <div
            key={animKey}
            style={{
              height: "100%",
              background: isExpired ? "#e11d48" : "#d97706",
              animation: "apToastBar 12s linear forwards",
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "stretch", minHeight: 148 }}>
          <div
            style={{
              width: 88,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: isExpired
                ? isDark
                  ? "#9f1239"
                  : "#fecdd3"
                : isDark
                  ? "#78350f"
                  : "#fde68a",
              borderRight: isExpired ? "2px solid #fb7185" : "2px solid #fbbf24",
              overflow: "hidden",
              position: "relative",
            }}
          >
            {alert.id ? (
              <EventPhoto
                eventId={alert.id}
                tenantId={tenantId}
                photoStored={alert.photoStored}
                createdAt={Date.now()}
                alt={alert.guestName}
                forceRetry
                className="h-full w-full object-cover"
                style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", inset: 0 }}
              />
            ) : null}
            <QrCode size={36} color={isDark ? "#fde68a" : "#92400e"} />
          </div>
          <div style={{ flex: 1, minWidth: 0, padding: "12px 12px 12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "4px 9px",
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    background: isExpired ? "#fecdd3" : "#fde68a",
                    color: isExpired ? "#9f1239" : "#92400e",
                  }}
                >
                  {isExpired ? (alert.reason === "too_early" ? "Aún no vale" : "Vencido") : "Identificado"}
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "4px 8px",
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    background: isOut ? "#fde68a" : "#bae6fd",
                    color: isOut ? "#92400e" : "#075985",
                  }}
                >
                  {isOut ? "Salida" : "Ingreso"}
                </span>
              </div>
              <span
                role="button"
                tabIndex={0}
                aria-label="Cerrar"
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    dismiss();
                  }
                }}
                style={{ padding: 2, color: "#64748b", flexShrink: 0, lineHeight: 0 }}
              >
                <X size={16} />
              </span>
            </div>
            <div style={{ marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: 10, color: "#64748b" }}>
              {timeStr}
            </div>
            <div style={{ marginTop: 8, fontSize: 17, fontWeight: 800, lineHeight: 1.15, wordBreak: "break-word" }}>
              {alert.guestName}
              {alert.lotNumber ? ` · Lote ${alert.lotNumber}` : ""}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: isDark ? "#cbd5e1" : "#475569", lineHeight: 1.35 }}>
              {alert.guestDni ? `DNI ${alert.guestDni}` : "DNI pendiente"}
              {alert.qrHint ? ` · QR ${alert.qrHint}` : ""}
            </div>
            {alert.scanChannelLabel ? (
              <div style={{ marginTop: 2, fontSize: 11, color: isDark ? "#94a3b8" : "#64748b" }}>
                {alert.scanChannelLabel}
                {alert.scannedByName ? ` · ${alert.scannedByName}` : ""}
              </div>
            ) : null}
            {alert.dwellLabel && !isExpired ? (
              <div style={{ marginTop: 2, fontSize: 11, fontWeight: 700, color: isDark ? "#fcd34d" : "#b45309" }}>
                {alert.dwellLabel}
              </div>
            ) : null}
            {isExpired ? (
              <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: isDark ? "#fda4af" : "#be123c" }}>
                Vigencia {fmt(alert.validFrom)} → {fmt(alert.validUntil)}. Liberado del lector. Quedó en historial.
              </div>
            ) : (
              <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: isDark ? "#fcd34d" : "#b45309" }}>
                Aprobá para abrir. El QR no abre solo.
              </div>
            )}
          </div>
        </div>
      </button>
    </aside>
  );

  return createPortal(node, document.body);
}
