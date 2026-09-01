"use client";

import { PageHeader } from "@/components/PageHeader";

export default function PlanoPage() {
  return (
    <div>
      <PageHeader
        title="Plano del predio"
        subtitle="Croquis del barrio. Los pines se arrastran cuando el módulo está contratado."
      />
      <div className="grid min-h-[420px] place-items-center rounded-2xl border border-dashed border-line bg-panel/60 p-8">
        <p className="max-w-md text-center text-sm text-slate-400">
          Acá va el mapa. Pánico y fuego aparecen cuando esos módulos están tildados. Todavía no está el editor.
        </p>
      </div>
    </div>
  );
}
