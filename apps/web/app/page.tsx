"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

const isDev = process.env.NODE_ENV === "development";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(isDev ? "admin@accesopro.local" : "");
  const [password, setPassword] = useState(isDev ? "AccesoPro!2026" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const me = await api<{ user: { role: string } | null }>("/auth/me");
      router.push(me.user?.role === "resident" ? "/portal" : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo entrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4 dark:bg-ink">
      <div className="w-full max-w-[380px] rounded-lg border border-slate-200 bg-white px-9 py-10 text-center shadow-card text-slate-900 dark:border-line dark:bg-panel dark:text-[#e8e8e8]">
        <div className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-md border border-slate-200 bg-slate-50 text-sm font-bold text-slate-800 dark:border-line dark:bg-panel2 dark:text-[#e6e6e6]">
          AP
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">AccesoPro</h1>
        <p className="mb-6 mt-1 text-slate-500 dark:text-muted">Control de acceso del barrio</p>
        <form onSubmit={onSubmit} className="space-y-4 text-left">
          <label className="block text-sm">
            Email
            <input
              className="mt-1 w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-accent dark:border-line dark:bg-ink dark:text-slate-100"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="username"
            />
          </label>
          <label className="block text-sm">
            Contraseña
            <input
              className="mt-1 w-full rounded-[10px] border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-accent dark:border-line dark:bg-ink dark:text-slate-100"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="rounded-[10px] border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-danger dark:bg-[#3a1515] dark:text-danger">{error}</p> : null}
          <button
            disabled={busy}
            className="w-full rounded-[10px] bg-accent py-2.5 font-medium text-white disabled:opacity-60"
            type="submit"
          >
            {busy ? "Entrando…" : "Ingresar"}
          </button>
        </form>
      </div>
    </main>
  );
}
