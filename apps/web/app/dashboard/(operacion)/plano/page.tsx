"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { CapabilityGate, PageHeader } from "@/components/PageHeader";

const SitePlanMap = dynamic(() => import("@/components/SitePlanMap").then((m) => m.SitePlanMap), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-[420px] flex-1 place-items-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
      Cargando mapa…
    </div>
  ),
});

export default function PlanoPage() {
  return (
    <CapabilityGate capability="ops.plano">
      <div className="flex min-h-0 flex-col lg:h-[calc(100vh-7.5rem)]">
        <PageHeader
          title="Plano del predio"
          subtitle="Mapa OpenStreetMap del barrio. Dibujá lotes y ubicá las casas; quedan en el padrón de propiedades."
        />
        <Suspense
          fallback={
            <div className="grid min-h-[420px] flex-1 place-items-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Cargando mapa…
            </div>
          }
        >
          <SitePlanMap />
        </Suspense>
      </div>
    </CapabilityGate>
  );
}
