"use client";

import { CapabilityGate } from "@/components/PageHeader";
import { ManualView } from "@/components/ManualView";

export default function ManualPage() {
  return (
    <CapabilityGate capability="core.config">
      <ManualView />
    </CapabilityGate>
  );
}
