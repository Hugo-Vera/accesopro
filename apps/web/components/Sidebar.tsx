"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDash } from "@/components/DashboardProvider";

type Item = { href: string; label: string; icon: string; module?: string };
type Section = { title: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    title: "Operación",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "D" },
      { href: "/dashboard/plano", label: "Plano", icon: "M" },
      { href: "/dashboard/diagnostico", label: "Diagnóstico", icon: "i" },
    ],
  },
  {
    title: "Acceso",
    items: [
      { href: "/dashboard/alpr", label: "Detecciones", icon: "T", module: "alpr" },
      { href: "/dashboard/dahua", label: "Acceso Dahua", icon: "A", module: "dahua_access" },
      { href: "/dashboard/actuadores", label: "Actuadores", icon: "R", module: "actuators" },
      { href: "/dashboard/visitas", label: "Visitas", icon: "V", module: "visitors" },
      { href: "/dashboard/alta-dni", label: "Alta DNI", icon: "ID", module: "dni_enroll" },
    ],
  },
  {
    title: "Seguridad",
    items: [
      { href: "/dashboard/panico", label: "Pánico", icon: "!", module: "panic" },
      { href: "/dashboard/fuego", label: "Fuego", icon: "F", module: "fire" },
    ],
  },
  {
    title: "Administración",
    items: [
      { href: "/dashboard/fichadas", label: "Fichadas", icon: "H", module: "attendance" },
      { href: "/dashboard/modulos", label: "Configuración", icon: "C" },
    ],
  },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, tenants, tenantId, isPlatform, status, setTenant, logout, enabled } = useDash();

  return (
    <aside className="flex h-full w-[230px] shrink-0 flex-col border-r border-line bg-gradient-to-b from-[#162539f5] to-[#101d2df5]">
      <div className="flex items-start gap-2.5 border-b border-line px-4 pb-3.5 pt-5">
        <div className="mt-0.5 grid h-7 w-7 place-items-center rounded-full border border-accent/45 bg-accent/20 text-[11px] font-bold">
          AP
        </div>
        <div>
          <p className="text-[1.35rem] font-bold leading-none">AccesoPro</p>
          <p className="mt-1 text-[13px] text-muted">Acceso y seguridad</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-3 overflow-auto p-2">
        {SECTIONS.map((section) => {
          const items = section.items.filter((item) => !item.module || enabled(item.module));
          if (!items.length) return null;
          return (
            <div key={section.title}>
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted/80">
                {section.title}
              </p>
              <div className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const active =
                    item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[15px] ${
                        active
                          ? "border border-accent/40 bg-accent/30 text-white"
                          : "text-muted hover:bg-accent/15 hover:text-[#eaf2ff]"
                      }`}
                    >
                      <span className="w-5 shrink-0 text-center text-[10px] font-bold">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-line px-4 py-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Estado ALPR</p>
        <div className="mb-2 rounded-[10px] border border-line bg-panel2 px-2 py-1.5 text-[12px] leading-snug text-muted">
          {status.engineOnline ? "Motor en línea · IN/OUT vivos" : "Motor offline"}
          <br />
          Dahua {status.agentOnline ? "en línea" : "offline"}
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Cámara principal</p>
        <p className="break-all text-[12px] text-muted">192.168.33.200 · LAN</p>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3.5">
        <div className="min-w-0">
          {isPlatform && tenants.length > 0 ? (
            <select
              className="w-full rounded-md border border-line bg-ink px-1 py-0.5 text-[12px]"
              value={tenantId ?? ""}
              onChange={(e) => setTenant(e.target.value)}
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="truncate text-[12px] text-muted">{user?.name}</p>
          )}
        </div>
        <button type="button" className="btn-ghost" onClick={logout}>
          Salir
        </button>
      </div>
    </aside>
  );
}
