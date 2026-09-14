"use client";

import { useEffect, useMemo, useState } from "react";
import { ScanFace } from "lucide-react";
import { eventPhotoUrl } from "@/components/ops/parseFacialEvent";

function toMs(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v > 0 && v < 1e12 ? v * 1000 : v;
  }
  const n = Date.parse(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

type Props = {
  eventId: string;
  tenantId?: string | null;
  photoStored?: boolean;
  createdAt?: string | number;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  /** Reintentos mientras llega la copia local (toast / evento fresco). */
  retryMs?: number;
  /** Forzar reintento aunque createdAt no sea reciente (toast en vivo). */
  forceRetry?: boolean;
  placeholderApproved?: boolean;
};

export function EventPhoto({
  eventId,
  tenantId,
  photoStored,
  createdAt,
  alt,
  className,
  style,
  retryMs = 12000,
  forceRetry,
  placeholderApproved,
}: Props) {
  const recent = createdAt != null && Date.now() - toMs(createdAt) < 20000;
  const shouldRetry = !photoStored && (forceRetry || recent);
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState(false);
  const [ok, setOk] = useState(!!photoStored);

  useEffect(() => {
    setTick(0);
    setFailed(false);
    setOk(!!photoStored);
  }, [eventId, photoStored]);

  useEffect(() => {
    if (ok || photoStored || failed || !shouldRetry) return;
    const started = Date.now();
    const t = window.setInterval(() => {
      if (Date.now() - started > retryMs) {
        window.clearInterval(t);
        setFailed(true);
        return;
      }
      setTick((n) => n + 1);
    }, 180);
    return () => window.clearInterval(t);
  }, [eventId, ok, photoStored, failed, shouldRetry, retryMs]);

  const src = useMemo(() => {
    if (!eventId) return null;
    if (failed && !photoStored) return null;
    if (!photoStored && !shouldRetry && !ok) return null;
    const base = eventPhotoUrl(eventId, tenantId);
    if (!base) return null;
    if (photoStored || ok) return base;
    const join = base.includes("?") ? "&" : "?";
    return `${base}${join}t=${tick}`;
  }, [eventId, tenantId, photoStored, ok, failed, shouldRetry, tick]);

  return (
    <>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className={className}
          style={{ ...style, display: ok ? style?.display ?? "block" : "none" }}
          decoding="async"
          onLoad={() => setOk(true)}
          onError={() => {
            if (photoStored || !shouldRetry) {
              setOk(false);
              setFailed(true);
            }
          }}
        />
      ) : null}
      {!ok ? (
        <div
          className="absolute inset-0 grid place-items-center text-slate-400"
          style={{
            background:
              placeholderApproved === false ? "#ffe4e6" : placeholderApproved ? "#d1fae5" : undefined,
          }}
        >
          <ScanFace size={36} strokeWidth={1.5} />
        </div>
      ) : null}
    </>
  );
}
