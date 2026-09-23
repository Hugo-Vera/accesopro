"use client";

import { useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";

type Props = {
  tenantId: string;
  propertyId: string;
  lotNumber: string;
  onClose: () => void;
  onDone?: (approvalId: string) => void;
};

export function AnnounceVisitModal({ tenantId, propertyId, lotNumber, onClose, onDone }: Props) {
  const [guestName, setGuestName] = useState("");
  const [guestDni, setGuestDni] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGuestName("");
    setGuestDni("");
    setError(null);
  }, [propertyId]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const d = await api<{ approvalId: string; passId: string }>(withTenant("/api/visitors/announce", tenantId), {
        method: "POST",
        body: JSON.stringify({ propertyId, guestName, guestDni }),
      });
      onDone?.(d.passId || d.approvalId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo anunciar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="sm" labelledBy="ap-announce-title">
      <h3 id="ap-announce-title" className="text-lg font-bold text-slate-900 dark:text-white">
        Anunciar visita · lote {lotNumber}
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Avisa al titular. Tiene 2 minutos para autorizar. La barrera la abre el guardia.
      </p>
      <label className="mt-3 block text-xs font-semibold text-slate-700 dark:text-slate-300">
        Nombre (si ya lo dijo)
        <input
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
          className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
      </label>
      <label className="mt-2 block text-xs font-semibold text-slate-700 dark:text-slate-300">
        DNI
        <input
          value={guestDni}
          onChange={(e) => setGuestDni(e.target.value)}
          className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
      </label>
      {error ? <p className="mt-2 text-[11px] text-rose-600">{error}</p> : null}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="flex-1 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          Anunciar al lote
        </button>
        <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold dark:border-slate-600">
          Cancelar
        </button>
      </div>
    </Modal>
  );
}
