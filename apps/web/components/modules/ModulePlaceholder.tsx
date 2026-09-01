"use client";

import { moduleByKey, type ModuleKey } from "@accesopro/catalog";
import { PageHeader } from "@/components/PageHeader";

export function ModulePlaceholder({
  moduleKey,
  nextSteps,
}: {
  moduleKey: ModuleKey;
  nextSteps?: string[];
}) {
  const mod = moduleByKey(moduleKey);
  const steps = nextSteps ?? [
    "Definir API y eventos en apps/api",
    "Conectar UI en apps/web",
    "Probar con el barrio demo Las Acacias",
  ];

  return (
    <div>
      <PageHeader title={mod?.name ?? moduleKey} subtitle={mod?.summary} />
      <div className="rounded-2xl border border-dashed border-line bg-panel/60 p-8">
        <p className="text-sm text-muted">
          Módulo en el esqueleto del producto. La pantalla y la API todavía no están implementadas.
        </p>
        <ul className="mt-4 list-inside list-disc space-y-1 text-sm text-slate-300">
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
