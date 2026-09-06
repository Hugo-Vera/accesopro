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
    <main className="grid min-h-screen place-items-center bg-ink px-4">
      <div className="w-full max-w-[380px] rounded-lg border border-line bg-panel px-9 py-10 text-center shadow-card">
        <div className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-md border border-line bg-panel2 text-sm font-bold text-[#e6e6e6]">
          AP
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">AccesoPro</h1>
        <p className="mb-6 mt-1 text-muted">Control de acceso del barrio</p>
        <form onSubmit={onSubmit} className="space-y-4 text-left">
          <label className="block text-sm">
            Email
            <input
              className="mt-1 w-full rounded-[10px] border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="username"
            />
          </label>
          <label className="block text-sm">
            Contraseña
            <input
              className="mt-1 w-full rounded-[10px] border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="rounded-[10px] border border-danger bg-[#3a1515] px-3 py-2 text-sm text-danger">{error}</p> : null}
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
