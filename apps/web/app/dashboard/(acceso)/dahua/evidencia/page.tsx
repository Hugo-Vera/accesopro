"use client";

import { FeatureGate, PageHeader } from "@/components/PageHeader";

export default function DahuaEvidenciaPage() {
  return (
    <FeatureGate feature="dahua.evidence" capability="dahua.evidence">
      <PageHeader
        title="Evidencia del lector"
        subtitle="Copia eventos y fotos del ASI al almacenamiento del barrio. Más retenible que el SD del equipo."
      />
      <div className="card space-y-3 p-5 text-sm text-muted">
        <p>
          Con este pack tildado, AccesoPro guarda en el barrio la foto asociada a cada acceso (cara, QR, huella o PIN),
          además del registro que ya llega en Eventos.
        </p>
        <p>
          El equipo puede seguir archivando en su memoria/SD; acá queda la copia consultable para el admin y la
          portería con permiso.
        </p>
        <p className="text-[12px]">Próximo: sync automático desde el agent + galería por fecha y equipo.</p>
      </div>
    </FeatureGate>
  );
}
