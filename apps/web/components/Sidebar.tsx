"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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
      { href: "/dashboard/puntos-acceso", label: "Puntos de acceso", module: "actuators", capability: "core.config", adminOnly: true },
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
        href: "/dashboard/dahua/departamentos",
        label: "Departamentos",
        module: "dahua_access",
        feature: "dahua.persons",
        capability: "dahua.persons",
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
      { href: "/dashboard/alpr", label: "Detecciones ALPR", module: "alpr", capability: "access.alpr" },
      { href: "/dashboard/visitas", label: "Visitas", module: "visitors", capability: "access.visitors.manage" },
      { href: "/dashboard/alta-dni", label: "Alta DNI", module: "dni_enroll", capability: "access.dni_enroll" },
      { href: "/portal", label: "App Propietario (Portal)", module: "visitors" },
    ],
  },
  {
    title: "Administración",
    items: [
      { href: "/dashboard/propiedades", label: "Propiedades", module: "visitors", capability: "access.visitors.manage", adminOnly: true },
      { href: "/dashboard/fichadas", label: "Fichadas", module: "attendance", capability: "access.attendance" },
      { href: "/dashboard/panico", label: "Pánico", module: "panic", capability: "ops.alarms" },
      { href: "/dashboard/fuego", label: "Fuego", module: "fire", capability: "ops.alarms" },
      { href: "/dashboard/usuarios", label: "Usuarios y permisos", capability: "core.users.read", adminOnly: true },
      { href: "/dashboard/modulos", label: "Configuración", capability: "core.config", adminOnly: true },
      { href: "/dashboard/diagnostico", label: "Diagnóstico", capability: "ops.dashboard", adminOnly: true },
    ],
  },
];

function pathMatchesHref(path: string, href: string) {
  if (href === "/dashboard") return path === "/dashboard";
  return path === href || path.startsWith(`${href}/`);
}

/** Una sola fila activa: la coincidencia más larga (evita Equipos + Eventos juntos). */
function bestActiveHref(path: string, hrefs: string[]) {
  let best: string | null = null;
  for (const href of hrefs) {
    if (!pathMatchesHref(path, href)) continue;
    if (!best || href.length > best.length) best = href;
  }
  return best;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const { user, tenantName, isPlatform, isAdmin, status, logout, enabled, featureOn, can } = useDash();

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  const visibleHrefs = SECTIONS.flatMap((section) =>
    section.items
      .filter(
        (item) =>
          (!item.adminOnly || isAdmin || isPlatform) &&
          (!item.module || enabled(item.module)) &&
          (!item.feature || featureOn(item.feature)) &&
          (!item.capability || can(item.capability)),
      )
      .map((item) => item.href),
  );
  const activeHref = bestActiveHref(pendingHref ?? pathname, visibleHrefs);

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-slate-200 dark:border-line bg-white dark:bg-[var(--ap-ink)] transition-colors">
      <div className="border-b border-slate-200 dark:border-line px-5 pb-4 pt-6">
        <p className="text-[1.35rem] font-bold leading-none tracking-tight text-blue-600 dark:text-[var(--ap-accent-bright)]">
          AccesoPro
        </p>
        <p className="mt-2 truncate text-[12px] text-slate-500 dark:text-muted">{tenantName ?? "Panel"}</p>
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
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-muted/80">
                {section.title}
              </p>
              <div className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const active = item.href === activeHref;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={false}
                      onClick={() => {
                        setPendingHref(item.href);
                        onNavigate?.();
                      }}
                      className={`rounded-md px-2.5 py-2 text-[13px] transition-colors ${
                        active
                          ? "border-l-2 border-blue-600 bg-blue-50 text-blue-700 font-semibold dark:border-accent dark:bg-accent/10 dark:text-[var(--ap-text)]"
                          : "border-l-2 border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium dark:text-muted dark:hover:bg-panel2/60 dark:hover:text-[var(--ap-text-dim)]"
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

      <div className="border-t border-slate-200 dark:border-line px-4 py-4 bg-slate-50/50 dark:bg-transparent transition-colors">
        <p className="text-[11px] text-slate-500 dark:text-muted">
          Dahua{" "}
          <span className={status.agentOnline ? "font-semibold text-emerald-600 dark:text-ok" : "font-semibold text-rose-600 dark:text-danger"}>
            {status.agentOnline ? "en línea" : "offline"}
          </span>
        </p>
        <p className="mt-2 truncate text-[12px] font-medium text-slate-700 dark:text-[#d0d0d0]">{user?.name}</p>
        <button
          type="button"
          className="mt-3 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[13px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-line dark:bg-transparent dark:text-muted dark:hover:border-accent/40 dark:hover:bg-panel2 dark:hover:text-[#e8f1f6] transition-colors shadow-sm dark:shadow-none"
          onClick={logout}
        >
          Salir
        </button>
      </div>
    </aside>
  );
}
