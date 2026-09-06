"use client";

import { useEscapeKey } from "@/hooks/useEscapeKey";

type Props = {
  open: boolean;
  label: string;
  action: "open" | "close";
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmRelayModal({ open, label, action, busy, onCancel, onConfirm }: Props) {
  useEscapeKey(onCancel, open);

  if (!open) return null;

  const verb = action === "open" ? "activar" : "desactivar";

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        aria-label="Cerrar"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-relay-title"
        className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        <h2 id="confirm-relay-title" className="text-base font-semibold text-slate-900 dark:text-white">
          Confirmar accionamiento
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Vas a <span className="font-semibold">{verb}</span>{" "}
          <span className="font-semibold text-rose-700 dark:text-rose-300">{label}</span>. Es un
          control de emergencia o alarma.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            onClick={onCancel}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Accionando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
