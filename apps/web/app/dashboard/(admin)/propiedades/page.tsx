"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { ModuleGate, PageHeader } from "@/components/PageHeader";
import { Home, Plus, UserPlus, MapPin, X, Building, CheckCircle2 } from "lucide-react";
import { useEscapeKey } from "@/hooks/useEscapeKey";

type Property = {
  id: string;
  lotNumber: string;
  label: string;
  address: string | null;
  mapLat: string | null;
  mapLng: string | null;
};

export default function PropiedadesPage() {
  const { tenantId } = useDash();
  const [rows, setRows] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPropModal, setShowPropModal] = useState(false);
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscapeKey(() => {
    if (showOwnerModal) setShowOwnerModal(false);
    else if (showPropModal) setShowPropModal(false);
  }, showPropModal || showOwnerModal);

  const [form, setForm] = useState({ lotNumber: "", label: "", address: "", mapLat: "", mapLng: "" });
  const [ownerForm, setOwnerForm] = useState({ propertyId: "", email: "", name: "", password: "", dni: "", phone: "" });

  const loadProperties = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const d = await api<{ properties: Property[] }>(withTenant("/api/residents/properties", tenantId));
      setRows(d.properties || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProperties();
  }, [tenantId]);

  async function addProperty(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    setMsg(null);
    try {
      await api(withTenant("/api/residents/properties", tenantId), {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm({ lotNumber: "", label: "", address: "", mapLat: "", mapLng: "" });
      setShowPropModal(false);
      setMsg("Propiedad agregada con exito");
      await loadProperties();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  async function addOwner(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !ownerForm.propertyId) return;
    setBusy(true);
    setMsg(null);
    try {
      await api(withTenant(`/api/residents/properties/${ownerForm.propertyId}/owners`, tenantId), {
        method: "POST",
        body: JSON.stringify(ownerForm),
      });
      setOwnerForm({ propertyId: "", email: "", name: "", password: "", dni: "", phone: "" });
      setShowOwnerModal(false);
      setMsg("Propietario creado con exito");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error al crear propietario");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModuleGate module="visitors">
      <PageHeader
        title="Propiedades y Propietarios"
        subtitle="Gestion de lotes, coordenadas de plano y credenciales de acceso para vecinos."
      />

      {msg ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{msg}</span>
        </div>
      ) : null}

      {/* Action Header Card */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
            <Building className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Padron de Lotes</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {rows.length} {rows.length === 1 ? "propiedad registrada" : "propiedades registradas"} en este barrio.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowOwnerModal(true)}
            disabled={rows.length === 0}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <UserPlus className="h-4 w-4" />
            Crear Login Propietario
          </button>
          <button
            type="button"
            onClick={() => setShowPropModal(true)}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-95"
          >
            <Plus className="h-4 w-4" />
            Nueva Propiedad
          </button>
        </div>
      </div>

      {/* Properties Table Card */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Nº Lote</th>
                <th className="px-5 py-3.5">Titular / Identificador</th>
                <th className="px-5 py-3.5">Direccion</th>
                <th className="px-5 py-3.5">Coordenadas GPS</th>
                <th className="px-5 py-3.5">Plano</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-slate-500 dark:text-slate-400">
                    <Home className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" />
                    <p className="text-sm font-medium">No hay propiedades registradas</p>
                    <p className="text-xs text-slate-400 mt-0.5">Usa el boton superior para cargar el primer lote.</p>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-5 py-3.5 font-bold text-slate-900 dark:text-white">
                      Lote {r.lotNumber}
                    </td>
                    <td className="px-5 py-3.5 font-medium text-slate-700 dark:text-slate-200">
                      {r.label}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 dark:text-slate-400">
                      {r.address || "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      {r.mapLat && r.mapLng ? (
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2 py-0.5 font-mono text-[11px] text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                          <MapPin className="h-3 w-3" />
                          {r.mapLat}, {r.mapLng}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/dashboard/plano?lote=${encodeURIComponent(r.lotNumber)}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-50 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-300 dark:hover:bg-slate-700"
                      >
                        <MapPin className="h-3.5 w-3.5" />
                        Abrir en el plano
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal 1: Nueva Propiedad */}
      {showPropModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl transition-all dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                  <Building className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">Nueva Propiedad</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Alta de lote en el predio del barrio.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPropModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={addProperty} className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Numero de Lote
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: 14B"
                    value={form.lotNumber}
                    onChange={(e) => setForm({ ...form, lotNumber: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Titular / Nombre
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Familia Gomez"
                    value={form.label}
                    onChange={(e) => setForm({ ...form, label: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Direccion interna
                </label>
                <input
                  type="text"
                  placeholder="Ej: Calle Los Alamos 230"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Latitud GPS (opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="-34.4521"
                    value={form.mapLat}
                    onChange={(e) => setForm({ ...form, mapLat: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Longitud GPS (opcional)
                  </label>
                  <input
                    type="text"
                    placeholder="-58.6210"
                    value={form.mapLng}
                    onChange={(e) => setForm({ ...form, mapLng: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                  />
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowPropModal(false)}
                  className="rounded-xl px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? "Guardando..." : "Crear Propiedad"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal 2: Crear Login Propietario */}
      {showOwnerModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl transition-all dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                  <UserPlus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">Crear Login Propietario</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Habilitar acceso a portal web de vecinos (/portal) para autorizar visitas.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOwnerModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={addOwner} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Propiedad vinculada
                </label>
                <select
                  required
                  value={ownerForm.propertyId}
                  onChange={(e) => setOwnerForm({ ...ownerForm, propertyId: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                >
                  <option value="">Seleccionar lote...</option>
                  {rows.map((r) => (
                    <option key={r.id} value={r.id}>
                      Lote {r.lotNumber} — {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Email de acceso
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="vecino@correo.com"
                    value={ownerForm.email}
                    onChange={(e) => setOwnerForm({ ...ownerForm, email: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nombre completo
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Juan Perez"
                    value={ownerForm.name}
                    onChange={(e) => setOwnerForm({ ...ownerForm, name: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Contraseña inicial (min. 8 caracteres)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••"
                  value={ownerForm.password}
                  onChange={(e) => setOwnerForm({ ...ownerForm, password: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    DNI
                  </label>
                  <input
                    type="text"
                    placeholder="35849201"
                    value={ownerForm.dni}
                    onChange={(e) => setOwnerForm({ ...ownerForm, dni: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Telefono / Celular
                  </label>
                  <input
                    type="tel"
                    placeholder="11-4567-8901"
                    value={ownerForm.phone}
                    onChange={(e) => setOwnerForm({ ...ownerForm, phone: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                  />
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowOwnerModal(false)}
                  className="rounded-xl px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy ? "Creando..." : "Crear Propietario"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </ModuleGate>
  );
}

