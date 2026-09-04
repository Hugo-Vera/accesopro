"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";

type Device = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
};

type Actuator = {
  id: string;
  name: string;
  kind: string;
  driver: string;
  dahuaDeviceId: string | null;
};

type FormState = {
  name: string;
  host: string;
  port: string;
  username: string;
  password: string;
  actuatorName: string;
  kind: string;
};

const emptyForm = (): FormState => ({
  name: "",
  host: "",
  port: "80",
  username: "admin",
  password: "",
  actuatorName: "",
  kind: "door",
});

type TestResult = {
  action: string;
  ok: boolean;
  detail: string;
  imageSrc?: string;
};

export function EquipmentPanel() {
  const { tenantId, can, status } = useDash();
  const [devices, setDevices] = useState<Device[]>([]);
  const [actuators, setActuators] = useState<Actuator[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [form, setForm] = useState<FormState>(emptyForm());
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tests, setTests] = useState<TestResult[]>([]);

  const canEdit = can("core.config");
  const canOpen = can("dahua.open") || can("ops.relay");
  const selected = devices.find((d) => d.id === selectedId) ?? null;
  const selectedAct = actuators.find((a) => a.dahuaDeviceId === selectedId) ?? null;

  const t = (path: string) => withTenant(path, tenantId);

  async function load() {
    if (!tenantId) return;
    const [d, a] = await Promise.all([
      api<{ devices: Device[] }>(t("/api/dahua")),
      api<{ actuators: Actuator[] }>(t("/api/actuators")).catch(() => ({ actuators: [] as Actuator[] })),
    ]);
    setDevices(d.devices);
    setActuators(a.actuators.filter((x) => x.driver === "dahua"));
    if (selectedId && !d.devices.some((x) => x.id === selectedId)) {
      setSelectedId(null);
      setMode("list");
    }
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  function startCreate() {
    setMode("create");
    setSelectedId(null);
    setForm(emptyForm());
    setTests([]);
    setMsg(null);
    setError(null);
  }

  function startEdit(d: Device) {
    const act = actuators.find((a) => a.dahuaDeviceId === d.id);
    setSelectedId(d.id);
    setMode("edit");
    setForm({
      name: d.name,
      host: d.host,
      port: String(d.port),
      username: d.username,
      password: "",
      actuatorName: act?.name ?? d.name,
      kind: act?.kind ?? "door",
    });
    setTests([]);
    setMsg(null);
    setError(null);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !canEdit) return;
    setBusy("save");
    setError(null);
    setMsg(null);
    try {
      if (mode === "create") {
        await api(t("/api/dahua"), {
          method: "POST",
          body: JSON.stringify({
            name: form.name,
            host: form.host,
            port: Number(form.port) || 80,
            username: form.username,
            password: form.password,
            actuatorName: form.actuatorName || form.name,
            kind: form.kind,
          }),
        });
        setMsg("Equipo agregado.");
        setMode("list");
        setForm(emptyForm());
      } else if (mode === "edit" && selectedId) {
        await api(t(`/api/dahua/${selectedId}`), {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name,
            host: form.host,
            port: Number(form.port) || 80,
            username: form.username,
            password: form.password || undefined,
            actuatorName: form.actuatorName || form.name,
            kind: form.kind,
          }),
        });
        setMsg("Equipo actualizado.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (!tenantId || !selectedId || !canEdit) return;
    if (!confirm("¿Borrar este equipo y su actuador vinculado?")) return;
    setBusy("delete");
    setError(null);
    try {
      await api(t(`/api/dahua/${selectedId}`), { method: "DELETE" });
      setMsg("Equipo borrado.");
      setSelectedId(null);
      setMode("list");
      setForm(emptyForm());
      setTests([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar");
    } finally {
      setBusy(null);
    }
  }

  async function runTest(action: "probe" | "door_status" | "open" | "snapshot") {
    if (!tenantId || !selectedId) return;
    if (action === "open" && !canOpen) {
      setError("Sin permiso para abrir puerta");
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const r = await api<{
        ok: boolean;
        error?: string;
        result?: {
          ok?: boolean;
          error?: string;
          deviceType?: string;
          serial?: string;
          status?: string;
          response?: string;
          imageBase64?: string;
          contentType?: string;
          bytes?: number;
        };
      }>(t(`/api/dahua/${selectedId}/test`), {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      const res = r.result;
      let detail = r.error || res?.error || (r.ok ? "OK" : "Falló");
      let imageSrc: string | undefined;
      if (action === "probe" && res?.deviceType) {
        detail = `${res.deviceType}${res.serial ? ` · ${res.serial}` : ""}`;
      }
      if (action === "door_status" && res?.status) detail = `Puerta: ${res.status}`;
      if (action === "open" && res?.response) detail = res.response;
      if (action === "snapshot" && res?.imageBase64) {
        detail = `Foto ${res.bytes ?? ""} bytes`;
        imageSrc = `data:${res.contentType || "image/jpeg"};base64,${res.imageBase64}`;
      }
      setTests((prev) => [{ action, ok: Boolean(r.ok && (res?.ok !== false)), detail, imageSrc }, ...prev].slice(0, 8));
      if (!r.ok) setError(detail);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Fallo la prueba";
      setTests((prev) => [{ action, ok: false, detail }, ...prev].slice(0, 8));
      setError(detail);
    } finally {
      setBusy(null);
    }
  }

  if (!tenantId) return <p className="text-sm text-muted">Elegí un barrio.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Equipos</h2>
          <p className="mt-1 text-sm text-muted">
            Terminales de acceso (ASI). La IP tiene que ser la del lector, no de una cámara CCTV.
          </p>
          <p className="mt-1 text-[12px] text-muted">
            Agent Dahua:{" "}
            <span className={status.agentOnline ? "text-ok" : "text-danger"}>
              {status.agentOnline ? "en línea" : "offline — hace falta para probar"}
            </span>
          </p>
        </div>
        {canEdit && mode === "list" ? (
          <button type="button" className="btn-primary" onClick={startCreate}>
            Agregar equipo
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {msg ? <p className="text-sm text-ok">{msg}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-line pb-4 lg:border-b-0 lg:border-r lg:pr-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Lista</p>
          {devices.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay equipos.</p>
          ) : (
            <ul className="space-y-1">
              {devices.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className={`w-full rounded-md px-2.5 py-2 text-left text-[13px] ${
                      selectedId === d.id ? "bg-panel2 text-[#f2f2f2]" : "text-muted hover:bg-panel2/50 hover:text-[#d8d8d8]"
                    }`}
                    onClick={() => startEdit(d)}
                  >
                    <span className="block font-medium text-[#e6e6e6]">{d.name}</span>
                    <span className="text-[11px]">
                      {d.host}:{d.port}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="min-w-0 space-y-6">
          {mode === "list" && !selected ? (
            <p className="text-sm text-muted">Elegí un equipo o agregá uno nuevo.</p>
          ) : null}

          {(mode === "create" || mode === "edit") && canEdit ? (
            <form onSubmit={onSave} className="space-y-3 border-b border-line pb-6">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                {mode === "create" ? "Nuevo equipo" : "Editar equipo"}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nombre" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
                <Field
                  label="Actuador vinculado"
                  value={form.actuatorName}
                  placeholder="Puerta peatonal"
                  onChange={(v) => setForm({ ...form, actuatorName: v })}
                />
                <Field label="IP / host" value={form.host} onChange={(v) => setForm({ ...form, host: v })} required />
                <Field label="Puerto" value={form.port} onChange={(v) => setForm({ ...form, port: v })} />
                <Field label="Usuario" value={form.username} onChange={(v) => setForm({ ...form, username: v })} required />
                <Field
                  label={mode === "edit" ? "Clave (dejar vacío para no cambiar)" : "Clave"}
                  value={form.password}
                  type="password"
                  onChange={(v) => setForm({ ...form, password: v })}
                  required={mode === "create"}
                />
                <label className="text-sm sm:col-span-2">
                  <span className="cfg-label">Tipo de actuador</span>
                  <select
                    className="cfg-input"
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value })}
                  >
                    <option value="door">Puerta</option>
                    <option value="gate">Portón</option>
                    <option value="barrier">Barrera</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn-primary" disabled={busy === "save"}>
                  {busy === "save" ? "Guardando…" : mode === "create" ? "Crear" : "Guardar cambios"}
                </button>
                {mode === "edit" ? (
                  <button type="button" className="btn-danger" disabled={busy === "delete"} onClick={onDelete}>
                    {busy === "delete" ? "…" : "Borrar"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setMode("list");
                    setForm(emptyForm());
                    setSelectedId(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : null}

          {selected && mode === "edit" ? (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Probar funciones</p>
              <p className="mt-1 text-[13px] text-muted">
                {selected.name}
                {selectedAct ? ` · actuador «${selectedAct.name}»` : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={!!busy || !status.agentOnline}
                  onClick={() => runTest("probe")}
                >
                  {busy === "probe" ? "…" : "1. Conexión / modelo"}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={!!busy || !status.agentOnline}
                  onClick={() => runTest("door_status")}
                >
                  {busy === "door_status" ? "…" : "2. Estado puerta"}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={!!busy || !status.agentOnline || !canOpen}
                  onClick={() => runTest("open")}
                >
                  {busy === "open" ? "…" : "3. Abrir puerta"}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={!!busy || !status.agentOnline}
                  onClick={() => runTest("snapshot")}
                >
                  {busy === "snapshot" ? "…" : "4. Foto cámara"}
                </button>
              </div>

              {tests.length > 0 ? (
                <ul className="mt-4 space-y-3">
                  {tests.map((trow, i) => (
                    <li key={`${trow.action}-${i}`} className="border-b border-line pb-3 text-sm">
                      <p>
                        <span className={trow.ok ? "text-ok" : "text-danger"}>{trow.ok ? "OK" : "Error"}</span>
                        <span className="ml-2 text-muted">{labelAction(trow.action)}</span>
                      </p>
                      <p className="mt-0.5 text-[#d0d0d0]">{trow.detail}</p>
                      {trow.imageSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={trow.imageSrc} alt="Snapshot" className="mt-2 max-h-48 rounded-md border border-line" />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[13px] text-muted">Todavía no corriste ninguna prueba.</p>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function labelAction(action: string) {
  if (action === "probe") return "Conexión";
  if (action === "door_status") return "Estado puerta";
  if (action === "open") return "Abrir";
  if (action === "snapshot") return "Foto";
  return action;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm">
      <span className="cfg-label">{label}</span>
      <input
        className="cfg-input"
        value={value}
        type={type}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
