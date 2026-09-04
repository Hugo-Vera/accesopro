"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDash } from "@/components/DashboardProvider";

type Item = {
  href: string;
  label: string;
  module?: string;
  feature?: string;
  capability?: string;
  adminOnly?: boolean;
};
type Section = { title: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    title: "Panel",
    items: [
      { href: "/dashboard", label: "Inicio", capability: "ops.dashboard" },
      { href: "/dashboard/plano", label: "Plano", capability: "ops.plano" },
    ],
  },
  {
    title: "Acceso",
    items: [
      {
        href: "/dashboard/dahua",
        label: "Equipos",
        module: "dahua_access",
        feature: "dahua.devices",
        capability: "access.dahua",
      },
      {
        href: "/dashboard/dahua/eventos",
        label: "Eventos",
        module: "dahua_access",
        feature: "dahua.events",
        capability: "dahua.events",
      },
      {
        href: "/dashboard/dahua/personas",
        label: "Personas",
        module: "dahua_access",
        feature: "dahua.persons",
        capability: "dahua.persons",
      },
      {
        href: "/dashboard/dahua/qr",
        label: "QR del lector",
        module: "dahua_access",
        feature: "dahua.qr",
        capability: "dahua.qr",
      },
      {
        href: "/dashboard/dahua/periodos",
        label: "Periodos",
        module: "dahua_access",
        feature: "dahua.schedules",
        capability: "dahua.schedules",
      },
      {
        href: "/dashboard/dahua/evidencia",
        label: "Evidencia",
        module: "dahua_access",
        feature: "dahua.evidence",
        capability: "dahua.evidence",
      },
      {
        href: "/dashboard/dahua/live",
        label: "Live lector",
        module: "dahua_access",
        feature: "dahua.live",
        capability: "dahua.live",
      },
      { href: "/dashboard/actuadores", label: "Actuadores", module: "actuators", capability: "ops.relay" },
      { href: "/dashboard/visitas", label: "Visitas", module: "visitors", capability: "access.visitors.manage" },
    ],
  },
  {
    title: "Administración",
    items: [
      { href: "/dashboard/propiedades", label: "Propiedades", module: "visitors", capability: "access.visitors.manage", adminOnly: true },
      { href: "/dashboard/usuarios", label: "Usuarios y permisos", capability: "core.users.read", adminOnly: true },
      { href: "/dashboard/modulos", label: "Configuración", capability: "core.config", adminOnly: true },
      { href: "/dashboard/diagnostico", label: "Diagnóstico", capability: "ops.dashboard", adminOnly: true },
    ],
  },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, tenantName, isPlatform, isAdmin, status, logout, enabled, featureOn, can } = useDash();

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-line bg-[var(--ap-ink)]">
      <div className="border-b border-line px-5 pb-4 pt-6">
        <p className="text-[1.35rem] font-semibold leading-none tracking-tight text-[var(--ap-accent-bright)]">AccesoPro</p>
        <p className="mt-2 truncate text-[12px] text-muted">{tenantName ?? "Panel"}</p>
      </div>

      <nav className="flex flex-1 flex-col gap-5 overflow-auto px-3 py-4">
        {SECTIONS.map((section) => {
          const items = section.items.filter(
            (item) =>
              (!item.adminOnly || isAdmin || isPlatform) &&
              (!item.module || enabled(item.module)) &&
              (!item.feature || featureOn(item.feature)) &&
              (!item.capability || can(item.capability)),
          );
          if (!items.length) return null;
          return (
            <div key={section.title}>
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/80">
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
                      className={`rounded-md px-2.5 py-2 text-[13px] transition-colors ${
                        active
                          ? "border-l-2 border-accent bg-accent/10 text-[var(--ap-text)]"
                          : "border-l-2 border-transparent text-muted hover:bg-panel2/60 hover:text-[var(--ap-text-dim)]"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-line px-4 py-4">
        <p className="text-[11px] text-muted">
          Dahua{" "}
          <span className={status.agentOnline ? "text-ok" : "text-danger"}>
            {status.agentOnline ? "en línea" : "offline"}
          </span>
        </p>
        <p className="mt-2 truncate text-[12px] text-[#d0d0d0]">{user?.name}</p>
        <button type="button" className="btn-ghost mt-3 w-full" onClick={logout}>
          Salir
        </button>
      </div>
    </aside>
  );
}
