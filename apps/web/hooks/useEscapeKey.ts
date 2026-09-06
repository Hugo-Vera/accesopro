"use client";

import { useEffect, useRef } from "react";

/**
 * Cierra modales / overlays con Escape.
 * Obligatorio en todo modal emergente de AccesoPro (ver AGENTS.md / regla accesopro).
 *
 * @example
 * useEscapeKey(onClose, open);
 */
export function useEscapeKey(onEscape: () => void, enabled = true) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // No interceptar si el foco está en un input que maneja Esc a su modo
      // (los modales AccesoPro cierran igual: es la UX pedida).
      e.preventDefault();
      e.stopPropagation();
      onEscapeRef.current();
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [enabled]);
}
