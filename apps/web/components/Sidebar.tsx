"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useDash } from "@/components/DashboardProvider";
import {
  bestNavHref,
  visibleNavGroups,
  type NavCaps,
  type NavLeaf,
  type VisibleNavGroup,
} from "@accesopro/catalog";

function itemClass(active: boolean) {
  return `rounded-md px-2.5 py-2 text-[13px] transition-colors ${
    active
      ? "border-l-2 border-blue-600 bg-blue-50 text-blue-700 font-semibold dark:border-accent dark:bg-accent/10 dark:text-[var(--ap-text)]"
      : "border-l-2 border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium dark:text-muted dark:hover:bg-panel2/60 dark:hover:text-[var(--ap-text-dim)]"
  }`;
}

function groupContainsHref(items: NavLeaf[], href: string) {
  return items.some((item) => item.href === href);
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const { user, tenantName, isPlatform, isAdmin, status, logout, enabled, featureOn, can } = useDash();

  const caps: NavCaps = useMemo(
    () => ({
      enabled,
      featureOn,
      can,
      isAdmin: isAdmin || isPlatform,
    }),
    [enabled, featureOn, can, isAdmin, isPlatform],
  );

  const groups = useMemo(() => visibleNavGroups(caps), [caps]);
  const activeHref = bestNavHref(pendingHref ?? pathname, caps);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    if (!activeHref) return;
    const hit = groups.find(({ items }) => groupContainsHref(items, activeHref));
    if (hit && hit.items.length > 1) {
      setOpenIds((prev) => (prev.includes(hit.group.id) ? prev : [...prev, hit.group.id]));
    }
  }, [activeHref, groups]);

  function go(href: string) {
    setPendingHref(href);
    onNavigate?.();
  }

  function toggleGroup(id: string) {
    setOpenIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-slate-200 dark:border-line bg-white dark:bg-[var(--ap-ink)] transition-colors">
      <div className="border-b border-slate-200 dark:border-line px-5 pb-4 pt-6">
        <p className="text-[1.35rem] font-bold leading-none tracking-tight text-blue-600 dark:text-[var(--ap-accent-bright)]">
          AccesoPro
        </p>
        <p className="mt-2 truncate text-[12px] text-slate-500 dark:text-muted">{tenantName ?? "Panel"}</p>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-auto px-3 py-4">
        {groups.map((entry) => (
          <NavGroupBlock
            key={entry.group.id}
            entry={entry}
            activeHref={activeHref}
            open={openIds.includes(entry.group.id)}
            onToggle={() => toggleGroup(entry.group.id)}
            onGo={go}
          />
        ))}
      </nav>

      <div className="border-t border-slate-200 dark:border-line px-4 py-4 bg-slate-50/50 dark:bg-transparent transition-colors">
        <p className="text-[11px] text-slate-500 dark:text-muted">
          Dahua{" "}
          <span
            className={
              status.agentOnline
                ? "font-semibold text-emerald-600 dark:text-ok"
                : "font-semibold text-rose-600 dark:text-danger"
            }
          >
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

function NavGroupBlock({
  entry,
  activeHref,
  open,
  onToggle,
  onGo,
}: {
  entry: VisibleNavGroup;
  activeHref: string | null;
  open: boolean;
  onToggle: () => void;
  onGo: (href: string) => void;
}) {
  const { group, items } = entry;
  if (items.length === 1) {
    const item = items[0];
    const active = item.href === activeHref;
    return (
      <Link href={item.href} prefetch={false} onClick={() => onGo(item.href)} className={itemClass(active)}>
        {item.label}
      </Link>
    );
  }

  const groupActive = groupContainsHref(items, activeHref ?? "");
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
          groupActive
            ? "text-blue-700 dark:text-[var(--ap-accent-bright)]"
            : "text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-muted/80 dark:hover:bg-panel2/60 dark:hover:text-[var(--ap-text-dim)]"
        }`}
      >
        <span>{group.label}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="mb-1 ml-1 flex flex-col gap-0.5 border-l border-slate-200 pl-1 dark:border-line">
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.id}
                href={item.href}
                prefetch={false}
                onClick={() => onGo(item.href)}
                className={itemClass(active)}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
