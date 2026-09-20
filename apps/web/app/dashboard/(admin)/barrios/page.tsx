"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { CapabilityGate, PageHeader } from "@/components/PageHeader";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { Building2, Copy, ExternalLink, Plus, RefreshCw, X } from "lucide-react";

type Snapshot = {
  tenantName: string | null;
  lots: number;
  ownersPending: number;
  ownersActive: number;
  familyMembers: number;
  visitsInSite: number;
  pendingApprovals: number;
  eventsToday: number;
  lastEventAt: number | null;
};

type HubSite = {
  id: string;
  name: string;
  slug: string;
  planId: string;
  planName: string;
  baseUrl: string;
  cloudUrl: string | null;
  adminName: string;
  adminEmail: string;
  status: string;
  lastSeenAt: string | number | null;
  snapshot: Snapshot | null;
  createdAt: string | number;
};

type PlanOpt = { id: string; name: string; summary: string };

const emptyForm = {
  name: "",
  planId: "",
  adminName: "",
  adminEmail: "",
  adminPassword: "",
  baseUrl: "",
  cloudUrl: "",
};

function statusLabel(s: string) {
  if (s === "online") return "En línea";
  if (s === "offline") return "Sin enlace";
  return "Pendiente";
}

function fmtSeen(v: string | number | Date | null | undefined) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

