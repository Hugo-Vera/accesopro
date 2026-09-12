"use client";

import React, { useState, useEffect } from "react";
import { FeatureGate, PageHeader } from "@/components/PageHeader";
import { Building2, Plus, Trash2, Clock, CheckCircle2, RefreshCw, Shield, Users } from "lucide-react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { useEscapeKey } from "@/hooks/useEscapeKey";

interface Department {
  id: string;
  dahuaDeptId: string;
  name: string;
  defaultPeriodIndex: number;
  description: string | null;
  createdAt: number;
}

export default function DahuaDepartamentosPage() {
  const { tenantId } = useDash();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // New department form
  const [name, setName] = useState("");
  const [dahuaDeptId, setDahuaDeptId] = useState("2");
  const [defaultPeriodIndex, setDefaultPeriodIndex] = useState<number>(0); // 0 = Period 1 (Laboral)
  const [description, setDescription] = useState("");
  const [showModal, setShowModal] = useState(false);
  useEscapeKey(() => setShowModal(false), showModal);

  function t(path: string) {
    return withTenant(path, tenantId);
  }

  useEffect(() => {
    if (tenantId) {
      loadDepartments();
    }
  }, [tenantId]);

  const loadDepartments = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const data = await api<{ ok: boolean; departments: Department[] }>(t("/api/departments"));
      const list: Department[] = data.departments || [];

      // If empty, auto-seed with standard departments
      if (list.length === 0) {
        await seedDefaultDepartments();
      } else {
        setDepartments(list);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  };

  const seedDefaultDepartments = async () => {
    try {
      await api(t("/api/departments"), {
        method: "POST",
        body: JSON.stringify({
          dahuaDeptId: "1",
          name: "Residentes y Propietarios",
          defaultPeriodIndex: 255,
          description: "Acceso libre e irrestricto las 24 horas todos los días",
        }),
      });
      await api(t("/api/departments"), {
        method: "POST",
        body: JSON.stringify({
          dahuaDeptId: "2",
          name: "Personal General y Empleados",
          defaultPeriodIndex: 0,
          description: "Ingreso en días hábiles (Lunes a Viernes 08:00 a 17:00)",
        }),
      });
      await api(t("/api/departments"), {
        method: "POST",
        body: JSON.stringify({
          dahuaDeptId: "3",
          name: "Mantenimiento y Obras",
          defaultPeriodIndex: 0,
          description: "Ingreso en días y horarios de obra reglamentarios",
        }),
      });
      const data = await api<{ ok: boolean; departments: Department[] }>(t("/api/departments"));
      setDepartments(data.departments || []);
    } catch {}
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await api(t("/api/departments"), {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          dahuaDeptId: dahuaDeptId.trim() || "1",
          defaultPeriodIndex: Number(defaultPeriodIndex),
          description: description.trim() || null,
        }),
      });
      setName("");
      setDescription("");
      setShowModal(false);
      await loadDepartments();
      setMessage("Departamento creado y vinculado exitosamente.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error al crear departamento");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, deptName: string) => {
    if (!confirm(`¿Eliminar el departamento "${deptName}"?`)) return;
    try {
      await api(t(`/api/departments/${id}`), { method: "DELETE" });
      setDepartments((prev) => prev.filter((d) => d.id !== id));
      setMessage(`Departamento "${deptName}" eliminado.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error al eliminar");
    }
  };

  return (
    <FeatureGate feature="dahua.persons" capability="dahua.persons">
      <PageHeader
        title="Departamentos y Sectores"
        subtitle="Gestión de sectores (ej. Personal General) con horarios habituales sincronizados."
      />

      <div className="space-y-6 max-w-5xl">
        {message && (
          <div className="p-4 rounded-xl border border-cyan-800/40 bg-cyan-950/30 text-cyan-200 text-sm flex items-center justify-between">
            <span>{message}</span>
            <button onClick={() => setMessage(null)} className="text-xs text-cyan-400 hover:underline">
              Cerrar
            </button>
          </div>
        )}

        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-[#1f2937] rounded-xl p-5 shadow-sm transition-colors">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-[#1f2937]">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              <h3 className="font-semibold text-slate-900 dark:text-white text-base">Sectores del Barrio</h3>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">({departments.length})</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={loadDepartments}
                disabled={loading}
                className="p-2 text-slate-400 hover:text-slate-800 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-[#1f2937] transition-colors"
                title="Recargar"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={() => setShowModal(true)}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded-lg transition-colors shadow flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Nuevo Departamento
              </button>
            </div>
          </div>

          {/* List of Departments */}
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {departments.map((dept) => {
              const isDefault = dept.dahuaDeptId === "1";
              return (
                <div
                  key={dept.id}
                  className="bg-slate-50 dark:bg-[#0b0f17] border border-slate-200 dark:border-[#1f2937] rounded-xl p-4 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-mono font-bold text-cyan-700 dark:text-cyan-400 bg-cyan-100 dark:bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-300 dark:border-cyan-900/60">
                          ID {dept.dahuaDeptId}
                        </span>
                        <h4 className="font-bold text-sm text-slate-900 dark:text-white mt-1">{dept.name}</h4>
                      </div>
                      {!isDefault && (
                        <button
                          type="button"
                          onClick={() => handleDelete(dept.id, dept.name)}
                          className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-slate-200 dark:hover:bg-[#1f2937]"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 line-clamp-2">
                      {dept.description || "Sin descripción adicional."}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-200 dark:border-[#1f2937]/70 flex items-center justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-400 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-500" />
                      {dept.defaultPeriodIndex === 255
                        ? "255-Defecto (24/7)"
                        : `Periodo ${dept.defaultPeriodIndex + 1}`}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <Users className="w-3 h-3" /> Sector
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200 dark:border-[#1f2937] text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
            <span>
              Cuando un usuario tiene <strong>Modo de programación = Programación de Departamento</strong>, hereda de forma estricta el período del sector correspondiente.
            </span>
          </div>
        </div>

        {/* Modal New Department */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80 backdrop-blur-sm">
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-[#2b354c] rounded-2xl w-full max-w-md shadow-2xl p-6 text-slate-900 dark:text-slate-100 animate-in fade-in transition-colors">
              <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-[#1f2937]">
                <h3 className="font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-cyan-600 dark:text-cyan-400" /> Nuevo Departamento
                </h3>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-lg font-bold"
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleCreate} className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nombre del Sector *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej: Personal General"
                    className="w-full bg-slate-50 dark:bg-[#0b0f17] border border-slate-300 dark:border-[#2b354c] rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      ID Dahua *
                    </label>
                    <input
                      type="text"
                      required
                      value={dahuaDeptId}
                      onChange={(e) => setDahuaDeptId(e.target.value)}
                      placeholder="Ej: 2"
                      className="w-full bg-slate-50 dark:bg-[#0b0f17] border border-slate-300 dark:border-[#2b354c] rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white font-mono focus:outline-none focus:border-cyan-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Horario Predeterminado
                    </label>
                    <select
                      value={defaultPeriodIndex}
                      onChange={(e) => setDefaultPeriodIndex(Number(e.target.value))}
                      className="w-full bg-slate-50 dark:bg-[#0b0f17] border border-slate-300 dark:border-[#2b354c] rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500 transition-colors"
                    >
                      <option value={255}>255-Defecto (Siempre abierto)</option>
                      <option value={0}>Periodo 1 (Base / Laboral)</option>
                      <option value={1}>Periodo 2</option>
                      <option value={2}>Periodo 3</option>
                      <option value={3}>Periodo 4</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Descripción / Notas
                  </label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Ej: Empleados con horario habitual de lunes a viernes."
                    className="w-full bg-slate-50 dark:bg-[#0b0f17] border border-slate-300 dark:border-[#2b354c] rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500 resize-none transition-colors"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200 dark:border-[#1f2937]">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-[#1f2937] transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !name.trim()}
                    className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg transition-colors shadow disabled:opacity-50"
                  >
                    {saving ? "Guardando..." : "Crear Sector"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </FeatureGate>
  );
}
