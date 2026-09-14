"use client";

import { AlprPanel } from "@/components/AlprPanel";
import { ModuleGate, PageHeader } from "@/components/PageHeader";
import { useDash } from "@/components/DashboardProvider";

export default function AlprPage() {
  const { tenantId } = useDash();
  return (
    <ModuleGate module="alpr">
      <PageHeader
        title="Detecciones"
        subtitle="Lecturas de chapa y lista blanca/negra en AccesoPro. Cableá cámaras ALPR en Puntos de acceso."
      />
      {tenantId ? <AlprPanel tenantId={tenantId} /> : null}
    </ModuleGate>
  );
}
