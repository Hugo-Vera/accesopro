"use client";

import { ModuleGate } from "@/components/PageHeader";
import { ModulePlaceholder } from "@/components/modules/ModulePlaceholder";

export default function PanicoPage() {
  return (
    <ModuleGate module="panic">
      <ModulePlaceholder
        moduleKey="panic"
        nextSteps={[
          "Cola de alarmas en tiempo real",
          "Pines en el plano del predio",
          "SOS desde app vecino",
        ]}
      />
    </ModuleGate>
  );
}
