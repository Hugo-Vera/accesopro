"use client";

import { useDash } from "@/components/DashboardProvider";
import { PageHeader } from "@/components/PageHeader";
import { ServerUpdatePanel } from "@/components/ServerUpdatePanel";

export function ConfigPage() {
  const { plan, plans, modules, features, isPlatform, toggleModule, toggleFeature, assignPlan, can } = useDash();
  const canToggleFeatures = isPlatform || can("core.config");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Módulos y Plan"
        subtitle="Gestión del plan comercial, módulos contratados y funciones operativas del barrio."
      />

      <ServerUpdatePanel />

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 flex flex-col gap-1 border-b border-slate-200 pb-4 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Plan Comercial del Barrio
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isPlatform
              ? "El plan comercial define el techo de contratación y límites del predio. Luego seleccioná qué módulos del plan utiliza este barrio."
              : "Detalle del plan activo contratado por el barrio."}
          </p>
        </div>

        {isPlatform ? (
          <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/50">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Seleccionar o Asignar Plan
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                value={plan?.id ?? ""}
                onChange={(e) => {
                  if (e.target.value) assignPlan(e.target.value).catch(() => null);
                }}
              >
                <option value="" disabled>
                  Elegí un plan…
                </option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {plan ? (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {plan.summary} · hasta {plan.limits.maxGuards} guardias · {plan.limits.maxProperties} lotes
                </p>
              ) : (
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  Sin plan asignado. Asigná uno para habilitar módulos.
                </p>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {plans.map((p) => {
                const isSelected = plan?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`rounded-lg border p-3.5 text-left transition-all ${
                      isSelected
                        ? "border-indigo-600 bg-indigo-50/70 shadow-sm dark:border-indigo-500 dark:bg-indigo-950/40"
                        : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                    }`}
                    onClick={() => assignPlan(p.id).catch(() => null)}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-sm font-semibold ${
                          isSelected ? "text-indigo-900 dark:text-indigo-200" : "text-slate-900 dark:text-white"
                        }`}
                      >
                        {p.name}
                      </span>
                      {isSelected ? (
                        <span className="h-2 w-2 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                      ) : null}
                    </div>
                    <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                      {p.moduleKeys.join(", ") || "Solo núcleo"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : plan ? (
          <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-sm text-slate-800 dark:text-slate-200">
              Plan activo: <span className="font-semibold text-slate-900 dark:text-white">{plan.name}</span>
              <span className="text-slate-500 dark:text-slate-400"> — {plan.summary}</span>
            </p>
          </div>
        ) : null}

        <div className="space-y-6">
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Módulos del Sistema
            </h3>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {modules
                .filter((m) => isPlatform || m.enabled)
                .filter((m) => m.key !== "alpr")
                .map((m) => {
                  const locked = isPlatform && !m.alwaysOn && m.inPlan === false;
                  return (
                    <li
                      key={m.key}
                      className={`flex items-center justify-between gap-4 px-4 py-3.5 transition-colors ${
                        locked ? "opacity-50" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-900 dark:text-white">{m.name}</p>
                          {locked ? (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                              Fuera de plan
                            </span>
                          ) : null}
                          {m.alwaysOn ? (
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                              Core
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{m.summary}</p>
                      </div>

                      {isPlatform ? (
                        <label className="relative flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={m.enabled}
                            disabled={m.alwaysOn || locked}
                            onChange={(e) => toggleModule(m.key, e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
                          />
                          <span>{m.alwaysOn ? "Siempre" : m.enabled ? "Habilitado" : "Deshabilitado"}</span>
                        </label>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                          Activo
                        </span>
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>

          {features.some((f) => f.parentOn) ? (
            <div className="border-t border-slate-200 pt-6 dark:border-slate-800">
              <div className="mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Funciones del Equipo (Feature Packs)
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  El administrador del barrio tilda las funciones específicas a utilizar (eventos, gestión de personas, QR, etc.).
                </p>
              </div>

              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                {features
                  .filter((f) => f.parentOn)
                  .map((f) => (
                    <li
                      key={f.key}
                      className="flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-900 dark:text-white">{f.name}</p>
                          <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">{f.key}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{f.summary}</p>
                      </div>

                      <label className="relative flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={f.enabled}
                          disabled={!canToggleFeatures}
                          onChange={(e) => toggleFeature(f.key, e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
                        />
                        <span className={f.enabled ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500"}>
                          {f.enabled ? "On" : "Off"}
                        </span>
                      </label>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
