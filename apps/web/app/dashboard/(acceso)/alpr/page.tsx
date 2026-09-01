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
        subtitle="Lecturas y fotos de AccesoSeguro. Cámaras, ROI y listas se configuran en el motor de LAN."
      />
      {tenantId ? <AlprPanel tenantId={tenantId} /> : null}
    </ModuleGate>
  );
}
