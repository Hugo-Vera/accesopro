"use client";

import { ModuleGate } from "@/components/PageHeader";
import { ModulePlaceholder } from "@/components/modules/ModulePlaceholder";

export default function AltaDniPage() {
  return (
    <ModuleGate module="dni_enroll">
      <ModulePlaceholder
        moduleKey="dni_enroll"
        nextSteps={[
          "Lector PDF417 / QR DNI en portería",
          "Alta de persona y vínculo con vehículo",
          "Integrar con listas del motor LAN",
        ]}
      />
    </ModuleGate>
  );
}
