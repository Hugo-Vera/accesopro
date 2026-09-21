export type NavIconKey = "home" | "map" | "ops" | "people" | "install" | "security" | "system";

export type NavLeaf = {
  id: string;
  href: string;
  label: string;
  /** Clave de MODULE_CATALOG. */
  module?: string;
  feature?: string;
  /** Clave de CAPABILITY_CATALOG. */
  capability?: string;
  adminOnly?: boolean;
  /** Rutas viejas / pestañas que deben marcar este ítem activo. */
  aliases?: string[];
  /** No sale en el menú: vive como pestaña de otro ítem. */
  navHidden?: boolean;
};

export type NavGroup = {
  id: string;
  label: string;
  icon: NavIconKey;
  adminOnly?: boolean;
  /** Ítem preferido para el tile de portería y para el grupo de un solo hijo. */
  defaultItemId: string;
  /** Si es false, no aparece en la grilla de Inicio (el propio Inicio). */
  opsTile?: boolean;
  items: NavLeaf[];
};

export type NavCaps = {
  enabled: (module: string) => boolean;
  featureOn: (feature: string) => boolean;
  can: (capability: string) => boolean;
  isAdmin: boolean;
};

/** Menú staff: un árbol para sidebar y grilla de portería. */
export const NAV_CATALOG: NavGroup[] = [
  {
    id: "inicio",
    label: "Inicio",
    icon: "home",
    defaultItemId: "inicio",
    opsTile: false,
    items: [{ id: "inicio", href: "/dashboard", label: "Inicio", capability: "ops.dashboard" }],
  },
  {
    id: "predio",
    label: "Predio",
    icon: "map",
    defaultItemId: "plano",
    items: [
      { id: "plano", href: "/dashboard/plano", label: "Plano", capability: "ops.plano" },
      {
        id: "puntos",
        href: "/dashboard/puntos-acceso",
        label: "Puntos de acceso",
        module: "actuators",
        capability: "core.config",
        adminOnly: true,
      },
    ],
  },
  {
    id: "porteria",
    label: "Portería",
    icon: "ops",
    defaultItemId: "visitas",
    items: [
      {
        id: "visitas",
        href: "/dashboard/visitas",
        label: "Visitas",
        module: "visitors",
        capability: "access.visitors.manage",
        aliases: ["/dashboard/alta-dni"],
      },
      {
        id: "alta-dni",
        href: "/dashboard/alta-dni",
        label: "Alta DNI",
        module: "dni_enroll",
        capability: "access.dni_enroll",
        navHidden: true,
      },
      {
        id: "eventos",
        href: "/dashboard/dahua/eventos",
        label: "Eventos",
        module: "dahua_access",
        feature: "dahua.events",
        capability: "dahua.events",
        aliases: ["/dashboard/dahua/evidencia"],
      },
      {
        id: "evidencia",
        href: "/dashboard/dahua/evidencia",
        label: "Fotos",
        module: "dahua_access",
        feature: "dahua.evidence",
        capability: "dahua.evidence",
        navHidden: true,
      },
      {
        id: "vehiculos",
        href: "/dashboard/alpr",
        label: "Vehículos",
        module: "alpr",
        capability: "access.alpr",
      },
      {
        id: "fichadas",
        href: "/dashboard/fichadas",
        label: "Fichadas",
        module: "attendance",
        capability: "access.attendance",
      },
    ],
  },
  {
    id: "personas",
    label: "Personas",
    icon: "people",
    defaultItemId: "lotes",
    items: [
      {
        id: "lotes",
        href: "/dashboard/propiedades",
        label: "Lotes",
        module: "visitors",
        capability: "access.owners.invite",
      },
      {
        id: "padron",
        href: "/dashboard/dahua/personas",
        label: "Padrón",
        module: "dahua_access",
        feature: "dahua.persons",
        capability: "dahua.persons",
        aliases: ["/dashboard/dahua/departamentos"],
      },
      {
        id: "sectores",
        href: "/dashboard/dahua/departamentos",
        label: "Sectores",
        module: "dahua_access",
        feature: "dahua.persons",
        capability: "dahua.persons",
        navHidden: true,
      },
    ],
  },
  {
    id: "instalacion",
    label: "Instalación",
    icon: "install",
    defaultItemId: "equipos",
    items: [
      {
        id: "equipos",
        href: "/dashboard/dahua",
        label: "Equipos",
        module: "dahua_access",
        feature: "dahua.devices",
        capability: "access.dahua",
      },
      {
        id: "actuadores",
        href: "/dashboard/actuadores",
        label: "Actuadores",
        module: "actuators",
        capability: "ops.relay",
      },
      {
        id: "live",
        href: "/dashboard/dahua/live",
        label: "Live del lector",
        module: "dahua_access",
        feature: "dahua.live",
        capability: "dahua.live",
      },
      {
        id: "qr-lector",
        href: "/dashboard/dahua/qr",
        label: "QR del lector",
        module: "dahua_access",
        feature: "dahua.qr",
        capability: "dahua.qr",
      },
      {
        id: "periodos",
        href: "/dashboard/dahua/periodos",
        label: "Periodos",
        module: "dahua_access",
        feature: "dahua.schedules",
        capability: "dahua.schedules",
      },
    ],
  },
  {
    id: "seguridad",
    label: "Seguridad",
    icon: "security",
    defaultItemId: "panico",
    items: [
      { id: "panico", href: "/dashboard/panico", label: "Pánico", module: "panic", capability: "ops.alarms" },
      {
        id: "censo",
        href: "/dashboard/censo",
        label: "Censo",
        module: "visitors",
        feature: "visitors.census",
        capability: "ops.census",
      },
      { id: "fuego", href: "/dashboard/fuego", label: "Fuego", module: "fire", capability: "ops.alarms" },
    ],
  },
  {
    id: "sistema",
    label: "Sistema",
    icon: "system",
    adminOnly: true,
    defaultItemId: "config",
    items: [
      { id: "barrios", href: "/dashboard/barrios", label: "Barrios", capability: "platform.tenants", adminOnly: true },
      { id: "usuarios", href: "/dashboard/usuarios", label: "Usuarios", capability: "core.users.read", adminOnly: true },
      { id: "config", href: "/dashboard/modulos", label: "Configuración", capability: "core.config", adminOnly: true },
      {
        id: "manual",
        href: "/dashboard/manual",
        label: "Manual",
        capability: "core.config",
        adminOnly: true,
      },
      {
        id: "diagnostico",
        href: "/dashboard/diagnostico",
        label: "Diagnóstico",
        capability: "ops.dashboard",
        adminOnly: true,
      },
    ],
  },
];

