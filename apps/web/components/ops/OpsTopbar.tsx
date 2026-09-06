"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";
import { Sun, Moon } from "lucide-react";
import { IconList, IconSearch, IconUser } from "@/components/DashboardIcons";

function ConsoleClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const update = () => {
      const d = new Date();
      setTime(d.toTimeString().split(" ")[0] ?? "");
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="ops-tab-clock">[{time || "--:--:--"}]</span>;
}

type TenantOpt = { id: string; name: string };

type Props = {
  tenantId: string | null;
  tenantName: string | null;
  opsStatus: "ok" | "degraded" | "offline";
  isPlatform: boolean;
  tenants: TenantOpt[];
  setTenant: (id: string) => void;
  userName: string | null;
  engineOnline: boolean;
  logout: () => void;
};

export function OpsTopbar({
  tenantId,
  tenantName,
  opsStatus,
  isPlatform,
  tenants,
  setTenant,
  userName,
  engineOnline,
  logout,
}: Props) {
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const [search, setSearch] = useState("");

  const statusPill =
    opsStatus === "ok" ? "ops-pill-ok" : opsStatus === "degraded" ? "ops-pill-muted" : "ops-pill-danger";
  const statusLabel =
    opsStatus === "ok" ? "OPERACIONAL" : opsStatus === "degraded" ? "DEGRADADO" : "OFFLINE";

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    router.push(`/dashboard/dahua/personas?q=${encodeURIComponent(q)}`);
  }

  return (
    <header className="ops-topbar flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="ops-brand mr-1">AccesoPro</span>

        <div className="ops-tab active">
          <span className={`ops-pill ${statusPill}`}>{statusLabel}</span>
          <span className="text-[11px] font-bold tracking-wide text-slate-800 dark:text-white">
            {tenantName ? `COND. ${tenantName.toUpperCase()}` : "SIN BARRIO"}
          </span>
          <ConsoleClock />
        </div>

        {isPlatform && tenants.length > 1 ? (
          <div className="ops-tab cursor-pointer hover:bg-slate-200 dark:hover:bg-[#132a3d]">
            <span className="ops-pill ops-pill-muted">CAMBIAR</span>
            <select
              className="cursor-pointer bg-transparent text-[11px] font-bold text-slate-700 outline-none dark:text-[#a0b5c4]"
              value={tenantId ?? ""}
              onChange={(e) => setTenant(e.target.value)}
              aria-label="Cambiar barrio"
            >
              {tenants.map((t) => (
                <option
                  key={t.id}
                  value={t.id}
                  className="bg-white text-slate-900 dark:bg-[#0b1a28] dark:text-white"
                >
                  {`COND. ${t.name.toUpperCase()}`}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="ops-tab hidden opacity-75 md:inline-flex">
            <span className={`ops-pill ${engineOnline ? "ops-pill-ok" : "ops-pill-muted"}`}>
              {engineOnline ? "ALPR OK" : "ALPR STBY"}
            </span>
            <span className="text-[11px] font-semibold text-slate-600 dark:text-[#8da4b6]">
              MOTOR LAN :5051
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={onSearch} className="ops-search hidden items-center gap-1.5 sm:flex">
          <IconSearch className="h-3.5 w-3.5 text-slate-500 dark:text-[#1a9fbf]" />
          <input
            className="ops-search-input"
            placeholder="Nombre / DNI"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar persona por nombre o DNI"
          />
        </form>

        <div className="hidden items-center gap-2 border-l border-slate-200 pl-2 text-[11px] dark:border-[#1a3246] lg:flex">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-100 text-slate-600 dark:bg-[#162c3e] dark:text-[#2bb8d9]">
            <IconUser className="h-3.5 w-3.5" />
          </span>
          <div className="leading-tight">
            <p className="font-bold text-slate-800 dark:text-white">{userName || "Operador"}</p>
            <p className="text-[9.5px] text-slate-500 dark:text-[#7892a7]">Operador de turno</p>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700 transition-colors hover:bg-slate-200 dark:border-[#234158] dark:bg-[#0c1f30] dark:text-[#8fa7b8] dark:hover:bg-[#152e46]"
          title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          aria-label="Alternar tema"
        >
          {theme === "dark" ? (
            <>
              <Sun className="h-3.5 w-3.5 text-amber-400" />
              <span className="hidden md:inline">Claro</span>
            </>
          ) : (
            <>
              <Moon className="h-3.5 w-3.5 text-slate-600" />
              <span className="hidden md:inline">Oscuro</span>
            </>
          )}
        </button>

        <button
          type="button"
          className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700 transition-colors hover:bg-slate-200 dark:border-[#234158] dark:bg-[#0c1f30] dark:text-[#8fa7b8] dark:hover:bg-[#152e46] dark:hover:text-white"
          onClick={() => window.dispatchEvent(new CustomEvent("ap:open-sidebar"))}
          title="Abrir menú de navegación"
        >
          <IconList className="h-3 w-3" />
          <span>Menú</span>
        </button>

        <button
          type="button"
          className="rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700 transition-colors hover:border-rose-500 hover:bg-slate-200 hover:text-rose-600 dark:border-[#234158] dark:bg-[#0c1f30] dark:text-[#8fa7b8] dark:hover:border-[#d94a4a] dark:hover:bg-[#152e46] dark:hover:text-white"
          onClick={logout}
          title="Cerrar sesión"
        >
          Salir
        </button>
      </div>
    </header>
  );
}
