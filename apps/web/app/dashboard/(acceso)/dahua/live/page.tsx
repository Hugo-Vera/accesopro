"use client";

import { DahuaLivePanel } from "@/components/DahuaLivePanel";
import { FeatureGate, PageHeader } from "@/components/PageHeader";

export default function DahuaLivePage() {
  return (
    <FeatureGate feature="dahua.live" capability="dahua.live">
      <PageHeader
        title="Live del lector"
        subtitle="Video continuo por RTSP del stream extra. El principal queda para el reconocimiento."
      />
      <DahuaLivePanel />
    </FeatureGate>
  );
}
