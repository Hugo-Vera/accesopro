"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, apiUrl, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { FeatureGate, PageHeader, SectionTabs } from "@/components/PageHeader";
import {
  ScanFace,
  CreditCard,
  KeyRound,
  Fingerprint,
  QrCode,
  Radio,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  RefreshCw,
  Search,
  Eye,
  Download,
  X,
  AlertTriangle,
  Camera,
  ShieldAlert,
  HelpCircle,
} from "lucide-react";
import { asiMethodKey, asiMethodLabel } from "@accesopro/catalog";
import { eventPhotoUrl } from "@/components/ops/parseFacialEvent";
import { EventPhoto } from "@/components/ops/EventPhoto";
import { EvidenciaGallery } from "@/components/EvidenciaGallery";
import { useEscapeKey } from "@/hooks/useEscapeKey";

type EventRow = {
  id: string;
  type: string;
  createdAt: string | number;
  payload: Record<string, any>;
};

const METHOD_BADGE_STYLES: Record<string, string> = {
  facial:
    "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/60",
  card:
    "bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/60",
  remote:
    "bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800/60",
  qr:
    "bg-cyan-50 text-cyan-700 border border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800/60",
  password:
    "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/60",
  password_after_card:
    "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/60",
  card_after_password:
    "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/60",
  fingerprint:
    "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60",
  unknown:
    "bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
};

const METHOD_BADGE_ICONS: Record<string, typeof ScanFace> = {
  facial: ScanFace,
  card: CreditCard,
  remote: Radio,
  qr: QrCode,
  password: KeyRound,
  password_after_card: KeyRound,
  card_after_password: KeyRound,
  fingerprint: Fingerprint,
};

function eventHeadline(p: Record<string, unknown>, isApproved: boolean) {
  const method = asiMethodKey(p.methodCode ?? p.Method, p.method);
  const qr = String(p.qrPayload ?? p.QRCode ?? p.QRCodeEx ?? "").trim();
  const err = Number(p.ErrorCode ?? p.asiErrorCode ?? 0);
  if (qr || method === "qr" || err === 96) {
    return isApproved || p.passthroughGranted ? "Pase válido (QR)" : "QR rechazado";
  }
  if (method === "remote") return "Apertura remota";
  if (method === "facial") return isApproved ? "Pase válido (rostro)" : "Extraño (rostro)";
  if (method === "card") return isApproved ? "Pase válido (tarjeta)" : "Tarjeta no válida";
  if (method === "fingerprint") return isApproved ? "Pase válido (huella)" : "Huella no válida";
  if (method === "password") return isApproved ? "Pase válido (PIN)" : "PIN rechazado";
  return isApproved ? "Pase válido" : "Acceso denegado";
}

function laneLabel(p: Record<string, unknown>) {
  const code = Number(p.laneCode ?? p.lane_code);
  if (code === 2 || p.sentido === "out") return "Salida";
  if (code === 1 || p.sentido === "in") return "Ingreso";
  return "—";
}

function personDisplay(p: Record<string, unknown>, isApproved: boolean) {
  const id = String(p.userId ?? p.UserID ?? p.cardNo ?? p.CardNo ?? p.qrPayload ?? p.QRCode ?? "").trim();
  const raw = String(p.personName ?? p.CardName ?? p.userName ?? "").trim();
  const bogus =
    !raw ||
    raw === "Rostro no identificado" ||
    raw === "Rostro no reconocido" ||
    raw === "Usuario ASI" ||
    raw === "Usuario Facial";
  const qr = String(p.qrPayload ?? p.QRCode ?? "").trim();
  if (bogus && qr) return { name: "Visita / QR", id: qr };
  if (bogus) return { name: isApproved ? "Usuario ASI" : "No identificado", id: id || "—" };
  return { name: raw, id: id || "—" };
}

