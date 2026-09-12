"use client";

import { PageHeader } from "@/components/PageHeader";
import { PredioMap } from "@/components/PredioMap";

export default function PlanoPage() {
  return (
    <div>
      <PageHeader
        title="Plano del predio"
        subtitle="Pines de puntos de acceso. Pánico y fuego aparecen cuando esos módulos están tildados."
      />
      <PredioMap />
    </div>
  );
}
