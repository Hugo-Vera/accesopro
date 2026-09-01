"use client";

import { DahuaPanel } from "@/components/DahuaPanel";
import { ModuleGate, PageHeader } from "@/components/PageHeader";
import { useDash } from "@/components/DashboardProvider";

export default function DahuaPage() {
  const { tenantId } = useDash();
  return (
    <ModuleGate module="dahua_access">
      <PageHeader
        title="Acceso Dahua"
        subtitle="Terminales faciales. El agent en la LAN habla CGI y pulsa el actuador con nombre."
      />
      {tenantId ? <DahuaPanel tenantId={tenantId} /> : null}
    </ModuleGate>
  );
}
