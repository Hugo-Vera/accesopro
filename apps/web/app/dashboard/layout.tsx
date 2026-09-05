"use client";

import { DashboardProvider } from "@/components/DashboardProvider";
import { AppFrame } from "@/components/AppFrame";
import { ToastProvider } from "@/components/Toast";
import { ThemeProvider } from "@/components/ThemeProvider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <DashboardProvider>
          <AppFrame>{children}</AppFrame>
        </DashboardProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
