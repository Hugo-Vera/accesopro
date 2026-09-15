"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { FeatureGate, PageHeader, SectionTabs } from "@/components/PageHeader";
import { PersonsPanel } from "@/components/PersonsPanel";
import { DepartmentsPanel } from "@/components/DepartmentsPanel";

function PersonasInner() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get("q") ?? "";
  const tab = params.get("tab") === "sectores" ? "sectores" : "padron";

  return (
    <FeatureGate feature="dahua.persons" capability="dahua.persons">
      <PageHeader
        title={tab === "sectores" ? "Sectores" : "Padrón"}
        subtitle={
          tab === "sectores"
            ? "Sectores del barrio con horario habitual del lector."
            : "Registro fácil: cara + QR para el lector. Listar y borrar desde acá."
        }
      />
      <SectionTabs
        tabs={[
          { id: "padron", label: "Padrón" },
          { id: "sectores", label: "Sectores" },
        ]}
        value={tab}
        onChange={(id) => {
          const next = new URLSearchParams(params.toString());
          if (id === "padron") next.delete("tab");
          else next.set("tab", id);
          const qs = next.toString();
          router.replace(qs ? `/dashboard/dahua/personas?${qs}` : "/dashboard/dahua/personas");
        }}
      />
      {tab === "sectores" ? <DepartmentsPanel /> : <PersonsPanel initialSearch={q} />}
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
