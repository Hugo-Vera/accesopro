"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useDash } from "@/components/DashboardProvider";
import { Sidebar } from "@/components/Sidebar";
import { useTheme } from "@/components/ThemeProvider";
import { Sun, Moon } from "lucide-react";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const { error, loading, user, tenantName, plan, status, isPlatform, tenants, tenantId, setTenant, logout } =
    useDash();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const opsHome = pathname === "/dashboard";

  // Permite que cualquier componente (como el botón Menú de HomeDashboard) abra la barra lateral
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("ap:open-sidebar", handler);
    return () => window.removeEventListener("ap:open-sidebar", handler);
  }, []);

  if (loading && !user) {
    return (
      <div className="grid h-screen place-items-center bg-slate-50 dark:bg-ink text-slate-500 dark:text-muted">
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
          ? "bg-slate-100 dark:bg-[#07131e] text-slate-900 dark:text-slate-100 transition-colors"
          : "bg-slate-100 dark:bg-[radial-gradient(ellipse_at_top,_#152433_0%,_#07121c_55%)] text-slate-900 dark:text-slate-100 transition-colors"
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
        {opsHome ? null : (
          <header className="flex items-center gap-3 border-b border-slate-200 dark:border-line/80 bg-white/90 dark:bg-transparent px-4 py-3 backdrop-blur-sm lg:px-8 lg:py-4 transition-colors">
            <button type="button" className="btn-ghost lg:hidden" onClick={() => setOpen(true)}>
              Menú
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold tracking-tight text-slate-900 dark:text-[#e8f1f6]">
                {tenantName ?? "AccesoPro"}
              </p>
              <p className="truncate text-[12px] text-slate-500 dark:text-muted">
                {roleLabel}
                {plan ? ` · ${plan.name}` : null}
                {" · "}
                <span className={status.agentOnline ? "text-emerald-600 dark:text-ok" : "text-rose-600 dark:text-danger"}>
                  Dahua {status.agentOnline ? "ok" : "offline"}
                </span>
              </p>
            </div>

            {/* Selector de modo oscuro / claro */}
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-sm"
              title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              aria-label="Alternar tema"
            >
              {theme === "dark" ? (
                <>
                  <Sun className="h-4 w-4 text-amber-400" />
                  <span className="hidden md:inline">Claro</span>
                </>
              ) : (
                <>
                  <Moon className="h-4 w-4 text-slate-600" />
                  <span className="hidden md:inline">Oscuro</span>
                </>
              )}
            </button>

            {isPlatform && tenants.length > 0 ? (
              <select
                className="hidden max-w-[200px] rounded-md border border-slate-300 dark:border-line bg-white dark:bg-panel px-2 py-1.5 text-[12px] text-slate-800 dark:text-slate-200 sm:block"
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
