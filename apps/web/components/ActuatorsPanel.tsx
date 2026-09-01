"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";

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

const KIND: Record<string, string> = { door: "Puerta", gate: "Portón", barrier: "Barrera" };
const DRIVER: Record<string, string> = { engine: "Motor LAN", dahua: "Dahua", ip: "IP" };

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
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const t = (path: string) => withTenant(path, tenantId);

  async function load() {
    if (!tenantId) return;
    const [a, d] = await Promise.all([
      api<{ actuators: Actuator[] }>(t("/api/actuators")),
      api<{ devices: Device[] }>(t("/api/dahua")).catch(() => ({ devices: [] as Device[] })),
    ]);
    setRows(a.actuators);
    setDevices(d.devices);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Error"));
    const id = setInterval(() => load().catch(() => null), 4000);
    return () => clearInterval(id);
  }, [tenantId]);

  function startEdit(row: Actuator) {
    setEditing(row.id);
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
  }

  function payload() {
    return {
      name: form.name,
      kind: form.kind,
      driver: form.driver,
      engineSentido: form.driver === "engine" ? form.engineSentido : null,
      dahuaDeviceId: form.driver === "dahua" ? form.dahuaDeviceId : null,
      dahuaChannel: Number(form.dahuaChannel) || 1,
      httpUrl: form.driver === "ip" ? form.httpUrl : null,
      pulseMs: Number(form.pulseMs) || 1000,
    };
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (!tenantId) return;
    setBusy("save");
    setError(null);
    try {
      if (editing) {
        await api(t(`/api/actuators/${editing}`), { method: "PATCH", body: JSON.stringify(payload()) });
      } else {
        await api(t("/api/actuators"), { method: "POST", body: JSON.stringify(payload()) });
      }
      setForm(emptyForm);
      setEditing(null);
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
      if (!r.ok) setError(r.error || "No se disparó");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se disparó");
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
      setError(err instanceof Error ? err.message : "No se pudo tildar");
    }
  }

  async function remove(id: string) {
    if (!tenantId) return;
    await api(t(`/api/actuators/${id}`), { method: "DELETE" });
    if (editing === id) {
      setEditing(null);
      setForm(emptyForm);
    }
    await load();
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <form onSubmit={onSubmit} className="card p-4">
        <div className="card-h -mx-4 -mt-4 mb-4">{editing ? "Editar actuador" : "Nuevo actuador"}</div>
        <p className="mb-4 text-sm text-muted">
          Agregá el relé y abajo tildá qué lo dispara: chapa, cara, QR o el botón Abrir.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="cfg-label">
            Nombre
            <input className="cfg-input" value={form.name} required placeholder="Barrera entrada" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="cfg-label">
            Tipo
            <select className="cfg-input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="barrier">Barrera</option>
              <option value="gate">Portón</option>
              <option value="door">Puerta</option>
            </select>
          </label>
          <label className="cfg-label">
            Driver
            <select className="cfg-input" value={form.driver} onChange={(e) => setForm({ ...form, driver: e.target.value })}>
              <option value="engine">Motor LAN (AccesoSeguro)</option>
              <option value="dahua">Dahua (openDoor)</option>
              <option value="ip">IP / HTTP</option>
            </select>
          </label>
          {form.driver === "engine" ? (
            <label className="cfg-label">
              Lado del motor
              <select className="cfg-input" value={form.engineSentido} onChange={(e) => setForm({ ...form, engineSentido: e.target.value })}>
                <option value="in">Ingreso (IN)</option>
                <option value="out">Salida (OUT)</option>
              </select>
            </label>
          ) : null}
          {form.driver === "dahua" ? (
            <>
              <label className="cfg-label">
                Equipo Dahua
                <select className="cfg-input" value={form.dahuaDeviceId} onChange={(e) => setForm({ ...form, dahuaDeviceId: e.target.value })}>
                  <option value="">Elegí equipo</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {d.host}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cfg-label">
                Canal openDoor
                <input className="cfg-input" value={form.dahuaChannel} onChange={(e) => setForm({ ...form, dahuaChannel: e.target.value })} />
              </label>
            </>
          ) : null}
          {form.driver === "ip" ? (
            <label className="cfg-label sm:col-span-2">
              URL abrir
              <input className="cfg-input" value={form.httpUrl} placeholder="http://192.168.1.50/open" onChange={(e) => setForm({ ...form, httpUrl: e.target.value })} />
            </label>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {editing ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setEditing(null);
                setForm(emptyForm);
              }}
            >
              Cancelar
            </button>
          ) : null}
          <button type="submit" disabled={busy === "save"} className="rounded-[10px] bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">
            {busy === "save" ? "Guardando…" : editing ? "Guardar cambios" : "Agregar actuador"}
          </button>
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">Todavía no hay actuadores.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((a) => (
            <li key={a.id} className={`relay-card ${a.open ? "open" : ""}`}>
              <div className={`relay-icon ${a.open ? "on" : ""}`}>{a.open ? "ON" : "OFF"}</div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{a.name}</p>
                <p className="text-xs text-muted">
                  {KIND[a.kind] ?? a.kind} · {DRIVER[a.driver] ?? a.driver}
                  {a.driver === "engine" ? ` · ${a.engineSentido === "out" ? "OUT" : "IN"}` : ""}
                  {a.driver === "dahua" ? ` · canal ${a.dahuaChannel}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={!!a.triggerManual} onChange={(e) => setTrigger(a, "triggerManual", e.target.checked)} />
                    Botón
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={!!a.triggerAlpr} onChange={(e) => setTrigger(a, "triggerAlpr", e.target.checked)} />
                    Chapa
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={!!a.triggerDahua} onChange={(e) => setTrigger(a, "triggerDahua", e.target.checked)} />
                    Cara Dahua
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={!!a.triggerQr} onChange={(e) => setTrigger(a, "triggerQr", e.target.checked)} />
                    QR / DNI
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className="btn-ok" disabled={!!busy} onClick={() => fire(a.id, "open")}>
                  {busy === `open-${a.id}` ? "…" : "Abrir"}
                </button>
                {a.driver === "engine" ? (
                  <button type="button" className="btn-danger" disabled={!!busy} onClick={() => fire(a.id, "close")}>
                    {busy === `close-${a.id}` ? "…" : "Cerrar"}
                  </button>
                ) : null}
                <button type="button" className="btn-ghost" onClick={() => startEdit(a)}>
                  Editar
                </button>
                <button type="button" className="btn-ghost text-muted" onClick={() => remove(a.id)}>
                  Quitar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
