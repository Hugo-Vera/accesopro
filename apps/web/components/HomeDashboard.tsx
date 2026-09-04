"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { DahuaLivePanel } from "@/components/DahuaLivePanel";

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

type MenuTile = {
  key: string;
  label: string;
  href: string;
  icon: string;
  show: boolean;
};

const PHONE_CONTACTS = [
  { id: "sindico", name: "Administración", ext: "100" },
  { id: "portero", name: "Interfono ingreso", ext: "101" },
  { id: "zelador", name: "Mantenimiento", ext: "102" },
  { id: "eclusa", name: "Barrera peatonal", ext: "103" },
  { id: "garaje", name: "Garaje / cochera", ext: "104" },
];

/** Consola fija 2×5 como la referencia; se enlazan actuadores reales por nombre o orden. */
const RELAY_PRESETS: { label: string; match: RegExp; kind: string; danger?: boolean; cam?: boolean }[] = [
  { label: "Portería", match: /porter|guarita|cabina/i, kind: "house" },
  { label: "Sirena", match: /siren|alarma/i, kind: "siren", danger: true },
  { label: "Emergencia", match: /emerg|pánico|panico/i, kind: "emerg", danger: true },
  { label: "Luces", match: /luz|luces|ilum/i, kind: "light" },
  { label: "Barrera", match: /barrera|entrada|in\b/i, kind: "gate", cam: true },
  { label: "Portón", match: /portón|porton|eclusa|cancela|salida|out\b/i, kind: "gate", cam: true },
  { label: "Garaje", match: /garage|garaje|cochera/i, kind: "garage", cam: true },
  { label: "Peatonal", match: /peaton|puerta/i, kind: "door", cam: true },
  { label: "Perímetro", match: /per[ií]metro|reflec|farol/i, kind: "light" },
  { label: "Auxiliar", match: /aux|extra|relay|rel[eé]/i, kind: "power" },
];

type RelaySlot = {
  label: string;
  kind: string;
  danger?: boolean;
  cam?: boolean;
  actuator: Actuator | null;
};

