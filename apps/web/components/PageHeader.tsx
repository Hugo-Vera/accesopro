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
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}
