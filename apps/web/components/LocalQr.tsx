"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

type Props = {
  payload: string;
  size?: number;
  alt?: string;
  className?: string;
};

/** PNG 512 px para que el vecino lo adjunte en WhatsApp. */
export async function downloadQrPng(payload: string, filename: string) {
  const text = payload.trim();
  if (!text) throw new Error("Sin contenido");
  const url = await QRCode.toDataURL(text, {
    width: 512,
    margin: 1,
    color: { dark: "#0f172a", light: "#ffffff" },
  });
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.toLowerCase().endsWith(".png") ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** QR generado en el browser. Nunca manda la credencial a un servicio de internet. */
export function LocalQr({ payload, size = 180, alt, className }: Props) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    const text = payload.trim();
    if (!text) {
      setSrc("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(text, {
      width: size,
      margin: 1,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc("");
      });
    return () => {
      cancelled = true;
    };
  }, [payload, size]);

  if (!payload.trim()) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-100 text-xs text-slate-400 dark:bg-slate-800 ${className ?? ""}`}
        style={{ width: size, height: size }}
      >
        Sin contenido
      </div>
    );
  }

  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-white text-xs text-slate-400 ${className ?? ""}`}
        style={{ width: size, height: size }}
      >
        Generando…
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt || "Código QR"}
      width={size}
      height={size}
      className={`rounded bg-white ${className ?? ""}`}
    />
  );
}
