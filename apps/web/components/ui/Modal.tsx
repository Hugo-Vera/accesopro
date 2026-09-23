"use client";

import type { ReactNode } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";

const SIZE_CLASS = {
  sm: "sm:max-w-md",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
} as const;

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  labelledBy?: string;
  size?: keyof typeof SIZE_CLASS;
  /** z-50 ficha / z-[60] confirm y scan */
  zClass?: string;
  /** false cuando el padre ya arma la pila Escape (cola con DNI/docs). */
  closeOnEscape?: boolean;
  panelClassName?: string;
  children: ReactNode;
};

export function Modal({
  open,
  onClose,
  title,
  labelledBy,
  size = "md",
  zClass = "z-50",
  closeOnEscape = true,
  panelClassName,
  children,
}: Props) {
  useEscapeKey(onClose, open && closeOnEscape);

  if (!open) return null;

  const headingId = labelledBy || (title ? "ap-modal-title" : undefined);

  return (
    <div className={`ap-overlay ${zClass}`}>
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Cerrar" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={`ap-modal-panel ${SIZE_CLASS[size]} ${panelClassName ?? "p-5"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? (
          <h2 id={headingId} className="text-base font-semibold text-slate-900 dark:text-white">
            {title}
          </h2>
        ) : null}
        {children}
      </div>
    </div>
  );
}
