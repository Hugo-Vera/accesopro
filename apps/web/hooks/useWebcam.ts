"use client";

import { useEffect, useRef, useState } from "react";
import { cameraBlockReason, getCameraStream } from "@/lib/camera";

export type CamDevice = { deviceId: string; label: string };

export function useWebcam(active: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<CamDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
  }

  useEffect(() => {
    if (!active) {
      stop();
      setError(null);
      return;
    }

    let cancelled = false;

    async function run() {
      setError(null);
      try {
        const blocked = cameraBlockReason();
        if (blocked) throw new Error(blocked);
        const video: MediaTrackConstraints = {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        };
        if (deviceId) video.deviceId = { exact: deviceId };
        else video.facingMode = { ideal: "user" };
        const stream = await getCameraStream({ video, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        for (let i = 0; i < 24 && !videoRef.current && !cancelled; i++) {
          await new Promise((r) => requestAnimationFrame(r));
        }
        const el = videoRef.current;
        if (!el || cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        el.srcObject = stream;
        await el.play().catch(() => null);
        setLive(true);
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(
          list
            .filter((d) => d.kind === "videoinput")
            .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Cámara ${i + 1}` })),
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "No se pudo abrir la cámara");
          setLive(false);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
      stop();
    };
  }, [active, deviceId]);

  return { videoRef, devices, deviceId, setDeviceId, error, live, stop };
}
