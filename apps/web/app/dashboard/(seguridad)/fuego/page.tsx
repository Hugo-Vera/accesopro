"use client";

import { ModuleGate } from "@/components/PageHeader";
import { ModulePlaceholder } from "@/components/modules/ModulePlaceholder";

export default function FuegoPage() {
  return (
    <ModuleGate module="fire">
      <ModulePlaceholder
        moduleKey="fire"
        nextSteps={[
          "Supervisar contacto del panel existente",
          "Pin de alarma en el plano",
          "No reemplaza sistema contra incendio certificado",
        ]}
      />
    </ModuleGate>
  );
}
