"use client";

import { EquipmentPanel } from "@/components/EquipmentPanel";
import { FeatureGate, PageHeader } from "@/components/PageHeader";

export default function DahuaPage() {
  return (
    <FeatureGate feature="dahua.devices" capability="access.dahua">
      <PageHeader
        title="Equipos"
        subtitle="Agregar, editar y borrar. Probá conexión, estado, abrir y foto por separado."
      />
      <EquipmentPanel />
    </FeatureGate>
  );
}