function ActIcon({ name, kind }: { name: string; kind: string }) {
  const n = `${name} ${kind}`.toLowerCase();
  if (/siren|alarma|emerg/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 3l9 16H3L12 3z" />
        <path d="M12 10v4" />
        <path d="M12 17h.01" />
      </svg>
    );
  }
  if (/luz|reflec|farol|light|ilum/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (/garage|cochera|garaje/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M3 10l9-6 9 6" />
        <path d="M5 10v10h14V10" />
        <path d="M5 14h14M5 17h14" />
      </svg>
    );
  }
  if (/porta|barrera|portón|porton|eclusa|cancela|sub.?solo|sótano|sotano/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="3" y="6" width="18" height="12" rx="1" />
        <path d="M3 12h18M8 6v12M16 6v12" />
      </svg>
    );
  }
  if (/puerta|peaton|peatón/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="7" y="3" width="10" height="18" rx="1" />
        <path d="M14 12h.01" />
      </svg>
    );
  }
  if (/guarita|cabina|porter|casa/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M3 11l9-7 9 7" />
        <path d="M5 10v10h14V10" />
        <path d="M10 20v-6h4v6" />
      </svg>
    );
  }
  if (/riego|irrig|jard/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 3c4 5 6 8 6 11a6 6 0 11-12 0c0-3 2-6 6-11z" />
      </svg>
    );
  }
  if (/basura|lixer|recicl/.test(n)) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M4 7h16M9 7V5h6v2M8 7l1 13h6l1-13" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </svg>
  );
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
    features,
    kpis,
    isPlatform,
    isAdmin,
  } = useDash();

  const [acts, setActs] = useState<Actuator[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dial, setDial] = useState("");
  const [phoneMsg, setPhoneMsg] = useState<string | null>(null);

  const showLive = featureOn("dahua.live") && can("dahua.live");
  const showEvents = featureOn("dahua.events") && can("dahua.events");
  const showActuators = enabled("actuators") && can("ops.relay");
  const showDevices = featureOn("dahua.devices") && can("access.dahua");
  const manualActs = acts.filter((a) => a.triggerManual !== false);

  const menuTiles: MenuTile[] = useMemo(
    () =>
      [
        {
          key: "plano",
          label: "Plano",
          href: "/dashboard/plano",
          icon: "▣",
          show: can("ops.plano"),
        },
        {
          key: "personas",
          label: "Personas",
          href: "/dashboard/dahua/personas",
          icon: "☺",
          show: featureOn("dahua.persons") && can("dahua.persons"),
        },
        {
          key: "visitas",
          label: "Visitas",
          href: "/dashboard/visitas",
          icon: "✉",
          show: enabled("visitors") && can("access.visitors.manage"),
        },
        {
          key: "vehiculos",
          label: "Chapas",
          href: "/dashboard/alpr",
          icon: "▣",
          show: enabled("alpr") && can("access.alpr"),
        },
        {
          key: "equipos",
          label: "Equipos",
          href: "/dashboard/dahua",
          icon: "▣",
          show: showDevices,
        },
        {
          key: "alarmas",
          label: "Alarmas",
          href: "/dashboard/panico",
          icon: "⚠",
          show: enabled("panic") && can("ops.alarms"),
        },
        {
          key: "fuego",
          label: "Fuego",
          href: "/dashboard/fuego",
          icon: "▲",
          show: enabled("fire") && can("ops.alarms"),
        },
        {
          key: "eventos",
          label: "Accesos",
          href: "/dashboard/dahua/eventos",
          icon: "☰",
          show: showEvents,
        },
        {
          key: "evidencia",
          label: "Evidencia",
          href: "/dashboard/dahua/evidencia",
          icon: "◉",
          show: featureOn("dahua.evidence") && can("dahua.evidence"),
        },
        {
          key: "actuadores",
          label: "Actuadores",
          href: "/dashboard/actuadores",
          icon: "⏻",
          show: showActuators,
        },
        {
          key: "propiedades",
          label: "Lotes",
          href: "/dashboard/propiedades",
          icon: "⌂",
          show: isAdmin && enabled("visitors") && can("access.visitors.manage"),
        },
        {
          key: "usuarios",
          label: "Usuarios",
          href: "/dashboard/usuarios",
          icon: "☰",
          show: isAdmin && can("core.users.read"),
        },
        {
          key: "config",
          label: "Config",
          href: "/dashboard/modulos",
          icon: "⚙",
          show: can("core.config"),
        },
        {
          key: "live",
          label: "Live",
          href: "/dashboard/dahua/live",
          icon: "▶",
          show: showLive,
        },
        {
          key: "qr",
          label: "QR lector",
          href: "/dashboard/dahua/qr",
          icon: "▦",
          show: featureOn("dahua.qr") && can("dahua.qr"),
        },
      ].filter((t) => t.show),
    [
      can,
      enabled,
      featureOn,
      isAdmin,
      showActuators,
      showDevices,
      showEvents,
      showLive,
    ],
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

    if (showEvents) {
      jobs.push(
        api<{ events: EventRow[] }>(t("/api/events?type=dahua_access"))
          .then((d) => setEvents(d.events.slice(0, 6)))
          .catch(() => setEvents([])),
      );
    } else {
      setEvents([]);
    }

    await Promise.all(jobs);
  }

  useEffect(() => {
    loadCore().catch((err) => setError(err instanceof Error ? err.message : "Error"));
    const id = setInterval(() => {
      loadCore().catch(() => null);
    }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, showActuators, showDevices, showEvents]);

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
    setPhoneMsg(`Softphone pendiente (FreePBX). Destino: ${target}`);
  }

  const relaySlots = useMemo((): RelaySlot[] => {
    const remaining = [...manualActs];
    const slots: RelaySlot[] = RELAY_PRESETS.map((preset) => {
      const idx = remaining.findIndex((a) => preset.match.test(a.name) || preset.match.test(a.kind));
      const actuator = idx >= 0 ? remaining.splice(idx, 1)[0]! : null;
      return {
        label: actuator?.name ?? preset.label,
        kind: preset.kind,
        danger: preset.danger,
        cam: preset.cam,
        actuator,
      };
    });
    // sobrantes: reemplazan Auxiliar / vacíos
    for (const extra of remaining.slice(0, 10)) {
      const emptyIdx = slots.findIndex((s) => !s.actuator);
      if (emptyIdx < 0) break;
      slots[emptyIdx] = {
        label: extra.name,
        kind: extra.kind || "power",
        actuator: extra,
        cam: /barrera|portón|porton|garaje|peaton/i.test(extra.name),
      };
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
    <div className="ops-shell flex h-full min-h-0 flex-col gap-2">
      <header className="ops-topbar flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <span className="ops-brand mr-2">AccesoPro</span>
          <span className="ops-pill ops-pill-ok">Operacional</span>
          <span className="ops-condo-tab active">{tenantName ?? "Barrio"}</span>
          {plan ? <span className="ops-condo-tab muted">{plan.name}</span> : null}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="ops-search hidden sm:flex">
            <span className="ops-search-label">Lote</span>
            <input className="ops-search-input" placeholder="Nombre / DNI" disabled title="Búsqueda próximamente" />
          </div>
          <StatusChip ok={Boolean(status.agentOnline)} label={status.agentOnline ? "Agent ok" : "Agent off"} />
          {showDevices ? <StatusChip label={`${devices.length} equipo${devices.length === 1 ? "" : "s"}`} /> : null}
          <StatusChip accent label={`${kpis?.eventsToday ?? status.eventsToday ?? 0} hoy`} />
        </div>
      </header>

      {error ? <p className="px-1 text-[12px] text-danger">{error}</p> : null}

      <div className="ops-grid min-h-0 flex-1">
        {/* LEFT: AccesoCam + relés (un solo bloque) */}
        <section className="ops-col ops-col-left flex min-h-0 flex-col">
          <div className="ops-cam-block">
            <div className="ops-cam-live">
              {showLive ? (
                <DahuaLivePanel compact minimalChrome />
              ) : (
                <div className="grid h-full min-h-[200px] place-items-center bg-[var(--ap-ink-deep)] text-[13px] text-[var(--ap-muted)]">
                  Live apagado o sin permiso
                </div>
              )}
            </div>

            {showActuators ? (
              <div className="ops-relay-strip">
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
                        className={`ops-relay-btn ${open ? "open" : ""} ${emerg ? "danger-tone" : ""} ${!bound ? "unbound" : ""}`}
                        disabled={!!busy || !bound}
                        title={
                          !bound
                            ? `Sin actuador — asigná «${slot.label}» en Actuadores`
                            : open
                              ? "Abierto — click para cerrar"
                              : "Cerrado — click para abrir"
                        }
                        onClick={() => {
                          if (!a) return;
                          fire(a.id, open ? "close" : "open");
                        }}
                      >
                        {slot.cam ? <span className="ops-relay-cam" title="Cámara asociada" /> : null}
                        <span className="ops-relay-icon">
                          <ActIcon name={slot.label} kind={slot.kind} />
                        </span>
                        <span className="ops-relay-label">
                          {a && (busy === `open-${a.id}` || busy === `close-${a.id}`)
                            ? "…"
                            : bound
                              ? shortRelayLabel(slot.label)
                              : slot.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* CENTER: menú + status + notificaciones */}
        <section className="ops-col ops-col-center flex min-h-0 flex-col gap-2 overflow-auto">
          <div className="ops-panel p-2.5">
            <p className="ops-section-title mb-2">Menú principal</p>
            {menuTiles.length === 0 ? (
              <p className="text-[12px] text-[var(--ap-muted)]">
                No hay funciones activas.
                {isAdmin ? (
                  <>
                    {" "}
                    <Link href="/dashboard/modulos" className="text-[var(--ap-accent)] underline-offset-2 hover:underline">
                      Configurá módulos
                    </Link>
                  </>
                ) : null}
              </p>
            ) : (
              <div className="ops-menu-grid">
                {menuTiles.map((tile) => (
                  <Link key={tile.key} href={tile.href} className="ops-menu-tile">
                    <span className="ops-menu-icon" aria-hidden>
                      {tile.icon}
                    </span>
                    <span className="ops-menu-label">{tile.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="ops-panel space-y-2 p-2.5">
            <div>
              <p className="ops-section-title">Sitio</p>
              <p className="mt-1 text-[13px] text-[var(--ap-text)]">{tenantName ?? "—"}</p>
              <p className="text-[11px] text-[var(--ap-muted)]">
                {plan ? `${plan.name} · ` : null}
                {features.filter((f) => f.enabled && f.parentOn).length} funciones on
              </p>
            </div>

            <div>
              <p className="ops-section-title">Estado de sensores</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {manualActs.length === 0 ? (
                  <span className="ops-badge muted">Sin sensores mapeados</span>
                ) : (
                  manualActs.slice(0, 8).map((a) => (
                    <span
                      key={a.id}
                      className={`ops-badge ${
                        a.open === true ? "warn" : a.open === false ? "ok" : "muted"
                      }`}
                    >
                      {shortRelayLabel(a.name)}
                    </span>
                  ))
                )}
              </div>
            </div>

            <div>
              <p className="ops-section-title">Estado de equipos</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <span className={`ops-badge ${status.agentOnline ? "ok" : "danger"}`}>
                  Agent {status.agentOnline ? "online" : "offline"}
                </span>
                {devices.length === 0 ? (
                  <span className="ops-badge muted">Sin equipos</span>
                ) : (
                  devices.map((d) => (
                    <span key={d.id} className="ops-badge ok" title={d.host}>
                      {d.name}
                    </span>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="ops-panel min-h-0 flex-1 p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="ops-section-title">Notificaciones</p>
              {showEvents ? (
                <Link href="/dashboard/dahua/eventos" className="text-[10px] text-[var(--ap-accent)] hover:underline">
                  Ver todos
                </Link>
              ) : null}
            </div>
            {!showEvents ? (
              <p className="text-[12px] text-[var(--ap-muted)]">Eventos no habilitados.</p>
            ) : events.length === 0 ? (
              <p className="text-[12px] text-[var(--ap-muted)]">Sin accesos recientes.</p>
            ) : (
              <ul className="space-y-1.5">
                {events.map((e) => (
                  <li key={e.id} className="ops-notif">
                    <p className="truncate text-[12px] text-[var(--ap-text)]">
                      {e.payload.CardName || e.payload.UserID || e.payload.userName || "Sin nombre"}
                      <span className="text-[var(--ap-muted)]">
                        {" "}
                        · {e.payload.Method || e.payload.method || "acceso"}
                      </span>
                    </p>
                    <p className="font-mono text-[10px] text-[var(--ap-muted)]">
                      {new Date(e.createdAt).toLocaleString("es-AR")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* RIGHT: AccesoPhone */}
        <aside className="ops-col ops-col-phone ops-panel ops-panel-accent flex min-h-0 flex-col overflow-hidden">
          <div className="ops-phone-head">
            <p className="ops-brand">AccesoPhone</p>
            <p className="text-[11px] text-[var(--ap-muted)]">Softphone · FreePBX (pendiente)</p>
          </div>

          <div className="min-h-0 flex-1 overflow-auto border-b border-[var(--ap-line-soft)]">
            <ul>
              {PHONE_CONTACTS.map((c) => (
                <li key={c.id} className="ops-contact">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="ops-dot" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate text-[12px] text-[var(--ap-text)]">{c.name}</p>
                      <p className="font-mono text-[10px] text-[var(--ap-muted)]">ext {c.ext}</p>
                    </div>
                  </div>
                  <button type="button" className="ops-call-btn" onClick={() => stubCall(c.ext)} aria-label={`Llamar ${c.name}`}>
                    ☎
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="shrink-0 p-2.5">
            <div className="ops-dial-display mb-2">{dial || "—"}</div>
            <div className="ops-keypad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => (
                <button key={k} type="button" className="ops-key" onClick={() => pushDial(k)}>
                  {k}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              <button type="button" className="ops-dial-go flex-1" onClick={() => stubCall(dial || "vacío")}>
                Discar
              </button>
              <button type="button" className="ops-key ops-key-back" onClick={() => setDial((d) => d.slice(0, -1))}>
                ⌫
              </button>
            </div>
            {phoneMsg ? <p className="mt-2 text-[10px] leading-snug text-[var(--ap-muted)]">{phoneMsg}</p> : null}

            <div className="mt-3 grid grid-cols-3 gap-1.5">
              <button type="button" className="ops-emerg police" onClick={() => stubCall("911")}>
                Policía
              </button>
              <button type="button" className="ops-emerg ambulance" onClick={() => stubCall("107")}>
                SAME
              </button>
              <button type="button" className="ops-emerg fire" onClick={() => stubCall("100")}>
                Bomberos
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function shortRelayLabel(name: string) {
  const t = name.trim();
  if (t.length <= 18) return t;
  return `${t.slice(0, 16)}…`;
}

function StatusChip({ label, ok, accent }: { label: string; ok?: boolean; accent?: boolean }) {
  return (
    <span
      className={`ops-pill ${
        ok === true
          ? "ops-pill-ok"
          : ok === false
            ? "ops-pill-danger"
            : accent
              ? "ops-pill-accent"
              : "ops-pill-muted"
      }`}
    >
      {label}
    </span>
  );
}
