"use client";

import { FeatureGate, PageHeader } from "@/components/PageHeader";

export default function DahuaPeriodosPage() {
  return (
    <FeatureGate feature="dahua.schedules" capability="dahua.schedules">
      <PageHeader
        title="Periodos Dahua"
        subtitle="Franjas horarias y días festivos del terminal."
      />
      <div className="card p-5 text-sm text-muted">
        Stub. Más adelante se sincronizan los AccessTimeSchedule del equipo y se asignan a personas.
      </div>
    </FeatureGate>
  );
}
