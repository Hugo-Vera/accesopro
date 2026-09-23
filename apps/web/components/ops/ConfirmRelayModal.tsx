"use client";

import { Modal } from "@/components/ui/Modal";

type Props = {
  open: boolean;
  label: string;
  action: "open" | "close";
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmRelayModal({ open, label, action, busy, onCancel, onConfirm }: Props) {
  const verb = action === "open" ? "activar" : "desactivar";

  return (
    <Modal open={open} onClose={onCancel} title="Confirmar accionamiento" size="sm" zClass="z-[60]">
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        Vas a <span className="font-semibold">{verb}</span>{" "}
        <span className="font-semibold text-rose-700 dark:text-rose-300">{label}</span>. Es un control de emergencia
        o alarma.
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
    </Modal>
  );
}
