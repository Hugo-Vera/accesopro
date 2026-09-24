"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, ScanFace } from "lucide-react";
import { cameraBlockReason, getCameraStream } from "@/lib/camera";

function processImageToJpegBase64(imageSource: HTMLVideoElement): string {
  const max = 640;
  let w = imageSource.videoWidth;
  let h = imageSource.videoHeight;
  if (!w || !h) {
    w = 480;
    h = 480;
  }
  const size = Math.min(w, h);
  const startX = (w - size) / 2;
  const startY = (h - size) / 2;
  const canvas = document.createElement("canvas");
  const targetSize = Math.min(max, size);
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo inicializar canvas");
  ctx.drawImage(imageSource, startX, startY, size, size, 0, 0, targetSize, targetSize);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
  return dataUrl.split(",", 2)[1] || "";
}

type Props = {
  preview: string | null;
  onCapture: (b64: string, dataUrl: string) => void;
  onClear: () => void;
};

export function VisitFaceCapture({ preview, onCapture, onClear }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
  }

  useEffect(() => {
    function onHide() {
      if (document.visibilityState === "hidden") stop();
    }
    function onPageHide() {
      stop();
    }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      stop();
    };
  }, []);

  async function start() {
    setError(null);
    try {
      stop();
      const stream = await getCameraStream({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setLive(true);
    } catch (err) {
      setError(cameraBlockReason() || (err instanceof Error ? err.message : "No se pudo abrir la cámara"));
      setLive(false);
    }
  }

  function capture() {
    if (!videoRef.current) return;
    try {
      const b64 = processImageToJpegBase64(videoRef.current);
      onCapture(b64, `data:image/jpeg;base64,${b64}`);
      stop();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo capturar");
    }
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-950">
        {preview && !live ? (
          <img src={preview} alt="Captura facial" className="mx-auto aspect-square max-h-56 w-full object-cover object-top" />
        ) : (
          <video
            ref={videoRef}
            className={`mx-auto aspect-square max-h-56 w-full object-cover ${live ? "" : "hidden"}`}
            playsInline
            muted
          />
        )}
        {!preview && !live ? (
          <div className="flex aspect-square max-h-56 flex-col items-center justify-center gap-2 text-slate-400">
            <ScanFace className="h-10 w-10 opacity-50" />
            <p className="text-[11px] font-semibold">Cámara de la portería</p>
          </div>
        ) : null}
      </div>
      {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {!live ? (
          <button
            type="button"
            onClick={() => void start()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <Camera className="h-3.5 w-3.5" />
            {preview ? "Volver a capturar" : "Abrir webcam"}
          </button>
        ) : (
          <button
            type="button"
            onClick={capture}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700"
          >
            <Camera className="h-3.5 w-3.5" />
            Capturar rostro
          </button>
        )}
        {preview ? (
          <button
            type="button"
            onClick={() => {
              stop();
              onClear();
            }}
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white"
          >
            Quitar foto
          </button>
        ) : null}
      </div>
    </div>
  );
}
