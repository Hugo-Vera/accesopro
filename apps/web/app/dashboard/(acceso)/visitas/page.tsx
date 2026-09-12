"use client";

import { useEffect, useState, useMemo } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { ModuleGate, PageHeader } from "@/components/PageHeader";
import { VisitorCheckinModal } from "@/components/VisitorCheckinModal";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import {
  UserPlus,
  Car,
  UserCheck,
  CheckCircle2,
  Clock,
  LogOut,
  Search,
  RefreshCw,
  Eye,
  ShieldCheck,
  AlertTriangle,
  FileText,
  IdCard,
  Building,
  Calendar,
  X,
  ShieldAlert,
} from "lucide-react";

type VisitRecordRow = {
  id: string;
  propertyId: string;
  personId: string;
  vehicleId: string | null;
  insuranceId: string | null;
  licenseId: string | null;
  visitType: string;
  status: "in_site" | "completed" | "authorized" | "rejected";
  authorizedBy: string;
  passToken: string | null;
  scannedInAt: string | number | null;
  scannedOutAt: string | number | null;
  notes: string | null;
  createdAt: string | number;
  person: {
    id: string;
    dniNumber: string;
    tramiteNumber?: string;
    lastName: string;
    firstName: string;
    gender?: string;
    phone?: string;
    address?: string;
  } | null;
  property: {
    id: string;
    lotNumber: string;
    label: string;
  } | null;
  vehicle: {
    id: string;
    plate: string;
    brand?: string;
    model?: string;
    color?: string;
    vehicleType?: string;
  } | null;
  insurance: {
    id: string;
    company: string;
    policyNumber: string;
    validUntil: string | number;
    coverageType: string;
    status: string;
  } | null;
  license: {
    id: string;
    licenseNumber: string;
    classes: string;
    jurisdiction?: string;
    validUntil: string | number;
  } | null;
};

