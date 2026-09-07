"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FeatureGate, PageHeader } from "@/components/PageHeader";

/** Stub: la galería todavía no está; redirige a Eventos (fotos por acceso). */
export default function DahuaEvidenciaPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/dahua/eventos");
  }, [router]);

  return (
    <FeatureGate feature="dahua.evidence" capability="dahua.evidence">
      <PageHeader title="Evidencia del lector" subtitle="Redirigiendo a Eventos…" />
      <p className="text-sm text-muted">
        La copia local de fotos llega en una próxima versión. Por ahora las fotos están en{" "}
        <button
          type="button"
          className="text-blue-600 underline dark:text-sky-400"
          onClick={() => router.replace("/dashboard/dahua/eventos")}
        >
          Eventos
        </button>
        .
      </p>
    </FeatureGate>
  );
}
