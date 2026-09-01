"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@accesopro.local");
  const [password, setPassword] = useState("AccesoPro!2026");
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
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo entrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-[380px] rounded-[14px] border border-line bg-panel px-9 py-10 text-center shadow-card">
        <div className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-full border border-accent/45 bg-accent/20 text-sm font-bold">
          AP
        </div>
        <h1 className="text-2xl font-bold">AccesoPro</h1>
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
