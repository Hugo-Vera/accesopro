"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Check, FileText, RotateCcw, RotateCw, Upload, X } from "lucide-react";
import { api, apiUrl, withTenant } from "@/lib/api";
import { detectDocBox, type DocBox } from "@/lib/detectDocBox";

export type AcceptedDoc = {
  base64: string | null;
  mime: string;
  source: "scan" | "upload";
  bytes: number;
  cropped: boolean;
  previewUrl: string;
  reuseId?: string;
};

type Props = {
  tenantId: string;
  value: AcceptedDoc | null;
  onAccept: (doc: AcceptedDoc) => void;
  onClear: () => void;
  overlayOpen: boolean;
  onOverlayChange: (open: boolean) => void;
};

type ScanRes = {
  imageBase64: string;
  mime: string;
  bytes: number;
  cropped: boolean;
  rotated?: boolean;
  width: number;
  height: number;
};

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || "");
      resolve(s.split(",", 2)[1] || "");
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

function rotateJpeg90(dataUrl: string) {
  return new Promise<{ dataUrl: string; base64: string; bytes: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalHeight;
      canvas.height = img.naturalWidth;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("No se pudo girar"));
        return;
      }
      ctx.translate(canvas.width, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0);
      const out = canvas.toDataURL("image/jpeg", 0.82);
      const base64 = out.split(",", 2)[1] || "";
      resolve({ dataUrl: out, base64, bytes: Math.round((base64.length * 3) / 4) });
    };
    img.onerror = () => reject(new Error("No se pudo girar"));
    img.src = dataUrl;
  });
}

