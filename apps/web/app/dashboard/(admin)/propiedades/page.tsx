"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { ModuleGate, PageHeader } from "@/components/PageHeader";
import { Home, Plus, UserPlus, MapPin, X, Building, CheckCircle2, Copy, MessageCircle, Pencil, Trash2 } from "lucide-react";
import { useEscapeKey } from "@/hooks/useEscapeKey";

type OwnerRow = {
  userId: string;
  email: string;
  name: string;
  dni: string | null;
  whatsapp: string | null;
  invitePending: boolean;
};

type Property = {
  id: string;
  lotNumber: string;
  label: string;
  address: string | null;
  mapLat: string | null;
  mapLng: string | null;
  notes?: string | null;
  owners?: OwnerRow[];
};

type InviteResult = {
  activateUrl: string;
  waUrl: string | null;
  shareText: string;
  email: string;
};

export default function PropiedadesPage() {
  const { tenantId, isAdmin, can } = useDash();
  const [rows, setRows] = useState<Property[]>([]);
  const [canCreateLot, setCanCreateLot] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showPropModal, setShowPropModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Property | null>(null);
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscapeKey(() => {
    if (inviteResult) setInviteResult(null);
    else if (confirmDelete) setConfirmDelete(null);
    else if (showOwnerModal) setShowOwnerModal(false);
    else if (showPropModal) {
      setShowPropModal(false);
      setEditId(null);
    }
  }, showPropModal || showOwnerModal || Boolean(inviteResult) || Boolean(confirmDelete));

  const [form, setForm] = useState({ lotNumber: "", label: "", address: "", mapLat: "", mapLng: "", notes: "" });
  const [ownerForm, setOwnerForm] = useState({ propertyId: "", email: "", name: "", dni: "", whatsapp: "" });

  const canInvite = isAdmin || can("access.owners.invite");

  const loadProperties = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const d = await api<{ properties: Property[]; canCreateLot?: boolean }>(withTenant("/api/residents/properties", tenantId));
      setRows(d.properties || []);
      setCanCreateLot(Boolean(d.canCreateLot));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProperties();
  }, [tenantId]);

  function openNewLot() {
    setEditId(null);
    setForm({ lotNumber: "", label: "", address: "", mapLat: "", mapLng: "", notes: "" });
    setShowPropModal(true);
  }

  function openEditLot(r: Property) {
    setEditId(r.id);
    setForm({
      lotNumber: r.lotNumber,
      label: r.label,
      address: r.address || "",
      mapLat: r.mapLat || "",
      mapLng: r.mapLng || "",
      notes: r.notes || "",
    });
    setShowPropModal(true);
  }

  async function saveProperty(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    setMsg(null);
    try {
      if (editId) {
        await api(withTenant(`/api/residents/properties/${editId}`, tenantId), {
          method: "PATCH",
          body: JSON.stringify(form),
        });
        setMsg("Lote actualizado");
      } else {
        await api(withTenant("/api/residents/properties", tenantId), {
          method: "POST",
          body: JSON.stringify(form),
        });
        setMsg("Propiedad agregada con exito");
      }
      setForm({ lotNumber: "", label: "", address: "", mapLat: "", mapLng: "", notes: "" });
      setEditId(null);
      setShowPropModal(false);
      await loadProperties();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  async function deleteProperty() {
    if (!tenantId || !confirmDelete) return;
    setBusy(true);
    setMsg(null);
    try {
      await api(withTenant(`/api/residents/properties/${confirmDelete.id}`, tenantId), { method: "DELETE" });
      setMsg(`Lote ${confirmDelete.lotNumber} eliminado`);
      setConfirmDelete(null);
      await loadProperties();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo eliminar");
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
      const d = await api<InviteResult>(withTenant(`/api/residents/properties/${ownerForm.propertyId}/invite`, tenantId), {
        method: "POST",
        body: JSON.stringify({
          email: ownerForm.email,
          name: ownerForm.name,
          dni: ownerForm.dni,
          whatsapp: ownerForm.whatsapp,
        }),
      });
      setInviteResult(d);
      setOwnerForm({ propertyId: "", email: "", name: "", dni: "", whatsapp: "" });
      setShowOwnerModal(false);
      setMsg("Invitación lista para copiar o enviar por WhatsApp");
      await loadProperties();
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
        subtitle="Cada lote se edita o borra desde la fila (modal). El vecino no cambia el lote desde el portal."
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
          {canInvite ? (
            <button
              type="button"
              onClick={() => setShowOwnerModal(true)}
              disabled={rows.length === 0}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <UserPlus className="h-4 w-4" />
              Invitar propietario
            </button>
          ) : null}
          {canCreateLot ? (
            <button
              type="button"
              onClick={openNewLot}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-95"
            >
              <Plus className="h-4 w-4" />
              Nueva Propiedad
            </button>
          ) : null}
        </div>
      </div>

      {/* Properties Table Card */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Nº Lote</th>
                <th className="px-5 py-3.5">Propietarios</th>
                <th className="px-5 py-3.5">Direccion</th>
                <th className="px-5 py-3.5">Coordenadas GPS</th>
                <th className="px-5 py-3.5">Plano</th>
                <th className="px-5 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-500 dark:text-slate-400">
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
                      <div>{r.label}</div>
                      {(r.owners || []).length ? (
                        <ul className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {r.owners!.map((o) => (
                            <li key={o.userId}>
                              {o.name} · {o.email}
                              {o.invitePending ? " (pendiente de activar)" : ""}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-xs text-slate-400">Sin propietario invitado</span>
                      )}
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
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Link
                          href={`/dashboard/plano?lote=${encodeURIComponent(r.lotNumber)}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-50 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-300 dark:hover:bg-slate-700"
                        >
                          <MapPin className="h-3.5 w-3.5" />
                          Abrir en el plano
                        </Link>
                        {canCreateLot ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditLot(r)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(r)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-50 dark:border-rose-900 dark:bg-slate-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Borrar
                            </button>
                          </>
                        ) : null}
                      </div>
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
                  <h3 className="font-bold text-slate-900 dark:text-white">{editId ? "Editar lote" : "Nueva Propiedad"}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {editId ? "Número, titular, dirección y coordenadas GPS." : "Alta de lote en el predio del barrio."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowPropModal(false);
                  setEditId(null);
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={saveProperty} className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Numero de Lote
                  </label>
                  <input
                    type="text"
                    required
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
                    value={form.mapLng}
                    onChange={(e) => setForm({ ...form, mapLng: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nota para portería
                </label>
                <textarea
                  rows={2}
                  maxLength={240}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                />
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Se muestra al guardia cuando entra o sale alguien del lote.
                </p>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowPropModal(false);
                    setEditId(null);
                  }}
                  className="rounded-xl px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? "Guardando..." : editId ? "Guardar cambios" : "Crear Propiedad"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal 2: Invitar propietario */}
      {showOwnerModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl transition-all dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                  <UserPlus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">Invitar propietario</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Lote + nombre o DNI + WhatsApp + email. El vecino arma su clave en el link.
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
                  Lote
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
                    Nombre (o DNI)
                  </label>
                  <input
                    type="text"
                    value={ownerForm.name}
                    onChange={(e) => setOwnerForm({ ...ownerForm, name: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    DNI
                  </label>
                  <input
                    type="text"
                    value={ownerForm.dni}
                    onChange={(e) => setOwnerForm({ ...ownerForm, dni: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Email de acceso
                </label>
                <input
                  type="email"
                  required
                  value={ownerForm.email}
                  onChange={(e) => setOwnerForm({ ...ownerForm, email: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  WhatsApp
                </label>
                <input
                  type="tel"
                  required
                  value={ownerForm.whatsapp}
                  onChange={(e) => setOwnerForm({ ...ownerForm, whatsapp: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                />
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
                  {busy ? "Generando…" : "Generar link"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {inviteResult ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="font-bold text-slate-900 dark:text-white">Enviar invitación</h3>
            <p className="mt-1 text-xs text-slate-500">
              El vecino arma la clave en este enlace. No hay clave temporal.
            </p>
            <p className="mt-3 break-all text-xs text-slate-600 dark:text-slate-300">{inviteResult.activateUrl}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(inviteResult.shareText)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold dark:border-slate-700"
              >
                <Copy className="h-4 w-4" />
                Copiar mensaje
              </button>
              {inviteResult.waUrl ? (
                <a
                  href={inviteResult.waUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => setInviteResult(null)}
                className="rounded-xl px-3 py-2 text-xs text-slate-500"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setConfirmDelete(null)}>
          <div
            className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-slate-900 dark:text-white">Borrar lote {confirmDelete.lotNumber}</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Se saca del padrón y del plano. Si tiene propietario, familia, servicios o visitas, primero hay que darlos de baja.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded-xl px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void deleteProperty()}
                className="rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {busy ? "Borrando…" : "Borrar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ModuleGate>
  );
}

