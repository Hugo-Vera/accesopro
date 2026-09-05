"use client";

import React, { useState, useEffect } from "react";
import { FeatureGate, PageHeader } from "@/components/PageHeader";
import { Clock, Calendar, Save, RefreshCw, CheckCircle2, Copy, Shield, Layers } from "lucide-react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { useToast } from "@/components/Toast";

interface ScheduleItem {
  index: number;
  label: string;
  enabled: boolean;
  days: string[][]; // 7 days, each up to 4 slots "1 HH:mm:ss-HH:mm:ss"
}

const DAY_LABELS = [
  "Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"
];

export default function DahuaPeriodosPage() {
  const { tenantId } = useDash();
  const toast = useToast();
  const [device, setDevice] = useState<{ id: string; name: string } | null>(null);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);

  function t(path: string) {
    return withTenant(path, tenantId);
  }

  useEffect(() => {
    if (tenantId) {
      loadDeviceAndSchedules();
    }
  }, [tenantId]);

  const [devices, setDevices] = useState<Array<{ id: string; name: string; host?: string; deviceType?: string }>>([]);

  const loadDeviceAndSchedules = async (targetDeviceId?: string) => {
    if (!tenantId) return;
    setLoading(true);
    setMessage(null);
    try {
      const devData = await api<{ devices?: Array<{ id: string; name: string; host?: string; deviceType?: string }> }>(t("/api/hardware/dahua"));
      const accessDevs = (devData.devices || []).filter((d) => d.deviceType !== "camera_ip");
      setDevices(accessDevs);
      const chosen = accessDevs.find((d) => d.id === targetDeviceId) || accessDevs[0];
      if (!chosen) {
        setMessage("No se encontró ningún terminal Dahua (lector facial / ASI) configurado.");
        setDevice(null);
        setLoading(false);
        return;
      }
      setDevice(chosen);

      const schedData = await api<{ schedules?: ScheduleItem[] }>(t(`/api/hardware/dahua/${chosen.id}/schedules?count=16`));
      const list = schedData.schedules || [];
      setSchedules(list);
      if (list.length > 0 && selectedIndex >= list.length) {
        setSelectedIndex(0);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error de comunicación con el lector");
    } finally {
      setLoading(false);
    }
  };

  const currentSchedule = schedules[selectedIndex] || null;

  const parseSlotTimes = (raw: string) => {
    // Expected format: "1 08:00:00-17:00:00"
    const cleaned = (raw || "").trim();
    const match = cleaned.match(/(\d{2}:\d{2}(?::\d{2})?)\s*-\s*(\d{2}:\d{2}(?::\d{2})?)/);
    if (match) {
      return { start: match[1], end: match[2] };
    }
    return { start: "00:00:00", end: "00:00:00" };
  };

  const updateSlot = (dayIdx: number, slotIdx: number, start: string, end: string) => {
    if (!currentSchedule) return;
    const newDays = currentSchedule.days.map((d, dIdx) => {
      if (dIdx !== dayIdx) return [...d];
      const newSlots = [...d];
      newSlots[slotIdx] = `1 ${start.trim()}-${end.trim()}`;
      return newSlots;
    });

    setSchedules((prev) =>
      prev.map((s, idx) => (idx === selectedIndex ? { ...s, days: newDays } : s))
    );
  };

  const toggleScheduleEnabled = (enabled: boolean) => {
    setSchedules((prev) =>
      prev.map((s, idx) => (idx === selectedIndex ? { ...s, enabled } : s))
    );
  };

  const copyMondayToAll = () => {
    if (!currentSchedule) return;
    const mondaySlots = currentSchedule.days[1] || []; // 1 = Monday
    const newDays = currentSchedule.days.map((_, idx) => {
      if (idx === 0 || idx === 6) return ["1 00:00:00-00:00:00", "1 00:00:00-00:00:00", "1 00:00:00-00:00:00", "1 00:00:00-00:00:00"]; // weekends off
      return [...mondaySlots];
    });
    setSchedules((prev) =>
      prev.map((s, idx) => (idx === selectedIndex ? { ...s, days: newDays } : s))
    );
    setMessage("Horarios de Lunes copiados a Martes-Viernes (Fines de semana inactivos).");
  };

  const setPresetAllDay = () => {
    if (!currentSchedule) return;
    const newDays = currentSchedule.days.map(() => [
      "1 00:00:00-23:59:59",
      "1 00:00:00-00:00:00",
      "1 00:00:00-00:00:00",
      "1 00:00:00-00:00:00",
    ]);
    setSchedules((prev) =>
      prev.map((s, idx) => (idx === selectedIndex ? { ...s, days: newDays, enabled: true } : s))
    );
  };

  const handleSave = async () => {
    if (!device || !currentSchedule || !tenantId) return;
    setSaving(true);
    setMessage(null);
    try {
      const data = await api<{ ok: boolean; error?: string }>(t(`/api/hardware/dahua/${device.id}/schedules`), {
        method: "POST",
        body: JSON.stringify({
          index: currentSchedule.index,
          enabled: currentSchedule.enabled,
          days: currentSchedule.days,
        }),
      });
      if (!data.ok) throw new Error(data.error || "No se pudo guardar el periodo");
      setMessage(`Periodo ${currentSchedule.index + 1} guardado y sincronizado correctamente en el equipo Dahua.`);
      toast.success("Periodo guardado", `Periodo ${currentSchedule.index + 1} sincronizado en el terminal ASI.`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Error al guardar";
      setMessage(errMsg);
      toast.error("Error al guardar periodo", errMsg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FeatureGate feature="dahua.schedules" capability="dahua.schedules">
      <PageHeader
        title="Periodos y Horarios Dahua"
        subtitle="Configuración de franjas horarias y días de validez sincronizados con la memoria del terminal ASI."
      />

      <div className="space-y-6 max-w-6xl">
        {message && (
          <div className="p-4 rounded-xl border border-cyan-200 dark:border-cyan-800/40 bg-cyan-50 dark:bg-cyan-950/30 text-cyan-900 dark:text-cyan-200 text-sm flex items-center justify-between">
            <span>{message}</span>
            <button onClick={() => setMessage(null)} className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline">
              Cerrar
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Left: Schedule Selector List */}
          <div className="md:col-span-4 bg-white dark:bg-[#111827] border border-slate-200 dark:border-[#1f2937] rounded-xl p-4 shadow-sm flex flex-col justify-between h-[650px] transition-colors">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#1f2937]">
                <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white text-sm">
                  <Layers className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                  <span>Listado de Periodos</span>
                </div>
                <button
                  onClick={() => loadDeviceAndSchedules()}
                  disabled={loading}
                  className="p-1 text-slate-400 hover:text-slate-800 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-[#1f2937] transition-colors"
                  title="Recargar"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {devices.length > 1 ? (
                <div className="mt-3 mb-2">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Terminal de acceso:
                  </label>
                  <select
                    value={device?.id ?? ""}
                    onChange={(e) => loadDeviceAndSchedules(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.host})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="mt-3 space-y-1.5 overflow-y-auto max-h-[500px] pr-1">
                {/* Special 255 Default Entry */}
                <div className="p-2.5 rounded-lg border border-dashed border-cyan-300 dark:border-cyan-800/50 bg-cyan-50 dark:bg-cyan-950/20 text-xs">
                  <div className="flex items-center justify-between font-bold text-cyan-800 dark:text-cyan-300">
                    <span>255-Defecto (Siempre Abierto)</span>
                    <span className="text-[10px] bg-cyan-100 dark:bg-cyan-900/60 px-1.5 py-0.5 rounded text-cyan-800 dark:text-cyan-200">GLOBAL</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Acceso irrestricto 24/7 todos los días del año.</p>
                </div>

                {/* Schedules 1 to 16 */}
                {schedules.map((s, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={s.index}
                      type="button"
                      onClick={() => setSelectedIndex(idx)}
                      className={`w-full text-left p-3 rounded-lg border transition-all flex items-center justify-between ${
                        isSelected
                          ? "bg-cyan-50 dark:bg-cyan-950/40 border-cyan-500 text-cyan-900 dark:text-white shadow-sm"
                          : "bg-slate-50 dark:bg-[#0b0f17] border-slate-200 dark:border-[#1f2937] hover:border-slate-300 dark:hover:border-slate-600 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-xs flex items-center gap-1.5">
                          <span>{s.label}</span>
                          {s.enabled ? (
                            <span className="text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 px-1.5 py-0.2 rounded">
                              ON
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.2 rounded">
                              OFF
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">
                          Dahua Index: {s.index}
                        </div>
                      </div>
                      <Clock className={`w-4 h-4 ${isSelected ? "text-cyan-600 dark:text-cyan-400" : "text-slate-400 dark:text-slate-600"}`} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-[#1f2937] text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
              <span>Los índices corresponden a la memoria interna del ASI.</span>
            </div>
          </div>

          {/* Right: Weekly Schedule Editor */}
          <div className="md:col-span-8 bg-white dark:bg-[#111827] border border-slate-200 dark:border-[#1f2937] rounded-xl p-5 shadow-sm flex flex-col justify-between h-[650px] transition-colors">
            <div>
              {/* Header & Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-[#1f2937]">
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                    <span>{currentSchedule?.label || "Seleccione un periodo"}</span>
                    {currentSchedule?.enabled && (
                      <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-300 dark:border-emerald-800">
                        Habilitado
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Defina hasta 4 franjas horarias para cada día de la semana.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={currentSchedule?.enabled || false}
                      onChange={(e) => toggleScheduleEnabled(e.target.checked)}
                      className="rounded bg-white dark:bg-[#0b0f17] border-slate-300 dark:border-slate-600 text-cyan-600 focus:ring-cyan-500 w-4 h-4"
                    />
                    <span>Periodo Activo</span>
                  </label>

                  <button
                    type="button"
                    disabled={saving || !currentSchedule}
                    onClick={handleSave}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg transition-colors shadow flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {saving ? "Guardando..." : "Guardar en Lector"}
                  </button>
                </div>
              </div>

              {/* Quick Presets Bar */}
              <div className="flex flex-wrap items-center gap-2 py-3 border-b border-slate-200 dark:border-[#1f2937] text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-medium">Plantillas rápidas:</span>
                <button
                  type="button"
                  onClick={setPresetAllDay}
                  className="px-2.5 py-1 bg-slate-100 dark:bg-[#1b263b] hover:bg-slate-200 dark:hover:bg-[#253450] text-cyan-800 dark:text-cyan-300 rounded border border-slate-200 dark:border-[#2b354c] transition-colors"
                >
                  24 Horas Todos los Días
                </button>
                <button
                  type="button"
                  onClick={copyMondayToAll}
                  className="px-2.5 py-1 bg-slate-100 dark:bg-[#1b263b] hover:bg-slate-200 dark:hover:bg-[#253450] text-cyan-800 dark:text-cyan-300 rounded border border-slate-200 dark:border-[#2b354c] transition-colors flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" /> Replicar Lunes a Laborales
                </button>
              </div>

              {/* Days Table */}
              <div className="mt-3 overflow-y-auto max-h-[420px] space-y-2 pr-1">
                {DAY_LABELS.map((dayName, dayIdx) => {
                  const slots = currentSchedule?.days[dayIdx] || [];
                  return (
                    <div
                      key={dayName}
                      className="p-2.5 bg-slate-50 dark:bg-[#0b0f17] border border-slate-200 dark:border-[#1f2937] rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-2 transition-colors"
                    >
                      <div className="w-28 font-semibold text-xs text-slate-800 dark:text-slate-200">
                        {dayName}
                      </div>

                      <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[0, 1, 2, 3].map((slotIdx) => {
                          const slotRaw = slots[slotIdx] || "1 00:00:00-00:00:00";
                          const parsed = parseSlotTimes(slotRaw);
                          const isActive = parsed.start !== "00:00:00" || parsed.end !== "00:00:00";

                          return (
                            <div
                              key={slotIdx}
                              className={`p-1.5 rounded border text-[11px] flex flex-col gap-1 transition-colors ${
                                isActive
                                  ? "bg-white dark:bg-[#111827] border-cyan-300 dark:border-cyan-900/60 shadow-xs"
                                  : "bg-slate-100/60 dark:bg-[#0e1626]/50 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500"
                              }`}
                            >
                              <div className="flex items-center justify-between text-[10px] text-slate-400">
                                <span>F{slotIdx + 1}</span>
                                {isActive && <span className="text-cyan-600 dark:text-cyan-400 font-bold">•</span>}
                              </div>
                              <div className="flex items-center gap-1 font-mono">
                                <input
                                  type="text"
                                  value={parsed.start}
                                  onChange={(e) => updateSlot(dayIdx, slotIdx, e.target.value, parsed.end)}
                                  className="w-full bg-slate-50 dark:bg-[#0b0f17] border border-slate-300 dark:border-slate-700 rounded px-1 py-0.5 text-center text-[10px] text-slate-800 dark:text-slate-200 focus:outline-none focus:border-cyan-500"
                                  placeholder="00:00:00"
                                />
                                <span>-</span>
                                <input
                                  type="text"
                                  value={parsed.end}
                                  onChange={(e) => updateSlot(dayIdx, slotIdx, parsed.start, e.target.value)}
                                  className="w-full bg-slate-50 dark:bg-[#0b0f17] border border-slate-300 dark:border-slate-700 rounded px-1 py-0.5 text-center text-[10px] text-slate-800 dark:text-slate-200 focus:outline-none focus:border-cyan-500"
                                  placeholder="00:00:00"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-[#1f2937] text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span>Formato de franja: HH:mm:ss (24 horas)</span>
              <span className="text-cyan-600 dark:text-cyan-400 font-mono">Total días: 7 | Franjas por día: 4</span>
            </div>
          </div>
        </div>
      </div>
    </FeatureGate>
  );
}
