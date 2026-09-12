"use client";

import { useEffect, useState, useMemo } from "react";
import { useDash } from "@/components/DashboardProvider";
import { ModuleGate, PageHeader } from "@/components/PageHeader";
import { api, withTenant } from "@/lib/api";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import {
  Users,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  Download,
  Plus,
  X,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ScanFace,
  CreditCard,
  Fingerprint,
  QrCode,
  KeyRound,
  FileText,
  Calendar,
  Building2,
  ShieldCheck,
} from "lucide-react";

type NormalizedAttendance = {
  id: string;
  timestamp: number;
  dateStr: string;
  timeStr: string;
  personName: string;
  personId: string;
  direction: "in" | "out";
  method: "facial" | "card" | "fingerprint" | "qr" | "manual" | "password" | "other";
  device: string;
  authorized: boolean;
  notes?: string;
};

type AttendanceSummary = {
  totalToday: number;
  entriesToday: number;
  exitsToday: number;
  presentNow: number;
};

type ApiResponse = {
  ok: boolean;
  summary: AttendanceSummary;
  records: NormalizedAttendance[];
};

export default function FichadasPage() {
  const { tenantId, can } = useDash();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<NormalizedAttendance[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary>({
    totalToday: 0,
    entriesToday: 0,
    exitsToday: 0,
    presentNow: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Filtros
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<"today" | "week" | "month" | "all">("today");

  // Modal de Fichada Manual
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  useEscapeKey(() => setIsModalOpen(false), isModalOpen);
  const [manualForm, setManualForm] = useState({
    personName: "",
    personId: "",
    direction: "in" as "in" | "out",
    datetime: new Date().toISOString().slice(0, 16),
    notes: "",
  });

  const loadData = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      let fromStr = "";
      const now = new Date();
      if (range === "today") {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        fromStr = start.toISOString();
      } else if (range === "week") {
        const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        fromStr = start.toISOString();
      } else if (range === "month") {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        fromStr = start.toISOString();
      }

      const qUrl = `/api/attendance?${new URLSearchParams({
        ...(fromStr ? { from: fromStr } : {}),
        ...(search.trim() ? { q: search.trim() } : {}),
      }).toString()}`;

      const res = await api<ApiResponse>(withTenant(qUrl, tenantId));
      if (res.ok) {
        setRecords(res.records);
        setSummary(res.summary);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar las fichadas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 10000);
    return () => clearInterval(timer);
  }, [tenantId, range]);

  const filteredRecords = useMemo(() => {
    if (!search.trim()) return records;
    const term = search.toLowerCase();
    return records.filter(
      (r) =>
        r.personName.toLowerCase().includes(term) ||
        r.personId.toLowerCase().includes(term) ||
        r.device.toLowerCase().includes(term) ||
        (r.notes && r.notes.toLowerCase().includes(term)),
    );
  }, [records, search]);

  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.personName.trim()) {
      setError("El nombre de la persona es obligatorio");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(withTenant("/api/attendance/manual", tenantId), {
        method: "POST",
        body: JSON.stringify({
          personName: manualForm.personName.trim(),
          personId: manualForm.personId.trim(),
          direction: manualForm.direction,
          timestamp: new Date(manualForm.datetime).getTime(),
          notes: manualForm.notes.trim(),
        }),
      });
      setIsModalOpen(false);
      setManualForm({
        personName: "",
        personId: "",
        direction: "in",
        datetime: new Date().toISOString().slice(0, 16),
        notes: "",
      });
      setMsg("Fichada manual registrada exitosamente");
      setTimeout(() => setMsg(null), 4000);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la fichada manual");
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    if (filteredRecords.length === 0) return;
    const headers = ["Fecha", "Hora", "Persona", "Identificador/DNI", "Sentido", "Metodo", "Dispositivo", "Estado", "Notas"];
    const rows = filteredRecords.map((r) => [
      r.dateStr,
      r.timeStr,
      `"${r.personName.replace(/"/g, '""')}"`,
      `"${r.personId}"`,
      r.direction === "in" ? "Ingreso" : "Egreso",
      getMethodLabel(r.method),
      `"${r.device.replace(/"/g, '""')}"`,
      r.authorized ? "Autorizado" : "Denegado",
      `"${(r.notes || "").replace(/"/g, '""')}"`,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `fichadas_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  function getMethodIcon(m: NormalizedAttendance["method"]) {
    switch (m) {
      case "facial":
        return <ScanFace className="w-3.5 h-3.5 text-blue-500" />;
      case "card":
        return <CreditCard className="w-3.5 h-3.5 text-indigo-500" />;
      case "fingerprint":
        return <Fingerprint className="w-3.5 h-3.5 text-emerald-500" />;
      case "qr":
        return <QrCode className="w-3.5 h-3.5 text-cyan-500" />;
      case "password":
        return <KeyRound className="w-3.5 h-3.5 text-amber-500" />;
      case "manual":
        return <FileText className="w-3.5 h-3.5 text-purple-500" />;
      default:
        return <Clock className="w-3.5 h-3.5 text-slate-400" />;
    }
  }

  function getMethodLabel(m: NormalizedAttendance["method"]) {
    switch (m) {
      case "facial":
        return "Rostro (ASI)";
      case "card":
        return "Tarjeta RFID";
      case "fingerprint":
        return "Huella";
      case "qr":
        return "Código QR";
      case "password":
        return "Clave PIN";
      case "manual":
        return "Manual";
      default:
        return "Biométrico";
    }
  }

  function getInitials(name: string) {
    return name
      .split(" ")
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase();
  }

  return (
    <ModuleGate module="attendance">
      <div className="space-y-6">
        <PageHeader
          title="Control de Fichadas y Asistencia"
          subtitle="Registro cronológico de ingresos, egresos y permanencia del personal a partir de terminales biométricos Dahua."
        />

        {/* Notificaciones */}
        {msg && (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-sm text-emerald-800 dark:text-emerald-300 shadow-sm animate-in fade-in">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{msg}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-4 text-sm text-rose-800 dark:text-rose-300 shadow-sm animate-in fade-in">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Tarjetas de Métricas Rápidas (KPIs) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Personal en Predio
              </span>
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                <Users className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">{summary.presentNow}</span>
              <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Actualmente adentro
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Marcaciones Hoy
              </span>
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
                <Clock className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">{summary.totalToday}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">fichadas registradas</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Ingresos Hoy
              </span>
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                <ArrowDownLeft className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">{summary.entriesToday}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">entradas</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Egresos Hoy
              </span>
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 dark:text-white">{summary.exitsToday}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">salidas</span>
            </div>
          </div>
        </div>

        {/* Barra de Control y Acciones */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          {/* Selector de Rango de Fecha */}
          <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setRange("today")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                range === "today"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={() => setRange("week")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                range === "week"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Últimos 7 días
            </button>
            <button
              type="button"
              onClick={() => setRange("month")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                range === "month"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Mes actual
            </button>
            <button
              type="button"
              onClick={() => setRange("all")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                range === "all"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              Histórico
            </button>
          </div>

          {/* Búsqueda y Botones de Acción */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar persona, DNI o terminal..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <button
              type="button"
              onClick={exportCsv}
              disabled={filteredRecords.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 transition-colors"
              title="Descargar reporte en formato CSV"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Exportar CSV</span>
            </button>

            <button
              type="button"
              onClick={() => loadData()}
              disabled={loading}
              className="rounded-xl border border-slate-300 bg-white p-2 text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white shadow-sm transition-colors"
              title="Recargar fichadas"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>

            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Registrar Fichada Manual</span>
            </button>
          </div>
        </div>

        {/* Tabla de Fichadas */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/75 dark:border-slate-800 dark:bg-slate-950/50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Persona / Empleado</th>
                  <th className="px-4 py-3">Identificador</th>
                  <th className="px-4 py-3">Sentido</th>
                  <th className="px-4 py-3">Fecha y Hora</th>
                  <th className="px-4 py-3">Método Biométrico</th>
                  <th className="px-4 py-3">Terminal / Dispositivo</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading && records.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                      <RefreshCw className="mx-auto h-6 w-6 animate-spin text-blue-500 mb-2" />
                      Cargando fichadas...
                    </td>
                  </tr>
                ) : filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                      <Clock className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" />
                      No se encontraron registros de fichadas para el criterio seleccionado.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((rec) => (
                    <tr
                      key={rec.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-100 dark:bg-blue-950 text-[11px] font-bold text-blue-700 dark:text-blue-300">
                            {getInitials(rec.personName)}
                          </span>
                          <div>
                            <span className="block font-semibold text-slate-900 dark:text-white">
                              {rec.personName}
                            </span>
                            {rec.notes ? (
                              <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                                {rec.notes}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">
                        {rec.personId}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            rec.direction === "in"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                              : "bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800"
                          }`}
                        >
                          {rec.direction === "in" ? (
                            <>
                              <ArrowDownLeft className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                              <span>Ingreso</span>
                            </>
                          ) : (
                            <>
                              <ArrowUpRight className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                              <span>Egreso</span>
                            </>
                          )}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">{rec.timeStr}</span>
                          <span className="text-[10px] text-slate-400">{rec.dateStr}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                          {getMethodIcon(rec.method)}
                          <span>{getMethodLabel(rec.method)}</span>
                        </span>
                      </td>

                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                        {rec.device}
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            rec.authorized
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                              : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
                          }`}
                        >
                          {rec.authorized ? (
                            <>
                              <ShieldCheck className="w-3 h-3" />
                              <span>Autorizado</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3 h-3" />
                              <span>Denegado</span>
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Modal Centrado: Registrar Fichada Manual */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl transition-all">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/80">
                    <Plus className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      Registrar Fichada Manual
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Justificación de asistencia o registro manual de entrada / salida.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleCreateManual} className="mt-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Persona / Empleado *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej. Juan Pérez (Seguridad)"
                    value={manualForm.personName}
                    onChange={(e) => setManualForm({ ...manualForm, personName: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      DNI o N° de Legajo
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. 34567890"
                      value={manualForm.personId}
                      onChange={(e) => setManualForm({ ...manualForm, personId: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Sentido de Fichada *
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setManualForm({ ...manualForm, direction: "in" })}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-semibold transition-all ${
                          manualForm.direction === "in"
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400"
                        }`}
                      >
                        <ArrowDownLeft className="h-3.5 w-3.5" />
                        <span>Ingreso</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setManualForm({ ...manualForm, direction: "out" })}
                        className={`inline-flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-semibold transition-all ${
                          manualForm.direction === "out"
                            ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400"
                        }`}
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                        <span>Egreso</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Fecha y Hora de la Marcación *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={manualForm.datetime}
                    onChange={(e) => setManualForm({ ...manualForm, datetime: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Motivo / Observación
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Ej. Olvido de tarjeta física, corte de energía o ingreso especial..."
                    value={manualForm.notes}
                    onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>

                <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                    <span>Guardar Fichada</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </ModuleGate>
  );
}
