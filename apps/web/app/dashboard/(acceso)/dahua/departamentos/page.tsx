"use client";

import { FeatureGate, PageHeader } from "@/components/PageHeader";
import { DepartmentsPanel } from "@/components/DepartmentsPanel";

export default function DahuaDepartamentosPage() {
  return (
    <FeatureGate feature="dahua.persons" capability="dahua.persons">
      <PageHeader
        title="Sectores"
        subtitle="Sectores del barrio (ej. Personal General) con horario habitual del lector."
      />
      <DepartmentsPanel />
    </FeatureGate>
  );
}
