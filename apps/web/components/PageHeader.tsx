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
  children,
}: {
  feature: string;
  capability?: string;
  children: React.ReactNode;
}) {
  const { loading, featureOn, can } = useDash();
  const router = useRouter();
  const ok = featureOn(feature) && (!capability || can(capability));

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
