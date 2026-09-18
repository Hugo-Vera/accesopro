"use client";

import { useEffect, useRef } from "react";

/** Pistola HID / lector DNI: captura ráfaga de teclado aunque el foco esté en otro campo. */
export function useHidWedge(onScan: (raw: string) => void, enabled: boolean) {
  const buf = useRef("");
  const lastAt = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const flush = () => {
      const text = buf.current.trim();
      buf.current = "";
      if (text.includes("@") && text.length >= 12) onScanRef.current(text);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = performance.now();
      if (e.key === "Enter") {
        if (buf.current.includes("@") && buf.current.length >= 12) {
          e.preventDefault();
          e.stopPropagation();
          flush();
        } else {
          buf.current = "";
        }
        return;
      }
      if (e.key.length !== 1) return;

      if (now - lastAt.current > 90) buf.current = "";
      const gap = now - lastAt.current;
      lastAt.current = now;
      buf.current += e.key;

      // Solo interceptar ráfaga de pistola. El tipeo lento (incluso con @) va al campo.
      const burst = buf.current.length >= 2 && gap < 45;
      if (burst) {
        e.preventDefault();
        e.stopPropagation();
      }

      window.setTimeout(() => {
        if (performance.now() - lastAt.current >= 85) flush();
      }, 90);
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled]);
}