function EventosInner() {
  const { tenantId, can, featureOn } = useDash();
  const params = useSearchParams();
  const router = useRouter();
  const showFotos = featureOn("dahua.evidence") && can("dahua.evidence");
  const tab = showFotos && params.get("tab") === "fotos" ? "fotos" : "lista";
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "failed">("all");

  // Modales
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [clearLocal, setClearLocal] = useState(true);
  const [clearDevice, setClearDevice] = useState(true);
  const [clearing, setClearing] = useState(false);

  // Modal Vista Previa de Captura
  const [selectedPhotoEvent, setSelectedPhotoEvent] = useState<EventRow | null>(null);

  useEscapeKey(() => {
    if (selectedPhotoEvent) setSelectedPhotoEvent(null);
    else if (isClearModalOpen) setIsClearModalOpen(false);
  }, !!selectedPhotoEvent || isClearModalOpen);

  const loadEvents = () => {
    if (!tenantId) return;
    setLoading(true);
    api<{ events: EventRow[] }>(withTenant("/api/events?type=dahua_access,qr_access&limit=80", tenantId))
      .then((d) => {
        setEvents(d.events || []);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error al cargar eventos"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEvents();
    if (!tenantId) return;

    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    try {
      es = new EventSource(apiUrl(withTenant("/api/events/stream?type=dahua_access,qr_access", tenantId)), {
        withCredentials: true,
      });
      es.addEventListener("access_event", (event: MessageEvent) => {
        try {
          const ev = JSON.parse(event.data);
          if (!ev?.id) return;
          setEvents((prev) => {
            if (prev.some((x) => x.id === ev.id)) return prev;
            return [
              {
                id: ev.id,
                type: ev.type || "dahua_access",
                createdAt: ev.createdAt || Date.now(),
                payload: ev.payload || {},
              },
              ...prev,
            ].slice(0, 80);
          });
          setLoading(false);
        } catch {
          /* ignore */
        }
      });
      es.onerror = () => {
        /* el poll cubre si SSE está caído */
      };
    } catch {
      /* ignore */
    }

    // SSE a menudo 503 detrás de Docker; poll corto para que el historial no quede congelado
    pollTimer = setInterval(() => {
      if (!tenantId) return;
      api<{ events: EventRow[] }>(withTenant("/api/events?type=dahua_access,qr_access&limit=80", tenantId))
        .then((d) => {
          setEvents(d.events || []);
          setError(null);
        })
        .catch(() => null);
    }, 5000);

    return () => {
      if (es) es.close();
      if (pollTimer) clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const handleClearHistory = async () => {
    if (!tenantId) return;
    if (!clearLocal && !clearDevice) {
      setError("Debes seleccionar al menos una opción para vaciar.");
      return;
    }
    setClearing(true);
    setError(null);
    try {
      const res = await api<{ ok: boolean }>(withTenant("/api/events/clear", tenantId), {
        method: "POST",
        body: JSON.stringify({
          clearLocal,
          clearDevice,
          type: "dahua_access",
        }),
      });
      if (res.ok) {
        setMsg(
          clearDevice && clearLocal
            ? "Historial vaciado con éxito en la base de datos y en la memoria del equipo Dahua."
            : clearDevice
            ? "Memoria del lector Dahua vaciada con éxito."
            : "Registros locales de la base de datos limpiados."
        );
        setIsClearModalOpen(false);
        loadEvents();
        setTimeout(() => setMsg(null), 5000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo vaciar el historial");
    } finally {
      setClearing(false);
    }
  };

  // Filtrado
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      const p = e.payload || {};
      const name = String(p.personName || p.CardName || p.userName || p.UserID || "").toLowerCase();
      const card = String(p.cardNo || p.CardNo || p.UserID || "").toLowerCase();
      const dev = String(p.deviceName || "").toLowerCase();
      const term = search.toLowerCase();

      const qr = String(p.qrPayload || p.QRCode || "").toLowerCase();
      const matchesSearch =
        !term || name.includes(term) || card.includes(term) || dev.includes(term) || qr.includes(term);

      const isApproved = p.approved === true || String(p.status ?? p.Status ?? "0") === "1";
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "approved" && isApproved) ||
        (statusFilter === "failed" && !isApproved);

      return matchesSearch && matchesStatus;
    });
  }, [events, search, statusFilter]);

  // Contadores
  const stats = useMemo(() => {
    let approved = 0;
    let failed = 0;
    let remote = 0;
    for (const e of events) {
      const p = e.payload || {};
      const isApp = p.approved === true || String(p.status ?? p.Status ?? "0") === "1";
      if (asiMethodKey(p.methodCode ?? p.Method, p.method) === "remote") remote++;
      if (isApp) approved++;
      else failed++;
    }
    return { total: events.length, approved, failed, remote };
  }, [events]);

  /** El código crudo del ASI manda: el historial viejo se corrige solo, sin tocar la evidencia. */
  function getMethodBadge(method: string, methodCode: string) {
    const key = asiMethodKey(methodCode, method);
    const style = METHOD_BADGE_STYLES[key] ?? METHOD_BADGE_STYLES.unknown;
    const Icon = METHOD_BADGE_ICONS[key] ?? HelpCircle;
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${style}`}
      >
        <Icon className="w-3.5 h-3.5" />
        <span>{asiMethodLabel(methodCode, method)}</span>
      </span>
    );
  }

  function getSnapshotUrl(eventId?: string) {
    if (!eventId) return null;
    return eventPhotoUrl(eventId, tenantId);
  }

  return (
    <FeatureGate feature="dahua.events" capability="dahua.events" orModule="dahua_access">
      <div className="space-y-6">
        <PageHeader
          title="Eventos"
          subtitle="Pase válido, extraño, QR y apertura remota. Punto, sentido IN/OUT y foto del evento."
          actions={
            tab === "lista" ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadEvents}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-blue-500" : ""}`} />
                <span>Refrescar</span>
              </button>
              {can("core.config") && (
                <button
                  type="button"
                  onClick={() => setIsClearModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:hover:bg-rose-950/60 dark:text-rose-300 px-3.5 py-2 text-xs font-bold shadow-sm transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>Vaciar Registros</span>
                </button>
              )}
            </div>
            ) : undefined
          }
        />

        {showFotos ? (
          <SectionTabs
            tabs={[
              { id: "lista", label: "Lista" },
              { id: "fotos", label: "Fotos" },
            ]}
            value={tab}
            onChange={(id) => {
              const next = new URLSearchParams(params.toString());
              if (id === "lista") next.delete("tab");
              else next.set("tab", id);
              const qs = next.toString();
              router.replace(qs ? `/dashboard/dahua/eventos?${qs}` : "/dashboard/dahua/eventos");
            }}
          />
        ) : null}

        {tab === "fotos" ? (
          <EvidenciaGallery />
        ) : (
        <>

        {/* Notificaciones */}
        {msg && (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-sm text-emerald-800 dark:text-emerald-300 shadow-sm animate-in fade-in">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{msg}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-4 text-sm text-rose-800 dark:text-rose-300 shadow-sm animate-in fade-in">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Tarjetas KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Total Registros</p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-white">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 shadow-sm">
            <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Aprobados</p>
            <p className="mt-1 font-mono text-2xl font-bold text-emerald-600 dark:text-emerald-400">{stats.approved}</p>
          </div>
          <div className="rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 p-4 shadow-sm">
            <p className="text-[11px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">No Reconocidos</p>
            <p className="mt-1 font-mono text-2xl font-bold text-rose-600 dark:text-rose-400">{stats.failed}</p>
          </div>
          <div className="rounded-2xl border border-purple-200 dark:border-purple-900/60 bg-purple-50/40 dark:bg-purple-950/20 p-4 shadow-sm">
            <p className="text-[11px] font-bold text-purple-700 dark:text-purple-400 uppercase tracking-wider">Aperturas Remotas</p>
            <p className="mt-1 font-mono text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.remote}</p>
          </div>
        </div>

        {/* Barra de Filtros */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-sm">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por nombre, DNI o lector..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 pl-10 pr-4 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                statusFilter === "all"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Todos ({events.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("approved")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                statusFilter === "approved"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100/50"
              }`}
            >
              Aprobados
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("failed")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                statusFilter === "failed"
                  ? "bg-rose-600 text-white shadow-xs"
                  : "text-rose-700 dark:text-rose-400 hover:bg-rose-100/50"
              }`}
            >
              Rechazados
            </button>
          </div>
        </div>

        {/* Tabla de Eventos */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/40 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-center w-16">Captura</th>
                  <th className="px-4 py-3">Evento</th>
                  <th className="px-4 py-3">Hora</th>
                  <th className="px-4 py-3">Punto</th>
                  <th className="px-4 py-3">Sentido</th>
                  <th className="px-4 py-3">Persona</th>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Resultado</th>
                  <th className="px-4 py-3 text-right">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                      <ScanFace className="mx-auto h-8 w-8 opacity-40 mb-2" />
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                        {events.length === 0 ? "No hay registros de acceso" : "Ningún evento coincide con el filtro"}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Los accesos frente a la cámara ASI se reflejan automáticamente aquí en tiempo real.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map((e) => {
                    const p = e.payload || {};
                    const isApproved = p.approved === true || String(p.status ?? p.Status ?? "0") === "1";
                    const { name: personName, id: personId } = personDisplay(p, isApproved);
                    const headline = eventHeadline(p, isApproved);
                    const lane = laneLabel(p);
                    const cardNo = personId;
                    const devName = String(p.deviceName || "Lector Facial");
                    const pointKind = String(p.laneSector || "Puerta");
                    const photoStored = p.photoStored === true;
                    const createdMs =
                      typeof e.createdAt === "number"
                        ? e.createdAt
                        : Date.parse(String(e.createdAt));
                    const recent =
                      Number.isFinite(createdMs) && Date.now() - createdMs < 20000;
                    const hasSnap = photoStored || recent;
                    const rawDate = e.createdAt ? new Date(e.createdAt) : new Date();

                    return (
                      <tr
                        key={e.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
                      >
                        {/* Miniatura de Captura */}
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => setSelectedPhotoEvent(e)}
                            title="Ver captura local"
                            className="group relative inline-grid h-10 w-10 place-items-center overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-400 shadow-2xs hover:scale-105 transition-transform"
                          >
                            {hasSnap ? (
                              <EventPhoto
                                eventId={e.id}
                                tenantId={tenantId}
                                photoStored={photoStored}
                                createdAt={e.createdAt}
                                alt=""
                                className="h-full w-full object-cover object-top"
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                  objectPosition: "center top",
                                  position: "relative",
                                  zIndex: 1,
                                }}
                                placeholderApproved={isApproved}
                              />
                            ) : (
                              <Camera className="h-4 w-4 opacity-50" />
                            )}
                          </button>
                        </td>

                        {/* Fecha y Hora */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="font-semibold text-slate-900 dark:text-white">{headline}</p>
                          <div className="mt-0.5">{getMethodBadge(String(p.method ?? ""), String(p.methodCode ?? p.Method ?? ""))}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="font-mono text-xs font-bold text-slate-800 dark:text-slate-100">
                            {rawDate.toLocaleTimeString("es-AR", {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">
                            {rawDate.toLocaleDateString("es-AR", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </p>
                        </td>

                        {/* Punto */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="font-bold text-slate-800 dark:text-slate-200">{devName}</p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400">{pointKind}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-bold border ${
                              lane === "Salida"
                                ? "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60"
                                : lane === "Ingreso"
                                  ? "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/60"
                                  : "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                            }`}
                          >
                            {lane === "—" ? "Sin carril" : lane}
                          </span>
                        </td>

                        {/* Persona */}
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-900 dark:text-white leading-tight">{personName}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-mono text-[10.5px] text-slate-600 dark:text-slate-300">
                            {cardNo !== "—" ? cardNo : "—"}
                          </p>
                        </td>

                        {/* Método */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {getMethodBadge(p.method, p.methodCode ?? p.Method)}
                        </td>

                        {/* Estado */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {isApproved ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                              <span>Aprobado</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
                              <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                              <span>Rechazado</span>
                            </span>
                          )}
                        </td>

                        {/* Acción */}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {hasSnap ? (
                            <button
                              type="button"
                              onClick={() => setSelectedPhotoEvent(e)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5 text-blue-500" />
                              <span>Ver Foto</span>
                            </button>
                          ) : (
                            <span className="text-slate-400 text-[11px]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* MODAL CENTRADO: Vista Previa de Captura Facial */}
        {selectedPhotoEvent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl transition-all">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/80">
                    <ScanFace className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Captura de Acceso Biométrica
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Evidencia fotográfica tomada por Dahua ASI al validar
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPhotoEvent(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Imagen Grande */}
              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950/90 aspect-[3/4] flex items-center justify-center relative shadow-inner">
                <EventPhoto
                  eventId={selectedPhotoEvent.id}
                  tenantId={tenantId}
                  photoStored={selectedPhotoEvent.payload.photoStored === true}
                  createdAt={selectedPhotoEvent.createdAt}
                  alt="Captura de rostro"
                  forceRetry={selectedPhotoEvent.payload.photoStored !== true}
                  className="h-full w-full object-contain"
                  style={{
                    height: "100%",
                    width: "100%",
                    objectFit: "contain",
                    position: "relative",
                    zIndex: 1,
                  }}
                />
              </div>

              {/* Ficha de Detalles */}
              <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-3 text-xs">
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Persona</p>
                  <p className="font-bold text-slate-900 dark:text-white">
                    {selectedPhotoEvent.payload.personName || selectedPhotoEvent.payload.CardName || "Usuario Facial"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">ID / Tarjeta</p>
                  <p className="font-mono font-bold text-slate-900 dark:text-white">
                    {selectedPhotoEvent.payload.cardNo || selectedPhotoEvent.payload.UserID || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Hora de Registro</p>
                  <p className="font-mono text-slate-800 dark:text-slate-200">
                    {new Date(selectedPhotoEvent.createdAt).toLocaleTimeString("es-AR")}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Equipo</p>
                  <p className="text-slate-800 dark:text-slate-200">
                    {selectedPhotoEvent.payload.deviceName || "Lector Facial"}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                {getSnapshotUrl(selectedPhotoEvent.id) && selectedPhotoEvent.payload.photoStored === true && (
                  <a
                    href={getSnapshotUrl(selectedPhotoEvent.id)!}
                    download={`captura_dahua_${selectedPhotoEvent.id}.jpg`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Descargar JPG</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedPhotoEvent(null)}
                  className="rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2 text-xs font-bold shadow-sm hover:opacity-90 transition-opacity"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL CENTRADO: Vaciar Historial */}
        {isClearModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl transition-all">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800/80">
                    <Trash2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      Vaciar Historial de Registros
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Elimina el registro de accesos del sistema y/o de la memoria del equipo físico.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsClearModalOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-3.5 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                  <p>
                    Esta acción es irreversible. Podés seleccionar si querés vaciar únicamente los eventos locales de AccesoPro o también ordenar al lector Dahua ASI que formatee su tabla interna de accesos.
                  </p>
                </div>

                <div className="space-y-3 pt-2">
                  <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 cursor-pointer hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={clearLocal}
                      onChange={(e) => setClearLocal(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900"
                    />
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                        Limpiar base de datos local de AccesoPro
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Elimina los registros guardados en el servidor local ({events.length} eventos).
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 cursor-pointer hover:border-slate-300 dark:hover:border-slate-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={clearDevice}
                      onChange={(e) => setClearDevice(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 dark:border-slate-700 dark:bg-slate-900"
                    />
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                        Vaciar memoria física del Lector Dahua ASI
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Envía la instrucción CGI al equipo Dahua para vaciar completamente la tabla <code className="font-mono">AccessControlCardRec</code>.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2.5 border-t border-slate-200 dark:border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setIsClearModalOpen(false)}
                  disabled={clearing}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleClearHistory}
                  disabled={clearing || (!clearLocal && !clearDevice)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors disabled:opacity-50"
                >
                  {clearing ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Vaciando...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      <span>Confirmar Vaciado</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </FeatureGate>
  );
}

export default function DahuaEventosPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Cargando eventos…</p>}>
      <EventosInner />
    </Suspense>
  );
}
