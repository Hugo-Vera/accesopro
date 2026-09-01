"use client";

import { ActuatorsPanel } from "@/components/ActuatorsPanel";
import { ModuleGate, PageHeader } from "@/components/PageHeader";

export default function ActuadoresPage() {
  return (
    <ModuleGate module="actuators">
      <PageHeader
        title="Actuadores"
        subtitle="Agregá el relé y tildá si lo abre la chapa, la cara, el QR o el botón."
      />
      <ActuatorsPanel />
    </ModuleGate>
  );
}
