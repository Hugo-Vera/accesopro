"use client";

import { FeatureGate, PageHeader } from "@/components/PageHeader";

export default function DahuaQrPage() {
  return (
    <FeatureGate feature="dahua.qr" capability="dahua.qr">
      <PageHeader
        title="QR del equipo"
        subtitle="Ajustes nativos del ASI: lectura/exposición de QR y validez global."
      />
      <div className="card p-5 text-sm text-muted">
        En el lector: Control de acceso → Código QR. Los pases de visita con fechas siguen siendo de AccesoPro
        (módulo Visitas); esta función es el QR nativo del ASI.
      </div>
    </FeatureGate>
  );
}
