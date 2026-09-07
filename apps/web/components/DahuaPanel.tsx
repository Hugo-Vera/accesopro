"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";

type Device = { id: string; name: string; host: string; port: number; username: string };
type Actuator = { id: string; name: string; kind: string; driver: string; dahuaDeviceId: string | null };
type EventRow = {
  id: string;
  type: string;
  createdAt: string | number;
  payload: Record<string, string>;
};

export function DahuaPanel({ tenantId }: { tenantId: string }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [actuators, setActuators] = useState<Actuator[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    host: "",
    port: "80",
    username: "admin",
    password: "",
    actuatorName: "",
    kind: "door",
  });

  const t = (path: string) => withTenant(path, tenantId);

  async function load() {
    const [d, a, e] = await Promise.all([
      api<{ devices: Device[] }>(t("/api/dahua")),
      api<{ actuators: Actuator[] }>(t("/api/actuators")),
      api<{ events: EventRow[] }>(t("/api/events?type=dahua_access&limit=24")),
    ]);
    setDevices(d.devices);
    setActuators(a.actuators.filter((x) => x.driver === "dahua"));
    setEvents(e.events);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Error"));
    const id = setInterval(() => load().catch(() => null), 4000);
    return () => clearInterval(id);
  }, [tenantId]);

  async function onCreate(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    setBusy("create");
    try {
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
      setForm({ ...form, password: "", name: "", host: "", actuatorName: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(null);
    }
  }

  async function probe(id: string) {
    setError(null);
    setBusy(id);
    try {
      const r = await api<{ ok: boolean; result?: { deviceType?: string; error?: string }; error?: string }>(
        t(`/api/dahua/${id}/probe`),
        { method: "POST" },
      );
      if (!r.ok) setError(r.error || r.result?.error || "No respondió el equipo");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fallo el test");
    } finally {
      setBusy(null);
    }
  }

  async function openActuator(id: string) {
    setError(null);
    setBusy(id);
    try {
      const r = await api<{ ok: boolean; error?: string }>(t(`/api/actuators/${id}/open`), { method: "POST" });
      if (!r.ok) setError(r.error || "No se abrió");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se abrió");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    await api(t(`/api/dahua/${id}`), { method: "DELETE" });
    await load();
  }

  const methodLabel: Record<string, string> = {
    "0": "clave",
    "1": "tarjeta",
    "6": "huella",
    "15": "facial",
  };

  return (
    <section className="space-y-5">
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <form onSubmit={onCreate} className="grid gap-3 rounded-2xl border border-line bg-panel p-6 sm:grid-cols-2">
        <Field label="Nombre del equipo" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <Field
          label="Nombre del actuador"
          value={form.actuatorName}
          placeholder="Puerta peatonal"
          onChange={(v) => setForm({ ...form, actuatorName: v })}
        />
        <Field label="IP / host" value={form.host} placeholder="192.168.1.110" onChange={(v) => setForm({ ...form, host: v })} />
        <Field label="Puerto" value={form.port} onChange={(v) => setForm({ ...form, port: v })} />
        <Field label="Usuario" value={form.username} onChange={(v) => setForm({ ...form, username: v })} />
        <Field label="Clave" value={form.password} type="password" onChange={(v) => setForm({ ...form, password: v })} />
        <label className="text-sm sm:col-span-2">
          Tipo
          <select
            className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
          >
            <option value="door">Puerta</option>
            <option value="gate">Portón</option>
            <option value="barrier">Barrera</option>
          </select>
        </label>
        <button
          disabled={busy === "create"}
          className="sm:col-span-2 rounded-lg bg-accent py-2 font-medium text-white disabled:opacity-60"
        >
          {busy === "create" ? "Guardando…" : "Agregar equipo"}
        </button>
      </form>

      <ul className="divide-y divide-line rounded-2xl border border-line bg-panel px-6">
        {devices.map((d) => {
          const act = actuators.find((a) => a.dahuaDeviceId === d.id);
          return (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="font-medium">{d.name}</p>
                <p className="text-xs text-slate-400">
                  {d.host}:{d.port}
                  {act ? ` · ${act.name}` : ""}
                </p>
              </div>
              <div className="flex gap-2 text-sm">
                <button className="rounded-md border border-line px-2 py-1" onClick={() => probe(d.id)} disabled={!!busy}>
                  Probar
                </button>
                {act ? (
                  <button
                    className="rounded-md border border-accent px-2 py-1 text-accent"
                    onClick={() => openActuator(act.id)}
                    disabled={!!busy}
                  >
                    Abrir
                  </button>
                ) : null}
                <button className="rounded-md border border-line px-2 py-1 text-slate-400" onClick={() => remove(d.id)}>
                  Quitar
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="rounded-2xl border border-line bg-panel p-6">
        <h2 className="text-sm font-medium text-slate-300">Últimos accesos</h2>
        <ul className="mt-2 max-h-56 overflow-auto text-sm space-y-1">
          {events.length === 0 ? <li className="text-slate-500">Todavía no hay eventos.</li> : null}
          {events.map((e) => (
            <li key={e.id} className="flex justify-between gap-3 text-slate-300">
              <span>
                {e.payload.deviceName ?? "Dahua"} · {methodLabel[e.payload.Method] ?? e.payload.Method ?? "acceso"}
                {e.payload.UserID ? ` · user ${e.payload.UserID}` : ""}
                {e.payload.Status === "0" ? " · falló" : ""}
              </span>
              <span className="text-xs text-slate-500">{when(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="text-sm">
      {label}
      <input
        className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
        value={value}
        type={type}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function when(v: string | number) {
  const d = typeof v === "number" ? new Date(v) : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}
