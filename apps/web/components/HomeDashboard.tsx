"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { useTheme } from "@/components/ThemeProvider";
import { Sun, Moon, ScanFace, Activity } from "lucide-react";
import { DahuaLivePanel } from "@/components/DahuaLivePanel";
import { LiveFacialAlertToast, type FacialEventAlert } from "@/components/LiveFacialAlertToast";
import {
  IconClipboard,
  IconIdCard,
  IconUserCheck,
  IconCar,
  IconServer,
  IconSiren,
  IconMap,
  IconClock,
  IconHeadset,
  IconGate,
  IconBuilding,
  IconQr,
  IconFolder,
  IconFingerprint,
  IconSettings,
  IconSearch,
  IconUser,
  IconPhone,
  IconPhoneCall,
  IconList,
  IconStar,
  IconBackspace,
  IconChevronLeft,
  IconChevronRight,
  IconAlertTriangle,
  IconShield,
} from "@/components/DashboardIcons";

type Actuator = {
  id: string;
  name: string;
  kind: string;
  driver: string;
  open: boolean | null;
  triggerManual?: boolean;
};

type Device = { id: string; name: string; host: string };

type EventRow = {
  id: string;
  createdAt: string | number;
  payload: Record<string, string>;
};

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

const PHONE_CONTACTS = [
  { id: "sindico", name: "Síndico / Admin", ext: "100" },
  { id: "portero", name: "Interfono Ingreso", ext: "101" },
  { id: "egreso", name: "Interfono Egreso", ext: "102" },
  { id: "zelador", name: "Intendencia / Mant.", ext: "103" },
  { id: "eclusa", name: "Eclusa Peatonal", ext: "104" },
  { id: "garaje", name: "Garaje / Cochera", ext: "105" },
  { id: "dtmf", name: "DTMF Apertura", ext: "106" },
  { id: "peatonal", name: "Peatonal Calle", ext: "107" },
];

/**
 * 12 slots en grilla 2 cols × 6 filas — terminología para barrios cerrados de Argentina:
 */
const RELAY_PRESETS: {
  label: string;
  match: RegExp;
  kind: string;
  danger?: boolean;
  cam?: boolean;
  empty?: boolean;
}[] = [
  { label: "Portería",          match: /porter|guarita|cabina/i,                    kind: "house" },
  { label: "Sirena",            match: /siren|alarma/i,                              kind: "siren",       danger: true },
  { label: "Basura",            match: /basura|lixe|recicl/i,                        kind: "trash" },
  { label: "Emergencia",        match: /emerg|pánico|panico/i,                       kind: "emerg",       danger: true },
  { label: "Iluminación",       match: /bi\b|ligar|panel|central|iluminac/i,         kind: "light" },
  { label: "",                  match: /\_EMPTY_SLOT_6\_/,                           kind: "empty",       empty: true },
  { label: "Reflector",         match: /reflec|per[ií]metro|farol/i,                 kind: "floodlight",  cam: true },
  { label: "Portón Eclusa",     match: /portón|porton|eclusa|cancela|barrera|in\b/i, kind: "gate",        cam: true },
  { label: "Cocheras / Garaje", match: /garage|garaje|cochera/i,                     kind: "garage",      cam: true },
  { label: "Puerta Peatonal",   match: /sub.?solo|s[oó]tano|peaton|puerta|out\b/i,  kind: "underground", cam: true },
  { label: "Riego Jardín",      match: /riego|irrig|jard/i,                          kind: "water" },
  { label: "",                  match: /\_EMPTY_SLOT_12\_/,                          kind: "empty",       empty: true },
];

type RelaySlot = {
  label: string;
  kind: string;
  danger?: boolean;
  cam?: boolean;
  empty?: boolean;
  actuator: Actuator | null;
};

function ActIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "house":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M3 11l9-7 9 7" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-6h4v6" />
        </svg>
      );
    case "siren":
    case "emerg":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3l9 16H3L12 3z" />
          <path d="M12 10v4" />
          <circle cx="12" cy="17" r="1" />
        </svg>
      );
    case "trash":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
        </svg>
      );
    case "light":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
    case "water":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3c4 5 6 8 6 11a6 6 0 11-12 0c0-3 2-6 6-11z" />
        </svg>
      );
    case "floodlight":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 6l2 2" />
        </svg>
      );
    case "gate":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="3" y="6" width="18" height="12" rx="1" />
          <path d="M3 12h18M8 6v12M16 6v12" />
        </svg>
      );
    case "garage":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M3 10l9-6 9 6" />
          <path d="M5 10v10h14V10" />
          <path d="M5 14h14M5 17h14" />
        </svg>
      );
    case "underground":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M4 6h4v4h4v4h4v4h4" />
          <path d="M4 20h16" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      );
  }
}