export function navLeafVisible(leaf: NavLeaf, caps: NavCaps): boolean {
  if (leaf.adminOnly && !caps.isAdmin) return false;
  if (leaf.module && !caps.enabled(leaf.module)) return false;
  if (leaf.feature && !caps.featureOn(leaf.feature)) return false;
  if (leaf.capability && !caps.can(leaf.capability)) return false;
  return true;
}

export function navPathMatches(path: string, href: string): boolean {
  if (href === "/dashboard") return path === "/dashboard";
  return path === href || path.startsWith(`${href}/`);
}

export function navLeafHrefs(leaf: NavLeaf): string[] {
  return [leaf.href, ...(leaf.aliases ?? [])];
}

export type VisibleNavGroup = {
  group: NavGroup;
  items: NavLeaf[];
};

export function visibleNavGroups(caps: NavCaps): VisibleNavGroup[] {
  const out: VisibleNavGroup[] = [];
  for (const group of NAV_CATALOG) {
    if (group.adminOnly && !caps.isAdmin) continue;
    const items = group.items.filter((leaf) => !leaf.navHidden && navLeafVisible(leaf, caps));
    if (!items.length) continue;
    out.push({ group, items });
  }
  return out;
}

export function defaultNavHref(group: NavGroup, items: NavLeaf[]): string {
  const preferred = items.find((item) => item.id === group.defaultItemId);
  return (preferred ?? items[0]).href;
}

export type OpsNavTile = {
  id: string;
  label: string;
  href: string;
  icon: NavIconKey;
};

export function opsNavTiles(caps: NavCaps): OpsNavTile[] {
  return visibleNavGroups(caps)
    .filter(({ group }) => group.opsTile !== false)
    .map(({ group, items }) => ({
      id: group.id,
      label: group.label,
      href: defaultNavHref(group, items),
      icon: group.icon,
    }));
}

/** Mejor coincidencia (href más largo) entre ítems visibles, incluyendo aliases y pestañas ocultas. */
export function bestNavHref(path: string, caps: NavCaps): string | null {
  const candidates: string[] = [];
  for (const group of NAV_CATALOG) {
    if (group.adminOnly && !caps.isAdmin) continue;
    for (const leaf of group.items) {
      if (!navLeafVisible(leaf, caps)) continue;
      if (leaf.navHidden) continue;
      for (const href of navLeafHrefs(leaf)) {
        if (navPathMatches(path, href)) candidates.push(leaf.href);
      }
    }
  }
  let best: string | null = null;
  for (const href of candidates) {
    if (!best || href.length > best.length) best = href;
  }
  return best;
}
