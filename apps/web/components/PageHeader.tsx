"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDash } from "@/components/DashboardProvider";

export function ModuleGate({ module, children }: { module: string; children: React.ReactNode }) {
  const { loading, enabled } = useDash();
  const router = useRouter();
  const ok = enabled(module);

  useEffect(() => {
    if (!loading && !ok) router.replace("/dashboard");
  }, [loading, ok, router]);

  if (loading) return null;
  if (!ok) return <p className="text-sm text-slate-400">Este módulo no está contratado.</p>;
  return children;
}

export function CapabilityGate({
  capability,
  children,
}: {
  capability: string;
  children: React.ReactNode;
}) {
  const { loading, can } = useDash();
  const router = useRouter();
  const ok = can(capability);

  useEffect(() => {
    if (!loading && !ok) router.replace("/dashboard");
  }, [loading, ok, router]);

  if (loading) return null;
  if (!ok) return <p className="text-sm text-muted">No tenés permiso para esta sección.</p>;
  return children;
}

export function FeatureGate({
  feature,
  capability,
  orModule,
  children,
}: {
  feature: string;
  capability?: string;
  /** Si el pack no está tildado pero el módulo sí, igual deja pasar (ej. eventos con dahua_access). */
  orModule?: string;
  children: React.ReactNode;
}) {
  const { loading, featureOn, can, enabled } = useDash();
  const router = useRouter();
  const featureOk = featureOn(feature) || (orModule ? enabled(orModule) : false);
  const ok = featureOk && (!capability || can(capability));

  useEffect(() => {
    if (!loading && !ok) router.replace("/dashboard");
  }, [loading, ok, router]);

  if (loading) return null;
  if (!ok) return <p className="text-sm text-muted">Esta función no está habilitada o no tenés permiso.</p>;
  return children;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function SectionTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (tabs.length < 2) return null;
  return (
    <div className="mb-5 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              active
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
