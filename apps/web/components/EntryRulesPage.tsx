"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ARRIVAL_MODE_CATALOG,
  ENTRY_RULE_GROUP_LABEL,
  ENTRY_RULE_ITEMS,
  VISIT_KIND_CATALOG,
  arrivalModeText,
  defaultEntryRule,
  entryRuleSummary,
  normalizeEntryRule,
  visitKindText,
  type EntryRule,
  type EntryRuleGroup,
  type EntryRuleItemKey,
} from "@accesopro/catalog";
import { AlertCircle, Car, CheckCircle2, DoorClosed, DoorOpen, Footprints, RotateCcw, Settings2, X } from "lucide-react";
import { useDash } from "@/components/DashboardProvider";
import { CapabilityGate, ModuleGate, PageHeader } from "@/components/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { api } from "@/lib/api";

const GROUPS: EntryRuleGroup[] = ["identity", "vehicle", "person_insurance"];

function sameRule(a: EntryRule, b: EntryRule) {
  return a.openBarrier === b.openBarrier && ENTRY_RULE_ITEMS.every((i) => a.items[i.key] === b.items[i.key]);
}

export function EntryRulesPage() {
  const { tenantId } = useDash();
  const [rules, setRules] = useState<EntryRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<EntryRule | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ rules: EntryRule[] }>(`/api/tenants/${tenantId}/entry-rules`);
      setRules(res.rules || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las reglas");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaved = (rule: EntryRule) => {
    setRules((prev) => prev.map((r) => (r.visitKind === rule.visitKind && r.arrivalMode === rule.arrivalMode ? rule : r)));
    setEditing(null);
    setMsg(`Regla guardada: ${visitKindText(rule.visitKind)} · ${arrivalModeText(rule.arrivalMode)}`);
    setTimeout(() => setMsg(null), 4000);
  };

  return (
    <ModuleGate module="visitors">
      <CapabilityGate capability="core.config">
        <div className="space-y-6">
          <PageHeader
            title="Reglas de ingreso"
            subtitle="Qué documentos pide portería según el tipo de visita y cómo llega, y si al aprobar se abre la barrera."
          />

          {msg ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{msg}</span>
            </div>
          ) : null}
          {error ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Cómo llega</th>
                    <th className="px-4 py-3">Qué se pide</th>
                    <th className="px-4 py-3">Al aprobar</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loading && !rules.length ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                        Cargando reglas…
                      </td>
                    </tr>
                  ) : (
                    VISIT_KIND_CATALOG.flatMap((k) =>
                      ARRIVAL_MODE_CATALOG.map((m) => {
                        const rule =
                          rules.find((r) => r.visitKind === k.key && r.arrivalMode === m.key) ?? defaultEntryRule(k.key, m.key);
                        const custom = !sameRule(rule, defaultEntryRule(k.key, m.key));
                        return (
                          <tr key={`${k.key}-${m.key}`} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                            <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                              {k.label}
                              {custom ? (
                                <span className="ml-2 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                                  Personalizada
                                </span>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                              <span className="inline-flex items-center gap-1.5">
                                {m.key === "vehiculo" ? <Car className="h-3.5 w-3.5" /> : <Footprints className="h-3.5 w-3.5" />}
                                {m.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                              {entryRuleSummary(rule).join(" · ") || "Nada"}
                            </td>
                            <td className="px-4 py-3">
                              <BarrierBadge open={rule.openBarrier} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => setEditing(rule)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <Settings2 className="h-3.5 w-3.5" />
                                Configurar
                              </button>
                            </td>
                          </tr>
                        );
                      }),
                    )
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Obra / Servicio agrupa técnicos, contratistas y personal de servicio. Un documento vencido nunca pasa, aunque esté
            destildada la foto. Si la regla no abre la barrera, el guardia igual puede usar «Abrir igual» en la ficha.
          </p>
        </div>

        <RuleModal tenantId={tenantId} rule={editing} onClose={() => setEditing(null)} onSaved={onSaved} />
      </CapabilityGate>
    </ModuleGate>
  );
}

function BarrierBadge({ open }: { open: boolean }) {
  return open ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
      <DoorOpen className="h-3 w-3" /> Abre la barrera
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
      <DoorClosed className="h-3 w-3" /> Registra sin abrir
    </span>
  );
}

function RuleModal({
  tenantId,
  rule,
  onClose,
  onSaved,
}: {
  tenantId: string | null;
  rule: EntryRule | null;
  onClose: () => void;
  onSaved: (rule: EntryRule) => void;
}) {
  const [draft, setDraft] = useState<EntryRule | null>(rule);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(rule);
    setError(null);
  }, [rule]);

  if (!rule || !draft) return null;
  const vehicle = draft.arrivalMode === "vehiculo";

  const toggle = (key: EntryRuleItemKey) => {
    setDraft((d) => (d ? normalizeEntryRule({ ...d, items: { ...d.items, [key]: !d.items[key] } }) : d));
  };

  const save = async (reset = false) => {
    if (!tenantId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ rule: EntryRule }>(
        `/api/tenants/${tenantId}/entry-rules/${draft.visitKind}/${draft.arrivalMode}`,
        {
          method: "PUT",
          body: JSON.stringify(reset ? { reset: true } : { items: draft.items, openBarrier: draft.openBarrier }),
        },
      );
      onSaved(res.rule);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="md" labelledBy="ap-entry-rule-title" panelClassName="p-6">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h3 id="ap-entry-rule-title" className="text-base font-bold text-slate-900 dark:text-white">
            {visitKindText(draft.visitKind)} · {arrivalModeText(draft.arrivalMode)}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Tildá lo que portería tiene que pedir.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {GROUPS.filter((g) => vehicle || g !== "vehicle").map((g) => (
          <fieldset key={g} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
              {ENTRY_RULE_GROUP_LABEL[g]}
            </legend>
            <div className="space-y-2">
              {ENTRY_RULE_ITEMS.filter((i) => i.group === g && (vehicle || !i.vehicleOnly)).map((i) => {
                const disabled = Boolean(i.parent && !draft.items[i.parent]);
                return (
                  <label
                    key={i.key}
                    className={`flex items-center gap-2.5 text-sm ${i.parent ? "pl-6" : ""} ${
                      disabled ? "text-slate-400 dark:text-slate-600" : "text-slate-800 dark:text-slate-200"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={draft.items[i.key]}
                      disabled={disabled || saving}
                      onChange={() => toggle(i.key)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
                    />
                    {i.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}

        <fieldset className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            Barrera
          </legend>
          <label className="flex items-center gap-2.5 text-sm text-slate-800 dark:text-slate-200">
            <input
              type="checkbox"
              checked={draft.openBarrier}
              disabled={saving}
              onChange={() => setDraft((d) => (d ? { ...d, openBarrier: !d.openBarrier } : d))}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
            />
            Abrir la barrera al aprobar
          </label>
          <p className="mt-1.5 pl-6 text-xs text-slate-500 dark:text-slate-400">
            Destildado: aprobar registra el ingreso o la salida sin pulsar el relé. El guardia puede usar «Abrir igual».
          </p>
        </fieldset>
      </div>

      {error ? <p className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p> : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <button
          type="button"
          onClick={() => void save(true)}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restaurar valores por defecto
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void save(false)}
            disabled={saving}
            className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-50"
          >
            Guardar
          </button>
        </div>
      </div>
    </Modal>
  );
}
