"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "info" | "warning" | "error";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextValue {
  showToast: (title: string, message?: string, type?: ToastType, duration?: number) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (title: string, message?: string, type: ToastType = "success", duration: number = 4000) => {
      const id = Math.random().toString(36).substring(2, 9);
      const newToast: ToastItem = { id, type, title, message, duration };
      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast]
  );

  const success = useCallback((title: string, message?: string) => showToast(title, message, "success"), [showToast]);
  const error = useCallback((title: string, message?: string) => showToast(title, message, "error", 5000), [showToast]);
  const info = useCallback((title: string, message?: string) => showToast(title, message, "info"), [showToast]);
  const warning = useCallback((title: string, message?: string) => showToast(title, message, "warning"), [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, success, error, info, warning }}>
      {children}
      {/* Contenedor flotante superior derecho */}
      <div className="fixed top-5 right-5 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-2xl backdrop-blur-md transition-all duration-300 ${
              toast.type === "success"
                ? "bg-slate-900/95 border-emerald-500/50 text-slate-100 shadow-[0_0_20px_rgba(16,185,129,0.25)]"
                : toast.type === "error"
                ? "bg-slate-900/95 border-rose-500/50 text-slate-100 shadow-[0_0_20px_rgba(244,63,94,0.25)]"
                : toast.type === "warning"
                ? "bg-slate-900/95 border-amber-500/50 text-slate-100 shadow-[0_0_20px_rgba(245,158,11,0.25)]"
                : "bg-slate-900/95 border-cyan-500/50 text-slate-100 shadow-[0_0_20px_rgba(6,182,212,0.25)]"
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {toast.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
              {toast.type === "error" && <AlertCircle className="w-5 h-5 text-rose-400" />}
              {toast.type === "warning" && <AlertTriangle className="w-5 h-5 text-amber-400" />}
              {toast.type === "info" && <Info className="w-5 h-5 text-cyan-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold tracking-wide text-white">{toast.title}</p>
              {toast.message && (
                <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed break-words">{toast.message}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="shrink-0 text-slate-400 hover:text-white transition-colors p-0.5 rounded"
              title="Cerrar notificación"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      showToast: () => {},
      success: (title: string, msg?: string) => console.log("[Toast Success]", title, msg),
      error: (title: string, msg?: string) => console.error("[Toast Error]", title, msg),
      info: () => {},
      warning: () => {},
    };
  }
  return ctx;
}
