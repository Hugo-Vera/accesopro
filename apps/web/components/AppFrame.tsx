"use client";

import { useState } from "react";
import { useDash } from "@/components/DashboardProvider";
import { Sidebar } from "@/components/Sidebar";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const { error, loading, user } = useDash();
  const [open, setOpen] = useState(false);

  if (loading && !user) {
    return <div className="grid h-screen place-items-center text-muted">Cargando panel…</div>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden h-full lg:block">
        <Sidebar />
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-black/60" type="button" onClick={() => setOpen(false)} />
          <div className="relative h-full w-[230px]">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3 lg:hidden">
          <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
            Menú
          </button>
          <span className="font-bold">AccesoPro</span>
        </header>
        <main className="flex-1 overflow-auto p-4">
          {error ? (
            <p className="mb-4 rounded-[10px] border border-danger/40 bg-[#3a1515] px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