export function HomeDashboard() {
  const {
    tenantId,
    tenantName,
    plan,
    status,
    featureOn,
    enabled,
    can,
    isPlatform,
    tenants,
    setTenant,
    user,
    logout,
  } = useDash();
  const { theme, toggleTheme } = useTheme();

  const [acts, setActs] = useState<Actuator[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [liveAlert, setLiveAlert] = useState<FacialEventAlert | null>(null);
  const handleDismissAlert = useCallback(() => setLiveAlert(null), []);
  const lastSeenEventIdRef = useRef<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dial, setDial] = useState("");
  const [phoneMsg, setPhoneMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const showLive = featureOn("dahua.live") && can("dahua.live");
  const showEvents = featureOn("dahua.events") && can("dahua.events");
  const showActuators = enabled("actuators") && can("ops.relay");
  const showDevices = featureOn("dahua.devices") && can("access.dahua");
  const manualActs = acts.filter((a) => a.triggerManual !== false);

  // 15 baldosas del menú principal con colores categóricos y estética sobria
  const menuTiles = useMemo(
    () => [
      {
        key: "procedimientos",
        label: "Procedimientos",
        href: "/dashboard/plano",
        icon: <IconClipboard className="h-5 w-5 text-blue-600 dark:text-[#38bdf8]" />,
        show: true,
      },
      {
        key: "colaboradores",
        label: "Colaboradores",
        href: "/dashboard/usuarios",
        icon: <IconIdCard className="h-5 w-5 text-indigo-600 dark:text-[#818cf8]" />,
        show: can("core.users.read"),
      },
      {
        key: "visitantes",
        label: "Visitantes",
        href: "/dashboard/visitas",
        icon: <IconUserCheck className="h-5 w-5 text-purple-600 dark:text-[#c084fc]" />,
        show: enabled("visitors") && can("access.visitors.manage"),
      },
      {
        key: "vehiculos",
        label: "Vehículos",
        href: "/dashboard/alpr",
        icon: <IconCar className="h-5 w-5 text-cyan-600 dark:text-[#22d3ee]" />,
        show: enabled("alpr") && can("access.alpr"),
      },
      {
        key: "dispositivos",
        label: "Dispositivos",
        href: "/dashboard/dahua",
        icon: <IconServer className="h-5 w-5 text-teal-600 dark:text-[#2dd4bf]" />,
        show: showDevices,
      },
      {
        key: "alarma",
        label: "Central Alarma",
        href: "/dashboard/panico",
        icon: <IconSiren className="h-5 w-5 text-rose-600 dark:text-[#fb7185]" />,
        show: enabled("panic") && can("ops.alarms"),
      },
      {
        key: "mapa",
        label: "Mapa Predio",
        href: "/dashboard/plano",
        icon: <IconMap className="h-5 w-5 text-sky-600 dark:text-[#38bdf8]" />,
        show: can("ops.plano"),
      },
      {
        key: "permanencia",
        label: "Permanencia",
        href: "/dashboard/dahua/eventos",
        icon: <IconClock className="h-5 w-5 text-amber-600 dark:text-[#fbbf24]" />,
        show: showEvents,
      },
      {
        key: "atencion",
        label: "Hist. Atención",
        href: "/dashboard/dahua/eventos",
        icon: <IconHeadset className="h-5 w-5 text-violet-600 dark:text-[#a78bfa]" />,
        show: showEvents,
      },
      {
        key: "accesos",
        label: "Hist. Acceso",
        href: "/dashboard/dahua/eventos",
        icon: <IconGate className="h-5 w-5 text-emerald-600 dark:text-[#34d399]" />,
        show: showEvents,
      },
      {
        key: "unidades",
        label: "Lista Unidades",
        href: "/dashboard/propiedades",
        icon: <IconBuilding className="h-5 w-5 text-slate-600 dark:text-[#94a3b8]" />,
        show: enabled("visitors") && can("access.visitors.manage"),
      },
      {
        key: "invitados",
        label: "Invitados QR",
        href: "/dashboard/dahua/qr",
        icon: <IconQr className="h-5 w-5 text-blue-600 dark:text-[#60a5fa]" />,
        show: featureOn("dahua.qr") && can("dahua.qr"),
      },
      {
        key: "archivos",
        label: "Evidencia",
        href: "/dashboard/dahua/evidencia",
        icon: <IconFolder className="h-5 w-5 text-amber-600 dark:text-[#f59e0b]" />,
        show: featureOn("dahua.evidence") && can("dahua.evidence"),
      },
      {
        key: "asistencia",
        label: "Fichadas",
        href: "/dashboard/fichadas",
        icon: <IconFingerprint className="h-5 w-5 text-emerald-600 dark:text-[#10b981]" />,
        show: enabled("attendance") && can("access.attendance"),
      },
      {
        key: "config",
        label: "Configuración",
        href: "/dashboard/modulos",
        icon: <IconSettings className="h-5 w-5 text-slate-600 dark:text-[#cbd5e1]" />,
        show: can("core.config"),
      },
    ],
    [can, enabled, featureOn, showDevices, showEvents],
  );


  function t(path: string) {
    return withTenant(path, tenantId);
  }

  async function loadCore() {
    if (!tenantId) return;
    const jobs: Promise<void>[] = [];

    if (showActuators) {
      jobs.push(
        api<{ actuators: Actuator[] }>(t("/api/actuators"))
          .then((d) => setActs(d.actuators))
          .catch(() => setActs([])),
      );
    } else {
      setActs([]);
    }

    if (showDevices) {
      jobs.push(
        api<{ devices: Device[] }>(t("/api/dahua"))
          .then((d) => setDevices(d.devices))
          .catch(() => setDevices([])),
      );
    } else {
      setDevices([]);
    }

    await Promise.all(jobs);
  }

  useEffect(() => {
    loadCore().catch((err) => setError(err instanceof Error ? err.message : "Error"));
    const id = setInterval(() => {
      loadCore().catch(() => null);
    }, 3500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, showActuators, showDevices]);

  // Streaming en tiempo real vía Server-Sent Events (SSE) con cero latencia + fallback continuo
  useEffect(() => {
    if (!tenantId || (!showEvents && !enabled("dahua_access"))) return;

    let es: EventSource | null = null;
    let fallbackTimer: NodeJS.Timeout | null = null;

    const handleIncomingEvent = (ev: { id: string; createdAt?: number | string; payload?: Record<string, any> }) => {
      if (!ev?.id) return;
      const p = (ev.payload || {}) as Record<string, any>;
      const isApproved = p.approved === true || String(p.status ?? p.Status ?? "0") === "1";
      const personName = String(
        p.personName || p.CardName || p.userName || p.UserID || (isApproved ? "Usuario ASI" : "Rostro no reconocido")
      );
      const devName = String(p.deviceName || "Lector Facial Dahua");
      const devId = String(p.deviceId || "");
      const snapUrl = String(p.snapshotUrl || p.URL || "");
      const method = String(p.method || (p.Method === "15" ? "facial" : "biométrico"));
      const reason = isApproved ? undefined : String(p.reason || "Rostro no registrado en el sistema");

      const alertData: FacialEventAlert = {
        id: ev.id,
        createdAt: typeof ev.createdAt === "number" ? ev.createdAt : Date.now(),
        approved: isApproved,
        personName,
        method,
        deviceName: devName,
        deviceId: devId,
        snapshotUrl: snapUrl,
        reason,
      };

      // Disparo inmediato del toast flotante en pantalla
      setLiveAlert(alertData);

      // Actualización atómica de la lista de eventos en vivo
      setEvents((prev) => {
        const withoutCurrent = prev.filter((x) => x.id !== ev.id);
        return [{ id: ev.id, createdAt: ev.createdAt || Date.now(), payload: p }, ...withoutCurrent].slice(0, 8);
      });

      lastSeenEventIdRef.current = ev.id;
    };

    // Carga inicial rápida de eventos recientes
    api<{ events: EventRow[] }>(t("/api/events?type=dahua_access"))
      .then((res) => {
        if (res?.events && res.events.length > 0) {
          setEvents(res.events.slice(0, 8));
          lastSeenEventIdRef.current = res.events[0].id;
        }
      })
      .catch(() => null);

    // Conexión SSE en tiempo real
    const connectSSE = () => {
      try {
        es = new EventSource(`/api/events/stream?type=dahua_access`, { withCredentials: true });

        es.addEventListener("access_event", (event: MessageEvent) => {
          try {
            const ev = JSON.parse(event.data);
            handleIncomingEvent(ev);
          } catch {
            // Ignorar errores de parseo
          }
        });

        es.onmessage = (event: MessageEvent) => {
          try {
            const ev = JSON.parse(event.data);
            if (ev?.id) handleIncomingEvent(ev);
          } catch {
            // Ignorar errores
          }
        };
      } catch {
        // Ignorar fallas temporales
      }
    };

    connectSSE();

    // Fallback de alta confiabilidad cada 4s: solo actualiza si hay un evento nuevo
    fallbackTimer = setInterval(async () => {
      try {
        const res = await api<{ events: EventRow[] }>(t("/api/events?type=dahua_access"));
        if (res?.events && res.events.length > 0) {
          const latest = res.events[0];
          if (lastSeenEventIdRef.current && latest.id !== lastSeenEventIdRef.current) {
            handleIncomingEvent(latest);
          }
        }
      } catch {
        // Silencioso
      }
    }, 4000);

    return () => {
      if (es) es.close();
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
  }, [tenantId, showEvents, enabled]);

  async function fire(id: string, action: "open" | "close") {
    if (!tenantId) return;
    setBusy(`${action}-${id}`);
    setError(null);
    try {
      await api(t(`/api/actuators/${id}/${action}`), { method: "POST" });
      const listed = await api<{ actuators: Actuator[] }>(t("/api/actuators"));
      setActs(listed.actuators);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo accionar");
    } finally {
      setBusy(null);
    }
  }

  function pushDial(ch: string) {
    setDial((d) => (d + ch).slice(0, 16));
    setPhoneMsg(null);
  }

  function stubCall(target: string) {
    setPhoneMsg(`Llamando a ${target} (FreePBX / SIP)…`);
  }

  // Mapeo dinámico de slots para grid responsivo sin huecos
  const relaySlots = useMemo((): RelaySlot[] => {
    const remaining = [...manualActs];
    const slots: RelaySlot[] = [];

    // Primero agregamos los presets definidos (omitiendo los vacíos)
    for (const preset of RELAY_PRESETS) {
      if (preset.empty) continue; // Ya no usamos slots vacíos forzados
      
      const idx = remaining.findIndex((a) => preset.match.test(a.name) || preset.match.test(a.kind));
      const actuator = idx >= 0 ? remaining.splice(idx, 1)[0]! : null;
      
      slots.push({
        label: actuator?.name ?? preset.label,
        kind: preset.kind,
        danger: preset.danger,
        cam: preset.cam,
        actuator,
      });
    }

    // Luego agregamos cualquier actuador extra que haya quedado
    for (const extra of remaining) {
      slots.push({
        label: extra.name,
        kind: extra.kind || "gate",
        actuator: extra,
        cam: /barrera|portón|porton|garaje|peaton/i.test(extra.name),
      });
    }

    return slots;
  }, [manualActs]);

  if (isPlatform && !tenantId) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <p className="font-mono text-[12px] tracking-[0.18em] text-accent">ACCESOPRO</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Plataforma</h1>
        <p className="mt-3 text-muted">Elegí un barrio arriba para ver el panel operativo.</p>
        <Link href="/dashboard/modulos" className="btn-primary mt-6 inline-flex">
          Planes y módulos
        </Link>
      </div>
    );
  }

  return (
    <div className="ops-shell flex min-h-full xl:h-full xl:min-h-0 flex-col gap-1.5 p-1">
      {/* BARRA SUPERIOR OPERATIVA */}
      <header className="ops-topbar flex flex-wrap items-center justify-between gap-2">
        {/* Pestañas de Condominios con Estado OPERACIONAL y Reloj */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="ops-brand mr-1">AccesoPro</span>

          {/* Pestaña 1 (Barrio Activo) */}
          <div className="ops-tab active">
            <span className="ops-pill ops-pill-ok">OPERACIONAL</span>
            <span className="text-[11px] font-bold text-slate-800 dark:text-white tracking-wide">
              {tenantName ? `COND. ${tenantName.toUpperCase()}` : "COND. LAS ACACIAS"}
            </span>
            <ConsoleClock />
          </div>

          {/* Pestaña 2 (Segundo Barrio o Switcher para Platform Admin) */}
          {isPlatform && tenants.length > 1 ? (
            <div className="ops-tab cursor-pointer hover:bg-slate-200 dark:hover:bg-[#132a3d]">
              <span className="ops-pill ops-pill-muted">OPERACIONAL</span>
              <select
                className="bg-transparent text-[11px] font-bold text-slate-700 dark:text-[#a0b5c4] outline-none cursor-pointer"
                value={tenantId ?? ""}
                onChange={(e) => setTenant(e.target.value)}
                aria-label="Cambiar barrio"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id} className="bg-white dark:bg-[#0b1a28] text-slate-900 dark:text-white">
                    {`COND. ${t.name.toUpperCase()}`}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="ops-tab hidden md:inline-flex opacity-75">
              <span className="ops-pill ops-pill-muted">OPERACIONAL</span>
              <span className="text-[11px] font-semibold text-slate-600 dark:text-[#8da4b6]">MOTOR LAN :5051</span>
            </div>
          )}
        </div>

        {/* Buscador de Lote/DNI + Perfil de Guardia + Selector de Tema + Acciones */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="ops-search hidden sm:flex items-center gap-1.5">
            <IconSearch className="h-3.5 w-3.5 text-blue-600 dark:text-[#1a9fbf]" />
            <input
              className="ops-search-input"
              placeholder="Unid. | Nombre / DNI"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Perfil del Operador / Estado de Turno */}
          <div className="hidden lg:flex items-center gap-2 border-l border-slate-200 dark:border-[#1a3246] pl-2 text-[11px]">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-blue-50 dark:bg-[#162c3e] text-blue-600 dark:text-[#2bb8d9]">
              <IconUser className="h-3.5 w-3.5" />
            </span>
            <div className="leading-tight">
              <p className="font-bold text-slate-800 dark:text-white">{user?.name || "Guardia Activo"}</p>
              <p className="text-[9.5px] text-slate-500 dark:text-[#7892a7]">Operador de Turno</p>
            </div>
          </div>

          {/* Selector de Tema Claro / Oscuro */}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-[#234158] bg-slate-100 hover:bg-slate-200 dark:bg-[#0c1f30] dark:hover:bg-[#152e46] px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:text-[#8fa7b8] transition-colors shadow-xs"
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

          {/* Botón para abrir el menú lateral completo de navegación */}
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-slate-200 dark:border-[#234158] bg-slate-100 hover:bg-slate-200 dark:bg-[#0c1f30] dark:hover:bg-[#152e46] px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:text-[#8fa7b8] hover:text-slate-900 dark:hover:text-white transition-colors shadow-xs"
            onClick={() => window.dispatchEvent(new CustomEvent("ap:open-sidebar"))}
            title="Abrir menú de navegación"
          >
            <IconList className="h-3 w-3" />
            <span>Menú</span>
          </button>

          <button
            type="button"
            className="rounded-md border border-slate-200 dark:border-[#234158] bg-slate-100 hover:bg-slate-200 dark:bg-[#0c1f30] dark:hover:bg-[#152e46] px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:text-[#8fa7b8] hover:border-rose-500 hover:text-rose-600 dark:hover:border-[#d94a4a] dark:hover:text-white transition-colors shadow-xs"
            onClick={logout}
            title="Cerrar sesión"
          >
            Salir
          </button>
        </div>
      </header>

      {error ? <p className="px-1 text-[12px] text-danger">{error}</p> : null}

      {/* GRILLA DE 3 COLUMNAS DE LA CONSOLA */}
      <div className="ops-grid">
        {/* COLUMNA 1: AccesoCam + Grilla de Pulsadores */}
        <section className="ops-col gap-1">
          {/* Live Camera Feed */}
          <div className="ops-cam-live-wrap">
            {showLive ? (
              <DahuaLivePanel compact minimalChrome />
            ) : (
              <div className="grid h-full min-h-[200px] place-items-center bg-slate-900 border border-slate-800 rounded-[6px] text-[13px] text-slate-400">
                <div className="text-center">
                  <p className="ops-brand">AccesoCam</p>
                  <p className="mt-1 text-[11px]">Stream en vivo de portería</p>
                </div>
              </div>
            )}
          </div>

          {/* Matriz de Pulsadores */}
          <div className="ops-relay-strip flex-1">
            <p className="ops-relay-strip-label">ACCIONAMIENTO DE ACTUADORES Y RELÉS</p>
            <div className="ops-relay-grid">
              {relaySlots.map((slot, i) => {
                const a = slot.actuator;
                const emerg = Boolean(slot.danger);
                const open = a?.open === true;
                const bound = Boolean(a);

                return (
                  <button
                    key={`${slot.label}-${i}`}
                    type="button"
                    className={`ops-relay-btn ${open ? "open" : ""} ${emerg ? "danger-tone" : ""} ${
                      !bound ? "unbound" : ""
                    }`}
                    disabled={!!busy || !bound}
                    title={
                      !bound
                        ? `Pulsador ${slot.label} — Asignar en Actuadores`
                        : open
                          ? "Abierto — click para cerrar"
                          : "Cerrado — click para accionar"
                    }
                    onClick={() => {
                      if (!a) return;
                      fire(a.id, open ? "close" : "open");
                    }}
                  >
                    {slot.cam ? <span className="ops-relay-cam" title="Cámara asociada" /> : null}
                    <span className="ops-relay-icon">
                      <ActIcon kind={slot.kind} />
                    </span>
                    <span className="ops-relay-label">
                      {a && (busy === `open-${a.id}` || busy === `close-${a.id}`)
                        ? "ACCIONANDO…"
                        : slot.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>


        {/* COLUMNA 2: Menú Principal (15 Baldosas) + Telemetría y Notificaciones */}
        <section className="ops-col gap-2 pr-1">
          {/* Menú Principal Superior */}
          <div className="ops-panel overflow-hidden">
            <div className="ops-menu-header flex items-center justify-between">
              <span>::: MENÚ PRINCIPAL</span>
              <span className="text-[9px] font-mono text-[#1a9fbf]">15 MÓDULOS</span>
            </div>

            <div className="ops-menu-grid">
              {menuTiles.map((tile) => (
                <Link
                  key={tile.key}
                  href={tile.href}
                  className={`ops-menu-tile ${!tile.show ? "opacity-60" : ""}`}
                  title={tile.label}
                >
                  <span className="ops-menu-icon" aria-hidden>
                    {tile.icon}
                  </span>
                  <span className="ops-menu-label">{tile.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Filas Inferiores en 2 columnas para coincidir con la referencia */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 flex-1 min-h-0">
            {/* Columna Izquierda Inferior */}
            <div className="flex flex-col gap-2">
              {/* Dirección / Sitio */}
              <div className="ops-subpanel">
                <p className="ops-section-title mb-1">DIRECCIÓN Y TENANT</p>
                <p className="text-[12px] font-bold text-slate-800 dark:text-white">
                  Av. Las Acacias 1280, B° Parque
                </p>
                <p className="text-[11px] text-slate-500 dark:text-[#8fa7b8]">Pilar, Buenos Aires, Argentina</p>
                <div className="mt-2 flex items-center gap-1.5 border-t border-slate-200 dark:border-[#172d3e] pt-1 text-[10px] text-slate-500 dark:text-[#7892a7]">
                  <span className="ops-pill ops-pill-ok">ACTIVO</span>
                  <span>{plan?.name ?? "Plan Acceso Pro"}</span>
                </div>
              </div>

              {/* Estado de Sensores (2 filas de badges) */}
              <div className="ops-subpanel">
                <p className="ops-section-title mb-1.5">ZONAS Y SENSORES DEL PREDIO</p>
                <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
                  <span className="ops-sensor-chip">Sótano</span>
                  <span className="ops-sensor-chip">Acceso Doble</span>
                  <span className="ops-sensor-chip">Garaje</span>
                  <span className="ops-sensor-chip">Portón Eclusa</span>
                  <span className="ops-sensor-chip warn flex items-center gap-1" title="Alerta de nivel">
                    <IconAlertTriangle className="h-2.5 w-2.5 text-amber-700 dark:text-[#1f1803]" />
                    <span>Cisterna</span>
                  </span>
                  <span className="ops-sensor-chip">Hall Social</span>
                  <span className="ops-sensor-chip">Alarma Resid.</span>
                  <span className="ops-sensor-chip ok">Barrera IN</span>
                  <span className="ops-sensor-chip ok">Barrera OUT</span>
                  <span className="ops-sensor-chip">Riego Jardín</span>
                </div>
              </div>

              {/* Estado de Equipos e Integraciones */}
              <div className="ops-subpanel">
                <p className="ops-section-title mb-1.5">EQUIPOS E INTEGRACIONES</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="ops-sensor-chip ok">Módulo Peatonal · OK</span>
                  <span className="ops-sensor-chip ok">Accionador Barrera · OK</span>
                  <span className="ops-sensor-chip ok">Lector Facial Dahua · OK</span>
                  <span
                    className={`ops-sensor-chip ${
                      status.agentOnline ? "ok" : "danger"
                    }`}
                  >
                    Agent Dahua · {status.agentOnline ? "ONLINE" : "OFFLINE"}
                  </span>
                  <span
                    className={`ops-sensor-chip ${
                      status.engineOnline ? "ok" : "warn"
                    }`}
                  >
                    Motor ALPR · {status.engineOnline ? "ONLINE" : "STANDBY"}
                  </span>
                </div>
              </div>
            </div>

            {/* Columna Derecha Inferior */}
            {/* Columna Derecha Inferior: ACTIVIDAD EN VIVO LECTOR FACIAL */}
            <div className="flex flex-col gap-2">
              <div className="ops-subpanel flex-1 flex flex-col justify-between">
                <div>
                  <div className="mb-2 flex items-center justify-between border-b border-slate-200 dark:border-[#172d3e] pb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      <p className="ops-section-title">ACTIVIDAD EN VIVO · LECTOR FACIAL</p>
                    </div>
                    <Link
                      href="/dashboard/dahua/eventos"
                      className="font-mono text-[9.5px] text-blue-600 hover:text-blue-700 dark:text-[#38bdf8] dark:hover:text-white font-bold transition-colors"
                    >
                      HISTORIAL →
                    </Link>
                  </div>

                  {/* Lista en vivo de las últimas caras / intentos */}
                  <div className="space-y-2">
                    {events.length === 0 ? (
                      <div className="py-7 text-center text-slate-400 dark:text-slate-500">
                        <ScanFace className="mx-auto h-7 w-7 opacity-40 mb-1 animate-pulse text-blue-500" />
                        <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Esperando movimiento en el lector facial</p>
                        <p className="text-[9.5px] opacity-75">Las caras y tarjetas se reflejan automáticamente aquí</p>
                      </div>
                    ) : (
                      events.slice(0, 5).map((e) => {
                        const p = (e.payload || {}) as Record<string, any>;
                        const isApproved = p.approved === true || String(p.status ?? p.Status ?? "0") === "1";
                        const personName = String(
                          p.personName || p.CardName || p.userName || p.UserID || (isApproved ? "Usuario ASI" : "Rostro no reconocido"),
                        );
                        const method = String(p.method || (p.Method === "15" ? "facial" : "biométrico"));
                        const devName = String(p.deviceName || "Lector Facial");
                        const devId = String(p.deviceId || "");
                        const snapUrl = String(p.snapshotUrl || p.URL || "");
                        const photoProxy = devId && snapUrl ? `/api/dahua/${devId}/record-snapshot?url=${encodeURIComponent(snapUrl)}` : null;
                        const reason = !isApproved ? String(p.reason || "Sin registro en base") : null;
                        const timeStr = e.createdAt
                          ? new Date(e.createdAt).toLocaleTimeString("es-AR", {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })
                          : "En vivo";

                        return (
                          <div
                            key={e.id}
                            className={`flex items-center justify-between p-2.5 rounded-xl border transition-all shadow-sm ${
                              isApproved
                                ? "bg-emerald-50/80 border-emerald-200/90 dark:bg-emerald-950/25 dark:border-emerald-900/60"
                                : "bg-rose-50/80 border-rose-200/90 dark:bg-rose-950/25 dark:border-rose-900/60"
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div
                                className={`relative w-10 aspect-[272/480] flex-shrink-0 overflow-hidden rounded-xl border-2 text-xs font-bold shadow-sm ${
                                  isApproved
                                    ? "border-emerald-400/80 bg-emerald-100 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                                    : "border-rose-400/80 bg-rose-100 text-rose-700 dark:border-rose-700 dark:bg-rose-900/50 dark:text-rose-300"
                                }`}
                              >
                                {photoProxy ? (
                                  <img
                                    src={photoProxy}
                                    alt={personName}
                                    className="h-full w-full object-cover object-center"
                                    onError={(ev) => {
                                      ev.currentTarget.style.display = "none";
                                    }}
                                  />
                                ) : null}
                                <div className="absolute inset-0 grid place-items-center -z-10 text-slate-400">
                                  {isApproved ? <IconUserCheck className="h-5 w-5 text-emerald-600" /> : <ScanFace className="h-5 w-5 text-rose-500" />}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-bold text-slate-900 dark:text-white leading-tight">
                                  {personName}
                                </p>
                                <p className="text-[10px] text-slate-600 dark:text-slate-400 truncate mt-0.5">
                                  {devName} · {method === "facial" ? "Rostro" : method}
                                </p>
                                {reason && (
                                  <p className="text-[9.5px] font-semibold text-rose-600 dark:text-rose-400 truncate mt-0.5">
                                    {reason}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col items-end flex-shrink-0 pl-2">
                              <span className="font-mono text-[9.5px] text-slate-500 dark:text-slate-400">
                                {timeStr}
                              </span>
                              <span
                                className={`inline-flex items-center gap-0.5 text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full mt-1 ${
                                  isApproved
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                                    : "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300"
                                }`}
                              >
                                {isApproved ? "Aprobado" : "Rechazado"}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between border-t border-slate-200 dark:border-[#172d3e] pt-1.5 text-[9.5px] text-slate-500 dark:text-[#7892a7]">
                  <span className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Sondeo activo Dahua CGI
                  </span>
                  <span>Terminal ASI6214S</span>
                </div>
              </div>

              {/* Guardia Activa */}
              <div className="ops-subpanel">
                <p className="ops-section-title mb-1.5">GUARDIA ACTIVA</p>
                <div className="flex items-center gap-2.5 bg-slate-50 dark:bg-[#081624] rounded-lg p-2 border border-slate-200 dark:border-[#1f374c]">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-blue-100 dark:bg-[#162c3e] text-blue-700 dark:text-[#2bb8d9] flex-shrink-0">
                    <IconShield className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-bold text-slate-800 dark:text-slate-100">{user?.name || "Administrador Plataforma"}</p>
                    <p className="text-[10px] text-slate-500 dark:text-[#7892a7]">Operador Portería · Puesto Principal</p>
                    <p className="text-[9px] font-bold text-emerald-600 dark:text-[#3dcf7a] mt-0.5">● Servicio Operativo</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* COLUMNA 3: AccesoPhone (Softphone Integrado) */}
        <section className="ops-col">
          <div className="ops-panel min-h-[420px] overflow-hidden flex flex-col justify-between">
          <div>
            {/* Toolbar con accesos rápidos de telefonía */}
            <div className="ops-phone-toolbar">
              <button type="button" className="ops-phone-toolbtn active" title="Llamadas">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </button>
              <button type="button" className="ops-phone-toolbtn" title="Agenda / Histórico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  <path d="M8 7h8M8 11h8M8 15h5" />
                </svg>
              </button>
              <button type="button" className="ops-phone-toolbtn" title="Contactos">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </button>
              <button type="button" className="ops-phone-toolbtn" title="Monitor / Pantalla">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path d="M8 21h8M12 17v4" />
                </svg>
              </button>
              <button type="button" className="ops-phone-toolbtn" title="Favoritos">
                <IconStar className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="border-b border-slate-200 dark:border-[#142838] bg-slate-50 dark:bg-[#0a1b2a] px-3 py-1.5 text-[11px] font-bold text-slate-800 dark:text-white">
              {tenantName ? `Cond. ${tenantName}` : "Cond. Las Acacias"}
            </div>

            {/* Lista de Contactos Rápidos / Interfonos */}
            <div className="ops-contact-list">
              <ul>
                {PHONE_CONTACTS.map((c) => (
                  <li key={c.id} className="ops-contact-row">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.7)]" />
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-bold text-slate-800 dark:text-[#67c8e8] tracking-tight">{c.name}</p>
                        <p className="font-mono text-[9px] text-slate-500 dark:text-[#4a7a92]">interno {c.ext}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ops-call-btn-round"
                      onClick={() => stubCall(c.ext)}
                      aria-label={`Llamar ${c.name}`}
                    >
                      <IconPhone className="h-3 w-3 text-white" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            {/* Bloque del Dialer y Teclado Numérico */}
            <div className="border-t border-slate-200 dark:border-[#142838] bg-slate-50 dark:bg-[#071522] p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="ops-brand text-[10px]">AccesoPhone</span>
                <span className="text-[9px] font-mono font-bold text-emerald-600 dark:text-[#3dcf7a]">● LISTO</span>
              </div>

              {/* Display LCD Digital */}
              <div className="ops-dial-lcd mb-2">
                <span className="text-[9.5px] font-mono text-slate-500 dark:text-[#4a6b82]">DESTINO:</span>
                <span className="truncate pl-2">{dial || "—"}</span>
              </div>

              {/* Grilla 3 cols: teclas DTMF + botón LLAMAR vertical */}
              <div className="ops-keypad-layout">
                {/* Teclas numéricas 3×4 */}
                <div className="ops-keypad-3x4">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="ops-key-round"
                      onClick={() => pushDial(k)}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                {/* Columna derecha: LLAMAR grande + Backspace */}
                <div className="ops-keypad-right">
                  <button
                    type="button"
                    className="ops-btn-discar-vertical"
                    onClick={() => stubCall(dial || "vacío")}
                    title="Efectuar llamada"
                  >
                    <IconPhoneCall className="h-4 w-4" />
                    <span>LLAMAR</span>
                  </button>
                  <button
                    type="button"
                    className="ops-key-round backspace ops-key-bksp"
                    onClick={() => setDial((d) => d.slice(0, -1))}
                    title="Borrar dígito"
                  >
                    <IconBackspace className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {phoneMsg ? (
                <p className="mt-1.5 text-center text-[10px] text-blue-600 dark:text-[#67e8f9] leading-snug">{phoneMsg}</p>
              ) : null}
            </div>

            {/* Barra de Emergencia Fija Inferior */}
            <div className="ops-emerg-bar">
              <button
                type="button"
                className="ops-emerg-btn"
                onClick={() => stubCall("911 (Policía)")}
              >
                POLICÍA 911
              </button>
              <button
                type="button"
                className="ops-emerg-btn bg-gradient-to-b from-amber-600 to-amber-700 border-amber-600"
                onClick={() => stubCall("107 (SAME)")}
              >
                SAME 107
              </button>
              <button
                type="button"
                className="ops-emerg-btn"
                onClick={() => stubCall("100 (Bomberos)")}
              >
                BOMBEROS 100
              </button>
            </div>
          </div>
          </div>
        </section>

        {/* Notificación flotante de alta prioridad para actividad facial en vivo */}
        <LiveFacialAlertToast
          alert={liveAlert}
          onDismiss={handleDismissAlert}
          onOpenRelay={async () => {
            const target = acts.find((a) => a.driver === "dahua" || a.kind === "gate" || a.kind === "underground") || acts[0];
            if (target) {
              await fire(target.id, "open");
            }
          }}
        />

      </div>
    </div>
  );
}
