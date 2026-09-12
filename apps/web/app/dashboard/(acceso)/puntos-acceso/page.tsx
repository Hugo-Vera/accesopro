"use client";

import { AccessPointsPanel } from "@/components/AccessPointsPanel";
import { CapabilityGate, ModuleGate, PageHeader } from "@/components/PageHeader";

export default function PuntosAccesoPage() {
  return (
    <ModuleGate module="actuators">
      <CapabilityGate capability="core.config">
        <PageHeader
          title="Puntos de acceso"
          subtitle="Cableá lectores, relés y cámaras a cada entrada o salida. El disparo usa solo lo vinculado acá."
        />
        <AccessPointsPanel />
      </CapabilityGate>
    </ModuleGate>
  );
}
