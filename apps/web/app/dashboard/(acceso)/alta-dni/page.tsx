"use client";

import { CapabilityGate, ModuleGate, PageHeader } from "@/components/PageHeader";
import { AltaDniPanel } from "@/components/AltaDniPanel";

export default function AltaDniPage() {
  return (
    <ModuleGate module="dni_enroll">
      <CapabilityGate capability="access.dni_enroll">
        <PageHeader
          title="Alta por DNI"
          subtitle="Pegá el QR o PDF417 del DNI argentino en portería. Opcional: enrollar CardNo = DNI en el ASI."
        />
        <AltaDniPanel />
      </CapabilityGate>
    </ModuleGate>
  );
}
