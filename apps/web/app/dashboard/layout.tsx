"use client";

import { DashboardProvider } from "@/components/DashboardProvider";
import { AppFrame } from "@/components/AppFrame";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <AppFrame>{children}</AppFrame>
    </DashboardProvider>
  );
}
