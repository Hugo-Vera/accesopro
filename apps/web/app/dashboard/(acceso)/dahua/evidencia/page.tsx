"use client";

import { FeatureGate, PageHeader } from "@/components/PageHeader";
import { EvidenciaGallery } from "@/components/EvidenciaGallery";

export default function DahuaEvidenciaPage() {
  return (
    <FeatureGate feature="dahua.evidence" capability="dahua.evidence">
      <PageHeader
        title="Evidencia del lector"
        subtitle="Fotos copiadas al historial del barrio (no se vuelven a pedir al ASI)."
      />
      <EvidenciaGallery />
    </FeatureGate>
  );
}
