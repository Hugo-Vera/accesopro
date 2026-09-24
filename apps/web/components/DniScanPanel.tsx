"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ScanLine } from "lucide-react";
import { parseDniScan } from "@/lib/parseDni";
import { cameraBlockReason, cameraHttpsUrl, cameraNeedsHttps, getCameraStream } from "@/lib/camera";
import { createDniLiveDecoder, type ScanBox, type ScanHit } from "@/lib/dniLiveScan";
import { useHidWedge } from "@/hooks/useHidWedge";

type Props = {
  onScan: (raw: string) => void;
  /** Si devuelve true, se consume el código (QR de visita). */
  onRaw?: (raw: string) => boolean;
  active?: boolean;
  title?: string;
};

function videoToDisplay(box: ScanBox, vw: number, vh: number, elW: number, elH: number) {
  const scale = Math.min(elW / vw, elH / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const ox = (elW - dw) / 2;
  const oy = (elH - dh) / 2;
  return {
    x: ox + box.x * vw * scale,
    y: oy + box.y * vh * scale,
    w: box.w * vw * scale,
    h: box.h * vh * scale,
  };
}

function drawCorners(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  width: number,
) {
  const L = Math.max(10, Math.min(w, h) * 0.22);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "square";
  ctx.beginPath();
  ctx.moveTo(x, y + L);
  ctx.lineTo(x, y);
  ctx.lineTo(x + L, y);
  ctx.moveTo(x + w - L, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + L);
  ctx.moveTo(x + w, y + h - L);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - L, y + h);
  ctx.moveTo(x + L, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - L);
  ctx.stroke();
}

export function DniScanPanel({ onScan, onRaw, active = true, title = "Escanear DNI con cámara (opcional)" }: Props) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [status, setStatus] = useState("QR del frente o PDF417 del dorso");
  const [locked, setLocked] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onRawRef = useRef(onRaw);
  onRawRef.current = onRaw;
  const liveHitRef = useRef<ScanHit | null>(null);

  const applyIfParsed = useCallback((text: string) => {
    if (onRawRef.current?.(text)) {
      setHint("Código leído");
      return true;
    }
    const parsed = parseDniScan(text);
    if (!parsed) return false;
    onScanRef.current(text);
    setHint(`Leído: ${parsed.lastName} ${parsed.firstName} · DNI ${parsed.dni}`.trim());
    return true;
  }, []);

  useHidWedge(applyIfParsed, active);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    liveHitRef.current = null;
    setLocked(false);
  }

  useEffect(() => {
    function onHide() {
      if (document.visibilityState === "hidden") {
        stopCamera();
        setOpen(false);
      }
    }
    function onPageHide() {
      stopCamera();
      setOpen(false);
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (!open || !active) {
      stopCamera();
      return;
    }
    const blocked = cameraBlockReason();
    if (blocked) {
      setCamError(blocked);
      return;
    }

    let cancelled = false;
    let raf = 0;
    let decoding = false;
    let lastDecode = 0;
    const decoder = createDniLiveDecoder();

    async function start() {
      setCamError(null);
      setHint(null);
      setLocked(false);
      setStatus("QR del frente o PDF417 del dorso");
      try {
        const stream = await getCameraStream({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          return;
        }
        video.srcObject = stream;
        await video.play().catch(() => null);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "No se pudo abrir la cámara";
        setCamError(
          msg.includes("getUserMedia") || msg.includes("undefined")
            ? "La cámara no está disponible. Pasá el DNI por el lector USB."
            : msg,
        );
        return;
      }

      const draw = (now: number) => {
        if (cancelled) return;
        const video = videoRef.current;
        const canvas = overlayRef.current;
        const wrap = wrapRef.current;
        if (video && canvas && wrap && video.videoWidth) {
          const dpr = window.devicePixelRatio || 1;
          const elW = wrap.clientWidth;
          const elH = wrap.clientHeight;
          const cssW = Math.max(1, elW);
          const cssH = Math.max(1, elH);
          if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
            canvas.width = Math.round(cssW * dpr);
            canvas.height = Math.round(cssH * dpr);
          }
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cssW, cssH);
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            const hit = liveHitRef.current;
            const card = videoToDisplay({ x: 0.08, y: 0.1, w: 0.84, h: 0.78 }, vw, vh, cssW, cssH);
            ctx.fillStyle = "rgba(2, 6, 23, 0.38)";
            ctx.fillRect(0, 0, cssW, cssH);
            ctx.save();
            ctx.beginPath();
            ctx.rect(card.x, card.y, card.w, card.h);
            ctx.clip();
            ctx.clearRect(card.x, card.y, card.w, card.h);
            ctx.restore();
            drawCorners(ctx, card.x, card.y, card.w, card.h, hit ? "#34d399" : "#93c5fd", 2.5);
          }
        }

        if (!decoding && now - lastDecode > 110 && video && video.readyState >= 2 && !liveHitRef.current) {
          decoding = true;
          lastDecode = now;
          void decoder
            .decodeFrame(video)
            .then((frame) => {
              decoding = false;
              if (cancelled || liveHitRef.current) return;
              if (!frame.hit) {
                if (frame.hints.some((h) => h.kind === "qr")) {
                  setStatus("QR a la vista. Lo estoy leyendo…");
                } else if (frame.hints.some((h) => h.kind === "pdf417")) {
                  setStatus("Código de barras a la vista. Acercá el dorso…");
                } else {
                  setStatus("QR del frente o PDF417 del dorso");
                }
                return;
              }
              if (applyIfParsed(frame.hit.text)) {
                liveHitRef.current = frame.hit;
                setLocked(true);
                setStatus(frame.hit.format === "qr" ? "QR leído" : "PDF417 del dorso leído");
                window.setTimeout(() => {
                  if (cancelled) return;
                  stopCamera();
                  setOpen(false);
                }, 700);
                return;
              }
              const preview = frame.hit.text.replace(/\s+/g, " ").slice(0, 48);
              setStatus(`Código leído, no es el DNI (${preview}). Probá el dorso.`);
            })
            .catch(() => {
              decoding = false;
            });
        }

        raf = window.requestAnimationFrame(draw);
      };
      raf = window.requestAnimationFrame(draw);
    }

    void start();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active, applyIfParsed]);

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-900/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        <ScanLine className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          {title}
        </span>
        <ChevronDown className={`ml-auto h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="border-t border-slate-200 px-3 py-3 dark:border-slate-700">
          <div
            ref={wrapRef}
            className="relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-slate-950"
          >
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-contain"
              muted
              playsInline
              autoPlay
            />
            <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
            <div
              className={`absolute inset-x-0 bottom-0 px-2.5 py-1.5 text-[10px] font-semibold ${
                locked
                  ? "bg-emerald-950/70 text-emerald-200"
                  : "bg-slate-950/65 text-slate-200"
              }`}
            >
              {status}
            </div>
          </div>
          {camError ? (
            <p className="mt-2 text-[11px] text-rose-600">
              {cameraNeedsHttps() ? (
                <>
                  El navegador bloquea la cámara en HTTP.{" "}
                  <a className="font-semibold underline" href={cameraHttpsUrl()}>
                    Entrá por HTTPS
                  </a>{" "}
                  (aceptá el certificado una vez) o usá el lector USB.
                </>
              ) : (
                camError
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {hint ? (
        <p
          className={`px-3 pb-2 text-[11px] font-semibold ${
            hint.startsWith("Leído")
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-800 dark:text-amber-300"
          }`}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
