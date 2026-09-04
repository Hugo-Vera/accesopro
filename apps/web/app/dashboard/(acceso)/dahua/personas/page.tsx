"use client";

import { FeatureGate, PageHeader } from "@/components/PageHeader";
import { PersonsPanel } from "@/components/PersonsPanel";

export default function DahuaPersonasPage() {
  return (
    <FeatureGate feature="dahua.persons" capability="dahua.persons">
      <PageHeader
        title="Personas"
        subtitle="Registro fácil: cara + QR para el lector. Listar y borrar desde acá."
      />
      <PersonsPanel />
    </FeatureGate>
  );
}
