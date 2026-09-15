"use client";

import { PageHeader } from "@/components/PageHeader";
import { DebugPanel } from "@/components/DebugPanel";
import { AsiDiscoveryPanel } from "@/components/AsiDiscoveryPanel";

export default function DiagnosticoPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Diagnóstico"
        subtitle="Cola de comandos, CGI Dahua, volcado crudo del lector y qué actuador está tildado para cada disparo."
      />
      <DebugPanel />
      <AsiDiscoveryPanel />
    </div>
  );
}
