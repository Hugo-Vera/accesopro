"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { Suspense } from "react";

function ActivarForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token")?.trim() || "";
  const [info, setInfo] = useState<{ email: string; name: string; lotNumber: string | null } | null>(null);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<{ email: string; name: string; lotNumber: string | null }>(`/auth/invite/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : "Enlace inválido"));
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (token) {
        await api("/auth/activate", {
          method: "POST",
          body: JSON.stringify({ token, password, passwordConfirm }),
        });
      } else {
        await api("/auth/change-password", {
          method: "POST",
          body: JSON.stringify({ password, passwordConfirm }),
        });
      }
      const me = await api<{ user: { role: string } | null }>("/auth/me");
      router.replace(me.user?.role === "resident" ? "/portal" : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la clave");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4 dark:bg-ink">
      <div className="w-full max-w-[420px] rounded-lg border border-slate-200 bg-white px-9 py-10 text-center shadow-card text-slate-900 dark:border-line dark:bg-panel dark:text-[#e8e8e8]">
        <div className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-md border border-slate-200 bg-slate-50 text-sm font-bold text-slate-800 dark:border-line dark:bg-panel2">
          AP
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Activar cuenta</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500 dark:text-muted">
          {info
            ? `Lote ${info.lotNumber ?? "—"} · ${info.email}`
            : "Definí tu clave definitiva (repetila para confirmar)."}
        </p>
        <form onSubmit={onSubmit} className="space-y-4 text-left">
          <label className="block text-sm">
            Clave nueva
            <input
              className="mt-1 w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-accent dark:border-line dark:bg-ink dark:text-slate-100"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label className="block text-sm">
            Repetir clave
            <input
              className="mt-1 w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-accent dark:border-line dark:bg-ink dark:text-slate-100"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          {error ? (
            <p className="rounded-[10px] border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-danger dark:bg-[#3a1515] dark:text-danger">
              {error}
            </p>
          ) : null}
          <button
            disabled={busy}
            className="w-full rounded-[10px] bg-accent py-2.5 font-medium text-white disabled:opacity-60"
            type="submit"
          >
            {busy ? "Guardando…" : "Guardar clave e ingresar"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function ActivarPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center text-slate-500">Cargando…</main>}>
      <ActivarForm />
    </Suspense>
  );
}
