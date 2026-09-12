"use client";

import { FormEvent, useEffect, useState } from "react";
import { IdCard } from "lucide-react";
import { CapabilityGate, ModuleGate, PageHeader } from "@/components/PageHeader";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";

type RecordRow = {
  id: string;
  createdAt: number;
  payload: { dni?: string; fullName?: string; apellido?: string; nombre?: string };
};

export default function AltaDniPage() {
  const { tenantId } = useDash();
  const [raw, setRaw] = useState("");
  const [enrollDahua, setEnrollDahua] = useState(false);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const t = (path: string) => withTenant(path, tenantId);

  async function load() {
    if (!tenantId) return;
    const d = await api<{ records: RecordRow[] }>(t("/api/dni-enroll"));
    setRows(d.records || []);
  }

  useEffect(() => {
    load().catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const d = await api<{ parsed: { fullName: string; dni: string } }>(t("/api/dni-enroll"), {
        method: "POST",
        body: JSON.stringify({ raw, enrollDahua }),
      });
      setMsg(`Leído: ${d.parsed.fullName || d.parsed.dni}`);
      setRaw("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModuleGate module="dni_enroll">
      <CapabilityGate capability="access.dni_enroll">
        <PageHeader
          title="Alta por DNI"
          subtitle="Pegá el QR o PDF417 del DNI argentino en portería. Opcional: enrollar CardNo = DNI en el ASI."
        />
        <form onSubmit={onSubmit} className="mb-6 max-w-xl space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-500">Lectura DNI</span>
            <textarea
              className="cfg-input min-h-[96px] w-full"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="@APELLIDO@NOMBRE@M@30123456@A@01/01/1980@..."
              required
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={enrollDahua} onChange={(e) => setEnrollDahua(e.target.checked)} />
            Enrolar también en los lectores Dahua (CardNo = DNI)
          </label>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          {msg ? <p className="text-sm text-emerald-600">{msg}</p> : null}
          <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy}>
            <IdCard className="h-4 w-4" />
            {busy ? "Leyendo…" : "Registrar"}
          </button>
        </form>
        <ul className="space-y-2 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              {new Date(r.createdAt).toLocaleString("es-AR")} · {r.payload.fullName || "—"} · DNI {r.payload.dni || "—"}
            </li>
          ))}
        </ul>
      </CapabilityGate>
    </ModuleGate>
  );
}