export default function BarriosPage() {
  const { isPlatform, plans } = useDash();
  const [rows, setRows] = useState<HubSite[]>([]);
  const [catalog, setCatalog] = useState<PlanOpt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [created, setCreated] = useState<{
    hubToken: string;
    adminEmail: string;
    adminPassword: string;
    bootstrapError: string | null;
    site: HubSite;
  } | null>(null);

  useEscapeKey(() => {
    if (created) setCreated(null);
    else setShowNew(false);
  }, showNew || Boolean(created));

  const load = useCallback(async () => {
    if (!isPlatform) return;
    try {
      const d = await api<{ sites: HubSite[] }>("/api/hub/sites");
      setRows(d.sites || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo listar");
    }
  }, [isPlatform]);

  useEffect(() => {
    load().catch(() => null);
    const t = window.setInterval(() => {
      load().catch(() => null);
    }, 10000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (plans?.length) {
      setCatalog(plans.map((p) => ({ id: p.id, name: p.name, summary: p.summary })));
      return;
    }
    api<{ plans: PlanOpt[] }>("/api/plans")
      .then((d) => setCatalog(d.plans || []))
      .catch(() => null);
  }, [plans]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await api<{
        site: HubSite;
        hubToken: string;
        adminEmail: string;
        adminPassword: string;
        bootstrapError: string | null;
      }>("/api/hub/sites", { method: "POST", body: JSON.stringify(form) });
      setCreated({
        hubToken: d.hubToken,
        adminEmail: d.adminEmail,
        adminPassword: d.adminPassword,
        bootstrapError: d.bootstrapError,
        site: d.site,
      });
      setShowNew(false);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear");
    } finally {
      setBusy(false);
    }
  }

  async function refreshOne(id: string) {
    setBusy(true);
    try {
      await api(`/api/hub/sites/${id}/refresh`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo consultar");
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
  }

  const openUrl = (row: HubSite) => row.baseUrl || row.cloudUrl || "";

  return (
    <CapabilityGate capability="platform.tenants">
      <PageHeader
        title="Barrios"
        subtitle="Concentrador: cada predio tiene su SQLite. Esta lista consulta en vivo lo que cada Ubuntu tiene cargado."
        actions={
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Nuevo barrio
          </button>
        }
      />

      {error ? (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Barrio</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Lotes</th>
                <th className="px-4 py-3">Propietarios</th>
                <th className="px-4 py-3">Familia</th>
                <th className="px-4 py-3">Visitas / eventos</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                    <Building2 className="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm font-medium">No hay predios en el concentrador</p>
                    <p className="mt-0.5 text-xs text-slate-400">Dá de alta el Ubuntu del barrio y su administrador.</p>
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const snap = r.snapshot;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900 dark:text-white">{r.name}</p>
                        <p className="text-[11px] text-slate-500">{r.adminEmail}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{r.planName}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                            r.status === "online"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                              : r.status === "offline"
                                ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                                : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                          }`}
                        >
                          {statusLabel(r.status)}
                        </span>
                        {fmtSeen(r.lastSeenAt) ? (
                          <p className="mt-1 text-[10px] text-slate-400">Último snapshot {fmtSeen(r.lastSeenAt)}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-medium">{snap?.lots ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                        {snap ? `${snap.ownersActive} activos / ${snap.ownersPending} pend.` : "—"}
                      </td>
                      <td className="px-4 py-3">{snap?.familyMembers ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                        {snap ? `${snap.visitsInSite} en predio · ${snap.eventsToday} ev. hoy` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => refreshOne(r.id)}
                            disabled={busy}
                            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                            title="Consultar ahora"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </button>
                          {openUrl(r) ? (
                            <a
                              href={openUrl(r)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-50 dark:border-slate-600 dark:text-sky-300"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Abrir predio
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showNew ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div
            className="relative w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            role="dialog"
            aria-labelledby="hub-new-title"
          >
            <div className="mb-4 flex items-start justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h2 id="hub-new-title" className="font-bold text-slate-900 dark:text-white">
                  Nuevo barrio
                </h2>
                <p className="text-xs text-slate-500">Alta en el concentrador. La base vive en el Ubuntu del predio.</p>
              </div>
              <button type="button" onClick={() => setShowNew(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={onCreate} className="space-y-3">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Nombre del barrio
                <input
                  className="cfg-input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </label>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Plan contratado
                <select
                  className="cfg-input"
                  value={form.planId}
                  onChange={(e) => setForm((f) => ({ ...f, planId: e.target.value }))}
                  required
                >
                  <option value="" disabled>
                    Seleccionar
                  </option>
                  {catalog.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Nombre del administrador
                  <input
                    className="cfg-input"
                    value={form.adminName}
                    onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))}
                    required
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Email
                  <input
                    className="cfg-input"
                    type="email"
                    value={form.adminEmail}
                    onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
                    autoComplete="off"
                    required
                  />
                </label>
              </div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Clave inicial
                <input
                  className="cfg-input"
                  type="password"
                  value={form.adminPassword}
                  onChange={(e) => setForm((f) => ({ ...f, adminPassword: e.target.value }))}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                URL LAN (garita)
                <input
                  className="cfg-input"
                  value={form.baseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                />
              </label>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                URL pública (si la LAN no responde)
                <input
                  className="cfg-input"
                  value={form.cloudUrl}
                  onChange={(e) => setForm((f) => ({ ...f, cloudUrl: e.target.value }))}
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowNew(false)} className="btn-ghost">
                  Cancelar
                </button>
                <button type="submit" disabled={busy} className="btn-primary">
                  {busy ? "Creando…" : "Crear"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {created ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-bold text-slate-900 dark:text-white">Barrio registrado</h2>
            <p className="mt-1 text-xs text-slate-500">Copiá estos datos ahora. El token no vuelve a mostrarse.</p>
            {created.bootstrapError ? (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
                Predio aún no alcanzó: {created.bootstrapError}. En el Ubuntu: ACCESOPRO_HUB_TOKEN y después Verificar.
              </p>
            ) : (
              <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">Bootstrap enviado al Ubuntu.</p>
            )}
            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="text-[11px] font-semibold uppercase text-slate-500">Admin</dt>
                <dd className="flex items-center justify-between gap-2 font-mono text-xs">
                  {created.adminEmail}
                  <button type="button" onClick={() => copy(created.adminEmail)} className="btn-ghost p-1">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase text-slate-500">Clave</dt>
                <dd className="flex items-center justify-between gap-2 font-mono text-xs">
                  {created.adminPassword}
                  <button type="button" onClick={() => copy(created.adminPassword)} className="btn-ghost p-1">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase text-slate-500">ACCESOPRO_HUB_TOKEN</dt>
                <dd className="flex items-center justify-between gap-2 break-all font-mono text-[11px]">
                  {created.hubToken}
                  <button type="button" onClick={() => copy(created.hubToken)} className="btn-ghost p-1">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex justify-end">
              <button type="button" className="btn-primary" onClick={() => setCreated(null)}>
                Listo
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </CapabilityGate>
  );
}
