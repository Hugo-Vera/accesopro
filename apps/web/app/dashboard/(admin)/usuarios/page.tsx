"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { CapabilityGate, PageHeader } from "@/components/PageHeader";

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
    setRows(u.users);
    setCatalog(c.capabilities.filter((x) => !x.key.startsWith("platform.")));
    setTemplates(c.templates);
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
    setMsg(null);
    try {
      await api(withTenant("/api/users", tenantId), {
        method: "POST",
        body: JSON.stringify({
          ...form,
          capabilities: form.role === "guard" ? templates.guard : templates.resident,
        }),
      });
      setForm({ name: "", email: "", password: "", role: "guard" });
      setMsg("Usuario creado.");
      await reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo crear");
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
        title="Usuarios y permisos"
        subtitle="Alta de guardias y otorgamiento de permisos granulares."
      />
      {msg ? <p className="mb-3 text-sm text-muted">{msg}</p> : null}

      {can("core.users.write") ? (
        <form onSubmit={createUser} className="card mb-4 grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <input
            className="cfg-input"
            placeholder="Nombre"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            className="cfg-input"
            placeholder="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <input
            className="cfg-input"
            placeholder="Clave (mín. 8)"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={8}
          />
          <select
            className="cfg-input"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as "guard" | "resident" })}
          >
            <option value="guard">Guardia</option>
            <option value="resident">Propietario</option>
          </select>
          <button type="submit" className="btn-primary">
            Crear
          </button>
        </form>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-muted">Usuarios del barrio</p>
          <ul className="divide-y divide-line">
            {rows.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className={`flex w-full items-start justify-between gap-2 px-1 py-2.5 text-left ${
                    selected === u.id ? "text-[#f2f2f2]" : "text-muted hover:text-[#d8d8d8]"
                  }`}
                  onClick={() => setSelected(u.id)}
                >
                  <span>
                    <span className="block font-medium text-[#e6e6e6]">{u.name}</span>
                    <span className="text-[12px]">{u.email}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">{ROLE_LABEL[u.role] ?? u.role}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-4">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-muted">Permisos</p>
          {!selectedUser ? (
            <p className="text-sm text-muted">Elegí un usuario.</p>
          ) : !editable ? (
            <p className="text-sm text-muted">
              El admin del barrio usa la plantilla del rol (no se edita grant por grant).
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm">
                <span className="font-medium text-[#e6e6e6]">{selectedUser.name}</span>
                <span className="text-muted"> · {ROLE_LABEL[selectedUser.role]}</span>
              </p>
              <p className="mb-3 text-[12px] text-muted">
                El permiso solo alcanza si el pack está tildado en{" "}
                <a href="/dashboard/modulos" className="text-accent hover:underline">
                  Configuración → Funciones
                </a>
                .
              </p>
              {groups.map((g) => (
                <div key={g} className="mb-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted/80">{g}</p>
                  <ul className="space-y-1">
                    {catalog
                      .filter((c) => c.group === g)
                      .map((c) => {
                        const pack = packByCap.get(c.key);
                        const packOff = Boolean(pack && !pack.enabled);
                        return (
                          <li key={c.key} className="flex items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="mt-1"
                              disabled={!can("tenant.grants")}
                              checked={editCaps.includes(c.key)}
                              onChange={(e) => {
                                setEditCaps((prev) =>
                                  e.target.checked ? [...prev, c.key] : prev.filter((k) => k !== c.key),
                                );
                              }}
                            />
                            <span>
                              <span className="text-[#e6e6e6]">{c.name}</span>
                              {packOff ? (
                                <span className="ml-2 text-[11px] text-warn">pack del barrio off</span>
                              ) : null}
                              <span className="block text-[11px] text-muted">{c.summary}</span>
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ))}
              {can("tenant.grants") ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn-primary" onClick={saveGrants}>
                    Guardar permisos
                  </button>
                  <button type="button" className="btn-ghost" onClick={resetTemplate}>
                    Restaurar plantilla
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </CapabilityGate>
  );
}
