"use client";

import { useEffect, useState } from "react";
import { LiveFacialAlertToast, type FacialEventAlert } from "@/components/LiveFacialAlertToast";

/**
 * Escucha `ap:facial-alert` (emitido por useOpsEvents) y muestra el toast en portal.
 */
export function FacialAlertHost({
  onOpenRelay,
}: {
  events?: unknown;
  onOpenRelay?: (deviceId: string) => void;
}) {
  const [alert, setAlert] = useState<FacialEventAlert | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FacialEventAlert>).detail;
      if (!detail?.id) return;
      setAlert(detail);
    };
    window.addEventListener("ap:facial-alert", handler as EventListener);
    return () => window.removeEventListener("ap:facial-alert", handler as EventListener);
  }, []);

  return (
    <LiveFacialAlertToast
      alert={alert}
      onDismiss={() => setAlert(null)}
      onOpenRelay={onOpenRelay}
    />
  );
}
