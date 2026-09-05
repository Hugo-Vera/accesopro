"use client";

import { OwnerPortal } from "@/components/owner/OwnerPortal";

export default function PortalPage() {
  return (
    <main className="min-h-screen bg-slate-100/70 text-slate-900 dark:bg-slate-950 dark:text-slate-100 px-4 py-6 transition-colors">
      <OwnerPortal />
    </main>
  );
}
