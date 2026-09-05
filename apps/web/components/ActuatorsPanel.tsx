"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { Plus, X, Settings2, Power, DoorClosed, Trash2 } from "lucide-react";

type Actuator = {
  id: string;
  name: string;
  kind: string;
  driver: string;
  dahuaDeviceId: string | null;
  dahuaChannel: number;
  httpUrl: string | null;
  pulseMs: number;
  engineSentido: "in" | "out" | null;
  open: boolean | null;
  triggerAlpr: boolean;
  triggerDahua: boolean;
  triggerQr: boolean;
  triggerManual: boolean;
};

type Device = { id: string; name: string; host: string };

const KIND: Record<string, string> = { door: "Puerta", gate: "Porton", barrier: "Barrera" };
const DRIVER: Record<string, string> = { engine: "Motor LAN (AccesoSeguro)", dahua: "Dahua (CGI)", ip: "Rele IP / HTTP" };

const emptyForm = {
  name: "",
  kind: "barrier",
  driver: "ip",
  engineSentido: "in",
  dahuaDeviceId: "",
  dahuaChannel: "1",
  httpUrl: "",
  pulseMs: "1000",
};

export function ActuatorsPanel() {
  const { tenantId } = useDash();
  const [rows, setRows] = useState<Actuator[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const t = (path: string) => withTenant(path, tenantId);

  async function load() {
    if (!tenantId) return;
    const [a, d] = await Promise.all([
      api<{ actuators: Actuator[] }>(t("/api/actuators")),
      api<{ devices: Device[] }>(t("/api/dahua")).catch(() => ({ devices: [] as Device[] })),
    ]);
    setRows(a.actuators || []);
    setDevices(d.devices || []);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Error"));
    const id = setInterval(() => load().catch(() => null), 4000);
    return () => clearInterval(id);
  }, [tenantId]);

  function openCreateModal() {
    setEditingId(null);
    setForm(emptyForm);
    setShowModal(true);
  }

  function openEditModal(row: Actuator) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      kind: row.kind,
      driver: row.driver,
      engineSentido: row.engineSentido ?? "in",
      dahuaDeviceId: row.dahuaDeviceId ?? "",
      dahuaChannel: String(row.dahuaChannel || 1),
      httpUrl: row.httpUrl ?? "",
      pulseMs: String(row.pulseMs || 1000),
    });
    setShowModal(true);
  }

  function payload() {
    return {
      name: form.name.trim(),
      kind: form.kind,
      driver: form.driver,
      engineSentido: form.driver === "engine" ? form.engineSentido : null,
      dahuaDeviceId: form.driver === "dahua" ? form.dahuaDeviceId : null,
      dahuaChannel: Number(form.dahuaChannel) || 1,
      httpUrl: form.driver === "ip" ? form.httpUrl.trim() : null,
      pulseMs: Number(form.pulseMs) || 1000,
    };
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (!tenantId) return;
    setBusy("save");
    setError(null);
    try {
      if (editingId) {
        await api(t(`/api/actuators/${editingId}`), { method: "PATCH", body: JSON.stringify(payload()) });
      } else {
        await api(t("/api/actuators"), { method: "POST", body: JSON.stringify(payload()) });
      }
      setShowModal(false);
      setForm(emptyForm);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(null);
    }
  }

  async function fire(id: string, action: "open" | "close") {
    if (!tenantId) return;
    setBusy(`${action}-${id}`);
    setError(null);
    try {
      const r = await api<{ ok: boolean; error?: string }>(t(`/api/actuators/${id}/${action}`), { method: "POST" });
      if (!r.ok) setError(r.error || "No se disparo la apertura");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fallo el pulso");
    } finally {
      setBusy(null);
    }
  }

  async function setTrigger(row: Actuator, key: "triggerAlpr" | "triggerDahua" | "triggerQr" | "triggerManual", value: boolean) {
    if (!tenantId) return;
    setError(null);
    try {
      await api(t(`/api/actuators/${row.id}`), {
        method: "PATCH",
        body: JSON.stringify({
          name: row.name,
          kind: row.kind,
          driver: row.driver,
          engineSentido: row.engineSentido,
          dahuaDeviceId: row.dahuaDeviceId,
          dahuaChannel: row.dahuaChannel,
          httpUrl: row.httpUrl,
          pulseMs: row.pulseMs,
          triggerAlpr: row.triggerAlpr,
          triggerDahua: row.triggerDahua,
          triggerQr: row.triggerQr,
          triggerManual: row.triggerManual,
          [key]: value,
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar");
    }
  }

  async function remove(id: string) {
    if (!tenantId) return;
    if (!confirm("Estas seguro de eliminar este actuador?")) return;
    await api(t(`/api/actuators/${id}`), { method: "DELETE" });
    if (editingId === id) {
      setShowModal(false);
      setEditingId(null);
    }
    await load();
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {/* Header bar with primary action */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Reles y Puntos de Acceso</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Control de barreras, portones y puertas peatonales activadas por camara, facial o QR.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-95 dark:bg-blue-600 dark:hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" />
          Nuevo Actuador
        </button>
      </div>

      {/* Actuators Grid / List */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900/40">
          <DoorClosed className="h-10 w-10 text-slate-400 dark:text-slate-600 mb-3" />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No hay actuadores configurados</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
            Agrega el primer rele para comandar aperturas desde reconocimiento facial, patentes o boton de porteria.
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            className="mt-4 flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Agregar Actuador
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((a) => {
            const isEng = a.driver === "engine";
            const isDah = a.driver === "dahua";
            const isIp = a.driver === "ip";

            return (
              <div
                key={a.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold text-xs ${
                          a.open
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                        }`}
                      >
                        <Power className={`h-5 w-5 ${a.open ? "text-emerald-600 dark:text-emerald-400 animate-pulse" : ""}`} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900 dark:text-white leading-tight">{a.name}</h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {KIND[a.kind] ?? a.kind} · {DRIVER[a.driver] ?? a.driver}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                        a.open
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {a.open ? "ABIERTO" : "CERRADO"}
                    </span>
                  </div>

                  {/* Details box */}
                  <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-[11px] space-y-1 dark:border-slate-800/80 dark:bg-slate-950/40">
                    {isEng ? (
                      <div className="flex justify-between text-slate-600 dark:text-slate-400">
                        <span>Lado de accionamiento:</span>
                        <span className="font-medium text-slate-900 dark:text-white">
                          {a.engineSentido === "out" ? "Salida (OUT)" : "Ingreso (IN)"}
                        </span>
                      </div>
                    ) : null}
                    {isDah ? (
                      <>
                        <div className="flex justify-between text-slate-600 dark:text-slate-400">
                          <span>Terminal vinculada:</span>
                          <span className="font-medium text-slate-900 dark:text-white truncate max-w-[140px]">
                            {devices.find((d) => d.id === a.dahuaDeviceId)?.name ?? "Terminal Dahua"}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-600 dark:text-slate-400">
                          <span>Canal de salida:</span>
                          <span className="font-medium text-slate-900 dark:text-white">Relay {a.dahuaChannel}</span>
                        </div>
                      </>
                    ) : null}
                    {isIp ? (
                      <div className="flex justify-between text-slate-600 dark:text-slate-400">
                        <span>URL de pulso:</span>
                        <span className="font-mono text-[10px] text-slate-900 dark:text-white truncate max-w-[150px]">
                          {a.httpUrl || "No especificada"}
                        </span>
                      </div>
                    ) : null}
                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>Tiempo de pulso:</span>
                      <span className="font-medium text-slate-900 dark:text-white">{a.pulseMs} ms</span>
                    </div>
                  </div>

                  {/* Trigger checkboxes */}
                  <div className="mt-3">
                    <p className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                      Disparadores automaticos
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 select-none cursor-pointer">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800"
                          checked={Boolean(a.triggerManual)}
                          onChange={(e) => setTrigger(a, "triggerManual", e.target.checked)}
                        />
                        <span>Boton Manual</span>
                      </label>
                      <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 select-none cursor-pointer">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800"
                          checked={Boolean(a.triggerAlpr)}
                          onChange={(e) => setTrigger(a, "triggerAlpr", e.target.checked)}
                        />
                        <span>Patente LPR</span>
                      </label>
                      <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 select-none cursor-pointer">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800"
                          checked={Boolean(a.triggerDahua)}
                          onChange={(e) => setTrigger(a, "triggerDahua", e.target.checked)}
                        />
                        <span>Rostro Dahua</span>
                      </label>
                      <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 select-none cursor-pointer">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800"
                          checked={Boolean(a.triggerQr)}
                          onChange={(e) => setTrigger(a, "triggerQr", e.target.checked)}
                        />
                        <span>QR / DNI</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Actions footer */}
                <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => fire(a.id, "open")}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                    >
                      {busy === `open-${a.id}` ? "Abriendo..." : "Abrir"}
                    </button>
                    {isEng ? (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => fire(a.id, "close")}
                        className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 active:scale-95 disabled:opacity-50"
                      >
                        {busy === `close-${a.id}` ? "Cerrando..." : "Cerrar"}
                      </button>
                    ) : null}
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => openEditModal(a)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Configurar
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(a.id)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                      title="Eliminar actuador"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Dialog for Create / Edit */}
      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl transition-all dark:border-slate-800 dark:bg-slate-900">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                  <Settings2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">
                    {editingId ? "Configurar Actuador" : "Nuevo Actuador"}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Parametros de relay y vinculo fisico con la controladora o motor.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={onSubmit} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nombre identificatorio
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Barrera Entrada, Porton Cochera"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white dark:focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tipo de apertura
                  </label>
                  <select
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                  >
                    <option value="barrier">Barrera</option>
                    <option value="gate">Porton corredizo</option>
                    <option value="door">Puerta peatonal</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Controlador / Driver
                  </label>
                  <select
                    value={form.driver}
                    onChange={(e) => setForm({ ...form, driver: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                  >
                    <option value="dahua">Dahua (Controladora/Facial)</option>
                    <option value="engine">Motor LAN (AccesoSeguro)</option>
                    <option value="ip">Rele IP / HTTP</option>
                  </select>
                </div>
              </div>

              {/* Conditional fields based on driver */}
              {form.driver === "dahua" ? (
                <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 space-y-3 dark:border-blue-900/40 dark:bg-blue-950/20">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Equipo Dahua
                    </label>
                    <select
                      required
                      value={form.dahuaDeviceId}
                      onChange={(e) => setForm({ ...form, dahuaDeviceId: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="">Seleccionar equipo...</option>
                      {devices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.host})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Canal de rele (Door index)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={form.dahuaChannel}
                      onChange={(e) => setForm({ ...form, dahuaChannel: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>
              ) : null}

              {form.driver === "engine" ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Sentido del Motor LAN
                  </label>
                  <select
                    value={form.engineSentido}
                    onChange={(e) => setForm({ ...form, engineSentido: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="in">Ingreso Principal (IN)</option>
                    <option value="out">Salida Principal (OUT)</option>
                  </select>
                </div>
              ) : null}

              {form.driver === "ip" ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    URL HTTP de activacion
                  </label>
                  <input
                    type="url"
                    placeholder="http://192.168.1.150/relay/open"
                    value={form.httpUrl}
                    onChange={(e) => setForm({ ...form, httpUrl: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-mono text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              ) : null}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Duracion del pulso (milisegundos)
                </label>
                <input
                  type="number"
                  min={200}
                  max={10000}
                  step={100}
                  value={form.pulseMs}
                  onChange={(e) => setForm({ ...form, pulseMs: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                />
              </div>

              {/* Modal Actions */}
              <div className="mt-6 flex items-center justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl px-4 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={busy === "save"}
                  className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy === "save" ? "Guardando..." : editingId ? "Guardar Cambios" : "Crear Actuador"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
