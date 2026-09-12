"use client";

import { FormEvent, useEffect, useState } from "react";
import { Plus, Settings2, Trash2, X, Cable, DoorOpen } from "lucide-react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";

type WireAct = { actuatorId: string; role: string; name?: string; kind?: string; driver?: string };
type WireDev = { dahuaDeviceId: string; role: string; name?: string; deviceType?: string };
type WireCam = { cameraId: string; role: string; sentido: string | null; name?: string };

type AccessPoint = {
  id: string;
  name: string;
  sector: string;
  sentido: string;
  sortOrder: number;
  enabled: boolean;
  notes: string | null;
  actuators: WireAct[];
  devices: WireDev[];
  cameras: WireCam[];
};

type Meta = {
  sectors: Array<{ key: string; name: string }>;
  sentidos: Array<{ key: string; name: string }>;
  actuatorRoles: Array<{ key: string; name: string }>;
  deviceRoles: Array<{ key: string; name: string }>;
  cameraRoles: Array<{ key: string; name: string }>;
};

type Option = { id: string; name: string };

const emptyForm = {
  name: "",
  sector: "vehicular",
  sentido: "in",
  sortOrder: "10",
  enabled: true,
  notes: "",
};

export function AccessPointsPanel() {
  const { tenantId } = useDash();
  const [rows, setRows] = useState<AccessPoint[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [actuators, setActuators] = useState<Option[]>([]);
  const [devices, setDevices] = useState<Option[]>([]);
  const [cameras, setCameras] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [pickedActs, setPickedActs] = useState<Array<{ actuatorId: string; role: string }>>([]);
  const [pickedDevs, setPickedDevs] = useState<Array<{ dahuaDeviceId: string; role: string }>>([]);
  const [pickedCams, setPickedCams] = useState<Array<{ cameraId: string; role: string }>>([]);

  useEscapeKey(() => setShowModal(false), showModal);

  const t = (path: string) => withTenant(path, tenantId);

  async function load() {
    if (!tenantId) return;
    const [points, m, a, d, cams] = await Promise.all([
      api<{ accessPoints: AccessPoint[] }>(t("/api/access-points")),
      api<Meta>(t("/api/access-points/meta")),
      api<{ actuators: Option[] }>(t("/api/actuators")).catch(() => ({ actuators: [] as Option[] })),
      api<{ devices: Option[] }>(t("/api/dahua")).catch(() => ({ devices: [] as Option[] })),
      api<{ cameras: Option[] }>(t("/api/cameras")).catch(() => ({ cameras: [] as Option[] })),
    ]);
    setRows(points.accessPoints || []);
    setMeta(m);
    setActuators(a.actuators || []);
    setDevices(d.devices || []);
    setCameras(cams.cameras || []);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setPickedActs([]);
    setPickedDevs([]);
    setPickedCams([]);
    setShowModal(true);
  }

  function openEdit(row: AccessPoint) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      sector: row.sector,
      sentido: row.sentido,
      sortOrder: String(row.sortOrder ?? 0),
      enabled: row.enabled !== false,
      notes: row.notes || "",
    });
    setPickedActs(row.actuators.map((w) => ({ actuatorId: w.actuatorId, role: w.role || "primary" })));
    setPickedDevs(row.devices.map((w) => ({ dahuaDeviceId: w.dahuaDeviceId, role: w.role || "both" })));
    setPickedCams(row.cameras.map((w) => ({ cameraId: w.cameraId, role: w.role || "live" })));
    setShowModal(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: form.name.trim(),
        sector: form.sector,
        sentido: form.sentido,
        sortOrder: Number(form.sortOrder) || 0,
        enabled: form.enabled,
        notes: form.notes.trim() || null,
      };
      const wiring = {
        actuators: pickedActs,
        devices: pickedDevs,
        cameras: pickedCams,
      };
      if (editingId) {
        await api(t(`/api/access-points/${editingId}`), { method: "PUT", body: JSON.stringify(body) });
        await api(t(`/api/access-points/${editingId}/wiring`), {
          method: "PUT",
          body: JSON.stringify(wiring),
        });
      } else {
        await api(t("/api/access-points"), {
          method: "POST",
          body: JSON.stringify({ ...body, wiring }),
        });
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!tenantId) return;
    if (!window.confirm("¿Borrar este punto de acceso? El cableado se pierde; los equipos quedan.")) return;
    setBusy(true);
    try {
      await api(t(`/api/access-points/${id}`), { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar");
    } finally {
      setBusy(false);
    }
  }

  function toggleAct(id: string) {
    setPickedActs((prev) =>
      prev.some((w) => w.actuatorId === id)
        ? prev.filter((w) => w.actuatorId !== id)
        : [...prev, { actuatorId: id, role: "primary" }],
    );
  }

  function toggleDev(id: string) {
    setPickedDevs((prev) =>
      prev.some((w) => w.dahuaDeviceId === id)
        ? prev.filter((w) => w.dahuaDeviceId !== id)
        : [...prev, { dahuaDeviceId: id, role: "both" }],
    );
  }

  function toggleCam(id: string) {
    setPickedCams((prev) =>
      prev.some((w) => w.cameraId === id)
        ? prev.filter((w) => w.cameraId !== id)
        : [...prev, { cameraId: id, role: "live" }],
    );
  }

  const sectorName = (k: string) => meta?.sectors.find((s) => s.key === k)?.name ?? k;
  const sentidoName = (k: string) => meta?.sentidos.find((s) => s.key === k)?.name ?? k;

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nuevo punto
        </button>
      </div>
      {error ? <p className="mb-3 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2">Punto</th>
              <th className="px-4 py-2">Sector</th>
              <th className="px-4 py-2">Sentido</th>
              <th className="px-4 py-2">Cableado</th>
              <th className="px-4 py-2 text-right"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No hay puntos. Creá Ingreso y Salida y cableá el ASI y el relé.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                    {row.name}
                    {row.enabled === false ? (
                      <span className="ml-2 text-[10px] uppercase text-slate-400">apagado</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{sectorName(row.sector)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{sentidoName(row.sentido)}</td>
                  <td className="px-4 py-3 text-[12px] text-slate-500">
                    {row.devices.length} equipo{row.devices.length === 1 ? "" : "s"} · {row.actuators.length} relé
                    {row.actuators.length === 1 ? "" : "s"} · {row.cameras.length} cámara
                    {row.cameras.length === 1 ? "" : "s"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="mr-2 inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[12px] dark:border-slate-600"
                      onClick={() => openEdit(row)}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Configurar
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-[12px] text-rose-600 dark:border-rose-900 dark:text-rose-400"
                      onClick={() => void onDelete(row.id)}
                      disabled={busy}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <form
            onSubmit={onSubmit}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
                <Cable className="h-5 w-5" />
                {editingId ? "Configurar punto" : "Nuevo punto de acceso"}
              </h2>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-slate-500">Nombre</span>
                <input
                  className="cfg-input w-full"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ingreso vehicular"
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-500">Sector</span>
                <select
                  className="cfg-input w-full"
                  value={form.sector}
                  onChange={(e) => setForm({ ...form, sector: e.target.value })}
                >
                  {(meta?.sectors || []).map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-500">Sentido</span>
                <select
                  className="cfg-input w-full"
                  value={form.sentido}
                  onChange={(e) => setForm({ ...form, sentido: e.target.value })}
                >
                  {(meta?.sentidos || []).map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <p className="mt-5 mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">
              <DoorOpen className="h-3.5 w-3.5" /> Relés
            </p>
            <div className="space-y-1 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              {actuators.length === 0 ? (
                <p className="px-1 py-2 text-sm text-slate-500">No hay actuadores cargados.</p>
              ) : (
                actuators.map((a) => {
                  const picked = pickedActs.find((w) => w.actuatorId === a.id);
                  return (
                    <label key={a.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={!!picked} onChange={() => toggleAct(a.id)} />
                      <span className="flex-1 text-slate-800 dark:text-slate-200">{a.name}</span>
                      {picked ? (
                        <select
                          className="cfg-input w-28 text-[12px]"
                          value={picked.role}
                          onChange={(e) =>
                            setPickedActs((prev) =>
                              prev.map((w) => (w.actuatorId === a.id ? { ...w, role: e.target.value } : w)),
                            )
                          }
                        >
                          {(meta?.actuatorRoles || []).map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </label>
                  );
                })
              )}
            </div>

            <p className="mt-4 mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Lectores / equipos</p>
            <div className="space-y-1 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              {devices.length === 0 ? (
                <p className="px-1 py-2 text-sm text-slate-500">No hay equipos Dahua.</p>
              ) : (
                devices.map((d) => {
                  const picked = pickedDevs.find((w) => w.dahuaDeviceId === d.id);
                  return (
                    <label key={d.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={!!picked} onChange={() => toggleDev(d.id)} />
                      <span className="flex-1 text-slate-800 dark:text-slate-200">{d.name}</span>
                      {picked ? (
                        <select
                          className="cfg-input w-36 text-[12px]"
                          value={picked.role}
                          onChange={(e) =>
                            setPickedDevs((prev) =>
                              prev.map((w) => (w.dahuaDeviceId === d.id ? { ...w, role: e.target.value } : w)),
                            )
                          }
                        >
                          {(meta?.deviceRoles || []).map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </label>
                  );
                })
              )}
            </div>

            <p className="mt-4 mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Cámaras</p>
            <div className="space-y-1 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              {cameras.length === 0 ? (
                <p className="px-1 py-2 text-sm text-slate-500">No hay cámaras cargadas.</p>
              ) : (
                cameras.map((cam) => {
                  const picked = pickedCams.find((w) => w.cameraId === cam.id);
                  return (
                    <label key={cam.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                      <input type="checkbox" checked={!!picked} onChange={() => toggleCam(cam.id)} />
                      <span className="flex-1 text-slate-800 dark:text-slate-200">{cam.name}</span>
                      {picked ? (
                        <select
                          className="cfg-input w-28 text-[12px]"
                          value={picked.role}
                          onChange={(e) =>
                            setPickedCams((prev) =>
                              prev.map((w) => (w.cameraId === cam.id ? { ...w, role: e.target.value } : w)),
                            )
                          }
                        >
                          {(meta?.cameraRoles || []).map((r) => (
                            <option key={r.key} value={r.key}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </label>
                  );
                })
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-md border border-slate-300 px-4 py-2 text-sm dark:border-slate-600" onClick={() => setShowModal(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
