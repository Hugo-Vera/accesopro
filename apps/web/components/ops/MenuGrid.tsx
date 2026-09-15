"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useMemo } from "react";
import {
  IconMap,
  IconUserCheck,
  IconUsers,
  IconServer,
  IconSiren,
  IconSettings,
  IconClipboard,
} from "@/components/DashboardIcons";
import { opsNavTiles, type NavCaps, type NavIconKey } from "@accesopro/catalog";
import { useDash } from "@/components/DashboardProvider";

const ICON = "h-5 w-5 text-slate-600 dark:text-[#94a3b8]";

const NAV_ICONS: Record<NavIconKey, ReactNode> = {
  home: <IconClipboard className={ICON} />,
  map: <IconMap className={ICON} />,
  ops: <IconUserCheck className={ICON} />,
  people: <IconUsers className={ICON} />,
  install: <IconServer className={ICON} />,
  security: <IconSiren className={ICON} />,
  system: <IconSettings className={ICON} />,
};

export type MenuTile = {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
  show: boolean;
};

export function useOpsMenuTiles(): MenuTile[] {
  const { can, enabled, featureOn, isAdmin, isPlatform } = useDash();
  const caps: NavCaps = useMemo(
    () => ({
      can,
      enabled,
      featureOn,
      isAdmin: isAdmin || isPlatform,
    }),
    [can, enabled, featureOn, isAdmin, isPlatform],
  );

  return useMemo(
    () =>
      opsNavTiles(caps).map((tile) => ({
        key: tile.id,
        label: tile.label,
        href: tile.href,
        icon: NAV_ICONS[tile.icon],
        show: true,
      })),
    [caps],
  );
}

export function MenuGrid({ tiles, compact }: { tiles: MenuTile[]; compact?: boolean }) {
  return (
    <div className={`ops-panel overflow-hidden ${compact ? "ops-menu--compact" : ""}`}>
      {!compact ? (
        <div className="ops-menu-header flex items-center justify-between">
          <span>::: MENÚ PRINCIPAL</span>
          <span className="font-mono text-[9px] text-[#1a9fbf]">
            {tiles.length} {tiles.length === 1 ? "MÓDULO" : "MÓDULOS"}
          </span>
        </div>
      ) : null}
      <div className="ops-menu-grid">
        {tiles.map((tile) => (
          <Link key={tile.key} href={tile.href} className="ops-menu-tile" title={tile.label}>
            <span className="ops-menu-icon" aria-hidden>
              {tile.icon}
            </span>
            <span className="ops-menu-label">{tile.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
