"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { CapabilityGate, PageHeader } from "@/components/PageHeader";
import { Users, UserPlus, Shield, X, CheckCircle2, RotateCcw, Key } from "lucide-react";

type CapDef = { key: string; group: string; name: string; summary: string };
type StaffUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  capabilities?: string[];
};

const ROLE_LABEL: Record<string, string> = {
  tenant_admin: "Admin barrio",
  guard: "Guardia",
  resident: "Propietario",
};

export default function UsuariosPage() {
  const { tenantId, can, features } = useDash();
  const [rows, setRows] = useState<StaffUser[]>([]);
  const [catalog, setCatalog] = useState<CapDef[]>([]);
  const [templates, setTemplates] = useState<{ guard: string[]; resident: string[] }>({
    guard: [],
    resident: [],
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [editCaps, setEditCaps] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "guard" as "guard" | "resident",
  });

  const packByCap = new Map(
    features.filter((f) => f.parentOn).map((f) => [f.capabilityKey, f] as const),
  );

  const reload = useCallback(async () => {
    if (!tenantId) return;
    const [u, c] = await Promise.all([
      api<{ users: StaffUser[] }>(withTenant("/api/users", tenantId)),
      api<{
        capabilities: CapDef[];
        templates: { guard: string[]; resident: string[] };
      }>(withTenant("/api/capabilities", tenantId)),
    ]);
    setRows(u.users || []);
    setCatalog((c.capabilities || []).filter((x) => !x.key.startsWith("platform.")));
    setTemplates(c.templates || { guard: [], resident: [] });
  }, [tenantId]);

  useEffect(() => {
    reload().catch((err) => setMsg(err instanceof Error ? err.message : "Error"));
  }, [reload]);

  useEffect(() => {
    const u = rows.find((r) => r.id === selected);
    if (u) setEditCaps(u.capabilities ?? []);
  }, [selected, rows]);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !can("core.users.write")) return;
    setBusy(true);
    setMsg(null);
    try {
      await api(withTenant("/api/users", tenantId), {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role,
          capabilities: form.role === "guard" ? templates.guard : templates.resident,
        }),
      });
      setForm({ name: "", email: "", password: "", role: "guard" });
      setShowModal(false);
      setMsg("Usuario creado exitosamente.");
      await reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo crear el usuario");
    } finally {
      setBusy(false);
    }
  }

  async function saveGrants() {
    if (!tenantId || !selected || !can("tenant.grants")) return;
    setMsg(null);
    try {
      await api(`/api/users/${selected}/grants`, {
        method: "PUT",
        body: JSON.stringify({ capabilities: editCaps }),
      });
      setMsg("Permisos guardados.");
      await reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo guardar");
    }
  }

  async function resetTemplate() {
    if (!tenantId || !selected || !can("tenant.grants")) return;
    await api(`/api/users/${selected}/reset-template`, { method: "POST" });
    setMsg("Plantilla del rol aplicada.");
    await reload();
  }

  const selectedUser = rows.find((r) => r.id === selected);
  const editable = selectedUser && selectedUser.role !== "tenant_admin";
  const groups = [...new Set(catalog.map((c) => c.group))];

  return (
    <CapabilityGate capability="core.users.read">
      <PageHeader
        title="Usuarios y Permisos"
        subtitle="Alta de personal de guardia, roles del predio y otorgamiento de permisos granulares."
      />

      {msg ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{msg}</span>
        </div>
      ) : null}

      {/* Top Header Card */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Cuentas y Credenciales</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {rows.length} {rows.length === 1 ? "usuario registrado" : "usuarios registrados"} en este predio.
            </p>
          </div>
        </div>
        {can("core.users.write") ? (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-95"
          >
            <UserPlus className="h-4 w-4" />
            Nuevo Usuario
          </button>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Users List Column */}
        <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Personal y Operadores
          </p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((u) => {
              const isSel = selected === u.id;
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    className={`flex w-full items-start justify-between gap-3 rounded-xl p-3 text-left transition ${
                      isSel
                        ? "bg-blue-50/80 border border-blue-200/80 dark:bg-blue-950/40 dark:border-blue-900/50"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/50 border border-transparent"
                    }`}
                    onClick={() => setSelected(u.id)}
                  >
                    <div className="min-w-0">
                      <span className={`block text-sm font-semibold truncate ${isSel ? "text-blue-700 dark:text-blue-300" : "text-slate-900 dark:text-white"}`}>
                        {u.name}
                      </span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {u.email}
                      </span>
                    </div>
                    <span className="shrink-0 inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {ROLE_LABEL[u.role] ?? u.role}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Permissions Column */}
        <section className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Permisos y Capacidades
          </p>

          {!selectedUser ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-slate-400">
              <Shield className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm font-medium">Selecciona un usuario de la lista</p>
              <p className="text-xs mt-0.5">Podras revisar o modificar sus permisos granulares.</p>
            </div>
          ) : !editable ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
              El administrador del barrio utiliza la plantilla maestra de su rol y no requiere configuracion grant por grant.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">{selectedUser.name}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Rol: {ROLE_LABEL[selectedUser.role]} · {selectedUser.email}
                  </p>
                </div>
                {can("tenant.grants") ? (
                  <button
                    type="button"
                    onClick={resetTemplate}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restaurar plantilla
                  </button>
                ) : null}
              </div>

              <div className="space-y-4 max-h-[480px] overflow-y-auto pr-2">
                {groups.map((g) => (
                  <div key={g} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5 dark:border-slate-800/80 dark:bg-slate-950/30">
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {g}
                    </p>
                    <ul className="space-y-2">
                      {catalog
                        .filter((c) => c.group === g)
                        .map((c) => {
                          const pack = packByCap.get(c.key);
                          const packOff = Boolean(pack && !pack.enabled);
                          const isChecked = editCaps.includes(c.key);

                          return (
                            <li key={c.key} className="flex items-start gap-2.5 text-xs">
                              <input
                                type="checkbox"
                                className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800"
                                disabled={!can("tenant.grants")}
                                checked={isChecked}
                                onChange={(e) => {
                                  setEditCaps((prev) =>
                                    e.target.checked ? [...prev, c.key] : prev.filter((k) => k !== c.key),
                                  );
                                }}
                              />
                              <div className="min-w-0 flex-1">
                                <span className="font-semibold text-slate-800 dark:text-slate-200">
                                  {c.name}
                                </span>
                                {packOff ? (
                                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                    Pack barrio apagado
                                  </span>
                                ) : null}
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                  {c.summary}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                ))}
              </div>

              {can("tenant.grants") ? (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                  <button
                    type="button"
                    onClick={saveGrants}
                    className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    Guardar Permisos
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {/* Modal: Nuevo Usuario */}
      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl transition-all dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                  <UserPlus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">Nuevo Usuario</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Alta de guardia u operador en el predio.</p>
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

            <form onSubmit={createUser} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nombre y Apellido
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Marcelo Gonzalez"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Email de acceso
                </label>
                <input
                  type="email"
                  required
                  placeholder="guardia@barrio.local"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Contraseña (minimo 8 caracteres)
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Rol inicial
                </label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as "guard" | "resident" })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800/80 dark:text-white"
                >
                  <option value="guard">Guardia de Porteria</option>
                  <option value="resident">Propietario / Residente</option>
                </select>
              </div>

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
                  disabled={busy}
                  className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? "Creando..." : "Crear Usuario"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </CapabilityGate>
  );
}

