"use client";

import { ModuleGate } from "@/components/PageHeader";
import { ModulePlaceholder } from "@/components/modules/ModulePlaceholder";

export default function FichadasPage() {
  return (
    <ModuleGate module="attendance">
      <ModulePlaceholder
        moduleKey="attendance"
        nextSteps={[
          "Importar eventos de terminales Dahua",
          "Reportes de entrada/salida por persona",
          "Export CSV para liquidación",
        ]}
      />
    </ModuleGate>
  );
}