export function DocumentScanPanel({
  tenantId,
  value,
  onAccept,
  onClear,
  overlayOpen,
  onOverlayChange,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<DocBox | null>(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lockOn, setLockOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    previewUrl: string;
    base64: string;
    mime: string;
    bytes: number;
    cropped: boolean;
    source: "scan" | "upload";
  } | null>(null);

  function stopCam() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
    setLockOn(false);
    boxRef.current = null;
  }

  useEffect(() => () => stopCam(), []);

  useEffect(() => {
    if (!overlayOpen) {
      stopCam();
      setReview(null);
      setBusy(false);
    }
  }, [overlayOpen]);

  useEffect(() => {
    if (!live || review) return;
    const work = document.createElement("canvas");
    const tick = () => {
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (!video?.videoWidth || !overlay) return;
      const aw = 240;
      const ah = Math.max(1, Math.round((aw * video.videoHeight) / video.videoWidth));
      work.width = aw;
      work.height = ah;
      const wctx = work.getContext("2d", { willReadFrequently: true });
      if (!wctx) return;
      wctx.drawImage(video, 0, 0, aw, ah);
      const img = wctx.getImageData(0, 0, aw, ah);
      const box = detectDocBox(img.data, aw, ah, 4);
      boxRef.current = box;
      setLockOn((prev) => {
        const next = Boolean(box);
        return prev === next ? prev : next;
      });
      const rect = overlay.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      overlay.width = Math.max(1, Math.round(rect.width * dpr));
      overlay.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = overlay.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      if (!box) return;
      const elW = overlay.width;
      const elH = overlay.height;
      const scale = Math.max(elW / video.videoWidth, elH / video.videoHeight);
      const dispW = video.videoWidth * scale;
      const dispH = video.videoHeight * scale;
      const ox = (elW - dispW) / 2;
      const oy = (elH - dispH) / 2;
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = Math.max(3, 3 * dpr);
      ctx.strokeRect(ox + box.x * dispW, oy + box.y * dispH, box.w * dispW, box.h * dispH);
    };
    const id = window.setInterval(tick, 180);
    return () => window.clearInterval(id);
  }, [live, review]);

  async function startCam() {
    setError(null);
    onOverlayChange(true);
    try {
      stopCam();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setLive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir la webcam USB");
    }
  }

  async function sendToServer(imageBase64: string, source: "scan" | "upload", box?: DocBox | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<ScanRes>(withTenant("/api/visitors/document-scan", tenantId), {
        method: "POST",
        body: JSON.stringify({
          imageBase64,
          box: box ? { x: box.x, y: box.y, w: box.w, h: box.h } : undefined,
        }),
      });
      const previewUrl = `data:image/jpeg;base64,${res.imageBase64}`;
      stopCam();
      setReview({
        previewUrl,
        base64: res.imageBase64,
        mime: "image/jpeg",
        bytes: res.bytes,
        cropped: res.cropped,
        source,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo recortar el documento");
    } finally {
      setBusy(false);
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    const b64 = dataUrl.split(",", 2)[1] || "";
    void sendToServer(b64, "scan", boxRef.current);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    onOverlayChange(true);
    if (file.size > 6 * 1024 * 1024) {
      setError("El archivo pesa de más (máx. 6 MB).");
      return;
    }
    if (file.type === "application/pdf") {
      try {
        const base64 = await fileToBase64(file);
        const previewUrl = URL.createObjectURL(file);
        setReview({
          previewUrl,
          base64,
          mime: "application/pdf",
          bytes: file.size,
          cropped: false,
          source: "upload",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo leer el PDF");
      }
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Subí una foto (JPG/PNG) o un PDF.");
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      await sendToServer(base64, "upload");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el archivo");
    }
  }

  function acceptReview() {
    if (!review) return;
    onAccept({
      base64: review.base64,
      mime: review.mime,
      source: review.source,
      bytes: review.bytes,
      cropped: review.cropped,
      previewUrl: review.previewUrl,
    });
    setReview(null);
    onOverlayChange(false);
  }

  function retry() {
    setReview(null);
    setError(null);
    void startCam();
  }

  async function rotateReview() {
    if (!review || review.mime.includes("pdf")) return;
    try {
      const rotated = await rotateJpeg90(review.previewUrl);
      setReview({ ...review, previewUrl: rotated.dataUrl, base64: rotated.base64, bytes: rotated.bytes });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo girar");
    }
  }

  const kb = value ? Math.max(1, Math.round(value.bytes / 1024)) : 0;

  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      {value && !overlayOpen ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
          {value.mime.includes("pdf") ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
              <FileText className="h-4 w-4" />
              PDF adjunto · {kb} KB
            </div>
          ) : (
            <img
              src={value.previewUrl}
              alt="Constancia de seguro"
              className="mx-auto max-h-52 w-auto max-w-full object-contain bg-slate-100 dark:bg-slate-900"
            />
          )}
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-1.5 dark:border-slate-800">
            <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
              Constancia aceptada{value.cropped ? " · recortada" : ""} · {kb} KB
            </span>
            <button type="button" onClick={onClear} className="text-[11px] font-bold text-slate-500 hover:text-rose-600">
              Quitar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void startCam()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white"
          >
            <Camera className="h-3.5 w-3.5" />
            Escanear con webcam
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            <Upload className="h-3.5 w-3.5" />
            Subir archivo
          </button>
        </div>
      )}

      {overlayOpen ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-900 dark:text-blue-300">
              {review ? "Revisá si se lee" : "Constancia de seguro"}
            </span>
            <button
              type="button"
              onClick={() => {
                stopCam();
                setReview(null);
                onOverlayChange(false);
              }}
              className="rounded p-1 text-slate-500 hover:text-slate-800 dark:hover:text-white"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {review ? (
            <div className="space-y-2">
              {review.mime.includes("pdf") ? (
                <iframe title="Vista previa PDF" src={review.previewUrl} className="h-56 w-full rounded-lg bg-white" />
              ) : (
                <img
                  src={review.previewUrl}
                  alt="Documento recortado"
                  className="mx-auto max-h-80 w-auto max-w-full rounded-lg bg-slate-900 object-contain"
                />
              )}
              <p className="text-[10px] text-slate-600 dark:text-slate-400">
                {review.cropped
                  ? "Hoja recortada en el servidor. No hay OCR: no leemos el texto."
                  : "No se trabó una hoja nítida; se comprimió igual. Acercá la constancia a la cámara."}{" "}
                {Math.max(1, Math.round(review.bytes / 1024))} KB.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={acceptReview}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white"
                >
                  <Check className="h-3.5 w-3.5" />
                  Aceptar, se lee
                </button>
                {!review.mime.includes("pdf") ? (
                  <button
                    type="button"
                    onClick={() => void rotateReview()}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    Girar
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={retry}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Repetir
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative overflow-hidden rounded-lg bg-black">
                <video
                  ref={videoRef}
                  className="h-52 w-full bg-black object-cover"
                  muted
                  playsInline
                  autoPlay
                />
                <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" />
              </div>
              <p className="text-[10px] text-blue-800 dark:text-blue-300">
                {lockOn
                  ? "Hoja detectada (recuadro verde). Capturá: el servidor recorta y gira a formato página."
                  : "Acercá la constancia. El recuadro verde aparece solo cuando ve la hoja (no es OCR)."}
              </p>
              <button
                type="button"
                onClick={capture}
                disabled={!live || busy}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
              >
                <Camera className="h-3.5 w-3.5" />
                {busy ? "Recortando…" : "Capturar"}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
    </div>
  );
}

export function visitorDocUrl(tenantId: string, id: string) {
  return apiUrl(withTenant(`/api/visitors/documents/${id}`, tenantId));
}
