"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useDash } from "@/components/DashboardProvider";
import { Sidebar } from "@/components/Sidebar";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const { error, loading, user, tenantName, plan, status, isPlatform, tenants, tenantId, setTenant, logout } =
    useDash();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const opsHome = pathname === "/dashboard";

  if (loading && !user) {
    return (
      <div className="grid h-screen place-items-center bg-ink text-muted">
        Cargando panel…
      </div>
    );
  }

  const roleLabel =
    user?.role === "platform_admin"
      ? "Dueño de plataforma"
      : user?.role === "tenant_admin"
        ? "Admin del barrio"
        : user?.role === "guard"
          ? "Guardia"
          : user?.role;

  return (
    <div
      className={`flex h-screen overflow-hidden ${
        opsHome
          ? "bg-[var(--ap-ink-deep)]"
          : "bg-[radial-gradient(ellipse_at_top,_#152433_0%,_#07121c_55%)]"
      }`}
    >
      {!opsHome ? (
        <div className="hidden h-full lg:block">
          <Sidebar />
        </div>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-40">
          <button className="absolute inset-0 bg-black/70" type="button" onClick={() => setOpen(false)} aria-label="Cerrar menú" />
          <div className="relative h-full w-[248px]">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {opsHome ? (
          <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--ap-line-soft)] bg-[var(--ap-chrome)] px-2">
            <button
              type="button"
              className="rounded border border-[var(--ap-line)] px-2 py-0.5 text-[11px] text-[var(--ap-text-dim)] hover:border-[var(--ap-accent)] hover:text-[var(--ap-accent-bright)]"
              onClick={() => setOpen(true)}
            >
              Menú
            </button>
            {isPlatform && tenants.length > 0 ? (
              <select
                className="ml-auto max-w-[180px] rounded border border-[var(--ap-line)] bg-[var(--ap-ink)] px-2 py-0.5 text-[11px]"
                value={tenantId ?? ""}
                onChange={(e) => setTenant(e.target.value)}
                aria-label="Barrio"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="ml-auto" />
            )}
            <button
              type="button"
              className="rounded border border-[var(--ap-line)] px-2 py-0.5 text-[11px] text-[var(--ap-muted)] hover:text-[var(--ap-text)]"
              onClick={logout}
            >
              Salir
            </button>
          </header>
        ) : (
          <header className="flex items-center gap-3 border-b border-line/80 px-4 py-3 backdrop-blur-sm lg:px-8 lg:py-4">
            <button type="button" className="btn-ghost lg:hidden" onClick={() => setOpen(true)}>
              Menú
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold tracking-tight text-[#e8f1f6]">
                {tenantName ?? "AccesoPro"}
              </p>
              <p className="truncate text-[12px] text-muted">
                {roleLabel}
                {plan ? ` · ${plan.name}` : null}
                {" · "}
                <span className={status.agentOnline ? "text-ok" : "text-danger"}>
                  Dahua {status.agentOnline ? "ok" : "offline"}
                </span>
              </p>
            </div>
            {isPlatform && tenants.length > 0 ? (
              <select
                className="hidden max-w-[200px] rounded-md border border-line bg-panel px-2 py-1.5 text-[12px] sm:block"
                value={tenantId ?? ""}
                onChange={(e) => setTenant(e.target.value)}
                aria-label="Barrio"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : null}
            <button type="button" className="btn-ghost hidden sm:inline-flex" onClick={logout}>
              Salir
            </button>
          </header>
        )}

        <main
          className={
            opsHome
              ? "flex min-h-0 flex-1 flex-col overflow-hidden p-1.5"
              : "flex-1 overflow-auto px-4 py-6 lg:px-8 lg:py-8"
          }
        >
          {error && !opsHome ? (
            <p className="mb-5 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}
          {opsHome ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children}
        </main>
      </div>
    </div>
  );
}
