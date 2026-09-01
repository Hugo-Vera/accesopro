"use client";

import { ModuleGate } from "@/components/PageHeader";
import { ModulePlaceholder } from "@/components/modules/ModulePlaceholder";

export default function VisitasPage() {
  return (
    <ModuleGate module="visitors">
      <ModulePlaceholder
        moduleKey="visitors"
        nextSteps={[
          "Generar QR firmado con vigencia y actuador destino",
          "App vecino / link de visita",
          "Validar en portería y disparar actuador",
        ]}
      />
    </ModuleGate>
  );
}
