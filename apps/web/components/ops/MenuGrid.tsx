"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useMemo } from "react";
import {
  IconIdCard,
  IconUserCheck,
  IconCar,
  IconServer,
  IconSiren,
  IconMap,
  IconGate,
  IconBuilding,
  IconQr,
  IconFolder,
  IconFingerprint,
  IconSettings,
} from "@/components/DashboardIcons";

const ICON = "h-5 w-5 text-slate-600 dark:text-[#94a3b8]";

type Caps = {
  can: (key: string) => boolean;
  enabled: (key: string) => boolean;
  featureOn: (key: string) => boolean;
  showDevices: boolean;
  showEvents: boolean;
};

export type MenuTile = {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
  show: boolean;
};

export function useOpsMenuTiles({ can, enabled, featureOn, showDevices, showEvents }: Caps): MenuTile[] {
  return useMemo(
    () =>
      [
        {
          key: "mapa",
          label: "Mapa Predio",
          href: "/dashboard/plano",
          icon: <IconMap className={ICON} />,
          show: can("ops.plano"),
        },
        {
          key: "colaboradores",
          label: "Colaboradores",
          href: "/dashboard/usuarios",
          icon: <IconIdCard className={ICON} />,
          show: can("core.users.read"),
        },
        {
          key: "visitantes",
          label: "Visitantes",
          href: "/dashboard/visitas",
          icon: <IconUserCheck className={ICON} />,
          show: enabled("visitors") && can("access.visitors.manage"),
        },
        {
          key: "vehiculos",
          label: "Vehículos",
          href: "/dashboard/alpr",
          icon: <IconCar className={ICON} />,
          show: enabled("alpr") && can("access.alpr"),
        },
        {
          key: "dispositivos",
          label: "Dispositivos",
          href: "/dashboard/dahua",
          icon: <IconServer className={ICON} />,
          show: showDevices,
        },
        {
          key: "alarma",
          label: "Central Alarma",
          href: "/dashboard/panico",
          icon: <IconSiren className={ICON} />,
          show: enabled("panic") && can("ops.alarms"),
        },
        {
          key: "accesos",
          label: "Hist. Acceso",
          href: "/dashboard/dahua/eventos",
          icon: <IconGate className={ICON} />,
          show: showEvents,
        },
        {
          key: "unidades",
          label: "Lista Unidades",
          href: "/dashboard/propiedades",
          icon: <IconBuilding className={ICON} />,
          show: enabled("visitors") && can("access.visitors.manage"),
        },
        {
          key: "invitados",
          label: "Invitados QR",
          href: "/dashboard/dahua/qr",
          icon: <IconQr className={ICON} />,
          show: featureOn("dahua.qr") && can("dahua.qr"),
        },
        {
          key: "archivos",
          label: "Evidencia",
          href: "/dashboard/dahua/eventos",
          icon: <IconFolder className={ICON} />,
          show: featureOn("dahua.evidence") && can("dahua.evidence"),
        },
        {
          key: "asistencia",
          label: "Fichadas",
          href: "/dashboard/fichadas",
          icon: <IconFingerprint className={ICON} />,
          show: enabled("attendance") && can("access.attendance"),
        },
        {
          key: "config",
          label: "Configuración",
          href: "/dashboard/modulos",
          icon: <IconSettings className={ICON} />,
          show: can("core.config"),
        },
      ].filter((t) => t.show),
    [can, enabled, featureOn, showDevices, showEvents],
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