function formatStay(inAt: string | number | null, outAt: string | number | null) {
  if (inAt == null || outAt == null) return null;
  const a = new Date(inAt).getTime();
  const b = new Date(outAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  const mins = Math.round((b - a) / 60000);
  if (mins < 1) return "menos de 1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export default function VisitasPage() {
  const { tenantId, can } = useDash();
  const [records, setRecords] = useState<VisitRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Modales
  const [isCheckinOpen, setIsCheckinOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<VisitRecordRow | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  useEscapeKey(() => {
    if (selectedRecord) setSelectedRecord(null);
    else if (isCheckinOpen) setIsCheckinOpen(false);
  }, !!selectedRecord || isCheckinOpen);

  // Filtros
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "in_site" | "completed">("all");

  const loadRecords = () => {
    if (!tenantId) return;
    setLoading(true);
    api<{ records: VisitRecordRow[] }>(withTenant("/api/visitors/records", tenantId))
      .then((d) => {
        setRecords(d.records || []);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error al cargar visitas"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadRecords();
    const id = setInterval(loadRecords, 6000);
    return () => clearInterval(id);
  }, [tenantId]);

  const handleCheckout = async (recordId: string) => {
    if (!tenantId) return;
    setCheckoutLoading(recordId);
    try {
      const res = await api<{ ok: boolean }>(
        withTenant(`/api/visitors/records/${recordId}/checkout`, tenantId),
        { method: "POST" }
      );
      if (res.ok) {
        setMsg("Egreso de visita registrado exitosamente.");
        loadRecords();
        setTimeout(() => setMsg(null), 4000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el egreso");
    } finally {
      setCheckoutLoading(null);
    }
  };

  // Filtrado reactivo
  const filtered = useMemo(() => {
    return records.filter((r) => {
      const term = search.toLowerCase();
      const personName = `${r.person?.lastName || ""} ${r.person?.firstName || ""}`.toLowerCase();
      const dni = (r.person?.dniNumber || "").toLowerCase();
      const plate = (r.vehicle?.plate || "").toLowerCase();
      const lot = (r.property?.lotNumber || "").toLowerCase();
      const auth = (r.authorizedBy || "").toLowerCase();

      const matchesSearch =
        !term ||
        personName.includes(term) ||
        dni.includes(term) ||
        plate.includes(term) ||
        lot.includes(term) ||
        auth.includes(term);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "in_site" && r.status === "in_site") ||
        (statusFilter === "completed" && r.status === "completed");

      return matchesSearch && matchesStatus;
    });
  }, [records, search, statusFilter]);

  // Contadores KPI
  const stats = useMemo(() => {
    let inSite = 0;
    let completed = 0;
    let vehicular = 0;
    let today = 0;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    for (const r of records) {
      if (r.status === "in_site") inSite++;
      if (r.status === "completed") completed++;
      if (r.vehicleId) vehicular++;

      const createdAtDate = new Date(r.createdAt);
      if (createdAtDate >= todayStart) today++;
    }

    return { total: records.length, inSite, completed, vehicular, today };
  }, [records]);

  function isInsuranceExpired(validUntil?: string | number) {
    if (!validUntil) return false;
    return new Date(validUntil).getTime() < Date.now();
  }

  return (
    <ModuleGate module="visitors">
      <div className="space-y-6">
        <PageHeader
          title="Control y Registro de Visitas"
          subtitle="Acreditación integral de visitantes, vehículos, pólizas de seguro automotor en Argentina y licencias de conducir."
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadRecords}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-blue-500" : ""}`} />
                <span>Refrescar</span>
              </button>

              {can("access.visitors.manage") && (
                <button
                  type="button"
                  onClick={() => setIsCheckinOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors"
                >
                  <UserPlus className="h-4 w-4" />
                  <span>Registrar Visita</span>
                </button>
              )}
            </div>
          }
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
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Tarjetas KPI */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                En Predio Ahora
              </p>
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <p className="mt-1 font-mono text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {stats.inSite}
            </p>
          </div>

          <div className="rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-4 shadow-sm">
            <p className="text-[11px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
              Ingresos Hoy
            </p>
            <p className="mt-1 font-mono text-2xl font-bold text-blue-600 dark:text-blue-400">
              {stats.today}
            </p>
          </div>

          <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 shadow-sm">
            <p className="text-[11px] font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">
              Visitas Vehiculares
            </p>
            <p className="mt-1 font-mono text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              {stats.vehicular}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
            <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Egresadas / Salidas
            </p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900 dark:text-white">
              {stats.completed}
            </p>
          </div>
        </div>

        {/* Barra de Búsqueda y Filtros */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-sm">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por DNI, Nombre, Patente o Lote..."
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
              Todas ({records.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("in_site")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                statusFilter === "in_site"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100/50"
              }`}
            >
              En Predio ({stats.inSite})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("completed")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                statusFilter === "completed"
                  ? "bg-slate-700 text-white shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              Salidas ({stats.completed})
            </button>
          </div>
        </div>

        {/* Tabla de Visitas */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/40 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Visitante (DNI)</th>
                  <th className="px-4 py-3">Destino / Autorizante</th>
                  <th className="px-4 py-3">Modalidad / Vehículo</th>
                  <th className="px-4 py-3">Seguro Automotor</th>
                  <th className="px-4 py-3">Ingreso / Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-400 dark:text-slate-500">
                      <UserCheck className="mx-auto h-8 w-8 opacity-40 mb-2" />
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                        {records.length === 0 ? "No hay visitas registradas" : "Sin resultados para el filtro"}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Utilizá el botón «Registrar Visita» para dar ingreso con DNI, patente y seguro.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => {
                    const isInSite = r.status === "in_site";
                    const isVehicular = Boolean(r.vehicleId && r.vehicle);
                    const isExpired = isInsuranceExpired(r.insurance?.validUntil);

                    return (
                      <tr
                        key={r.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
                      >
                        {/* Visitante */}
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-900 dark:text-white leading-tight">
                            {r.person ? `${r.person.lastName}, ${r.person.firstName}` : "Visitante"}
                          </p>
                          <p className="font-mono text-[10.5px] text-slate-500 dark:text-slate-400">
                            DNI: {r.person?.dniNumber || "—"}
                          </p>
                        </td>

                        {/* Destino */}
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-800 dark:text-slate-200">
                            {r.property ? `Lote ${r.property.lotNumber} (${r.property.label})` : "Lote Destino"}
                          </p>
                          <p className="text-[10.5px] text-slate-500 dark:text-slate-400">
                            Autorizó: <span className="font-semibold">{r.authorizedBy}</span>
                          </p>
                        </td>

                        {/* Modalidad / Vehículo */}
                        <td className="px-4 py-3">
                          {isVehicular ? (
                            <div>
                              <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-800/60">
                                <Car className="h-3.5 w-3.5" />
                                <span>{r.vehicle?.plate}</span>
                              </span>
                              {r.vehicle?.brand && (
                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                  {r.vehicle.brand} {r.vehicle.model}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                              <UserCheck className="h-3.5 w-3.5 text-blue-500" />
                              <span>Peatonal</span>
                            </span>
                          )}
                        </td>

                        {/* Seguro Automotor Argentina */}
                        <td className="px-4 py-3">
                          {r.insurance ? (
                            <div>
                              <p className="font-bold text-slate-800 dark:text-slate-200 text-[11.5px] leading-tight">
                                {r.insurance.company}
                              </p>
                              <div className="flex items-center gap-1.5 text-[10px] mt-0.5">
                                <span className="font-mono text-slate-500">Póliza: {r.insurance.policyNumber}</span>
                                <span
                                  className={`font-bold uppercase tracking-wider px-1.5 py-0.2 rounded text-[9px] ${
                                    isExpired
                                      ? "bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300"
                                      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300"
                                  }`}
                                >
                                  {isExpired ? "Vencida" : "Al Día"}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">—</span>
                          )}
                        </td>

                        {/* Ingreso / Estado */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {isInSite ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span>En Predio</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                <CheckCircle2 className="h-3 w-3 text-slate-400" />
                                <span>Salida Registrada</span>
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                            {r.scannedInAt
                              ? new Date(r.scannedInAt).toLocaleTimeString("es-AR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "—"}{" "}
                            {r.scannedOutAt && `→ ${new Date(r.scannedOutAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`}
                            {formatStay(r.scannedInAt, r.scannedOutAt) ? ` · ${formatStay(r.scannedInAt, r.scannedOutAt)}` : ""}
                          </p>
                        </td>

                        {/* Acciones */}
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedRecord(r)}
                            title="Ver ficha completa de la visita"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5 text-blue-500" />
                            <span>Ficha</span>
                          </button>

                          {isInSite && can("access.visitors.manage") && (
                            <button
                              type="button"
                              onClick={() => handleCheckout(r.id)}
                              disabled={checkoutLoading === r.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:hover:bg-rose-950/60 dark:text-rose-300 font-bold transition-colors disabled:opacity-50"
                            >
                              <LogOut className="h-3.5 w-3.5" />
                              <span>{checkoutLoading === r.id ? "Egresando..." : "Egreso"}</span>
                            </button>
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

        {/* MODAL CENTRADO: Ficha Técnica Detallada de Visita */}
        {selectedRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl transition-all">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/80">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      Ficha de Ingreso de Visita
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Constancia acreditada de identidad, seguro y vehículo
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                {/* Bloque Identidad */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 bg-slate-50/50 dark:bg-slate-800/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[10.5px] uppercase tracking-wider text-slate-500">
                      Datos de la Persona (DNI Argentino)
                    </span>
                    <span className="inline-flex items-center gap-1 font-bold text-[11px] text-emerald-600">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Verificado
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] text-slate-400">Nombre Completo</p>
                      <p className="font-bold text-slate-900 dark:text-white text-[13px]">
                        {selectedRecord.person?.lastName}, {selectedRecord.person?.firstName}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400">DNI / Trámite</p>
                      <p className="font-mono font-bold text-slate-900 dark:text-white">
                        {selectedRecord.person?.dniNumber}{" "}
                        {selectedRecord.person?.tramiteNumber && `(Trámite: ${selectedRecord.person.tramiteNumber})`}
                      </p>
                    </div>
                    {selectedRecord.person?.phone && (
                      <div>
                        <p className="text-[10px] text-slate-400">Teléfono</p>
                        <p className="text-slate-800 dark:text-slate-200">{selectedRecord.person.phone}</p>
                      </div>
                    )}
                    {selectedRecord.person?.address && (
                      <div>
                        <p className="text-[10px] text-slate-400">Domicilio</p>
                        <p className="text-slate-800 dark:text-slate-200">{selectedRecord.person.address}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bloque Vehículo y Seguro si aplica */}
                {selectedRecord.vehicle && (
                  <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 p-3.5 bg-indigo-50/30 dark:bg-indigo-950/20 space-y-2">
                    <span className="font-bold text-[10.5px] uppercase tracking-wider text-indigo-700 dark:text-indigo-400">
                      Vehículo y Seguro Obligatorio (Ley 24.449)
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] text-slate-400">Patente / Dominio</p>
                        <p className="font-mono font-bold text-slate-900 dark:text-white text-sm">
                          {selectedRecord.vehicle.plate}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-400">Marca y Modelo</p>
                        <p className="font-bold text-slate-800 dark:text-slate-200">
                          {selectedRecord.vehicle.brand} {selectedRecord.vehicle.model} ({selectedRecord.vehicle.color})
                        </p>
                      </div>
                    </div>

                    {selectedRecord.insurance && (
                      <div className="mt-2 border-t border-indigo-100 dark:border-indigo-900/40 pt-2 grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[10px] text-slate-400">Aseguradora</p>
                          <p className="font-bold text-slate-900 dark:text-white">
                            {selectedRecord.insurance.company}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400">N° Póliza</p>
                          <p className="font-mono text-slate-800 dark:text-slate-200">
                            {selectedRecord.insurance.policyNumber}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400">Vencimiento Póliza</p>
                          <p className="font-bold text-slate-900 dark:text-white">
                            {new Date(selectedRecord.insurance.validUntil).toLocaleDateString("es-AR")}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400">Estado de Seguro</p>
                          <span className="font-bold text-emerald-600">Vigencia Acreditada</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Bloque Destino y Tiempos */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 bg-slate-50/50 dark:bg-slate-800/30 grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] text-slate-400">Lote Destino</p>
                    <p className="font-bold text-slate-900 dark:text-white">
                      Lote {selectedRecord.property?.lotNumber} ({selectedRecord.property?.label})
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400">Autorizante</p>
                    <p className="font-bold text-slate-800 dark:text-slate-200">
                      {selectedRecord.authorizedBy}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400">Ingreso Registrado</p>
                    <p className="font-mono text-slate-800 dark:text-slate-200">
                      {selectedRecord.scannedInAt ? new Date(selectedRecord.scannedInAt).toLocaleString("es-AR") : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-400">Egreso Registrado</p>
                    <p className="font-mono text-slate-800 dark:text-slate-200">
                      {selectedRecord.scannedOutAt ? new Date(selectedRecord.scannedOutAt).toLocaleString("es-AR") : "En predio"}
                    </p>
                  </div>
                  {formatStay(selectedRecord.scannedInAt, selectedRecord.scannedOutAt) ? (
                    <div className="col-span-2">
                      <p className="text-[10px] text-slate-400">Permanencia</p>
                      <p className="font-mono text-slate-800 dark:text-slate-200">
                        {formatStay(selectedRecord.scannedInAt, selectedRecord.scannedOutAt)}
                      </p>
                    </div>
                  ) : null}
                </div>

                {selectedRecord.notes && (
                  <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px]">
                    <span className="font-bold">Observaciones: </span>
                    <span>{selectedRecord.notes}</span>
                  </div>
                )}
              </div>

              <div className="mt-5 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  className="rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2 text-xs font-bold shadow-sm hover:opacity-90 transition-opacity"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL CENTRADO: Wizard de Check-in en Varios Pasos */}
        <VisitorCheckinModal
          tenantId={tenantId || ""}
          isOpen={isCheckinOpen}
          onClose={() => setIsCheckinOpen(false)}
          onSuccess={() => {
            setMsg("Ingreso de visita registrado exitosamente con toda la documentación vinculada.");
            loadRecords();
            setTimeout(() => setMsg(null), 5000);
          }}
        />
      </div>
    </ModuleGate>
  );
}
