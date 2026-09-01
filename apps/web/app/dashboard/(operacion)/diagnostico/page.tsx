"use client";

import { PageHeader } from "@/components/PageHeader";
import { DebugPanel } from "@/components/DebugPanel";

export default function DiagnosticoPage() {
  return (
    <div>
      <PageHeader
        title="Diagnóstico"
        subtitle="Cola de comandos, CGI Dahua y qué actuador está tildado para cada disparo."
      />
      <DebugPanel />
    </div>
  );
}
