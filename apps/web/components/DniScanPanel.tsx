"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Keyboard, ScanLine } from "lucide-react";
import { parseDniScan } from "@/lib/parseDni";

type Mode = "lector" | "webcam";

type Props = {
  onScan: (raw: string) => void;
  active?: boolean;
};

type ZxingHandle = {
  reset: () => void;
  decode: (el: HTMLVideoElement) => { getText: () => string };
};

export function DniScanPanel({ onScan, active = true }: Props) {
  const [mode, setMode] = useState<Mode>("lector");
  const [raw, setRaw] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [camLive, setCamLive] = useState(false);
  const [decoding, setDecoding] = useState(false);

  const hidRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<ZxingHandle | null>(null);
  const flushTimer = useRef<number | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const applyIfParsed = useCallback((text: string) => {
    const parsed = parseDniScan(text);
    if (!parsed) return false;
    onScanRef.current(text);
    setRaw("");
    setHint(`Leído: ${parsed.lastName} ${parsed.firstName} · DNI ${parsed.dni}`.trim());
    return true;
  }, []);

  function stopCamera() {
    readerRef.current?.reset();
    readerRef.current = null;
    const video = videoRef.current;
    const stream = video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (video) video.srcObject = null;
    setCamLive(false);
    setDecoding(false);
  }

  useEffect(() => {
    if (!active) stopCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (mode === "lector") {
      stopCamera();
      const t = window.setTimeout(() => hidRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (mode !== "webcam" || !active) return;
    let cancelled = false;

    async function start() {
      setCamError(null);
      setHint(null);
      try {
        const zxing = await import("@zxing/library");
        if (cancelled) return;
        const hints = new Map();
        hints.set(zxing.DecodeHintType.POSSIBLE_FORMATS, [
          zxing.BarcodeFormat.PDF_417,
          zxing.BarcodeFormat.QR_CODE,
        ]);
        hints.set(zxing.DecodeHintType.TRY_HARDER, true);
        const reader = new zxing.BrowserMultiFormatReader(hints, 250);
        readerRef.current = reader;
        const video = videoRef.current;
        if (!video) return;
        await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          },
          video,
          (result) => {
            if (!result || cancelled) return;
            if (applyIfParsed(result.getText())) {
              stopCamera();
              setMode("lector");
            }
          }
        );
        if (!cancelled) setCamLive(true);
      } catch (err) {
        if (cancelled) return;
        setCamError(err instanceof Error ? err.message : "No se pudo abrir la cámara");
        setCamLive(false);
      }
    }

    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, active, applyIfParsed]);

  function onHidChange(value: string) {
    setRaw(value);
    setHint(null);
    if (flushTimer.current) window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => {
      applyIfParsed(value);
    }, 280);
  }

  function onHidKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const text = e.currentTarget.value.trim();
    if (!text) return;
    if (!applyIfParsed(text)) {
      setHint("No se reconoció el formato Renaper. Acercá de nuevo el DNI al lector.");
    }
  }

  function onHidPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    e.preventDefault();
    setRaw(text);
    if (!applyIfParsed(text)) {
      setHint("No se reconoció el formato Renaper. Acercá de nuevo el DNI al lector.");
    }
  }

  async function decodeSnapshot() {
    const video = videoRef.current;
    const reader = readerRef.current;
    if (!video || !video.videoWidth || !reader) return;
    setDecoding(true);
    setCamError(null);
    try {
      const result = reader.decode(video);
      const text = result.getText();
      if (applyIfParsed(text)) {
        stopCamera();
        setMode("lector");
      } else {
        setHint("Hay un código, pero no coincide con el PDF417/QR del DNI.");
      }
    } catch {
      setHint("No se vio un PDF417 o QR nítido. Acercá el dorso del DNI y repetí.");
    } finally {
      setDecoding(false);
    }
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ScanLine className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-blue-900 dark:text-blue-300">
          Escanear DNI
        </span>
        <div className="ml-auto flex rounded-lg border border-blue-200 bg-white p-0.5 dark:border-blue-800 dark:bg-slate-950">
          <button
            type="button"
            onClick={() => setMode("lector")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ${
              mode === "lector"
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <Keyboard className="h-3 w-3" />
            Lector DNI
          </button>
          <button
            type="button"
            onClick={() => setMode("webcam")}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ${
              mode === "webcam"
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <Camera className="h-3 w-3" />
            Cámara web
          </button>
        </div>
      </div>

      {mode === "lector" ? (
        <div>
          <label className="mb-1 block text-[11px] font-bold text-blue-900 dark:text-blue-300">
            Pistola USB o lector de DNI (HID)
          </label>
          <input
            ref={hidRef}
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Apoyá el cursor acá y pasá el DNI por el lector…"
            value={raw}
            onChange={(e) => onHidChange(e.target.value)}
            onKeyDown={onHidKeyDown}
            onPaste={onHidPaste}
            className="w-full rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-blue-800 dark:bg-slate-950 dark:text-white"
          />
          <p className="mt-1 text-[10px] text-blue-700 dark:text-blue-400">
            El lector se comporta como teclado: deja este campo enfocado y pasa el documento
            (PDF417 del dorso o QR). También sirve pegar la cadena.
          </p>
        </div>
      ) : (
        <div>
          <video
            ref={videoRef}
            className="mb-2 h-40 w-full rounded-lg bg-slate-900 object-cover"
            muted
            playsInline
            autoPlay
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void decodeSnapshot()}
              disabled={!camLive || decoding}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
            >
              <Camera className="h-3.5 w-3.5" />
              {decoding ? "Leyendo…" : "Leer recuadro"}
            </button>
            <p className="text-[10px] text-blue-700 dark:text-blue-400">
              Enfocá el PDF417 del dorso (DNI tarjeta) o el QR del frente, con buena luz y de cerca.
            </p>
          </div>
          {camError ? <p className="mt-1 text-[11px] text-rose-600">{camError}</p> : null}
        </div>
      )}

      {hint ? (
        <p
          className={`mt-2 text-[11px] font-semibold ${
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
