"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { FeatureGate, PageHeader } from "@/components/PageHeader";
import { PersonsPanel } from "@/components/PersonsPanel";

function PersonasInner() {
  const params = useSearchParams();
  const q = params.get("q") ?? "";

  return (
    <FeatureGate feature="dahua.persons" capability="dahua.persons">
      <PageHeader
        title="Personas"
        subtitle="Registro fácil: cara + QR para el lector. Listar y borrar desde acá."
      />
      <PersonsPanel initialSearch={q} />
    </FeatureGate>
  );
}

export default function DahuaPersonasPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Cargando personas…</p>}>
      <PersonasInner />
    </Suspense>
  );
}
