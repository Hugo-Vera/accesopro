"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, X, DoorOpen, ScanFace } from "lucide-react";
import { markSnapshotFailed, snapshotProxyUrl } from "@/components/ops/parseFacialEvent";
import { useDash } from "@/components/DashboardProvider";
import { useEscapeKey } from "@/hooks/useEscapeKey";

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
  const { tenantId } = useDash();
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const [animKey, setAnimKey] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [liveAlert, setLiveAlert] = useState<FacialEventAlert | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  const shown = liveAlert ?? alert;

  const dismiss = () => {
    setLiveAlert(null);
    onDismissRef.current();
  };

  useEscapeKey(dismiss, !!shown);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (alert?.id) {
      setLiveAlert(alert);
      setPhotoFailed(false);
    } else {
      setLiveAlert(null);
    }
  }, [alert]);

  // Fuente principal: CustomEvent (también si el host aún no setea prop)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FacialEventAlert>).detail;
      if (!detail?.id) return;
      setLiveAlert(detail);
      setPhotoFailed(false);
    };
    window.addEventListener("ap:facial-alert", handler as EventListener);
    return () => window.removeEventListener("ap:facial-alert", handler as EventListener);
  }, []);

  useEffect(() => {
    if (!shown?.id) return;
    setAnimKey((k) => k + 1);
    const timer = setTimeout(() => {
      dismiss();
    }, 12000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown?.id]);

  if (!mounted || !shown) return null;

  const isApproved = shown.approved;
  const photoProxy = !photoFailed ? snapshotProxyUrl(shown.deviceId, shown.snapshotUrl, tenantId) : null;

  const timeStr = shown.createdAt
    ? new Date(shown.createdAt).toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "Ahora";

  const accent = isApproved ? "#10b981" : "#f43f5e";
  const accentSoft = isApproved ? "#34d399" : "#fb7185";
  const bg = isApproved ? "#ecfdf5" : "#fff1f2";

  const node = (
    <aside
      aria-label="Alerta de reconocimiento facial en vivo"
      data-testid="facial-alert-toast"
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        left: "auto",
        zIndex: 2147483646,
        width: "min(420px, calc(100vw - 24px))",
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
      <div
        style={{
          animation: "apToastIn 0.22s ease-out",
          borderRadius: 16,
          border: `3px solid ${accent}`,
          background: bg,
          boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
          overflow: "hidden",
          color: "#0f172a",
        }}
      >
        <div style={{ height: 4, background: "rgba(0,0,0,0.08)" }}>
          <div
            key={animKey}
            style={{
              height: "100%",
              background: isApproved ? "#059669" : "#e11d48",
              animation: "apToastBar 12s linear forwards",
            }}
          />
        </div>

        {/* Foto a la izquierda + textos al costado */}
        <div style={{ display: "flex", alignItems: "stretch", gap: 0, minHeight: 200 }}>
          <div
            style={{
              width: 120,
              flexShrink: 0,
              alignSelf: "stretch",
              minHeight: 200,
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
                alt={shown.personName}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "center top",
                  display: "block",
                }}
                onError={() => {
                  markSnapshotFailed(shown.deviceId, shown.snapshotUrl);
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
                <ScanFace size={36} strokeWidth={1.5} />
              </div>
            )}
          </div>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              padding: "12px 12px 12px 14px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "4px 9px",
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    background: isApproved ? "#a7f3d0" : "#fecdd3",
                    color: isApproved ? "#065f46" : "#9f1239",
                  }}
                >
                  {isApproved ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                  {isApproved ? "Acceso Aprobado" : "Acceso Denegado"}
                </div>
                <button
                  type="button"
                  onClick={dismiss}
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
                  <X size={16} />
                </button>
              </div>

              <div
                style={{
                  marginTop: 6,
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 10,
                  color: "#64748b",
                }}
              >
                {timeStr}
              </div>

              <div style={{ marginTop: 10, fontSize: 17, fontWeight: 800, lineHeight: 1.15, wordBreak: "break-word" }}>
                {shown.personName}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: "#475569", lineHeight: 1.35 }}>
                {shown.deviceName}
                <span style={{ opacity: 0.55 }}> · </span>
                {shown.method === "facial" ? "Rostro" : shown.method}
              </div>
              {!isApproved ? (
                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "#be123c", lineHeight: 1.35 }}>
                  {shown.reason || "Rostro no registrado"}
                </div>
              ) : (
                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "#047857" }}>
                  Identidad validada
                </div>
              )}
            </div>

            {!isApproved && onOpenRelay ? (
              <button
                type="button"
                onClick={() => onOpenRelay(shown.deviceId)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  alignSelf: "flex-start",
                  border: "none",
                  borderRadius: 10,
                  padding: "9px 12px",
                  background: "#059669",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <DoorOpen size={14} />
                Apertura Manual Guardia
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  );

  return createPortal(node, document.body);
}
