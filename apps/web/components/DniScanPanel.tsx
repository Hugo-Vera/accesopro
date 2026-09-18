"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ScanLine } from "lucide-react";
import { parseDniScan } from "@/lib/parseDni";
import { getCameraStream, mediaDevicesAvailable } from "@/lib/camera";
import { createDniLiveDecoder, type ScanBox, type ScanHint, type ScanHit } from "@/lib/dniLiveScan";
import { useHidWedge } from "@/hooks/useHidWedge";

type Props = {
  onScan: (raw: string) => void;
  active?: boolean;
};

const QR_GUIDE: ScanBox = { x: 0.29, y: 0.14, w: 0.42, h: 0.46 };
const PDF_GUIDE: ScanBox = { x: 0.08, y: 0.66, w: 0.84, h: 0.22 };

function videoToDisplay(box: ScanBox, vw: number, vh: number, elW: number, elH: number) {
  const scale = Math.max(elW / vw, elH / vh);
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

export function DniScanPanel({ onScan, active = true }: Props) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [status, setStatus] = useState("Buscando QR o PDF417…");
  const [locked, setLocked] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const liveHintsRef = useRef<ScanHint[]>([]);
  const liveHitRef = useRef<ScanHit | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const applyIfParsed = useCallback((text: string) => {
    const parsed = parseDniScan(text);
    if (!parsed) return false;
    onScanRef.current(text);
    setHint(`Leído: ${parsed.lastName} ${parsed.firstName} · DNI ${parsed.dni}`.trim());
    return true;
  }, []);

  useHidWedge(applyIfParsed, active);

  function stopCamera() {
    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (video) video.srcObject = null;
    liveHintsRef.current = [];
    liveHitRef.current = null;
    setLocked(false);
  }

  useEffect(() => {
    if (!open || !active) return;
    if (!mediaDevicesAvailable()) {
      setCamError("La cámara no está disponible. Pasá el DNI por el lector USB o usá HTTPS/localhost.");
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
      setStatus("Buscando QR (frente) o PDF417 (dorso)…");
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
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
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
            const hints = liveHintsRef.current;
            const map = (box: ScanBox) => videoToDisplay(box, vw, vh, cssW, cssH);

            ctx.fillStyle = "rgba(2, 6, 23, 0.38)";
            ctx.fillRect(0, 0, cssW, cssH);
            const card = map({ x: 0.06, y: 0.08, w: 0.88, h: 0.84 });
            ctx.save();
            ctx.beginPath();
            ctx.rect(card.x, card.y, card.w, card.h);
            ctx.clip();
            ctx.clearRect(card.x, card.y, card.w, card.h);
            ctx.restore();
            drawCorners(ctx, card.x, card.y, card.w, card.h, hit ? "#34d399" : "#93c5fd", 2.5);

            const qrBox = hints.find((h) => h.kind === "qr") || (!hit ? QR_GUIDE : null);
            const pdfBox = hints.find((h) => h.kind === "pdf417") || (!hit ? PDF_GUIDE : null);
            if (qrBox && !hit) {
              const q = map(qrBox);
              ctx.strokeStyle = hints.some((h) => h.kind === "qr") ? "#38bdf8" : "rgba(148,163,184,0.7)";
              ctx.setLineDash(hints.some((h) => h.kind === "qr") ? [] : [5, 4]);
              ctx.lineWidth = 1.5;
              ctx.strokeRect(q.x, q.y, q.w, q.h);
              ctx.setLineDash([]);
              ctx.font = "600 10px ui-sans-serif, system-ui";
              ctx.fillStyle = "#e2e8f0";
              ctx.fillText("QR frente · DNI nuevo", q.x + 6, q.y + 14);
            }
            if (pdfBox && !hit) {
              const p = map(pdfBox);
              ctx.strokeStyle = hints.some((h) => h.kind === "pdf417") ? "#fbbf24" : "rgba(148,163,184,0.7)";
              ctx.setLineDash(hints.some((h) => h.kind === "pdf417") ? [] : [5, 4]);
              ctx.lineWidth = 1.5;
              ctx.strokeRect(p.x, p.y, p.w, p.h);
              ctx.setLineDash([]);
              ctx.font = "600 10px ui-sans-serif, system-ui";
              ctx.fillStyle = "#e2e8f0";
              ctx.fillText("PDF417 dorso · tarjeta vieja o nueva", p.x + 6, p.y + 14);
            }

            if (hit?.box) {
              const b = map(hit.box);
              ctx.strokeStyle = "#34d399";
              ctx.lineWidth = 3;
              ctx.strokeRect(b.x, b.y, b.w, b.h);
            } else {
              const lineY = card.y + ((now / 18) % card.h);
              const grad = ctx.createLinearGradient(0, lineY - 12, 0, lineY + 12);
              grad.addColorStop(0, "rgba(56,189,248,0)");
              grad.addColorStop(0.5, "rgba(56,189,248,0.85)");
              grad.addColorStop(1, "rgba(56,189,248,0)");
              ctx.fillStyle = grad;
              ctx.fillRect(card.x, lineY - 12, card.w, 24);
            }
          }
        }

        if (!decoding && now - lastDecode > 110 && video && video.readyState >= 2 && !liveHitRef.current) {
          decoding = true;
          lastDecode = now;
          void decoder.decodeFrame(video).then((frame) => {
            decoding = false;
            if (cancelled || liveHitRef.current) return;
            liveHintsRef.current = frame.hints;
            if (!frame.hit) {
              if (frame.hints.length && statusRef.current.startsWith("Buscando")) {
                setStatus(
                  frame.hints.some((h) => h.kind === "pdf417")
                    ? "Código de barras a la vista. Acercá el dorso…"
                    : "QR a la vista. Mantené el frente estable…",
                );
              }
              return;
            }
            if (applyIfParsed(frame.hit.text)) {
              liveHitRef.current = frame.hit;
              setLocked(true);
              setStatus(frame.hit.format === "qr" ? "QR del frente leído" : "PDF417 del dorso leído");
              window.setTimeout(() => {
                if (cancelled) return;
                stopCamera();
                setOpen(false);
              }, 700);
              return;
            }
            setStatus("Código visto, no es el DNI. Probá el dorso (PDF417) o el QR de datos del frente.");
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
          Escanear DNI con cámara (opcional)
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
              className="absolute inset-0 h-full w-full object-cover"
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
          {camError ? <p className="mt-2 text-[11px] text-rose-600">{camError}</p> : null}
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
